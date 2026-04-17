import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueModule } from './queues/queue.module';
import { LeadsModule } from './leads/leads.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { ScoringModule } from './scoring/scoring.module';
import { DedupModule } from './dedup/dedup.module';
import { ValidationModule } from './validation/validation.module';
import { PersonalizationModule } from './personalization/personalization.module';
import { UploadModule } from './upload/upload.module';
import { ReplyModule } from './reply/reply.module';
import { KeywordModule } from './keyword/keyword.module';
import { SourceModule } from './source/source.module';
import { PaperclipModule } from './paperclip-api/paperclip.module';
import { RemediationModule } from './remediation/remediation.module';
import { BudgetModule } from './budget/budget.module';
import { AlertModule } from './alert/alert.module';
import { StatsModule } from './stats/stats.module';
import { HealthModule } from './health/health.module';
import { SessionModule } from './session/session.module';
import { QueryModule } from './query/query.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { CampaignModule } from './campaign/campaign.module';
import { ScraperModule } from './scraper/scraper.module';
import { DeliverabilityModule } from './deliverability/deliverability.module';
import { SettingsModule } from './settings/settings.module';
import { ManualReviewModule } from './manual-review/manual-review.module';
import { QaModule } from './qa/qa.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD ?? undefined,
      },
    }),
    ScheduleModule.forRoot(),
    QueueModule,
    LeadsModule,
    EnrichmentModule,
    ScoringModule,
    DedupModule,
    ValidationModule,
    PersonalizationModule,
    UploadModule,
    ReplyModule,
    KeywordModule,
    SourceModule,
    PaperclipModule,
    RemediationModule,
    BudgetModule,
    AlertModule,
    StatsModule,
    HealthModule,
    SessionModule,
    QueryModule,
    OrchestratorModule,
    CampaignModule,
    ScraperModule,
    DeliverabilityModule,
    SettingsModule,
    ManualReviewModule,
    QaModule,
  ],
})
export class AppModule {}
