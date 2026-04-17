import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { BudgetModule } from '../budget/budget.module';
import { AlertModule } from '../alert/alert.module';
import { ReplyService } from './reply.service';
import { ReplyController, InstantlyWebhookController } from './reply.controller';
import { ReplyClassifyProcessor } from './reply.processor';
import { ReplySyncProcessor } from './reply-sync.processor';

@Module({
  imports: [QueueModule, BudgetModule, AlertModule],
  providers: [ReplyService, ReplyClassifyProcessor, ReplySyncProcessor],
  controllers: [ReplyController, InstantlyWebhookController],
  exports: [ReplyService],
})
export class ReplyModule {}
