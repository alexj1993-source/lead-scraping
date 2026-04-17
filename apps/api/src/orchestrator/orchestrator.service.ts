import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { BudgetService } from '../budget/budget.service';
import { SourceService } from '../source/source.service';
import { KeywordService } from '../keyword/keyword.service';
import { DnsMonitorService } from '../deliverability/dns-monitor.service';
import { BlacklistMonitorService } from '../deliverability/blacklist-monitor.service';
import { ReputationMonitorService } from '../deliverability/reputation-monitor.service';
import { RotationService } from '../deliverability/rotation.service';
import { RemediationService } from '../remediation/remediation.service';
import {
  morningAssessment,
  middayCheck,
  eveningWrap,
  continuousMonitor,
} from '@hyperscale/paperclip';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import type { Source } from '@hyperscale/types';
import type { ScheduleConfig } from './schedule.controller';

const logger = createLogger('orchestrator');

const SOURCES: Source[] = ['FACEBOOK_ADS', 'INSTAGRAM'];
const SOURCE_TO_QUEUE: Record<string, string> = {
  FACEBOOK_ADS: 'scrape-facebook',
  INSTAGRAM: 'scrape-instagram',
};

const SCHEDULE_CACHE_KEY = 'schedule_config';

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: true,
  cronExpression: '0 6 * * *',
  dailyTarget: 500,
  sourceWeights: { FACEBOOK_ADS: 60, INSTAGRAM: 40 },
  keywordRotationEnabled: true,
  keywordMaxUses: 10,
  timezone: 'UTC',
};

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly queue: QueueService,
    private readonly budget: BudgetService,
    private readonly source: SourceService,
    private readonly keyword: KeywordService,
    private readonly dnsMonitor: DnsMonitorService,
    private readonly blacklistMonitor: BlacklistMonitorService,
    private readonly reputationMonitor: ReputationMonitorService,
    private readonly rotation: RotationService,
    private readonly remediation: RemediationService,
  ) {}

  // -------------------------------------------------------------------------
  // Schedule config helpers
  // -------------------------------------------------------------------------

  private async getScheduleConfig(): Promise<ScheduleConfig> {
    const cached = await prisma.apiCache.findUnique({ where: { key: SCHEDULE_CACHE_KEY } });
    if (!cached) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(cached.response as object) } as ScheduleConfig;
  }

  private async isScheduleEnabled(): Promise<boolean> {
    const config = await this.getScheduleConfig();
    return config.enabled;
  }

  // -------------------------------------------------------------------------
  // CMO Decision Cycles (.10.4)
  // -------------------------------------------------------------------------

  @Cron('0 6 * * *')
  async cmoMorningAssessment() {
    if (!(await this.isScheduleEnabled())) {
      logger.info('Schedule disabled — skipping morning assessment');
      return;
    }

    logger.info('Running CMO morning assessment');
    try {
      const assessment = await morningAssessment();

      if (!assessment.shouldRun) {
        logger.warn({ reasoning: assessment.reasoning }, 'CMO says DO NOT RUN today');
        return;
      }

      logger.info({ reasoning: assessment.reasoning }, 'CMO approved daily run');
      await this.runDailyPipeline(assessment.volumeAdjustment);
    } catch (err) {
      logger.error({ err }, 'CMO morning assessment failed');
    }
  }

  @Cron('0 12 * * *')
  async cmoMiddayCheck() {
    if (!(await this.isScheduleEnabled())) return;

    logger.info('Running CMO midday check');
    try {
      const status = await middayCheck();

      if (status.recommendation === 'increase_volume') {
        logger.info('Midday: increasing volume — queueing additional scrape jobs');
        await this.runDailyPipeline(20);
      } else if (status.recommendation === 'pause') {
        logger.warn('Midday: CMO recommends pause — high error rate');
      }
    } catch (err) {
      logger.error({ err }, 'CMO midday check failed');
    }
  }

  @Cron('0 20 * * *')
  async cmoEveningWrap() {
    logger.info('Running CMO evening wrap');
    try {
      await eveningWrap();
    } catch (err) {
      logger.error({ err }, 'CMO evening wrap failed');
    }
  }

  @Cron('*/15 * * * *')
  async cmoContinuousMonitor() {
    logger.info('Running CMO continuous monitor');
    try {
      const result = await continuousMonitor();

      for (const issue of result.issues) {
        if (issue.action === 'scale_concurrency') {
          logger.info({ issue }, 'Continuous monitor: would scale concurrency');
        }

        if (issue.type === 'error_spike' || issue.type === 'source_error_rate') {
          await this.remediation.handleFailure({
            trigger: issue.type === 'source_error_rate' ? 'scraper_tier_degraded' : 'unknown',
            errorMessage: issue.detail,
            metadata: { fromContinuousMonitor: true },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, 'CMO continuous monitor failed');
    }
  }

  // -------------------------------------------------------------------------
  // Daily pipeline runner (used by CMO morning + forceRun)
  // -------------------------------------------------------------------------

  private async runDailyPipeline(volumeAdjustmentPct = 0): Promise<number> {
    const config = await this.getScheduleConfig();
    let totalJobs = 0;

    for (const src of SOURCES) {
      const srcKey = src === 'FACEBOOK_ADS' ? 'FACEBOOK_ADS' : 'INSTAGRAM';
      const weight = config.sourceWeights[srcKey as keyof typeof config.sourceWeights] ?? 50;
      const baseCount = Math.ceil((config.dailyTarget * weight) / 100 / 100);
      const adjustedCount = Math.max(1, Math.round(baseCount * (1 + volumeAdjustmentPct / 100)));

      const sourceForApi = src === 'FACEBOOK_ADS' ? 'facebook_ads' : 'instagram';
      const topKeywords = await this.keyword.getTopKeywords(sourceForApi as Source, adjustedCount);
      const queueName = SOURCE_TO_QUEUE[src];

      const maxResults = 100;
      const jobs = topKeywords.map((kw) => ({
        data: { keyword: kw.primary, maxResults },
      }));

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        totalJobs += jobs.length;
        logger.info({ source: src, jobs: jobs.length, volumeAdjustmentPct }, 'Pipeline scrape jobs queued');
      }
    }

    return totalJobs;
  }

  /**
   * Force-run the pipeline, bypassing CMO checks. Used by the "Run Now" button.
   */
  async forceRun(): Promise<{ success: boolean; jobsQueued: number }> {
    logger.info('Force run triggered — bypassing CMO checks');
    const totalJobs = await this.runDailyPipeline(0);
    return { success: true, jobsQueued: totalJobs };
  }

  // -------------------------------------------------------------------------
  // Existing cron jobs (preserved)
  // -------------------------------------------------------------------------

  @Cron('15 0 * * *')
  async overnightSummary() {
    logger.info('Running overnight Paperclip summary');
    await this.queue.addJob('paperclip-daily', {});
  }

  @Cron('0 2 * * *')
  async keywordRotation() {
    if (!(await this.isScheduleEnabled())) return;

    const config = await this.getScheduleConfig();
    if (!config.keywordRotationEnabled) {
      logger.info('Keyword rotation disabled in schedule config');
      return;
    }

    logger.info('Running keyword rotation');
    for (const src of SOURCES) {
      const sourceForApi = src === 'FACEBOOK_ADS' ? 'facebook_ads' : 'instagram';
      const topKeywords = await this.keyword.getTopKeywords(sourceForApi as Source, 20);
      logger.info(
        { source: src, count: topKeywords.length },
        'Top keywords selected',
      );
    }
  }

  @Cron('15 2 * * *')
  async queueScrapeJobs() {
    if (!(await this.isScheduleEnabled())) {
      logger.info('Schedule disabled — skipping queued scrape jobs');
      return;
    }

    logger.info('Queuing scrape jobs for all sources');

    for (const src of SOURCES) {
      const sourceForApi = src === 'FACEBOOK_ADS' ? 'facebook_ads' : 'instagram';
      const topKeywords = await this.keyword.getTopKeywords(sourceForApi as Source, 20);
      const queueName = SOURCE_TO_QUEUE[src];

      const jobs = topKeywords.map((kw) => ({
        data: { keyword: kw.primary, maxResults: 100 },
      }));

      if (jobs.length > 0) {
        await this.queue.addBulk(queueName, jobs);
        logger.info(
          { source: src, jobs: jobs.length },
          'Scrape jobs queued',
        );
      }
    }
  }

  @Cron('*/30 * * * *')
  async triggerValidationBatch() {
    const count = await prisma.lead.count({ where: { status: 'VALIDATING' } });
    if (count > 0) {
      logger.info({ count }, 'Triggering NeverBounce validation batch');
      await this.queue.addJob('validate-neverbounce', { trigger: 'cron' });
    }
  }

  @Cron('*/5 * * * *')
  async pollReplies() {
    logger.info('Polling Instantly for new replies (safety net)');
    const campaigns = await prisma.campaign.findMany({
      where: { active: true, instantlyCampaignId: { not: null } },
      select: { id: true },
    });

    for (const campaign of campaigns) {
      await this.queue.addJob('reply-sync', { campaignId: campaign.id });
    }

    if (campaigns.length > 0) {
      logger.info({ count: campaigns.length }, 'Reply poll jobs queued');
    }
  }

  @Cron('*/15 * * * *')
  async paperclip15Min() {
    logger.info('Running Paperclip 15-min triage');
    await this.queue.addJob('paperclip-15min', {});
  }

  @Cron('0 * * * *')
  async hourlyTasks() {
    logger.info('Running hourly tasks');

    const campaigns = await prisma.campaign.findMany({
      where: { active: true },
    });

    for (const campaign of campaigns) {
      await this.queue.addJob('reply-sync', {
        campaignId: campaign.id,
      });
    }

    const budgets = await this.budget.getAllBudgets();
    for (const b of budgets) {
      const check = await this.budget.checkBudget(b.provider);
      if (check.usedPct >= 80) {
        logger.warn(
          { provider: b.provider, usedPct: check.usedPct },
          'Budget alert threshold reached',
        );
      }
    }

    await this.queue.addJob('session-health-check', { provider: 'all' });
    await this.queue.addJob('paperclip-hourly', {});
  }

  @Cron('0 */6 * * *')
  async sessionHealthChecks() {
    logger.info('Running session health checks');
    const sessions = await prisma.sessionCredential.findMany({
      where: { status: 'active' },
    });

    for (const session of sessions) {
      await this.queue.addJob('session-health-check', {
        provider: session.service,
      });
    }
  }

  @Cron('55 23 * * *')
  async dailyStatsRollup() {
    logger.info('Running daily stats rollup');
    const today = new Date().toISOString().split('T')[0];
    await this.queue.addJob('stats-rollup', { date: today });
  }

  @Cron('59 23 * * *')
  async classifyRemainingReplies() {
    logger.info('Classifying remaining unclassified replies');
    const unclassified = await prisma.lead.findMany({
      where: {
        emailReplied: true,
        replyClassification: 'NOT_CLASSIFIED',
        replyText: { not: null },
      },
      select: { id: true, replyText: true },
    });

    for (const lead of unclassified) {
      await this.queue.addJob('reply-classify', {
        replyId: lead.id,
        body: lead.replyText!,
        leadId: lead.id,
      });
    }

    logger.info({ count: unclassified.length }, 'Replies queued for classification');
  }

  @Cron('30 0 * * *')
  async keywordYieldRecalc() {
    logger.info('Recalculating keyword yield scores');
    await this.keyword.recalcAllScores();
  }

  @Cron('0 7 * * *')
  async paperclipDailyDigest() {
    logger.info('Generating Paperclip daily digest');
    await this.queue.addJob('paperclip-daily', {});
  }

  @Cron('0 8 * * 1')
  async paperclipWeeklyReview() {
    logger.info('Generating Paperclip weekly strategy review');
    await this.queue.addJob('paperclip-weekly', {});
  }

  @Cron('0 */6 * * *')
  async checkDns() {
    logger.info('Running DNS compliance checks');
    try {
      await this.dnsMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'DNS compliance check failed');
    }
  }

  @Cron('0 */4 * * *')
  async checkBlacklists() {
    logger.info('Running blacklist checks');
    try {
      await this.blacklistMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'Blacklist check failed');
    }
  }

  @Cron('0 */12 * * *')
  async checkReputation() {
    logger.info('Running domain reputation checks');
    try {
      await this.reputationMonitor.checkAllDomains();
    } catch (err) {
      logger.error({ err }, 'Reputation check failed');
    }
  }

  @Cron('0 * * * *')
  async checkRotation() {
    logger.info('Running inbox rotation check');
    try {
      const events = await this.rotation.checkAndRotate();
      if (events.length > 0) {
        logger.info({ eventCount: events.length }, 'Rotation events processed');
      }
    } catch (err) {
      logger.error({ err }, 'Inbox rotation check failed');
    }
  }
}
