import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PersonalizationService } from './personalization.service';
import { createLogger } from '../common/logger';

const logger = createLogger('personalization-processor');

@Processor('personalize')
export class PersonalizationProcessor extends WorkerHost {
  constructor(private readonly personalizationService: PersonalizationService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<any> {
    const { leadId } = job.data;
    logger.info({ jobId: job.id, leadId }, 'Processing personalization job');

    try {
      const result = await this.personalizationService.personalizeLead(leadId);
      logger.info(
        {
          jobId: job.id,
          leadId,
          success: result.success,
          model: result.model,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
        },
        'Personalization job completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, leadId, err }, 'Personalization job failed');
      throw err;
    }
  }
}
