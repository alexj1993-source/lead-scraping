import { Module } from '@nestjs/common';
import { RemediationService } from './remediation.service';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [QueueModule],
  providers: [RemediationService],
  exports: [RemediationService],
})
export class RemediationModule {}
