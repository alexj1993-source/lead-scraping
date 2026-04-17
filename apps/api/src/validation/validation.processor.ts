import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ValidationService } from './validation.service';
import { createLogger } from '../common/logger';

const logger = createLogger('validation-processor');

@Processor('validate-neverbounce')
export class NbValidationProcessor extends WorkerHost {
  constructor(private readonly validationService: ValidationService) {
    super();
  }

  async process(job: Job<{ trigger: string }>): Promise<any> {
    logger.info({ jobId: job.id, trigger: job.data.trigger }, 'Starting NeverBounce batch');

    try {
      const result = await this.validationService.runNeverBounceBatch();
      logger.info(
        { jobId: job.id, ...result },
        'NeverBounce batch completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'NeverBounce batch failed');
      throw err;
    }
  }
}

@Processor('validate-bounceban')
export class BbValidationProcessor extends WorkerHost {
  constructor(private readonly validationService: ValidationService) {
    super();
  }

  async process(job: Job<{ leadIds?: string[] }>): Promise<any> {
    logger.info(
      { jobId: job.id, leadCount: job.data.leadIds?.length ?? 'all' },
      'Starting BounceBan batch',
    );

    try {
      const result = await this.validationService.runBounceBanBatch(job.data.leadIds);
      logger.info(
        { jobId: job.id, ...result },
        'BounceBan batch completed',
      );
      return result;
    } catch (err) {
      logger.error({ jobId: job.id, err }, 'BounceBan batch failed');
      throw err;
    }
  }
}
