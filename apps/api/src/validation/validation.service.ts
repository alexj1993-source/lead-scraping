import { Injectable } from '@nestjs/common';
import { prisma, type EmailValidationResult } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import { StatsService } from '../stats/stats.service';

const NB_COST_PER_EMAIL = 0.008;
const BB_COST_PER_EMAIL = 0.008;
const BB_BASE_URL = 'https://api.bounceban.com';
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RETRIES = 3;

interface BatchResult {
  processed: number;
  passed: number;
  failed: number;
}

interface BbEmailResult {
  result: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  score: number;
  is_disposable: boolean;
  is_accept_all: boolean;
  is_role: boolean;
  is_free: boolean;
}

type NbRawResult = 'valid' | 'invalid' | 'disposable' | 'catchall' | 'unknown';

const NB_CODE_TO_STRING: Record<number, NbRawResult> = {
  0: 'valid',
  1: 'invalid',
  2: 'disposable',
  3: 'catchall',
  4: 'unknown',
};

@Injectable()
export class ValidationService {
  private logger = createLogger('validation');

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
    private readonly statsService: StatsService,
  ) {}

  // ---------------------------------------------------------------------------
  // NeverBounce Batch
  // ---------------------------------------------------------------------------

  async runNeverBounceBatch(): Promise<BatchResult> {
    const leads = await prisma.lead.findMany({
      where: { status: 'VALIDATING' },
      select: { id: true, email: true },
    });

    if (leads.length < 1) {
      this.logger.info('No VALIDATING leads to process');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const leadsWithEmails = leads.filter((l) => l.email);
    const noEmailLeads = leads.filter((l) => !l.email);

    if (noEmailLeads.length > 0) {
      await prisma.lead.updateMany({
        where: { id: { in: noEmailLeads.map((l) => l.id) } },
        data: { status: 'VALIDATED_INVALID', validatedAt: new Date() },
      });
    }

    const cached = await this.checkCacheBatch(leadsWithEmails.map((l) => l.email!));
    const uncachedLeads: typeof leadsWithEmails = [];
    const nbPassedIds: string[] = [];
    let invalidCount = noEmailLeads.length;

    for (const lead of leadsWithEmails) {
      const entry = cached.get(lead.email!);
      if (entry) {
        const mapped = this.mapNbResultToStatus(
          (entry.neverbounce?.toLowerCase() as NbRawResult) ?? 'unknown',
        );
        if (mapped.leadStatus === 'VALIDATED_INVALID') {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'VALIDATED_INVALID',
              neverbounceResult: mapped.enumValue,
              validatedAt: new Date(),
            },
          });
          invalidCount++;
        } else {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { status: 'NB_PASSED', neverbounceResult: mapped.enumValue },
          });
          nbPassedIds.push(lead.id);
        }
      } else {
        uncachedLeads.push(lead);
      }
    }

    if (uncachedLeads.length > 0) {
      const nbStopped = await this.budgetService.isHardStopped('neverbounce');
      if (nbStopped) {
        this.logger.warn('NeverBounce budget exhausted, skipping uncached leads');
        return { processed: leads.length - uncachedLeads.length, passed: nbPassedIds.length, failed: invalidCount };
      }

      const emails = uncachedLeads.map((l) => l.email!);
      const results = await this.executeWithRetry(
        () => this.runNbApi(emails),
        'NeverBounce batch',
      );

      if (!results) {
        await prisma.lead.updateMany({
          where: { id: { in: uncachedLeads.map((l) => l.id) } },
          data: { status: 'ERROR' },
        });
        return { processed: leads.length, passed: nbPassedIds.length, failed: invalidCount };
      }

      await this.budgetService.trackUsage('neverbounce', NB_COST_PER_EMAIL * emails.length);

      for (const lead of uncachedLeads) {
        const nbRaw = results.get(lead.email!) ?? 'unknown';
        const mapped = this.mapNbResultToStatus(nbRaw as NbRawResult);

        await this.upsertCacheNb(lead.email!, mapped.enumValue);

        if (mapped.leadStatus === 'VALIDATED_INVALID') {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'VALIDATED_INVALID',
              neverbounceResult: mapped.enumValue,
              isRoleBasedEmail: this.isRoleBasedEmail(lead.email!),
              validatedAt: new Date(),
            },
          });
          invalidCount++;
        } else {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'NB_PASSED',
              neverbounceResult: mapped.enumValue,
              isRoleBasedEmail: this.isRoleBasedEmail(lead.email!),
            },
          });
          nbPassedIds.push(lead.id);
        }
      }
    }

    if (invalidCount > 0) {
      await this.statsService.incrementStat(new Date(), 'leadsValidated', invalidCount);
    }

    if (nbPassedIds.length > 0) {
      await this.queueService.addJob('validate-bounceban', { leadIds: nbPassedIds });
    }

    this.logger.info(
      { total: leads.length, passed: nbPassedIds.length, invalid: invalidCount },
      'NeverBounce batch completed',
    );

    return { processed: leads.length, passed: nbPassedIds.length, failed: invalidCount };
  }

  private async runNbApi(emails: string[]): Promise<Map<string, string>> {
    const apiKey = process.env.NEVERBOUNCE_API_KEY;
    if (!apiKey) throw new Error('NEVERBOUNCE_API_KEY not set');

    const createRes = await fetch('https://api.neverbounce.com/v4.2/jobs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: apiKey,
        input: emails.map((e) => [e]),
        input_location: 'supplied',
        auto_start: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!createRes.ok) {
      throw new Error(`NB jobs/create failed: ${createRes.status} ${await createRes.text()}`);
    }

    const createData = await createRes.json();
    const jobId = createData.job_id;
    this.logger.info({ jobId, emailCount: emails.length }, 'NB batch job created');

    await this.pollNbJob(apiKey, jobId);
    return this.downloadNbResults(apiKey, jobId);
  }

  private async pollNbJob(apiKey: string, jobId: number): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const params = new URLSearchParams({ key: apiKey, job_id: String(jobId) });
      const res = await fetch(`https://api.neverbounce.com/v4.2/jobs/status?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`NB jobs/status failed: ${res.status}`);

      const data = await res.json();
      const status = data.job_status;

      if (status === 'complete') return;
      if (status === 'failed') throw new Error(`NB job ${jobId} failed: ${JSON.stringify(data)}`);

      this.logger.debug({ jobId, status }, 'NB job still processing');
      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`NB job ${jobId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }

  private async downloadNbResults(apiKey: string, jobId: number): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const params = new URLSearchParams({
        key: apiKey,
        job_id: String(jobId),
        page: String(page),
        items_per_page: '1000',
      });
      const res = await fetch(`https://api.neverbounce.com/v4.2/jobs/results?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`NB jobs/results failed: ${res.status}`);

      const data = await res.json();
      totalPages = data.total_pages ?? 1;

      for (const item of data.results ?? []) {
        const email = item.data?.[0] ?? item.data?.email;
        const rawResult = item.verification?.result;
        const result = typeof rawResult === 'number'
          ? (NB_CODE_TO_STRING[rawResult] ?? 'unknown')
          : String(rawResult ?? 'unknown');
        if (email) results.set(email.toLowerCase(), result);
      }

      page++;
    }

    this.logger.info({ jobId, resultCount: results.size }, 'NB results downloaded');
    return results;
  }

  private mapNbResultToStatus(raw: NbRawResult): {
    leadStatus: 'NB_PASSED' | 'VALIDATED_INVALID';
    enumValue: EmailValidationResult;
  } {
    switch (raw) {
      case 'valid':
        return { leadStatus: 'NB_PASSED', enumValue: 'VALID' };
      case 'invalid':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
      case 'disposable':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
      case 'catchall':
        return { leadStatus: 'NB_PASSED', enumValue: 'CATCH_ALL' };
      case 'unknown':
      default:
        return { leadStatus: 'NB_PASSED', enumValue: 'UNKNOWN' };
    }
  }

  // ---------------------------------------------------------------------------
  // BounceBan Batch (catch-all verification)
  // ---------------------------------------------------------------------------

  async runBounceBanBatch(leadIds?: string[]): Promise<BatchResult> {
    const where = leadIds?.length
      ? { id: { in: leadIds }, status: 'NB_PASSED' as const }
      : { status: 'NB_PASSED' as const };

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, email: true },
    });

    if (leads.length < 1) {
      this.logger.info('No NB_PASSED leads for BounceBan');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const bbStopped = await this.budgetService.isHardStopped('bounceban');
    if (bbStopped) {
      this.logger.warn('BounceBan budget exhausted, skipping batch');
      return { processed: 0, passed: 0, failed: 0 };
    }

    const emails = leads.filter((l) => l.email).map((l) => l.email!);
    const emailToLead = new Map(leads.map((l) => [l.email?.toLowerCase(), l]));

    const results = await this.executeWithRetry(
      () => this.runBbApi(emails),
      'BounceBan batch',
    );

    if (!results) {
      await prisma.lead.updateMany({
        where: { id: { in: leads.map((l) => l.id) } },
        data: { status: 'ERROR' },
      });
      return { processed: leads.length, passed: 0, failed: leads.length };
    }

    await this.budgetService.trackUsage('bounceban', BB_COST_PER_EMAIL * emails.length);

    let validCount = 0;
    let invalidCount = 0;
    const now = new Date();

    for (const [email, bbResult] of results) {
      const lead = emailToLead.get(email.toLowerCase());
      if (!lead) continue;

      const mapped = this.mapBbResultToStatus(bbResult);
      await this.upsertCacheBb(email, mapped.enumValue, bbResult.score);

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: mapped.leadStatus,
          bouncebanResult: mapped.enumValue,
          bouncebanScore: bbResult.score,
          isRoleBasedEmail: bbResult.is_role || this.isRoleBasedEmail(email),
          validatedAt: now,
        },
      });

      if (mapped.leadStatus === 'VALIDATED_VALID') {
        await this.queueService.addJob('personalize', { leadId: lead.id });
        validCount++;
      } else {
        invalidCount++;
      }
    }

    for (const lead of leads) {
      if (!lead.email || results.has(lead.email.toLowerCase())) continue;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'VALIDATED_VALID',
          bouncebanResult: 'UNKNOWN',
          validatedAt: now,
        },
      });
      await this.queueService.addJob('personalize', { leadId: lead.id });
      validCount++;
    }

    if (validCount > 0 || invalidCount > 0) {
      await this.statsService.incrementStat(now, 'leadsValidated', validCount + invalidCount);
    }

    this.logger.info(
      { total: leads.length, valid: validCount, invalid: invalidCount },
      'BounceBan batch completed',
    );

    return { processed: leads.length, passed: validCount, failed: invalidCount };
  }

  private async runBbApi(
    emails: string[],
  ): Promise<Map<string, BbEmailResult>> {
    const apiKey = process.env.BOUNCEBAN_API_KEY;
    if (!apiKey) throw new Error('BOUNCEBAN_API_KEY not set');

    const res = await fetch(`${BB_BASE_URL}/v1/verify/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        emails,
        greylisting_bypass: 'robust',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(`BB bulk create failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const taskId: string = data.id;
    this.logger.info({ taskId, emailCount: emails.length, credits: data.credits_remaining }, 'BB bulk task created');

    await this.pollBbTask(apiKey, taskId);
    return this.downloadBbResults(apiKey, taskId);
  }

  private async pollBbTask(apiKey: string, taskId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const params = new URLSearchParams({ id: taskId });
      const res = await fetch(`${BB_BASE_URL}/v1/verify/bulk/status?${params}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`BB bulk/status failed: ${res.status}`);

      const data = await res.json();
      const status = data.status?.toLowerCase();

      if (status === 'finished') return;
      if (status === 'failed' || status === 'error') {
        throw new Error(`BB task ${taskId} failed: ${JSON.stringify(data)}`);
      }

      this.logger.debug(
        { taskId, status, total: data.total_count, deliverable: data.deliverable_count },
        'BB task still processing',
      );
      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`BB task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }

  private async downloadBbResults(
    apiKey: string,
    taskId: string,
  ): Promise<Map<string, BbEmailResult>> {
    const results = new Map<string, BbEmailResult>();
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({ id: taskId, page_size: '3000' });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`${BB_BASE_URL}/v1/verify/bulk/dump?${params}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) throw new Error(`BB bulk/dump failed: ${res.status}`);

      const data = await res.json();
      cursor = data.cursor ?? null;

      for (const item of data.items ?? []) {
        if (!item.email) continue;
        results.set(item.email.toLowerCase(), {
          result: item.result,
          score: item.score ?? -1,
          is_disposable: item.is_disposable ?? false,
          is_accept_all: item.is_accept_all ?? false,
          is_role: item.is_role ?? false,
          is_free: item.is_free ?? false,
        });
      }
    } while (cursor);

    this.logger.info({ taskId, resultCount: results.size }, 'BB results downloaded');
    return results;
  }

  private mapBbResultToStatus(bb: BbEmailResult): {
    leadStatus: 'VALIDATED_VALID' | 'VALIDATED_INVALID';
    enumValue: EmailValidationResult;
  } {
    if (bb.is_disposable) {
      return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };
    }

    switch (bb.result) {
      case 'deliverable':
        if (bb.is_accept_all) {
          return { leadStatus: 'VALIDATED_VALID', enumValue: 'CATCH_ALL' };
        }
        return { leadStatus: 'VALIDATED_VALID', enumValue: 'VALID' };

      case 'undeliverable':
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };

      case 'risky':
        if (bb.score >= 50) {
          return { leadStatus: 'VALIDATED_VALID', enumValue: 'CATCH_ALL' };
        }
        return { leadStatus: 'VALIDATED_INVALID', enumValue: 'INVALID' };

      case 'unknown':
      default:
        return { leadStatus: 'VALIDATED_VALID', enumValue: 'UNKNOWN' };
    }
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private async checkCacheBatch(
    emails: string[],
  ): Promise<Map<string, { neverbounce: string | null; bounceban: string | null; bbScore: number | null }>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cached = await prisma.emailValidationCache.findMany({
      where: {
        email: { in: emails },
        validatedAt: { gte: thirtyDaysAgo },
      },
    });

    const map = new Map<string, { neverbounce: string | null; bounceban: string | null; bbScore: number | null }>();
    for (const c of cached) {
      if (c.neverbounce) {
        map.set(c.email, {
          neverbounce: c.neverbounce,
          bounceban: c.bounceban,
          bbScore: c.bbScore,
        });
      }
    }
    return map;
  }

  private async upsertCacheNb(email: string, result: EmailValidationResult): Promise<void> {
    try {
      await prisma.emailValidationCache.upsert({
        where: { email },
        update: { neverbounce: result, validatedAt: new Date() },
        create: { email, neverbounce: result },
      });
    } catch (err) {
      this.logger.warn({ email, err }, 'Failed to upsert NB cache');
    }
  }

  private async upsertCacheBb(
    email: string,
    result: EmailValidationResult,
    score?: number,
  ): Promise<void> {
    try {
      await prisma.emailValidationCache.upsert({
        where: { email },
        update: { bounceban: result, bbScore: score ?? null, validatedAt: new Date() },
        create: { email, bounceban: result, bbScore: score ?? null },
      });
    } catch (err) {
      this.logger.warn({ email, err }, 'Failed to upsert BB cache');
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  isRoleBasedEmail(email: string): boolean {
    const roleBasedPrefixes = [
      'info', 'hello', 'contact', 'support', 'admin', 'team',
      'sales', 'help', 'office', 'billing', 'general', 'enquiries', 'mail',
    ];
    const prefix = email.split('@')[0].toLowerCase();
    return roleBasedPrefixes.includes(prefix);
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        this.logger.error({ err, attempt, label }, `${label} attempt ${attempt}/${MAX_RETRIES} failed`);
        if (attempt >= MAX_RETRIES) return null;
        await this.sleep(5000 * attempt);
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
