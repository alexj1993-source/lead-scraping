import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { PERSONAS } from '@hyperscale/config';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { AlertService } from '../alert/alert.service';
import { QueueService } from '../queues/queue.service';
import { REPLY_CLASSIFICATION_PROMPT } from './prompts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const CLASSIFICATION_LLM_COST = 0.002;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DELAYED_MS = 90 * 24 * 60 * 60 * 1000;

interface ClassificationResult {
  classification: string;
  confidence: number;
  reasoning: string;
  returnDate?: string | null;
  suggestedFollowUp?: string | null;
}

interface DraftReply {
  subject: string;
  body: string;
  draftedAt: string;
  classification: string;
}

@Injectable()
export class ReplyService {
  private logger = createLogger('reply');
  private anthropic: Anthropic;

  constructor(
    private readonly budgetService: BudgetService,
    private readonly alertService: AlertService,
    private readonly queueService: QueueService,
  ) {
    this.anthropic = new Anthropic();
  }

  async classifyReply(
    leadId: string,
  ): Promise<{ classification: string; confidence: number; autoAction?: string }> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });

    if (!lead.replyText) {
      this.logger.warn({ leadId }, 'No reply text to classify');
      return { classification: 'NOT_CLASSIFIED', confidence: 0 };
    }

    const result = await this.llmClassify(lead.replyText, {
      companyName: lead.companyName,
      firstName: lead.firstName,
      source: lead.source,
      email: lead.email,
    });

    if (result.confidence < 0.7) {
      this.logger.warn(
        { leadId, classification: result.classification, confidence: result.confidence },
        'Low confidence classification',
      );
      await this.queueService.addJob('remediate', {
        leadId,
        trigger: 'reply_classification_low_confidence',
        context: {
          classification: result.classification,
          confidence: result.confidence,
          reasoning: result.reasoning,
          replyText: lead.replyText,
        },
      });
    }

    let autoAction: string | undefined;

    try {
      switch (result.classification) {
        case 'DIRECT_INTEREST':
          await this.handleDirectInterest(lead);
          autoAction = 'draft_reply_queued_for_review';
          break;
        case 'INTEREST_OBJECTION':
          await this.handleInterestObjection(lead);
          autoAction = 'objection_draft_queued_for_review';
          break;
        case 'NOT_INTERESTED':
          await this.handleNotInterested(lead);
          autoAction = 'marked_not_interested';
          break;
        case 'OUT_OF_OFFICE':
          await this.handleOutOfOffice(lead, lead.replyText, result.returnDate);
          autoAction = 'resend_scheduled';
          break;
        case 'UNSUBSCRIBE':
          await this.handleUnsubscribe(lead);
          autoAction = 'suppressed_and_removed';
          break;
        case 'AGGRESSIVE':
          await this.handleAggressive(lead);
          autoAction = 'suppressed_flagged_for_review';
          break;
      }
    } catch (err) {
      this.logger.error(
        { leadId, classification: result.classification, err },
        'Error executing auto-action for classification',
      );
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        replyClassification: result.classification as any,
        replyClassifiedAt: new Date(),
      },
    });

    this.logger.info(
      { leadId, classification: result.classification, confidence: result.confidence, autoAction },
      'Reply classified',
    );

    return {
      classification: result.classification,
      confidence: result.confidence,
      autoAction,
    };
  }

  async processReply(payload: {
    email: string;
    body: string;
    subject?: string;
    campaignId?: string;
    instantlyLeadId?: string;
    timestamp?: string;
  }): Promise<{ leadId: string; classification: string; confidence: number } | null> {
    const lead = await prisma.lead.findFirst({
      where: {
        OR: [
          { email: payload.email },
          ...(payload.instantlyLeadId ? [{ instantlyLeadId: payload.instantlyLeadId }] : []),
        ],
      },
    });

    if (!lead) {
      this.logger.warn({ email: payload.email }, 'Reply received for unknown lead');
      return null;
    }

    const alreadyProcessed = lead.emailReplied && lead.replyClassification !== 'NOT_CLASSIFIED';
    if (alreadyProcessed) {
      this.logger.info({ leadId: lead.id }, 'Reply already processed, skipping');
      return null;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        emailReplied: true,
        replyText: payload.body,
      },
    });

    const result = await this.classifyReply(lead.id);

    return {
      leadId: lead.id,
      classification: result.classification,
      confidence: result.confidence,
    };
  }

  private async llmClassify(
    replyText: string,
    leadContext: { companyName?: string; firstName?: string | null; source?: string; email?: string | null },
  ): Promise<ClassificationResult> {
    const contextLines = [
      leadContext.companyName ? `Company: ${leadContext.companyName}` : null,
      leadContext.firstName ? `Contact: ${leadContext.firstName}` : null,
      leadContext.source ? `Source: ${leadContext.source}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const userMessage = `Lead context:\n${contextLines}\n\nReply text:\n${replyText}`;

    try {
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        temperature: 0,
        system: REPLY_CLASSIFICATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      await this.budgetService.trackUsage('anthropic', CLASSIFICATION_LLM_COST);

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in LLM classification response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        classification: String(parsed.classification).toUpperCase(),
        confidence: Number(parsed.confidence) || 0.5,
        reasoning: String(parsed.reasoning ?? ''),
        returnDate: parsed.returnDate ?? null,
        suggestedFollowUp: parsed.suggestedFollowUp ?? null,
      };
    } catch (err) {
      this.logger.error({ err, replyText: replyText.slice(0, 200) }, 'LLM classification failed');
      throw err;
    }
  }

  // ── DIRECT_INTEREST ──────────────────────────────────────────────

  private async handleDirectInterest(lead: any): Promise<void> {
    const shaul = PERSONAS.shaul;
    const firstName = lead.firstName ?? 'there';
    const subject = `Re: ${lead.companyName ?? 'Our conversation'}`;

    const draft: DraftReply = {
      subject,
      body: [
        `Hi ${firstName},`,
        '',
        `Great to hear from you! I'd love to learn more about ${lead.companyName} and see how we can help.`,
        '',
        `Here's a link to book a quick strategy session: ${shaul.calendlyUrl}`,
        '',
        `In the meantime, here's a quick overview of what we do: ${shaul.onePagerUrl}`,
        '',
        `Looking forward to connecting!`,
        '',
        shaul.signature,
      ].join('\n'),
      draftedAt: new Date().toISOString(),
      classification: 'DIRECT_INTEREST',
    };

    await prisma.lead.update({
      where: { id: lead.id },
      data: { draftReply: draft as any },
    });

    await this.alertService.createAlert(
      'HIGH',
      'POSITIVE_REPLY',
      `Direct interest from ${lead.companyName}`,
      `${firstName} (${lead.email}) expressed direct interest. Draft reply created and queued for Shaul's review.`,
      { leadId: lead.id, email: lead.email, companyName: lead.companyName, draftSubject: subject },
      'Draft reply created, queued for human review',
    );

    const slackWebhookUrl = process.env.SLACK_LEADGEN_REPLIES_WEBHOOK;
    if (slackWebhookUrl) {
      try {
        await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Hot lead reply from *${lead.companyName}*`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: [
                    `:fire: *Direct Interest - ${lead.companyName}*`,
                    `*Contact:* ${firstName} (${lead.email})`,
                    `*Source:* ${lead.source}`,
                    `*Reply:*\n>${(lead.replyText ?? '').slice(0, 500)}`,
                    `*Draft reply ready for review*`,
                  ].join('\n'),
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        this.logger.error({ err, leadId: lead.id }, 'Failed to post direct interest reply to Slack');
      }
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'direct_interest_detected',
        reasoning: `Direct interest from ${lead.companyName} (${lead.email}) — draft reply created with Calendly link, queued for Shaul's review`,
        inputContext: { leadId: lead.id, replyText: (lead.replyText ?? '').slice(0, 500) } as any,
        outputResult: { slackNotified: !!slackWebhookUrl, draftCreated: true, calendlyIncluded: true } as any,
      },
    });
  }

  // ── INTEREST_OBJECTION ───────────────────────────────────────────

  private async handleInterestObjection(lead: any): Promise<void> {
    const shaul = PERSONAS.shaul;
    const firstName = lead.firstName ?? 'there';
    const niche = lead.companyName ?? 'your';
    const subject = `Re: ${lead.companyName ?? 'Our conversation'}`;

    const draft: DraftReply = {
      subject,
      body: [
        `Hi ${firstName},`,
        '',
        `Totally understand! Just to clarify — we're not trying to sell you anything on this call. It's purely a strategy session where we share some insights that have worked for similar ${niche} businesses.`,
        '',
        `No pressure at all, but if you're curious: ${shaul.calendlyUrl}`,
        '',
        `Best,`,
        shaul.signature,
      ].join('\n'),
      draftedAt: new Date().toISOString(),
      classification: 'INTEREST_OBJECTION',
    };

    await prisma.lead.update({
      where: { id: lead.id },
      data: { draftReply: draft as any },
    });

    await this.alertService.createAlert(
      'MEDIUM',
      'INTEREST_OBJECTION',
      `Interest with objection from ${lead.companyName}`,
      `${firstName} (${lead.email}) is interested but raised a concern. Draft objection-handling reply created for Shaul's review.`,
      { leadId: lead.id, email: lead.email, companyName: lead.companyName, replySnippet: (lead.replyText ?? '').slice(0, 200) },
      'Draft objection reply created, queued for human review',
    );

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'interest_objection_detected',
        reasoning: `Interest with objection from ${lead.companyName} (${lead.email}) — deflection response drafted, queued for Shaul's review`,
        inputContext: { leadId: lead.id, replyText: (lead.replyText ?? '').slice(0, 500) } as any,
        outputResult: { draftCreated: true, objectionHandlingPending: true } as any,
      },
    });
  }

  // ── NOT_INTERESTED ───────────────────────────────────────────────

  private async handleNotInterested(lead: any): Promise<void> {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'REPLIED' },
    });

    if (lead.instantlyCampaignId && lead.email) {
      await this.removeFromInstantlyCampaign(lead.email, lead.instantlyCampaignId);
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'not_interested_processed',
        reasoning: `Not interested reply from ${lead.email} (${lead.companyName}) — removed from campaign, status set to REPLIED`,
        inputContext: { leadId: lead.id, email: lead.email } as any,
        outputResult: { removedFromCampaign: !!lead.instantlyCampaignId, statusUpdated: 'REPLIED' } as any,
      },
    });
  }

  // ── OUT_OF_OFFICE ────────────────────────────────────────────────

  private async handleOutOfOffice(lead: any, replyText: string, llmReturnDate?: string | null): Promise<void> {
    let returnDate: Date | null = null;

    if (llmReturnDate) {
      const parsed = new Date(llmReturnDate);
      if (!isNaN(parsed.getTime())) {
        returnDate = parsed;
      }
    }

    if (!returnDate) {
      returnDate = this.extractReturnDateRegex(replyText);
    }

    let delayMs: number;
    if (returnDate) {
      const reEngageDate = new Date(returnDate);
      reEngageDate.setDate(reEngageDate.getDate() + 1);
      delayMs = Math.max(0, reEngageDate.getTime() - Date.now());
    } else {
      delayMs = SEVEN_DAYS_MS;
    }

    if (delayMs > 0 && delayMs < MAX_DELAYED_MS) {
      await this.queueService.addJob(
        'upload',
        { leadId: lead.id, reEngage: true },
        { delay: delayMs },
      );
    }

    const reEngageDateStr = returnDate
      ? new Date(returnDate.getTime() + 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'out_of_office_processed',
        reasoning: `OOO from ${lead.email} — re-engagement scheduled for ${reEngageDateStr.split('T')[0]}`,
        inputContext: { leadId: lead.id, returnDateDetected: returnDate?.toISOString() ?? null } as any,
        outputResult: { reEngageDate: reEngageDateStr, delayMs } as any,
      },
    });

    this.logger.info(
      { leadId: lead.id, returnDate: returnDate?.toISOString() ?? null, reEngageDate: reEngageDateStr },
      'OOO processed, re-engagement scheduled',
    );
  }

  private extractReturnDateRegex(text: string): Date | null {
    const patterns = [
      /(?:back|return(?:ing)?|available|in the office)\s+(?:on\s+)?(\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4})/i,
      /(?:back|return(?:ing)?|available)\s+(?:on\s+)?(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
      /(?:back|return(?:ing)?|available)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime()) && parsed > new Date()) {
          return parsed;
        }
      }
    }

    return null;
  }

  // ── UNSUBSCRIBE ──────────────────────────────────────────────────

  private async handleUnsubscribe(lead: any): Promise<void> {
    if (lead.email) {
      await this.addToSuppressionList(lead.email, 'UNSUBSCRIBE', lead.id);
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'UNSUBSCRIBED' },
    });

    if (lead.email) {
      await this.removeFromAllInstantlyCampaigns(lead.email);
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'unsubscribe_processed',
        reasoning: `Unsubscribe request from ${lead.email} (${lead.companyName}) — suppressed globally, removed from all campaigns`,
        inputContext: { leadId: lead.id, email: lead.email } as any,
        outputResult: { suppressionAdded: true, removedFromCampaigns: true, statusUpdated: 'UNSUBSCRIBED' } as any,
      },
    });

    this.logger.info({ leadId: lead.id, email: lead.email }, 'Unsubscribe processed — compliance action logged');
  }

  // ── AGGRESSIVE ───────────────────────────────────────────────────

  private async handleAggressive(lead: any): Promise<void> {
    if (lead.email) {
      await this.addToSuppressionList(lead.email, 'AGGRESSIVE', lead.id);
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'UNSUBSCRIBED' },
    });

    if (lead.email) {
      await this.removeFromAllInstantlyCampaigns(lead.email);
    }

    await this.alertService.createAlert(
      'HIGH',
      'AGGRESSIVE_REPLY',
      `Aggressive reply from ${lead.companyName}`,
      `${lead.email} sent an aggressive/hostile reply. Lead has been suppressed and removed from all campaigns. Flagged for review.`,
      { leadId: lead.id, email: lead.email, companyName: lead.companyName, replySnippet: (lead.replyText ?? '').slice(0, 300) },
      'Suppressed, removed from campaigns, flagged for review',
    );

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'aggressive_reply_processed',
        reasoning: `Aggressive reply from ${lead.email} (${lead.companyName}) — suppressed, removed from all campaigns, alert created`,
        inputContext: { leadId: lead.id, email: lead.email } as any,
        outputResult: { suppressionAdded: true, removedFromCampaigns: true, alertCreated: true } as any,
      },
    });

    this.logger.warn({ leadId: lead.id, email: lead.email }, 'Aggressive reply — lead suppressed and flagged');
  }

  // ── Instantly API helpers ────────────────────────────────────────

  private async removeFromInstantlyCampaign(email: string, campaignId: string): Promise<void> {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) return;

    try {
      const res = await fetch(`https://api.instantly.ai/api/v2/leads/${encodeURIComponent(email)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ campaign_id: campaignId, status: 'completed' }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        this.logger.warn({ email, campaignId, status: res.status }, 'Instantly remove-from-campaign non-OK response');
      } else {
        this.logger.info({ email, campaignId }, 'Lead removed from Instantly campaign');
      }
    } catch (err) {
      this.logger.error({ email, campaignId, err }, 'Failed to remove lead from Instantly campaign');
    }
  }

  private async removeFromAllInstantlyCampaigns(email: string): Promise<void> {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) return;

    const campaigns = await prisma.campaign.findMany({
      where: { active: true, instantlyCampaignId: { not: null } },
      select: { instantlyCampaignId: true },
    });

    for (const campaign of campaigns) {
      if (campaign.instantlyCampaignId) {
        await this.removeFromInstantlyCampaign(email, campaign.instantlyCampaignId);
      }
    }
  }

  private async addToSuppressionList(email: string, reason: string, leadId?: string): Promise<void> {
    try {
      await prisma.suppression.upsert({
        where: { email },
        create: { email, reason, source: leadId },
        update: { reason },
      });
      this.logger.info({ email, reason }, 'Email added to suppression list');
    } catch (err) {
      this.logger.error({ email, reason, err }, 'Failed to add email to suppression list');
    }
  }

  // ── Polling: fetch new replies from Instantly ────────────────────

  async pollInstantlyReplies(campaignId: string): Promise<number> {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) {
      this.logger.warn('No INSTANTLY_API_KEY — skipping reply poll');
      return 0;
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { instantlyCampaignId: true },
    });

    if (!campaign?.instantlyCampaignId) {
      this.logger.warn({ campaignId }, 'Campaign has no Instantly campaign ID');
      return 0;
    }

    try {
      const url = new URL('https://api.instantly.ai/api/v2/emails');
      url.searchParams.set('campaign_id', campaign.instantlyCampaignId);
      url.searchParams.set('email_type', 'reply');

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        this.logger.error({ status: res.status, campaignId }, 'Instantly replies API error');
        return 0;
      }

      const data = await res.json() as any;
      const replies: any[] = data.data ?? data ?? [];
      let processed = 0;

      for (const reply of replies) {
        const email = reply.from_email ?? reply.email ?? reply.lead_email;
        const body = reply.body ?? reply.text ?? '';
        const subject = reply.subject ?? '';

        if (!email || !body) continue;

        const result = await this.processReply({
          email,
          body,
          subject,
          campaignId: campaign.instantlyCampaignId,
          timestamp: reply.timestamp ?? reply.created_at,
        });

        if (result) processed++;
      }

      this.logger.info({ campaignId, totalReplies: replies.length, processed }, 'Instantly reply poll completed');
      return processed;
    } catch (err) {
      this.logger.error({ campaignId, err }, 'Failed to poll Instantly replies');
      return 0;
    }
  }

  // ── Existing query endpoints ─────────────────────────────────────

  async getReplies(filters: {
    classification?: string;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const where: any = { emailReplied: true };
    if (filters.classification) {
      where.replyClassification = filters.classification;
    }

    return prisma.lead.findMany({
      where,
      orderBy: { replyClassifiedAt: 'desc' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
      select: {
        id: true,
        companyName: true,
        email: true,
        firstName: true,
        replyText: true,
        replyClassification: true,
        replyClassifiedAt: true,
        draftReply: true,
        source: true,
        instantlyCampaignId: true,
      },
    });
  }

  async reclassify(leadId: string, newClassification: string): Promise<void> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        replyClassification: newClassification as any,
        replyClassifiedAt: new Date(),
      },
    });

    try {
      switch (newClassification) {
        case 'DIRECT_INTEREST':
          await this.handleDirectInterest(lead);
          break;
        case 'INTEREST_OBJECTION':
          await this.handleInterestObjection(lead);
          break;
        case 'NOT_INTERESTED':
          await this.handleNotInterested(lead);
          break;
        case 'UNSUBSCRIBE':
          await this.handleUnsubscribe(lead);
          break;
        case 'AGGRESSIVE':
          await this.handleAggressive(lead);
          break;
        case 'OUT_OF_OFFICE':
          if (lead.replyText) {
            await this.handleOutOfOffice(lead, lead.replyText);
          }
          break;
      }
    } catch (err) {
      this.logger.error(
        { leadId, newClassification, err },
        'Error executing auto-action during reclassification',
      );
    }

    await prisma.paperclipAction.create({
      data: {
        category: 'reply',
        action: 'manual_reclassification',
        reasoning: `Human reclassified reply from ${lead.email} to ${newClassification}`,
        inputContext: { leadId, previousClassification: lead.replyClassification } as any,
        outputResult: { newClassification } as any,
      },
    });

    this.logger.info({ leadId, newClassification }, 'Reply manually reclassified');
  }
}
