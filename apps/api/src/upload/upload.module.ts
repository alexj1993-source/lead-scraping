import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { StatsModule } from '../stats/stats.module';
import { UploadService } from './upload.service';
import { UploadProcessor } from './upload.processor';
import { ReplySyncProcessor } from './reply-sync.processor';

@Module({
  imports: [QueueModule, BudgetModule, StatsModule],
  providers: [UploadService, UploadProcessor, ReplySyncProcessor],
  exports: [UploadService],
})
export class UploadModule {}
