import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import { StatsService } from '../stats/stats.service';
import { loadTemplate, toInstantlyFormat } from './sequence-builder';

const INSTANTLY_BASE_URL = 'https://api.instantly.ai';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables?: Record<string, string>;
}

@Injectable()
export class UploadService {
  private logger = createLogger('upload');

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
    private readonly statsService: StatsService,
  ) {}

  async uploadLead(
    leadId: string,
  ): Promise<{ success: boolean; instantlyLeadId?: string }> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { keyword: true },
    });

    if (!lead.email) {
      this.logger.warn({ leadId }, 'Lead has no email, cannot upload');
      return { success: false };
    }

    const campaign = await this.getCampaignForLead(lead);
    if (!campaign) {
      this.logger.error({ leadId, source: lead.source }, 'No campaign found');
      return { success: false };
    }

    if (!campaign.instantlyCampaignId) {
      this.logger.info(
        { campaignId: campaign.id, source: lead.source },
        'No Instantly campaign linked, triggering bootstrap',
      );
      try {
        const instantlyId = await this.bootstrapCampaign(lead.source);
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { instantlyCampaignId: instantlyId },
        });
        campaign.instantlyCampaignId = instantlyId;
      } catch (err) {
        this.logger.error({ campaignId: campaign.id, err }, 'Campaign bootstrap failed');
        await this.queueService.addJob('remediate', {
          leadId,
          trigger: 'instantly_campaign_missing',
          context: { campaignId: campaign.id, source: lead.source },
        });
        return { success: false };
      }
    }

    const formatted = this.formatLeadForInstantly(lead);

    try {
      const result = await this.callInstantlyApi('POST', '/api/v2/leads', {
        campaign_id: campaign.instantlyCampaignId,
        ...formatted,
      });

      const instantlyLeadId = result?.id ?? result?.lead_id ?? undefined;

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'UPLOADED',
          uploadedAt: new Date(),
          instantlyCampaignId: campaign.instantlyCampaignId,
          instantlyLeadId,
        },
      });

      await this.trackUploadStats(lead.source);

      this.logger.info(
        { leadId, instantlyLeadId, campaignId: campaign.instantlyCampaignId },
        'Lead uploaded to Instantly',
      );

      return { success: true, instantlyLeadId };
    } catch (err: any) {
      return this.handleUploadError(err, leadId, lead, campaign);
    }
  }

  async bootstrapCampaign(source: string): Promise<string> {
    let steps;
    try {
      const rawSteps = loadTemplate(source);
      steps = toInstantlyFormat(rawSteps);
    } catch {
      steps = null;
    }

    const campaignRes = await this.callInstantlyApi('POST', '/api/v2/campaigns', {
      name: `Hyperscale - ${source} - Auto`,
      daily_limit: 500,
    });

    const instantlyCampaignId = campaignRes.id;

    if (steps) {
      for (const step of steps) {
        await this.callInstantlyApi(
          'POST',
          `/api/v2/campaigns/${instantlyCampaignId}/sequences`,
          {
            subject: step.subject,
            body: step.body,
            delay_days: step.delay_days,
          },
        );
      }
    }

    await this.callInstantlyApi(
      'POST',
      `/api/v2/campaigns/${instantlyCampaignId}/schedule`,
      {
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        start_hour: '07:00',
        end_hour: '18:00',
        timezone: 'recipient',
      },
    );

    await prisma.paperclipAction.create({
      data: {
        category: 'campaign',
        action: 'bootstrap_instantly_campaign',
        reasoning: `Auto-created Instantly campaign for source ${source}`,
        inputContext: { source } as any,
        outputResult: { instantlyCampaignId } as any,
      },
    });

    this.logger.info(
      { source, instantlyCampaignId },
      'Instantly campaign bootstrapped',
    );

    return instantlyCampaignId;
  }

  async healthCheckCampaign(
    campaignId: string,
  ): Promise<{ healthy: boolean; detail: string }> {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });

    if (!campaign.instantlyCampaignId) {
      return { healthy: false, detail: 'No Instantly campaign linked' };
    }

    try {
      const result = await this.callInstantlyApi(
        'GET',
        `/api/v2/campaigns/${campaign.instantlyCampaignId}`,
      );

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { lastHealthCheckAt: new Date() },
      });

      if (result.status === 'paused') {
        return { healthy: false, detail: 'Campaign is paused in Instantly' };
      }

      return { healthy: true, detail: `Campaign active: ${result.name ?? campaign.name}` };
    } catch (err: any) {
      if (err.status === 404) {
        this.logger.warn(
          { campaignId, instantlyCampaignId: campaign.instantlyCampaignId },
          'Instantly campaign not found (deleted?), triggering bootstrap',
        );

        try {
          const newId = await this.bootstrapCampaign(campaign.source);
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { instantlyCampaignId: newId },
          });
          return { healthy: true, detail: `Campaign re-bootstrapped: ${newId}` };
        } catch {
          return { healthy: false, detail: 'Campaign deleted and re-bootstrap failed' };
        }
      }

      return { healthy: false, detail: `Health check error: ${err.message}` };
    }
  }

  async syncReplies(): Promise<{ synced: number; newReplies: number }> {
    let synced = 0;
    let newReplies = 0;

    try {
      const result = await this.callInstantlyApi('GET', '/api/v1/unibox/emails', {
        api_key: process.env.INSTANTLY_API_KEY,
        email_type: 'reply',
        limit: 100,
      });

      const emails = result?.data ?? result ?? [];
      if (!Array.isArray(emails)) {
        this.logger.warn({ result }, 'Unexpected Instantly unibox response format');
        return { synced: 0, newReplies: 0 };
      }

      for (const email of emails) {
        synced++;
        const replyEmail = email.from_address ?? email.from;
        if (!replyEmail) continue;

        try {
          const lead = await prisma.lead.findUnique({
            where: { email: replyEmail },
          });

          if (!lead) {
            this.logger.debug({ replyEmail }, 'Reply from unknown email, skipping');
            continue;
          }

          if (lead.emailReplied && lead.replyText) {
            continue;
          }

          const replyText = email.body ?? email.text_body ?? email.snippet ?? '';

          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              emailReplied: true,
              replyText,
              status: 'REPLIED',
              replyClassification: 'NOT_CLASSIFIED',
            },
          });

          await this.queueService.addJob('reply-classify', {
            replyId: lead.id,
            body: replyText,
            leadId: lead.id,
          });

          newReplies++;
          this.logger.info(
            { leadId: lead.id, replyEmail },
            'New reply synced and queued for classification',
          );
        } catch (err) {
          this.logger.error({ replyEmail, err }, 'Error processing reply');
        }
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch replies from Instantly');
      throw err;
    }

    this.logger.info({ synced, newReplies }, 'Reply sync complete');
    return { synced, newReplies };
  }

  private formatLeadForInstantly(lead: any): InstantlyLead {
    let firstName = lead.firstName;
    let lastName: string | undefined;

    if (!firstName && lead.fullName) {
      const parts = lead.fullName.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(' ') || undefined;
    } else if (firstName && lead.fullName) {
      const parts = lead.fullName.trim().split(/\s+/);
      if (parts.length > 1) {
        lastName = parts.slice(1).join(' ');
      }
    }

    const personalization = (lead.personalization ?? {}) as Record<string, any>;
    const customVariables: Record<string, string> = {};

    if (personalization.icebreaker) {
      customVariables.icebreaker = String(personalization.icebreaker);
    }
    if (personalization.subjectLine) {
      customVariables.subjectLine = String(personalization.subjectLine);
    }
    if (personalization.angle) {
      customVariables.angle = String(personalization.angle);
    }
    if (lead.leadMagnetDescription) {
      customVariables.leadMagnet = String(lead.leadMagnetDescription);
    }
    if (lead.source) {
      customVariables.source = String(lead.source);
    }

    return {
      email: lead.email,
      first_name: firstName ?? undefined,
      last_name: lastName,
      company_name: lead.companyName ?? undefined,
      custom_variables: Object.keys(customVariables).length > 0 ? customVariables : undefined,
    };
  }

  private async trackUploadStats(source: string): Promise<void> {
    const today = new Date();
    try {
      await this.statsService.incrementStat(today, 'leadsUploaded');

      const sourceField = source === 'FACEBOOK_ADS' || source === 'facebook_ads'
        ? 'fbLeads'
        : 'igLeads';
      await this.statsService.incrementStat(today, sourceField);

      await this.budgetService.trackUsage('instantly', 0);
    } catch (err) {
      this.logger.warn({ source, err }, 'Failed to track upload stats (non-fatal)');
    }
  }

  private async handleUploadError(
    err: any,
    leadId: string,
    lead: any,
    campaign: any,
  ): Promise<{ success: boolean; instantlyLeadId?: string }> {
    const message = err.message ?? String(err);

    if (message.includes('email already in system') || message.includes('already exists')) {
      this.logger.info(
        { leadId, email: lead.email, campaignId: campaign.instantlyCampaignId },
        'Email already in Instantly, skipping',
      );
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'UPLOADED', uploadedAt: new Date() },
      });
      return { success: true };
    }

    if (message.includes('campaign not found') || err.status === 404) {
      this.logger.error({ leadId, campaignId: campaign.instantlyCampaignId }, 'Instantly campaign not found');
      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'instantly_campaign_missing',
        context: { campaignId: campaign.id, instantlyCampaignId: campaign.instantlyCampaignId },
      });
      return { success: false };
    }

    this.logger.error({ leadId, err }, 'Instantly upload failed');
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'ERROR' },
    });
    return { success: false };
  }

  private async callInstantlyApi(
    method: string,
    path: string,
    body?: any,
  ): Promise<any> {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) throw new Error('INSTANTLY_API_KEY not configured');

    const url = new URL(path, INSTANTLY_BASE_URL);

    if (method === 'GET' && body) {
      for (const [key, value] of Object.entries(body)) {
        if (value != null) url.searchParams.set(key, String(value));
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const fetchOpts: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(30_000),
        };

        if (method !== 'GET' && body) {
          fetchOpts.body = JSON.stringify(body);
        }

        const response = await fetch(url.toString(), fetchOpts);

        const retryAfter = response.headers.get('X-RateLimit-Reset')
          ?? response.headers.get('Retry-After');

        if (response.status === 429) {
          const backoff = retryAfter
            ? Math.max(parseInt(retryAfter, 10) * 1000, INITIAL_BACKOFF_MS)
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn(
            { path, attempt, backoffMs: backoff },
            'Instantly rate limited, retrying',
          );
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          const error: any = new Error(
            `Instantly API error ${response.status}: ${errorBody}`,
          );
          error.status = response.status;
          throw error;
        }

        return response.json();
      } catch (err: any) {
        lastError = err;
        if (err.status && err.status !== 429) throw err;

        if (attempt < MAX_RETRIES - 1) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn({ path, attempt, err }, 'Instantly API call failed, retrying');
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    throw lastError ?? new Error('Instantly API call failed after retries');
  }

  private async getCampaignForLead(lead: any) {
    const campaigns = await prisma.campaign.findMany({
      where: { source: lead.source, active: true },
    });

    if (campaigns.length === 0) return null;
    if (campaigns.length === 1) return campaigns[0];

    // Load-balance: pick the campaign with the fewest uploaded leads
    const withCounts = await Promise.all(
      campaigns.map(async (c) => ({
        campaign: c,
        leadCount: c.instantlyCampaignId
          ? await prisma.lead.count({
              where: { instantlyCampaignId: c.instantlyCampaignId },
            })
          : 0,
      })),
    );

    withCounts.sort((a, b) => a.leadCount - b.leadCount);
    return withCounts[0].campaign;
  }
}
