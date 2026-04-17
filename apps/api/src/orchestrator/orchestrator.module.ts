import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { ScheduleController } from './schedule.controller';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { SourceModule } from '../source/source.module';
import { KeywordModule } from '../keyword/keyword.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { RemediationModule } from '../remediation/remediation.module';

@Module({
  imports: [QueueModule, BudgetModule, SourceModule, KeywordModule, DeliverabilityModule, RemediationModule],
  providers: [OrchestratorService],
  controllers: [ScheduleController],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
