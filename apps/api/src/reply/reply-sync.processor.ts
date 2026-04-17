import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReplyService } from './reply.service';
import { createLogger } from '../common/logger';

const logger = createLogger('reply-sync-processor');

@Processor('reply-sync')
export class ReplySyncProcessor extends WorkerHost {
  constructor(private readonly replyService: ReplyService) {
    super();
  }

  async process(job: Job<{ campaignId: string }>): Promise<any> {
    const { campaignId } = job.data;
    logger.info({ jobId: job.id, campaignId }, 'Processing reply sync (poll) job');

    try {
      const processed = await this.replyService.pollInstantlyReplies(campaignId);
      logger.info(
        { jobId: job.id, campaignId, processed },
        'Reply sync job completed',
      );
      return { campaignId, processed };
    } catch (err) {
      logger.error({ jobId: job.id, campaignId, err }, 'Reply sync job failed');
      throw err;
    }
  }
}
