import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';
import { getActiveFacebookAdapter } from '@hyperscale/adapters';

const logger = createLogger('facebook-ads-processor');

interface FacebookAdsJobData {
  keyword: string;
  maxResults?: number;
  country?: string;
}

@Processor('scrape-facebook')
export class FacebookAdsProcessor extends WorkerHost {
  constructor(private readonly queueService: QueueService) {
    super();
  }

  async process(job: Job<FacebookAdsJobData>): Promise<any> {
    const { keyword, maxResults = 100, country } = job.data;
    logger.info(
      { jobId: job.id, keyword, maxResults, country },
      'Processing Facebook Ads scrape job',
    );

    const adapter = await getActiveFacebookAdapter();

    const result = await adapter.scrape(keyword, { maxResults, country });
    logger.info(
      {
        jobId: job.id,
        totalFetched: result.metadata.leadsFound,
        qualified: result.leads.length,
      },
      'Scrape complete, persisting leads',
    );

    let created = 0;
    let skipped = 0;

    for (const lead of result.leads) {
      try {
        const existing = await prisma.lead.findFirst({
          where: {
            source: 'FACEBOOK_ADS',
            sourceHandle: lead.sourceHandle ?? undefined,
          },
          select: { id: true },
        });

        if (existing) {
          logger.debug(
            { sourceHandle: lead.sourceHandle, existingId: existing.id },
            'Advertiser already scraped, skipping',
          );
          skipped++;
          continue;
        }

        const companyNameNormalized = normalizeForDedup(
          lead.companyName,
        );

        const newLead = await prisma.lead.create({
          data: {
            source: 'FACEBOOK_ADS',
            status: 'RAW',
            companyName: lead.companyName,
            companyNameNormalized,
            sourceUrl: lead.sourceUrl,
            sourceHandle: lead.sourceHandle,
            adCreativeId: lead.adCreativeId,
            landingPageUrl: lead.landingPageUrl,
            facebookUrl: lead.facebookUrl,
            country: lead.country,
          },
        });

        await this.queueService.addJob('dedup', { leadId: newLead.id });
        created++;
      } catch (err) {
        logger.error(
          { sourceHandle: lead.sourceHandle, err },
          'Failed to persist lead',
        );
      }
    }

    logger.info(
      { jobId: job.id, created, skipped, keyword },
      'Facebook Ads scrape job completed',
    );

    return {
      keyword,
      totalFetched: result.metadata.leadsFound,
      qualified: result.leads.length,
      created,
      skipped,
      durationMs: result.metadata.durationMs,
    };
  }
}

function normalizeForDedup(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
