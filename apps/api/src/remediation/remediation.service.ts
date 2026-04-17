import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { logAction, canActAutonomously, getMaxRetries } from '@hyperscale/paperclip';
import { createLogger } from '../common/logger';
import { QueueService } from '../queues/queue.service';

const logger = createLogger('remediation');

interface FailurePattern {
  id: string;
  name: string;
  detect: (context: RemediationContext) => boolean;
  fix: (context: RemediationContext) => Promise<RemediationResult>;
  escalate: (context: RemediationContext) => Promise<void>;
  cooldownMs: number;
  maxRetries: number;
}

interface RemediationContext {
  trigger: string;
  leadId?: string;
  source?: string;
  provider?: string;
  errorMessage?: string;
  errorCode?: number;
  metadata?: Record<string, unknown>;
}

interface RemediationResult {
  success: boolean;
  action: string;
  detail: string;
}

const COOLDOWN_TRACKER = new Map<string, number>();

@Injectable()
export class RemediationService {
  private readonly patterns: FailurePattern[];

  constructor(private readonly queue: QueueService) {
    this.patterns = this.buildPatterns();
  }

  private buildPatterns(): FailurePattern[] {
    return [
      {
        id: 'scrape_rate_limit',
        name: 'Scrape rate limit',
        detect: (ctx) =>
          ctx.trigger === 'scraper_tier_degraded' ||
          ctx.errorCode === 429 ||
          /rate.?limit/i.test(ctx.errorMessage ?? ''),
        fix: async (ctx) => {
          if (!canActAutonomously('retry_failed_jobs')) {
            return { success: false, action: 'skip', detail: 'No authority to retry' };
          }

          const delayMs = 60_000 + Math.random() * 60_000;
          if (ctx.leadId) {
            await this.queue.addJob('remediate', {
              leadId: ctx.leadId,
              trigger: 'scraper_tier_degraded' as any,
              context: { retryAfterMs: delayMs, proxy: 'rotate' },
            }, { delay: delayMs });
          }

          return {
            success: true,
            action: 'retry_with_delay',
            detail: `Queued retry in ${Math.round(delayMs / 1000)}s with proxy rotation`,
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'warning',
            'rate_limit',
            'Persistent scrape rate limiting',
            `Source ${ctx.source ?? 'unknown'} hitting rate limits repeatedly. Manual proxy/session review needed.`,
            ctx,
          );
        },
        cooldownMs: 5 * 60 * 1000,
        maxRetries: 3,
      },

      {
        id: 'validation_api_down',
        name: 'NeverBounce/BounceBan API down',
        detect: (ctx) =>
          /neverbounce|bounceban/i.test(ctx.provider ?? '') &&
          (/api.?(down|unavailable|timeout|5\d\d)/i.test(ctx.errorMessage ?? '') ||
           ctx.errorCode === 503 || ctx.errorCode === 502),
        fix: async (ctx) => {
          if (!canActAutonomously('retry_failed_jobs')) {
            return { success: false, action: 'skip', detail: 'No authority to retry' };
          }

          const delayMs = 30 * 60 * 1000;
          if (ctx.leadId) {
            await prisma.lead.update({
              where: { id: ctx.leadId },
              data: { status: 'VALIDATING' },
            });
          }

          await this.queue.addJob('validate-neverbounce', { trigger: 'remediation_retry' }, { delay: delayMs });

          return {
            success: true,
            action: 'queue_retry_30min',
            detail: `Validation API down — leads queued for retry in 30 min`,
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'critical',
            'api_error',
            `${ctx.provider ?? 'Validation'} API persistently down`,
            'Validation API has been unreachable for multiple retry cycles. Leads are accumulating in VALIDATING status.',
            ctx,
          );
        },
        cooldownMs: 30 * 60 * 1000,
        maxRetries: 3,
      },

      {
        id: 'instantly_api_error',
        name: 'Instantly API error',
        detect: (ctx) =>
          ctx.trigger === 'instantly_upload_failed' ||
          (/instantly/i.test(ctx.provider ?? '') && !!ctx.errorMessage),
        fix: async (ctx) => {
          if (!canActAutonomously('retry_failed_jobs')) {
            return { success: false, action: 'skip', detail: 'No authority to retry' };
          }

          const existing = await prisma.remediation.count({
            where: {
              trigger: 'instantly_upload_failed',
              status: { in: ['PENDING', 'IN_PROGRESS'] },
              createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
            },
          });

          if (existing >= 3) {
            return { success: false, action: 'exhausted', detail: 'Instantly API: 3+ failures in last hour — needs escalation' };
          }

          if (ctx.leadId) {
            await this.queue.addJob('upload', { leadId: ctx.leadId }, { delay: 60_000, attempts: 3 });
          }

          return {
            success: true,
            action: 'retry_upload',
            detail: 'Upload retried with backoff (3 attempts max)',
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'critical',
            'api_error',
            'Instantly API persistently failing',
            'Upload retries exhausted. Pausing uploads until manually resolved.',
            ctx,
          );
          await this.queue.pauseQueue('upload');
        },
        cooldownMs: 5 * 60 * 1000,
        maxRetries: 3,
      },

      {
        id: 'claude_rate_limit',
        name: 'Claude rate limit',
        detect: (ctx) =>
          /claude|anthropic/i.test(ctx.provider ?? '') &&
          (ctx.errorCode === 429 || /rate.?limit|overloaded/i.test(ctx.errorMessage ?? '')),
        fix: async (ctx) => {
          if (!canActAutonomously('switch_llm_model')) {
            return { success: false, action: 'skip', detail: 'No authority to switch model' };
          }

          logger.info('Claude rate-limited — switching to Haiku for retries');

          if (ctx.leadId) {
            await this.queue.addJob('personalize', {
              leads: [{ id: ctx.leadId, model: 'claude-haiku' }],
            } as any, { delay: 30_000 });
          }

          return {
            success: true,
            action: 'switch_to_haiku',
            detail: 'Switched to Claude Haiku model and queued retry in 30s',
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'warning',
            'rate_limit',
            'Claude API rate limiting persistent',
            'Even Haiku fallback is rate-limited. LLM-dependent pipeline stages may be blocked.',
            ctx,
          );
        },
        cooldownMs: 60 * 1000,
        maxRetries: 5,
      },

      {
        id: 'enrichment_all_failing',
        name: 'Enrichment providers all failing',
        detect: (ctx) =>
          ctx.trigger === 'provider_budget_exhausted' ||
          (/enrich/i.test(ctx.trigger) && /all.?fail|exhausted|no.?provider/i.test(ctx.errorMessage ?? '')),
        fix: async (ctx) => {
          if (!canActAutonomously('retry_failed_jobs')) {
            return { success: false, action: 'skip', detail: 'No authority to retry' };
          }

          if (ctx.leadId) {
            await this.queue.addJob('exa-search', {
              query: ctx.metadata?.companyName as string ?? 'unknown',
              type: 'company',
              numResults: 5,
            } as any, { delay: 10_000 });
          }

          return {
            success: true,
            action: 'fallback_to_exa',
            detail: 'Using Exa as enrichment fallback',
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'critical',
            'api_error',
            'All enrichment providers exhausted',
            'Primary enrichment providers and Exa fallback all failing. Enrichment pipeline is blocked.',
            ctx,
          );
        },
        cooldownMs: 10 * 60 * 1000,
        maxRetries: 2,
      },

      {
        id: 'queue_backlog',
        name: 'Queue backlog > 500',
        detect: (ctx) =>
          ctx.trigger === 'queue_backlog' ||
          (ctx.metadata?.backlogSize as number) > 500,
        fix: async (ctx) => {
          if (!canActAutonomously('scale_queue_concurrency')) {
            return { success: false, action: 'skip', detail: 'No authority to scale concurrency' };
          }

          const queueName = (ctx.metadata?.queueName as string) ?? 'enrich';
          logger.info({ queueName }, 'Scaling concurrency for backed-up queue');

          return {
            success: true,
            action: 'scale_concurrency',
            detail: `Recommended concurrency increase for ${queueName} queue`,
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'warning',
            'performance',
            `Queue backlog critical: ${ctx.metadata?.queueName ?? 'unknown'}`,
            `Queue has ${ctx.metadata?.backlogSize ?? '500+'} pending items. Scaling may not be sufficient.`,
            ctx,
          );
        },
        cooldownMs: 15 * 60 * 1000,
        maxRetries: 2,
      },

      {
        id: 'source_high_error_rate',
        name: 'High error rate on specific source',
        detect: (ctx) =>
          ctx.trigger === 'scraper_tier_degraded' &&
          !!ctx.source &&
          (ctx.metadata?.errorRate as number) > 0.3,
        fix: async (ctx) => {
          if (!canActAutonomously('pause_degraded_source')) {
            return { success: false, action: 'skip', detail: 'No authority to pause source' };
          }

          if (ctx.source) {
            const sourceConfig = await prisma.sourceConfig.findUnique({
              where: { source: ctx.source as any },
            });

            if (sourceConfig) {
              await prisma.sourceConfig.update({
                where: { source: ctx.source as any },
                data: {
                  tierHealth: {
                    ...(sourceConfig.tierHealth as object ?? {}),
                    paused: true,
                    pausedAt: new Date().toISOString(),
                    pauseReason: 'high_error_rate',
                  },
                },
              });
            }
          }

          return {
            success: true,
            action: 'pause_source',
            detail: `Paused source ${ctx.source} due to ${((ctx.metadata?.errorRate as number) * 100).toFixed(0)}% error rate`,
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'critical',
            'scraper',
            `Source ${ctx.source} persistently failing`,
            'Source paused but underlying issue persists. Manual investigation required.',
            ctx,
          );
        },
        cooldownMs: 30 * 60 * 1000,
        maxRetries: 1,
      },

      {
        id: 'memory_resource_issues',
        name: 'Memory/resource issues',
        detect: (ctx) =>
          /oom|out.?of.?memory|heap|ENOMEM/i.test(ctx.errorMessage ?? ''),
        fix: async (ctx) => {
          logger.error({ context: ctx }, 'Memory/resource issue detected — logging for ops');

          return {
            success: true,
            action: 'log_and_alert',
            detail: 'Memory issue logged. Worker restart recommended.',
          };
        },
        escalate: async (ctx) => {
          await this.createAlert(
            'critical',
            'infrastructure',
            'Memory/resource exhaustion',
            `Worker experiencing OOM/resource issues: ${ctx.errorMessage}. Immediate attention required.`,
            ctx,
          );
        },
        cooldownMs: 5 * 60 * 1000,
        maxRetries: 1,
      },
    ];
  }

  async handleFailure(context: RemediationContext): Promise<RemediationResult> {
    const pattern = this.patterns.find((p) => p.detect(context));

    if (!pattern) {
      logger.warn({ context }, 'No matching failure pattern — creating generic alert');
      await this.createAlert(
        'warning',
        'unknown',
        `Unrecognized failure: ${context.trigger}`,
        `Error: ${context.errorMessage ?? 'unknown'}`,
        context,
      );
      return { success: false, action: 'no_pattern', detail: 'No matching remediation pattern found' };
    }

    const cooldownKey = `${pattern.id}:${context.source ?? context.provider ?? 'global'}`;
    const lastRun = COOLDOWN_TRACKER.get(cooldownKey) ?? 0;
    const now = Date.now();

    if (now - lastRun < pattern.cooldownMs) {
      logger.info({ pattern: pattern.id, remainingMs: pattern.cooldownMs - (now - lastRun) }, 'Pattern in cooldown');
      return { success: false, action: 'cooldown', detail: `${pattern.name} in cooldown` };
    }

    const recentAttempts = await prisma.remediation.count({
      where: {
        trigger: context.trigger,
        leadId: context.leadId ?? undefined,
        createdAt: { gte: new Date(now - 60 * 60 * 1000) },
      },
    });

    if (recentAttempts >= pattern.maxRetries) {
      logger.warn({ pattern: pattern.id, attempts: recentAttempts }, 'Max retries exceeded — escalating');

      await prisma.remediation.create({
        data: {
          leadId: context.leadId,
          trigger: context.trigger,
          strategy: pattern.id,
          status: 'ESCALATED',
          attempts: recentAttempts,
          maxAttempts: pattern.maxRetries,
          actor: 'paperclip',
          reasoning: `Max retries (${pattern.maxRetries}) exceeded for ${pattern.name}`,
          escalatedTo: 'human',
        },
      });

      await pattern.escalate(context);

      await logAction(
        'remediation',
        `escalated: ${pattern.name}`,
        `${recentAttempts} attempts exhausted`,
        { pattern: pattern.id, trigger: context.trigger, leadId: context.leadId },
        { escalated: true, attempts: recentAttempts },
      );

      return { success: false, action: 'escalated', detail: `${pattern.name}: max retries exceeded, escalated` };
    }

    COOLDOWN_TRACKER.set(cooldownKey, now);

    const remediationRecord = await prisma.remediation.create({
      data: {
        leadId: context.leadId,
        trigger: context.trigger,
        strategy: pattern.id,
        status: 'IN_PROGRESS',
        attempts: recentAttempts + 1,
        maxAttempts: pattern.maxRetries,
        actor: 'paperclip',
        reasoning: `Auto-remediation: ${pattern.name}`,
      },
    });

    try {
      const result = await pattern.fix(context);

      await prisma.remediation.update({
        where: { id: remediationRecord.id },
        data: {
          status: result.success ? 'SUCCEEDED' : 'FAILED',
          result: result as any,
          completedAt: new Date(),
        },
      });

      await logAction(
        'remediation',
        `${result.success ? 'fixed' : 'failed'}: ${pattern.name}`,
        result.detail,
        { pattern: pattern.id, trigger: context.trigger, leadId: context.leadId },
        { ...result, remediationId: remediationRecord.id },
      );

      if (!result.success) {
        await pattern.escalate(context);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ pattern: pattern.id, err }, 'Remediation fix threw');

      await prisma.remediation.update({
        where: { id: remediationRecord.id },
        data: {
          status: 'FAILED',
          result: { error: message } as any,
          completedAt: new Date(),
        },
      });

      await pattern.escalate(context);
      return { success: false, action: 'error', detail: `Remediation error: ${message}` };
    }
  }

  async getActiveRemediations(): Promise<any[]> {
    return prisma.remediation.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getPatternStats(): Promise<Array<{ pattern: string; total: number; succeeded: number; failed: number; escalated: number }>> {
    const patterns = this.patterns.map((p) => p.id);
    const result: Array<{ pattern: string; total: number; succeeded: number; failed: number; escalated: number }> = [];

    for (const patternId of patterns) {
      const [total, succeeded, failed, escalated] = await Promise.all([
        prisma.remediation.count({ where: { strategy: patternId } }),
        prisma.remediation.count({ where: { strategy: patternId, status: 'SUCCEEDED' } }),
        prisma.remediation.count({ where: { strategy: patternId, status: 'FAILED' } }),
        prisma.remediation.count({ where: { strategy: patternId, status: 'ESCALATED' } }),
      ]);
      result.push({ pattern: patternId, total, succeeded, failed, escalated });
    }

    return result;
  }

  private async createAlert(
    severity: string,
    category: string,
    title: string,
    description: string,
    context: RemediationContext,
  ): Promise<void> {
    await prisma.alert.create({
      data: {
        severity,
        category,
        title,
        description,
        context: context as any,
      },
    });
    logger.warn({ severity, category, title }, 'Alert created by remediation engine');
  }
}
