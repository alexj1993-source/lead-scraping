import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { UploadService } from './upload.service';
import { createLogger } from '../common/logger';

const logger = createLogger('reply-sync-processor');

@Processor('reply-sync')
export class ReplySyncProcessor extends WorkerHost {
  constructor(private readonly uploadService: UploadService) {
    super();
  }

  async process(job: Job<{ campaignId?: string }>): Promise<any> {
    logger.info({ jobId: job.id, campaignId: job.data.campaignId }, 'Processing reply sync job');

    try {
      const result = await this.uploadService.syncReplies();
      logger.info(
        { jobId: job.id, synced: result.synced, newReplies: result.newReplies },
        'Reply sync job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'Reply sync job failed');
      throw err;
    }
  }
}
