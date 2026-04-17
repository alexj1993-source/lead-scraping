import { Injectable } from '@nestjs/common';
import { prisma, type SourceConfig } from '@hyperscale/database';
import type { Source, SourceTier, TierSwitchDecision, SourceHealthResult } from '@hyperscale/types';
import { tierThresholds } from '@hyperscale/config';
import { AlertService } from '../alert/alert.service';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('source');

const SOURCE_ENUM_MAP: Record<Source, string> = {
  facebook_ads: 'FACEBOOK_ADS',
  instagram: 'INSTAGRAM',
};

const TIER_MAP: Record<SourceTier, string> = {
  api: 'TIER_1_API',
  managed_service: 'TIER_2_MANAGED',
  in_house_playwright: 'TIER_3_INHOUSE',
};

const TIER_REVERSE: Record<string, SourceTier> = {
  TIER_1_API: 'api',
  TIER_2_MANAGED: 'managed_service',
  TIER_3_INHOUSE: 'in_house_playwright',
};

const SOURCE_TO_QUEUE: Record<string, string> = {
  FACEBOOK_ADS: 'scrape-facebook',
  INSTAGRAM: 'scrape-instagram',
};

@Injectable()
export class SourceService {
  constructor(
    private readonly alertService: AlertService,
    private readonly queueService: QueueService,
  ) {}

  async getSourceConfig(source: Source): Promise<SourceConfig> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    return prisma.sourceConfig.findUniqueOrThrow({
      where: { source: enumVal },
    });
  }

  async updateTierHealth(source: Source, health: any): Promise<void> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    await prisma.sourceConfig.update({
      where: { source: enumVal },
      data: { tierHealth: health },
    });
  }

  async evaluateTierSwitch(source: Source): Promise<TierSwitchDecision> {
    const config = await this.getSourceConfig(source);
    const health = (config.tierHealth as any) ?? {};
    const currentTier = TIER_REVERSE[config.activeTier] ?? 'api';

    const errorRate = health.errorRate ?? 0;
    const leadDrop = health.leadDropPct ?? 0;
    const zeroHours = health.zeroLeadHours ?? 0;

    let shouldSwitch = false;
    let reason = '';

    if (zeroHours >= tierThresholds.zeroLeadHours) {
      shouldSwitch = true;
      reason = `Zero leads for ${zeroHours}h (threshold: ${tierThresholds.zeroLeadHours}h)`;
    } else if (errorRate >= tierThresholds.errorRateThreshold) {
      shouldSwitch = true;
      reason = `Error rate ${(errorRate * 100).toFixed(0)}% exceeds ${tierThresholds.errorRateThreshold * 100}% threshold`;
    } else if (leadDrop >= tierThresholds.leadDropThreshold) {
      shouldSwitch = true;
      reason = `Lead drop ${(leadDrop * 100).toFixed(0)}% exceeds ${tierThresholds.leadDropThreshold * 100}% threshold`;
    }

    const tierOrder: SourceTier[] = ['api', 'managed_service', 'in_house_playwright'];
    const currentIdx = tierOrder.indexOf(currentTier);
    const toTier = shouldSwitch
      ? tierOrder[Math.min(currentIdx + 1, tierOrder.length - 1)]
      : currentTier;

    return { shouldSwitch, fromTier: currentTier, toTier, reason };
  }

  async executeTierSwitch(
    source: Source,
    toTier: SourceTier,
    reason: string,
  ): Promise<void> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    const tierVal = TIER_MAP[toTier] as any;

    await prisma.sourceConfig.update({
      where: { source: enumVal },
      data: { activeTier: tierVal },
    });

    await this.alertService.createAlert(
      'warning',
      'tier_switch',
      `${source} tier switched to ${toTier}`,
      reason,
      { source, toTier },
      `Switched to ${toTier}`,
    );

    logger.warn({ source, toTier, reason }, 'Tier switched');
  }

  async getSourceHealth(): Promise<Record<string, SourceHealthResult>> {
    const configs = await prisma.sourceConfig.findMany();
    const result: Record<string, SourceHealthResult> = {};

    for (const config of configs) {
      const health = (config.tierHealth as any) ?? {};
      const tier = TIER_REVERSE[config.activeTier] ?? 'api';
      result[config.source] = {
        healthy: (health.errorRate ?? 0) < tierThresholds.errorRateThreshold,
        tier,
        errorRate: health.errorRate ?? 0,
        leadsPerRun: health.leadsPerRun ?? 0,
        message: health.message,
      };
    }

    return result;
  }

  async getSources() {
    const configs = await prisma.sourceConfig.findMany();

    const results = await Promise.all(
      configs.map(async (cfg) => {
        const keywords = await prisma.keyword.findMany({
          where: { source: cfg.source as any },
          orderBy: { score: 'desc' },
        });
        const totalYield = keywords.reduce((sum, kw) => sum + kw.totalYield, 0);

        return {
          source: cfg.source,
          activeTier: cfg.activeTier,
          autoTierSwitch: cfg.autoTierSwitch,
          enabled: cfg.enabled,
          scheduleEnabled: cfg.scheduleEnabled,
          scheduleDailyTarget: cfg.scheduleDailyTarget,
          tier1Config: cfg.tier1Config,
          tier2Config: cfg.tier2Config,
          tier3Config: cfg.tier3Config,
          tierHealth: cfg.tierHealth,
          keywordCount: keywords.length,
          totalYield,
          keywords,
        };
      }),
    );

    return results;
  }

  async updateSourceConfig(
    source: string,
    data: {
      autoTierSwitch?: boolean;
      tier1Config?: any;
      tier2Config?: any;
      tier3Config?: any;
      scheduleEnabled?: boolean;
      scheduleDailyTarget?: number;
    },
  ) {
    return prisma.sourceConfig.update({
      where: { source: source as any },
      data,
    });
  }

  async toggleSource(source: string, enabled: boolean) {
    await prisma.sourceConfig.update({
      where: { source: source as any },
      data: { enabled },
    });

    logger.info({ source, enabled }, 'Source toggled');
  }

  async runSource(
    source: string,
    count: number,
  ): Promise<{ success: boolean; jobsQueued: number }> {
    const queueName = SOURCE_TO_QUEUE[source];
    if (!queueName) {
      throw new Error(`Unknown source: ${source}`);
    }

    const keywords = await prisma.keyword.findMany({
      where: { source: source as any, enabled: true },
      orderBy: { score: 'desc' },
      take: count,
    });

    if (keywords.length === 0) {
      return { success: true, jobsQueued: 0 };
    }

    const jobs = keywords.map((kw) => ({
      data: { keyword: kw.primary, maxResults: 100 },
    }));

    await this.queueService.addBulk(queueName, jobs);

    logger.info({ source, count: jobs.length }, 'Manual scrape jobs queued');
    return { success: true, jobsQueued: jobs.length };
  }

  async getTierSwitchHistory(source: Source) {
    const enumVal = SOURCE_ENUM_MAP[source];
    return prisma.alert.findMany({
      where: {
        category: 'tier_switch',
        context: { path: ['source'], equals: enumVal },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
