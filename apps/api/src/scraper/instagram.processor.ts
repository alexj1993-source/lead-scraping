import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { prisma } from '@hyperscale/database';
import { InstagramScraperService } from './instagram.service';
import { QueueService } from '../queues/queue.service';
import { createLogger } from '../common/logger';

const logger = createLogger('instagram-processor');

interface InstagramJobData {
  keyword: string;
  maxResults?: number;
}

@Processor('scrape-instagram')
export class InstagramProcessor extends WorkerHost {
  constructor(
    private readonly scraperService: InstagramScraperService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<InstagramJobData>): Promise<any> {
    const { keyword, maxResults = 100 } = job.data;
    logger.info({ jobId: job.id, keyword, maxResults }, 'Processing Instagram scrape job');

    const scrapeJob = await prisma.scrapeJob.create({
      data: {
        source: 'INSTAGRAM',
        sourceTier: 'TIER_3_INHOUSE',
        keyword,
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      const result = await this.scraperService.scrapeKeyword(keyword, maxResults);

      const createdLeads = await prisma.lead.findMany({
        where: {
          source: 'INSTAGRAM',
          scrapedAt: { gte: new Date(Date.now() - result.durationMs - 5000) },
        },
        orderBy: { scrapedAt: 'desc' },
        take: result.leadsCreated,
        select: { id: true },
      });

      for (const lead of createdLeads) {
        await this.queueService.addJob('dedup', { leadId: lead.id });
      }

      await prisma.scrapeJob.update({
        where: { id: scrapeJob.id },
        data: {
          status: 'completed',
          leadsFound: result.profilesChecked,
          leadsAdded: result.leadsCreated,
          costUsd: 0,
          finishedAt: new Date(),
          errorLog: result.errors.length > 0 ? result.errors.join('\n') : null,
        },
      });

      logger.info(
        {
          jobId: job.id,
          scrapeJobId: scrapeJob.id,
          keyword,
          leadsCreated: result.leadsCreated,
          profilesChecked: result.profilesChecked,
          enqueuedDedup: createdLeads.length,
        },
        'Instagram scrape job completed',
      );

      return {
        scrapeJobId: scrapeJob.id,
        leadsCreated: result.leadsCreated,
        profilesChecked: result.profilesChecked,
        dedupEnqueued: createdLeads.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, keyword, err: message }, 'Instagram scrape job failed');

      await prisma.scrapeJob.update({
        where: { id: scrapeJob.id },
        data: {
          status: 'failed',
          errorLog: message,
          finishedAt: new Date(),
        },
      });

      throw err;
    }
  }
}
