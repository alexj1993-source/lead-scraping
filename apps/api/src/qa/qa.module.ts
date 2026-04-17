import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { QaService } from './qa.service';
import { QaProcessor } from './qa.processor';

@Module({
  imports: [QueueModule],
  providers: [QaService, QaProcessor],
  exports: [QaService],
})
export class QaModule {}
