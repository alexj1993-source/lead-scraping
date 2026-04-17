import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { KeywordService } from './keyword.service';
import { createLogger } from '../common/logger';

const logger = createLogger('keyword-score-processor');

@Processor('keyword-score')
export class KeywordScoreProcessor extends WorkerHost {
  constructor(private readonly keywordService: KeywordService) {
    super();
  }

  async process(job: Job<{ keywordId?: string; recalcAll?: boolean }>): Promise<any> {
    const { keywordId, recalcAll } = job.data;
    logger.info({ jobId: job.id, keywordId, recalcAll }, 'Processing keyword score job');

    try {
      if (recalcAll || !keywordId) {
        await this.keywordService.recalcAllScores();
        const retired = await this.keywordService.autoRetireKeywords();
        logger.info(
          { jobId: job.id, retired: retired.length },
          'Keyword score recalc and auto-retirement completed',
        );
        return { recalcAll: true, retired };
      }

      await this.keywordService.updateScore(keywordId);
      logger.info({ jobId: job.id, keywordId }, 'Keyword score job completed');
      return { keywordId };
    } catch (err) {
      logger.error({ jobId: job.id, keywordId, err }, 'Keyword score job failed');
      throw err;
    }
  }
}
