import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QaService } from './qa.service';
import { createLogger } from '../common/logger';

const logger = createLogger('qa-processor');

@Processor('qa')
export class QaProcessor extends WorkerHost {
  constructor(private readonly qaService: QaService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing QA job');

    try {
      const result = await this.qaService.validateLead(leadId);
      logger.info(
        { jobId: job.id, leadId, passed: result.passed, failures: result.failures },
        'QA job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'QA job failed');
      throw err;
    }
  }
}
