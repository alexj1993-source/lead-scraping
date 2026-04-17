import { prisma } from '@hyperscale/database';
import type {
  DailyDigest,
  DailyMetrics,
  WeeklyStrategy,
  CmoAssessment,
  CmoMiddayStatus,
  CmoEveningSummary,
} from '@hyperscale/types';
import pino from 'pino';

import { logAction, getRecentActions } from './actions';
import { canActAutonomously, getMaxAdjustmentPct } from './authority';
import { PaperclipClient, type WeeklyStrategyInput } from './client';
import {
  postToChannel,
  formatDailyDigest,
  formatWeeklyStrategy,
  formatEscalation,
  formatHotLead,
} from './slack';

const logger = pino({ name: 'paperclip-cycles' });

function env(key: string): string {
  return process.env[key] ?? '';
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function yesterdayStart(): Date {
  const d = todayStart();
  d.setDate(d.getDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// CMO Decision Cycles (.10.1)
// ---------------------------------------------------------------------------

/**
 * Morning Assessment (6 AM) — Decide whether to run today and adjust keyword mix.
 */
export async function morningAssessment(): Promise<CmoAssessment> {
  logger.info('CMO morning assessment starting');

  const yesterday = yesterdayStart();
  const today = todayStart();

  const yesterdayStats = await prisma.dailyStats.findFirst({
    where: { date: { gte: yesterday, lt: today } },
  });

  const pipelineCounts = await Promise.all([
    prisma.lead.count({ where: { status: 'RAW' } }),
    prisma.lead.count({ where: { status: 'ENRICHING' } }),
    prisma.lead.count({ where: { status: 'SCORING' } }),
    prisma.lead.count({ where: { status: 'VALIDATING' } }),
    prisma.lead.count({ where: { status: 'PERSONALIZING' } }),
    prisma.lead.count({ where: { status: 'READY_TO_UPLOAD' } }),
    prisma.lead.count({ where: { status: 'ERROR' } }),
  ]);
  const [raw, enriching, scoring, validating, personalizing, readyToUpload, errors] = pipelineCounts;

  const degradedDomains = await prisma.domain.findMany({
    where: { healthStatus: { in: ['DEGRADED', 'BLACKLISTED'] } },
    select: { domain: true, healthStatus: true },
  });

  const budgets = await prisma.budget.findMany();
  const budgetAlerts: string[] = [];
  let budgetExhausted = false;
  for (const b of budgets) {
    const utilization = b.monthlyCapUsd > 0 ? b.currentUsageUsd / b.monthlyCapUsd : 0;
    if (utilization >= 1.0 && b.hardStopAt100) {
      budgetAlerts.push(`${b.provider} budget exhausted`);
      budgetExhausted = true;
    } else if (utilization >= 0.8) {
      budgetAlerts.push(`${b.provider} at ${(utilization * 100).toFixed(0)}% of budget`);
    }
  }

  const keywords = await prisma.keyword.findMany({
    where: { enabled: true },
    orderBy: { score: 'desc' },
  });

  const keywordAdjustments: CmoAssessment['keywordAdjustments'] = [];

  const icpPassRate = yesterdayStats?.leadsPassedIcp && yesterdayStats?.leadsScraped
    ? yesterdayStats.leadsPassedIcp / yesterdayStats.leadsScraped
    : 0;

  if (icpPassRate < 0.3 && yesterdayStats && yesterdayStats.leadsScraped > 20) {
    for (const kw of keywords) {
      if (kw.icpPassRate < 0.05 && kw.totalYield >= 100 && canActAutonomously('deactivate_low_yield_keyword')) {
        keywordAdjustments.push({ keywordId: kw.id, action: 'deactivate' });
      } else if (kw.icpPassRate < 0.15 && canActAutonomously('adjust_keyword_weights')) {
        keywordAdjustments.push({ keywordId: kw.id, action: 'decrease_weight' });
      }
    }

    for (const kw of keywords.slice(0, 5)) {
      if (kw.icpPassRate > 0.4 && canActAutonomously('adjust_keyword_weights')) {
        keywordAdjustments.push({ keywordId: kw.id, action: 'increase_weight' });
      }
    }
  }

  let shouldRun = true;
  const alerts: string[] = [...budgetAlerts];
  let reasoning = '';

  if (budgetExhausted && canActAutonomously('pause_pipeline_on_budget')) {
    shouldRun = false;
    reasoning = 'Budget exhausted on critical providers — skipping today to avoid overspend.';
  } else if (degradedDomains.length > 0 && degradedDomains.length === (await prisma.domain.count())) {
    shouldRun = false;
    reasoning = 'All sending domains are degraded or blacklisted — pausing until deliverability recovers.';
    alerts.push('All domains degraded');
  } else {
    const yesterdayUploaded = yesterdayStats?.leadsUploaded ?? 0;
    const yesterdayScraped = yesterdayStats?.leadsScraped ?? 0;
    reasoning = [
      `Yesterday: ${yesterdayScraped} scraped, ${yesterdayUploaded} uploaded, ICP rate ${(icpPassRate * 100).toFixed(1)}%.`,
      `Pipeline: ${raw} raw, ${enriching} enriching, ${scoring} scoring, ${validating} validating, ${personalizing} personalizing, ${readyToUpload} ready, ${errors} errored.`,
      degradedDomains.length > 0
        ? `${degradedDomains.length} domain(s) degraded: ${degradedDomains.map((d) => d.domain).join(', ')}.`
        : 'All domains healthy.',
      keywordAdjustments.length > 0
        ? `Adjusting ${keywordAdjustments.length} keyword(s) based on yesterday's yield.`
        : 'Keyword mix looks healthy.',
    ].join(' ');
  }

  if (degradedDomains.length > 0) {
    alerts.push(`${degradedDomains.length} degraded domain(s): ${degradedDomains.map((d) => d.domain).join(', ')}`);
  }

  for (const adj of keywordAdjustments) {
    if (adj.action === 'deactivate') {
      await prisma.keyword.update({ where: { id: adj.keywordId }, data: { enabled: false } });
    } else if (adj.action === 'decrease_weight') {
      const kw = await prisma.keyword.findUnique({ where: { id: adj.keywordId } });
      if (kw) {
        await prisma.keyword.update({
          where: { id: adj.keywordId },
          data: { score: Math.max(0, kw.score * 0.7) },
        });
      }
    } else if (adj.action === 'increase_weight') {
      const kw = await prisma.keyword.findUnique({ where: { id: adj.keywordId } });
      if (kw) {
        await prisma.keyword.update({
          where: { id: adj.keywordId },
          data: { score: Math.min(10, kw.score * 1.3) },
        });
      }
    }
  }

  const result: CmoAssessment = {
    shouldRun,
    reasoning,
    keywordAdjustments,
    volumeAdjustment: 0,
    alerts,
  };

  await logAction(
    'morning_assessment',
    shouldRun ? 'proceed with daily run' : 'skip daily run',
    reasoning,
    {
      yesterdayStats: yesterdayStats ? {
        scraped: yesterdayStats.leadsScraped,
        uploaded: yesterdayStats.leadsUploaded,
        icpPassRate,
        cost: yesterdayStats.totalCostUsd,
      } : null,
      pipeline: { raw, enriching, scoring, validating, personalizing, readyToUpload, errors },
      degradedDomains: degradedDomains.length,
      budgetAlerts,
    },
    result,
  );

  logger.info({ shouldRun, adjustments: keywordAdjustments.length, alerts: alerts.length }, 'CMO morning assessment complete');
  return result;
}

/**
 * Midday Check (12 PM) — Are we on track? Adjust volume if needed.
 */
export async function middayCheck(): Promise<CmoMiddayStatus> {
  logger.info('CMO midday check starting');

  const today = todayStart();
  const stats = await prisma.dailyStats.findFirst({
    where: { date: { gte: today } },
  });

  const scheduleCache = await prisma.apiCache.findUnique({ where: { key: 'schedule_config' } });
  const config = scheduleCache?.response as Record<string, unknown> | null;
  const dailyTarget = (config?.dailyTarget as number) ?? 500;

  const leadsToday = stats?.leadsUploaded ?? 0;
  const pctComplete = dailyTarget > 0 ? (leadsToday / dailyTarget) * 100 : 0;

  const queueNames = [
    'scrape-facebook', 'scrape-instagram', 'enrich', 'score',
    'dedup', 'validate', 'personalize', 'qa', 'upload',
  ];
  const queueHealth: CmoMiddayStatus['queueHealth'] = {};

  for (const qn of queueNames) {
    try {
      const waiting = await prisma.lead.count({
        where: {
          status: qn === 'enrich' ? 'ENRICHING' :
            qn === 'score' ? 'SCORING' :
            qn === 'validate' ? 'VALIDATING' :
            qn === 'personalize' ? 'PERSONALIZING' :
            qn === 'upload' ? 'READY_TO_UPLOAD' :
            'RAW',
        },
      });
      queueHealth[qn] = { waiting, active: 0, failed: 0 };
    } catch {
      queueHealth[qn] = { waiting: 0, active: 0, failed: 0 };
    }
  }

  const errorCount = await prisma.lead.count({
    where: { status: 'ERROR', updatedAt: { gte: today } },
  });
  queueHealth['errors_today'] = { waiting: errorCount, active: 0, failed: errorCount };

  let recommendation: CmoMiddayStatus['recommendation'] = 'continue';
  let reasoning = '';

  const hourOfDay = new Date().getHours();
  const expectedPct = ((hourOfDay - 6) / 14) * 100;

  if (pctComplete < expectedPct * 0.5 && hourOfDay > 9) {
    recommendation = 'increase_volume';
    reasoning = `Only ${pctComplete.toFixed(1)}% of daily target at midday (expected ~${expectedPct.toFixed(0)}%). Recommending volume increase.`;
  } else if (pctComplete > expectedPct * 1.5) {
    recommendation = 'decrease_volume';
    reasoning = `Already at ${pctComplete.toFixed(1)}% of target — ahead of pace. Reducing volume to save budget.`;
  } else if (errorCount > 50) {
    recommendation = 'pause';
    reasoning = `High error count today (${errorCount}). Pipeline may have systemic issues.`;
  } else {
    reasoning = `On track: ${pctComplete.toFixed(1)}% of ${dailyTarget} daily target. ${leadsToday} uploaded so far.`;
  }

  const backedUpQueues = Object.entries(queueHealth)
    .filter(([, v]) => v.waiting > 500)
    .map(([name]) => name);

  if (backedUpQueues.length > 0) {
    reasoning += ` Backed up queues: ${backedUpQueues.join(', ')}.`;
    if (recommendation === 'continue') {
      recommendation = 'continue';
      reasoning += ' Queues will clear — monitoring.';
    }
  }

  const result: CmoMiddayStatus = {
    onTrack: recommendation === 'continue' || recommendation === 'decrease_volume',
    leadsToday,
    dailyTarget,
    pctComplete,
    recommendation,
    reasoning,
    queueHealth,
  };

  await logAction(
    'midday_check',
    `midday: ${recommendation}`,
    reasoning,
    { leadsToday, dailyTarget, pctComplete, errorCount, backedUpQueues },
    result,
  );

  logger.info({ recommendation, pctComplete: pctComplete.toFixed(1), leadsToday }, 'CMO midday check complete');
  return result;
}

/**
 * Evening Wrap (8 PM) — Final stats, keyword optimization, plan next day.
 */
export async function eveningWrap(): Promise<CmoEveningSummary> {
  logger.info('CMO evening wrap starting');

  const today = todayStart();
  const stats = await prisma.dailyStats.findFirst({
    where: { date: { gte: today } },
  });

  const totalScraped = stats?.leadsScraped ?? 0;
  const totalUploaded = stats?.leadsUploaded ?? 0;
  const totalCostUsd = stats?.totalCostUsd ?? 0;

  const keywords = await prisma.keyword.findMany({
    where: { enabled: true },
    include: {
      leads: {
        where: { scrapedAt: { gte: today } },
        select: { id: true, icpPass: true, meetingBooked: true },
      },
    },
  });

  const keywordsDeactivated: string[] = [];
  const keywordsPromoted: string[] = [];

  for (const kw of keywords) {
    const todayLeads = kw.leads.length;
    const todayIcpPass = kw.leads.filter((l) => l.icpPass).length;
    const todayRate = todayLeads > 0 ? todayIcpPass / todayLeads : 0;

    if (kw.totalYield >= 100 && kw.icpPassRate < 0.05 && canActAutonomously('deactivate_low_yield_keyword')) {
      await prisma.keyword.update({ where: { id: kw.id }, data: { enabled: false } });
      keywordsDeactivated.push(kw.primary);

      await logAction(
        'keyword_optimization',
        `evening deactivate: ${kw.primary}`,
        `Yield ${kw.totalYield}, ICP rate ${(kw.icpPassRate * 100).toFixed(1)}% — below 5% threshold after 100+ leads`,
        { keywordId: kw.id, totalYield: kw.totalYield, icpPassRate: kw.icpPassRate },
        { keywordId: kw.id, disabled: true },
      );
    }

    if (todayRate > 0.5 && todayLeads >= 10 && canActAutonomously('adjust_keyword_weights')) {
      const newScore = Math.min(10, kw.score * 1.2);
      await prisma.keyword.update({ where: { id: kw.id }, data: { score: newScore } });
      keywordsPromoted.push(kw.primary);

      await logAction(
        'keyword_optimization',
        `evening promote: ${kw.primary}`,
        `Today's ICP rate ${(todayRate * 100).toFixed(1)}% on ${todayLeads} leads — boosting score`,
        { keywordId: kw.id, todayRate, todayLeads, oldScore: kw.score },
        { keywordId: kw.id, newScore },
      );
    }
  }

  const enabledKeywords = await prisma.keyword.count({ where: { enabled: true } });
  const nextDayPlan = [
    `${enabledKeywords} keywords active for tomorrow.`,
    keywordsDeactivated.length > 0
      ? `Deactivated ${keywordsDeactivated.length} low-yield keyword(s): ${keywordsDeactivated.join(', ')}.`
      : '',
    keywordsPromoted.length > 0
      ? `Promoted ${keywordsPromoted.length} high-yield keyword(s): ${keywordsPromoted.join(', ')}.`
      : '',
    totalUploaded > 0
      ? `Cost per lead today: $${(totalCostUsd / totalUploaded).toFixed(2)}.`
      : 'No uploads today.',
  ].filter(Boolean).join(' ');

  const result: CmoEveningSummary = {
    date: today.toISOString().split('T')[0],
    totalScraped,
    totalUploaded,
    totalCostUsd,
    keywordsDeactivated,
    keywordsPromoted,
    nextDayPlan,
  };

  await logAction(
    'evening_wrap',
    'evening wrap complete',
    nextDayPlan,
    { totalScraped, totalUploaded, totalCostUsd },
    result,
  );

  logger.info(
    { totalScraped, totalUploaded, deactivated: keywordsDeactivated.length, promoted: keywordsPromoted.length },
    'CMO evening wrap complete',
  );
  return result;
}

/**
 * Continuous Monitor (every 15 min) — Detect stuck jobs, error spikes, rate limits.
 */
export async function continuousMonitor(): Promise<{
  issues: Array<{ type: string; detail: string; action: string }>;
}> {
  logger.info('CMO continuous monitor starting');

  const issues: Array<{ type: string; detail: string; action: string }> = [];
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const stuckRemediations = await prisma.remediation.findMany({
    where: {
      status: 'IN_PROGRESS',
      createdAt: { lte: thirtyMinAgo },
    },
  });

  for (const rem of stuckRemediations) {
    issues.push({
      type: 'stuck_job',
      detail: `Remediation ${rem.id} (trigger: ${rem.trigger}) running for >30 min`,
      action: 'escalate',
    });

    await prisma.remediation.update({
      where: { id: rem.id },
      data: { status: 'ESCALATED', escalatedTo: 'human' },
    });
  }

  const recentErrors = await prisma.lead.count({
    where: { status: 'ERROR', updatedAt: { gte: fifteenMinAgo } },
  });

  if (recentErrors > 5) {
    issues.push({
      type: 'error_spike',
      detail: `${recentErrors} leads entered ERROR state in last 15 minutes`,
      action: recentErrors > 20 ? 'pause_and_alert' : 'alert',
    });

    const errorLeads = await prisma.lead.findMany({
      where: { status: 'ERROR', updatedAt: { gte: fifteenMinAgo } },
      select: { source: true, errorLog: true },
      take: 10,
    });

    const sourceCounts: Record<string, number> = {};
    for (const l of errorLeads) {
      sourceCounts[l.source] = (sourceCounts[l.source] ?? 0) + 1;
    }

    for (const [source, count] of Object.entries(sourceCounts)) {
      if (count >= 5 && canActAutonomously('pause_degraded_source')) {
        issues.push({
          type: 'source_error_rate',
          detail: `Source ${source}: ${count} errors in 15 min`,
          action: 'pause_source',
        });
      }
    }
  }

  const recentAlerts = await prisma.alert.findMany({
    where: {
      acknowledged: false,
      createdAt: { gte: fifteenMinAgo },
      category: { in: ['rate_limit', 'api_error'] },
    },
  });

  for (const alert of recentAlerts) {
    if (alert.category === 'rate_limit') {
      issues.push({
        type: 'rate_limit',
        detail: `Rate limit warning: ${alert.title}`,
        action: 'throttle',
      });
    }
  }

  const queueBacklog = await prisma.lead.count({ where: { status: 'RAW' } });
  if (queueBacklog > 500) {
    issues.push({
      type: 'queue_backlog',
      detail: `${queueBacklog} leads in RAW status — pipeline may be backed up`,
      action: canActAutonomously('scale_queue_concurrency') ? 'scale_concurrency' : 'alert',
    });
  }

  if (issues.length > 0) {
    await logAction(
      'continuous_monitor',
      `${issues.length} issue(s) detected`,
      issues.map((i) => `[${i.type}] ${i.detail} → ${i.action}`).join('; '),
      { issueCount: issues.length },
      { issues },
    );

    const criticalIssues = issues.filter((i) =>
      i.action === 'pause_and_alert' || i.type === 'stuck_job',
    );

    if (criticalIssues.length > 0) {
      const webhook = env('SLACK_WEBHOOK_ESCALATIONS');
      if (webhook) {
        await postToChannel(
          webhook,
          formatEscalation(
            `Continuous Monitor: ${criticalIssues.length} critical issue(s)`,
            { issues: criticalIssues },
            'Review immediately — automated remediation may be insufficient.',
            `${env('DASHBOARD_URL')}/alerts`,
          ),
        );
      }
    }
  }

  logger.info({ issueCount: issues.length }, 'CMO continuous monitor complete');
  return { issues };
}

// ---------------------------------------------------------------------------
// Existing cycles (preserved)
// ---------------------------------------------------------------------------

/**
 * 15-minute cycle: Scan alerts, DLQ, and remediations. Take autonomous actions.
 */
export async function run15MinCycle(): Promise<void> {
  const client = new PaperclipClient();
  logger.info('Starting 15-min cycle');

  const unackedAlerts = await prisma.alert.findMany({
    where: { acknowledged: false },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  for (const alert of unackedAlerts) {
    try {
      const triage = await client.triageAlert(alert);

      if (triage.canHandle && canActAutonomously('acknowledge_non_critical_alert')) {
        if (alert.severity !== 'critical') {
          await prisma.alert.update({
            where: { id: alert.id },
            data: {
              acknowledged: true,
              actionTaken: triage.action,
              resolvedAt: new Date(),
            },
          });

          await logAction(
            'alert_triage',
            `acknowledged: ${alert.title}`,
            triage.reasoning,
            { alertId: alert.id, severity: alert.severity, category: alert.category },
            { alertId: alert.id, action: triage.action },
          );
        }
      } else {
        const webhook = env('SLACK_WEBHOOK_ESCALATIONS');
        if (webhook) {
          await postToChannel(
            webhook,
            formatEscalation(
              alert.title,
              { severity: alert.severity, category: alert.category, description: alert.description },
              triage.action,
              `${env('DASHBOARD_URL')}/alerts/${alert.id}`,
            ),
          );
        }

        await logAction(
          'alert_triage',
          `escalated: ${alert.title}`,
          triage.reasoning,
          { alertId: alert.id },
          { escalated: true, canHandle: false },
        );
      }
    } catch (err) {
      logger.error({ alertId: alert.id, err }, 'Failed to triage alert');
    }
  }

  const dlqLeads = await prisma.lead.findMany({
    where: { status: 'ERROR' },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  for (const lead of dlqLeads) {
    try {
      const remediations = await prisma.remediation.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'desc' },
      });

      const review = await client.reviewDlqItem({
        leadId: lead.id,
        status: lead.status,
        companyName: lead.companyName,
        email: lead.email,
        errorLog: lead.errorLog,
        remediationHistory: remediations.map((r) => ({
          trigger: r.trigger,
          strategy: r.strategy,
          status: r.status,
          attempts: r.attempts,
        })),
      });

      if (review.action === 'retry' && canActAutonomously('retry_failed_job')) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: 'RAW' },
        });

        await logAction(
          'dlq_processing',
          `retry: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'retry', leadId: lead.id },
        );
      } else if (review.action === 'discard' && canActAutonomously('requeue_dlq_items')) {
        await logAction(
          'dlq_processing',
          `discard: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'discard', leadId: lead.id },
        );
      } else {
        await logAction(
          'dlq_processing',
          `escalate: ${lead.companyName}`,
          review.reasoning,
          { leadId: lead.id },
          { action: 'escalate', leadId: lead.id },
        );
      }
    } catch (err) {
      logger.error({ leadId: lead.id, err }, 'Failed to review DLQ item');
    }
  }

  const pendingRemediations = await prisma.remediation.findMany({
    where: { status: 'PENDING' },
    take: 10,
  });

  for (const rem of pendingRemediations) {
    try {
      if (rem.trigger === 'session_challenge' && canActAutonomously('reauthenticate_session')) {
        await prisma.remediation.update({
          where: { id: rem.id },
          data: { status: 'IN_PROGRESS', actor: 'paperclip' },
        });

        await logAction(
          'session_reauth',
          `reauth triggered for remediation ${rem.id}`,
          'Session challenge detected, initiating auto-reauth',
          { remediationId: rem.id, trigger: rem.trigger },
          { status: 'in_progress' },
        );
      }
    } catch (err) {
      logger.error({ remediationId: rem.id, err }, 'Failed to process remediation');
    }
  }

  logger.info(
    { alerts: unackedAlerts.length, dlq: dlqLeads.length, remediations: pendingRemediations.length },
    '15-min cycle complete',
  );
}

/**
 * Hourly cycle: Source health, budget pacing, reply inbox, tier switch confirmations.
 */
export async function runHourlyCycle(): Promise<void> {
  const client = new PaperclipClient();
  logger.info('Starting hourly cycle');

  const sourceConfigs = await prisma.sourceConfig.findMany();
  for (const sc of sourceConfigs) {
    try {
      const health = sc.tierHealth as Record<string, unknown> | null;
      if (!health) continue;

      const errorRate = (health.errorRate as number) ?? 0;
      const leadsPerRun = (health.leadsPerRun as number) ?? 0;

      if (errorRate > 0.3 || leadsPerRun === 0) {
        logger.warn({ source: sc.source, errorRate, leadsPerRun }, 'Source degradation detected');
        await logAction(
          'campaign_health',
          `source degradation: ${sc.source}`,
          `Error rate ${(errorRate * 100).toFixed(1)}%, leads/run: ${leadsPerRun}`,
          { source: sc.source, health },
          { flagged: true },
        );
      }
    } catch (err) {
      logger.error({ source: sc.source, err }, 'Failed to check source health');
    }
  }

  const budgets = await prisma.budget.findMany();
  for (const budget of budgets) {
    const utilization = budget.monthlyCapUsd > 0
      ? budget.currentUsageUsd / budget.monthlyCapUsd
      : 0;

    if (utilization >= 0.8) {
      await logAction(
        'budget_review',
        `budget alert: ${budget.provider} at ${(utilization * 100).toFixed(0)}%`,
        `$${budget.currentUsageUsd.toFixed(2)} of $${budget.monthlyCapUsd.toFixed(2)} cap`,
        { provider: budget.provider, utilization },
        { provider: budget.provider, utilization, atCap: utilization >= 1.0 },
      );

      if (utilization >= 1.0 && budget.hardStopAt100) {
        logger.warn({ provider: budget.provider }, 'Budget hard cap reached');
      }
    }
  }

  const positiveReplies = await prisma.lead.findMany({
    where: {
      replyClassification: 'DIRECT_INTEREST',
      meetingBooked: false,
      replyClassifiedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    take: 10,
  });

  const repliesWebhook = env('SLACK_WEBHOOK_REPLIES');
  for (const lead of positiveReplies) {
    try {
      if (repliesWebhook) {
        await postToChannel(
          repliesWebhook,
          formatHotLead(lead, '(Human must draft response — Paperclip cannot reply to leads)'),
        );
      }

      await logAction(
        'reply_analysis',
        `hot lead flagged: ${lead.companyName}`,
        'Positive reply detected, escalated to human for response',
        { leadId: lead.id, companyName: lead.companyName },
        { leadId: lead.id, escalated: true },
      );
    } catch (err) {
      logger.error({ leadId: lead.id, err }, 'Failed to flag hot lead');
    }
  }

  const recentTierActions = await prisma.paperclipAction.findMany({
    where: {
      category: 'tier_switch_review',
      performedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      humanFeedback: null,
    },
    orderBy: { performedAt: 'desc' },
  });

  for (const action of recentTierActions) {
    const output = action.outputResult as Record<string, unknown>;
    if (output?.pendingConfirmation) {
      const hoursAgo = (Date.now() - action.performedAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        logger.warn({ actionId: action.id }, 'Tier switch confirmation window expired, reverting');
        const input = action.inputContext as Record<string, unknown>;
        if (input?.source && input?.fromTier) {
          await prisma.sourceConfig.update({
            where: { source: input.source as any },
            data: { activeTier: input.fromTier as any },
          });
          await logAction(
            'tier_switch_review',
            `auto-revert: ${input.source} back to ${input.fromTier}`,
            'Confirmation window expired without human approval',
            { originalActionId: action.id },
            { reverted: true, source: input.source, revertedTo: input.fromTier },
          );
        }
      }
    }
  }

  logger.info('Hourly cycle complete');
}

/**
 * Daily cycle: Aggregate metrics, generate digest, post to Slack.
 */
export async function runDailyCycle(): Promise<DailyDigest> {
  const client = new PaperclipClient();
  logger.info('Starting daily cycle');

  const today = todayStart();
  const stats = await prisma.dailyStats.findUnique({ where: { date: today } });

  const metrics: DailyMetrics = {
    leadsScraped: stats?.leadsScraped ?? 0,
    leadsEnriched: stats?.leadsEnriched ?? 0,
    leadsPassedIcp: stats?.leadsPassedIcp ?? 0,
    leadsValidated: stats?.leadsValidated ?? 0,
    leadsUploaded: stats?.leadsUploaded ?? 0,
    leadsReplied: stats?.leadsReplied ?? 0,
    leadsBooked: stats?.leadsBooked ?? 0,
    totalCostUsd: stats?.totalCostUsd ?? 0,
    costPerLead: stats?.leadsUploaded
      ? (stats.totalCostUsd / stats.leadsUploaded)
      : 0,
    bySource: {
      facebook_ads: {
        scraped: stats?.fbLeads ?? 0,
        uploaded: 0,
        cost: stats?.apifyCostUsd ?? 0,
      },
      instagram: {
        scraped: stats?.igLeads ?? 0,
        uploaded: 0,
        cost: 0,
      },
    },
  };

  const todayAlerts = await prisma.alert.findMany({
    where: { createdAt: { gte: today } },
    orderBy: { createdAt: 'desc' },
  });

  const todayActions = await getRecentActions(24);

  const digest = await client.generateDigest(metrics, todayAlerts, todayActions);

  const webhook = env('SLACK_WEBHOOK_DAILY');
  if (webhook) {
    await postToChannel(webhook, formatDailyDigest(digest));
  }

  await logAction(
    'daily_digest',
    'daily digest generated',
    `${digest.topWins.length} wins, ${digest.topConcerns.length} concerns, ${digest.escalations.length} escalations`,
    { date: digest.date },
    { digest },
  );

  logger.info({ date: digest.date }, 'Daily cycle complete');
  return digest;
}

/**
 * Weekly cycle: Deep strategy review — keywords, personalization, budget, patterns.
 */
export async function runWeeklyCycle(): Promise<WeeklyStrategy> {
  const client = new PaperclipClient();
  logger.info('Starting weekly cycle');

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const weeklyStats = await prisma.dailyStats.findMany({
    where: { date: { gte: weekAgo } },
    orderBy: { date: 'asc' },
  });

  const rollingMetrics: Record<string, unknown> = {
    days: weeklyStats.length,
    totalScraped: weeklyStats.reduce((s, d) => s + d.leadsScraped, 0),
    totalEnriched: weeklyStats.reduce((s, d) => s + d.leadsEnriched, 0),
    totalUploaded: weeklyStats.reduce((s, d) => s + d.leadsUploaded, 0),
    totalBooked: weeklyStats.reduce((s, d) => s + d.leadsBooked, 0),
    totalCost: weeklyStats.reduce((s, d) => s + d.totalCostUsd, 0),
    dailyBreakdown: weeklyStats.map((d) => ({
      date: d.date,
      scraped: d.leadsScraped,
      uploaded: d.leadsUploaded,
      booked: d.leadsBooked,
      cost: d.totalCostUsd,
    })),
  };

  const keywords = await prisma.keyword.findMany({
    where: { enabled: true },
    orderBy: { score: 'desc' },
  });

  const keywordPerformance = keywords.map((k) => ({
    id: k.id,
    primary: k.primary,
    secondary: k.secondary,
    source: k.source,
    totalYield: k.totalYield,
    icpPassRate: k.icpPassRate,
    bookingYield: k.bookingYield,
    score: k.score,
  }));

  const bookedLeads = await prisma.lead.findMany({
    where: {
      meetingBooked: true,
      meetingBookedAt: { gte: weekAgo },
    },
    select: {
      companyName: true,
      source: true,
      country: true,
      title: true,
      leadMagnetType: true,
      icpScore: true,
      keyword: { select: { primary: true } },
    },
  });

  const budgets = await prisma.budget.findMany();
  const budgetUtilization = budgets.map((b) => ({
    provider: b.provider,
    monthlyCapUsd: b.monthlyCapUsd,
    currentUsageUsd: b.currentUsageUsd,
    utilization: b.monthlyCapUsd > 0 ? b.currentUsageUsd / b.monthlyCapUsd : 0,
  }));

  const replyStats = await prisma.lead.groupBy({
    by: ['replyClassification'],
    where: {
      replyClassification: { not: null },
      replyClassifiedAt: { gte: weekAgo },
    },
    _count: true,
  });

  const replyBreakdown: Record<string, number> = {};
  for (const r of replyStats) {
    if (r.replyClassification) {
      replyBreakdown[r.replyClassification] = r._count;
    }
  }

  const input: WeeklyStrategyInput = {
    rollingMetrics,
    keywordPerformance,
    personalizationVariants: {},
    budgetUtilization,
    replyBreakdown,
    bookedLeadProfiles: bookedLeads.map((l) => ({
      companyName: l.companyName,
      source: l.source,
      country: l.country,
      title: l.title,
      leadMagnetType: l.leadMagnetType,
      icpScore: l.icpScore,
      keyword: l.keyword?.primary,
    })),
  };

  const strategy = await client.generateWeeklyStrategy(input);

  if (canActAutonomously('enable_disable_keyword')) {
    for (const kwName of strategy.keywordRecommendations.remove) {
      const kw = await prisma.keyword.findFirst({
        where: { primary: kwName, enabled: true },
      });
      if (kw) {
        await prisma.keyword.update({
          where: { id: kw.id },
          data: { enabled: false },
        });
        await logAction(
          'keyword_optimization',
          `disabled keyword: ${kwName}`,
          strategy.keywordRecommendations.reasoning,
          { keywordId: kw.id, keyword: kwName },
          { keywordId: kw.id, disabled: true },
        );
        logger.info({ keyword: kwName }, 'Keyword disabled by weekly strategy');
      }
    }
  }

  const webhook = env('SLACK_WEBHOOK_STRATEGY');
  if (webhook) {
    await postToChannel(webhook, formatWeeklyStrategy(strategy));
  }

  await logAction(
    'weekly_strategy',
    'weekly strategy generated',
    `${strategy.keywordRecommendations.add.length} keywords to add, ${strategy.keywordRecommendations.remove.length} to remove`,
    { weekOf: strategy.weekOf },
    { strategy },
  );

  logger.info({ weekOf: strategy.weekOf }, 'Weekly cycle complete');
  return strategy;
}
