import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@hyperscale/database';
import { fetchLandingPage } from '../common/landing-page-fetcher';
import { createLogger } from '../common/logger';
import { BudgetService } from '../budget/budget.service';
import { QueueService } from '../queues/queue.service';
import { buildLeadMagnetPrompt } from './prompts';

const PRIMARY_MODEL = 'claude-sonnet-4-20250514';
const FALLBACK_MODEL = 'claude-3-5-haiku-20241022';
const MAX_TOKENS = 100;
const LEAD_MAGNET_LLM_COST = 0.003;
const FALLBACK_LEAD_MAGNET = 'your training program';
const MAX_RETRIES = 3;

interface LeadMagnetResult {
  success: boolean;
  leadMagnet: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
}

@Injectable()
export class PersonalizationService {
  private logger = createLogger('personalization');
  private anthropic: Anthropic;

  constructor(
    private readonly budgetService: BudgetService,
    private readonly queueService: QueueService,
  ) {
    this.anthropic = new Anthropic();
  }

  async personalizeLead(leadId: string): Promise<LeadMagnetResult> {
    const startTime = Date.now();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    await prisma.lead.update({ where: { id: leadId }, data: { status: 'PERSONALIZING' } });

    let title = '';
    let h1 = '';
    let description = '';

    if (lead.leadMagnetDescription) {
      description = lead.leadMagnetDescription;
      title = lead.leadMagnetType ?? '';
    } else if (lead.landingPageUrl) {
      try {
        const page = await fetchLandingPage(lead.landingPageUrl);
        if (page) {
          title = page.title;
          h1 = page.h1;
          description = page.description;
        }
      } catch (err) {
        this.logger.warn({ leadId, err }, 'Landing page fetch failed');
      }
    }

    let leadMagnet: string;
    let model = PRIMARY_MODEL;
    let tokensUsed = 0;

    try {
      const result = await this.generateLeadMagnet({
        title,
        h1,
        description,
        companyName: lead.companyName,
        landingPageUrl: lead.landingPageUrl ?? '',
      });
      leadMagnet = result.text;
      model = result.model;
      tokensUsed = result.tokensUsed;
      await this.budgetService.trackUsage('anthropic', LEAD_MAGNET_LLM_COST);
    } catch (err) {
      this.logger.warn({ leadId, err }, 'Lead magnet generation failed, using fallback');
      leadMagnet = FALLBACK_LEAD_MAGNET;
    }

    const existingPersonalization = (lead.personalization as Record<string, any>) ?? {};

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        personalization: { ...existingPersonalization, leadMagnet } as any,
        status: 'PERSONALIZED',
        personalizedAt: new Date(),
      },
    });

    await this.queueService.addJob('qa', { leadId });

    const durationMs = Date.now() - startTime;
    this.logger.info(
      { leadId, source: lead.source, durationMs, model, tokensUsed },
      'Lead personalized with lead magnet',
    );

    return { success: true, leadMagnet, model, tokensUsed, durationMs };
  }

  private async generateLeadMagnet(input: {
    title: string;
    h1: string;
    description: string;
    companyName: string;
    landingPageUrl: string;
  }): Promise<{ text: string; model: string; tokensUsed: number }> {
    const userMessage = buildLeadMagnetPrompt(input);

    for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await this.anthropic.messages.create({
            model,
            max_tokens: MAX_TOKENS,
            temperature: 0.5,
            messages: [{ role: 'user', content: userMessage }],
          });

          const raw = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');

          const tokensUsed =
            (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

          return { text: this.sanitizeLeadMagnet(raw), model, tokensUsed };
        } catch (err: any) {
          const isRateLimit = err?.status === 429;
          const isLastAttempt = attempt === MAX_RETRIES;

          if (isRateLimit && !isLastAttempt) {
            const delay = Math.pow(2, attempt) * 1000;
            this.logger.warn({ model, attempt, delay }, 'Rate limited, retrying');
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          if (isLastAttempt && model === PRIMARY_MODEL) {
            this.logger.warn({ model, err }, 'Primary model exhausted retries, trying fallback');
            break;
          }

          throw err;
        }
      }
    }

    throw new Error('All models and retries exhausted');
  }

  private sanitizeLeadMagnet(raw: string): string {
    let text = raw
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .replace(/\n/g, ' ')
      .trim()
      .toLowerCase();

    const words = text.split(/\s+/);
    if (words.length > 15) {
      text = words.slice(0, 15).join(' ');
    }

    if (!text.startsWith('your') && !text.startsWith('the')) {
      text = 'your ' + text;
    }

    return text;
  }
}
