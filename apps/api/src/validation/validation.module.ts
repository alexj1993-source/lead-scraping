import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { StatsModule } from '../stats/stats.module';
import { ValidationService } from './validation.service';
import { NbValidationProcessor, BbValidationProcessor } from './validation.processor';

@Module({
  imports: [QueueModule, BudgetModule, StatsModule],
  providers: [ValidationService, NbValidationProcessor, BbValidationProcessor],
  exports: [ValidationService],
})
export class ValidationModule {}
