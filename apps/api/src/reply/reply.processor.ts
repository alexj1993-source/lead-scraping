import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReplyService } from './reply.service';
import { createLogger } from '../common/logger';

const logger = createLogger('reply-classify-processor');

@Processor('reply-classify')
export class ReplyClassifyProcessor extends WorkerHost {
  constructor(private readonly replyService: ReplyService) {
    super();
  }

  async process(job: Job<{ leadId: string; replyId: string; body: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing reply classification job');

    try {
      const result = await this.replyService.classifyReply(leadId);
      logger.info(
        { jobId: job.id, leadId, classification: result.classification, confidence: result.confidence },
        'Reply classification job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Reply classification job failed');
      throw err;
    }
  }
}
