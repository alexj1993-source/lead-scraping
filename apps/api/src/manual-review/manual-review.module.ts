import { Module } from '@nestjs/common';
import { ManualReviewController } from './manual-review.controller';

@Module({
  controllers: [ManualReviewController],
})
export class ManualReviewModule {}
