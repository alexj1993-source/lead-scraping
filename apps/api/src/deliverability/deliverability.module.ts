import { Module } from '@nestjs/common';
import { DomainService } from './domain.service';
import { InboxService } from './inbox.service';
import { DnsMonitorService } from './dns-monitor.service';
import { BlacklistMonitorService } from './blacklist-monitor.service';
import { ReputationMonitorService } from './reputation-monitor.service';
import { RotationService } from './rotation.service';
import { DeliverabilityStatsService } from './deliverability-stats.service';
import { DeliverabilityController } from './deliverability.controller';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [AlertModule],
  providers: [
    DomainService,
    InboxService,
    DnsMonitorService,
    BlacklistMonitorService,
    ReputationMonitorService,
    RotationService,
    DeliverabilityStatsService,
  ],
  controllers: [DeliverabilityController],
  exports: [
    DomainService,
    InboxService,
    DnsMonitorService,
    BlacklistMonitorService,
    ReputationMonitorService,
    RotationService,
    DeliverabilityStatsService,
  ],
})
export class DeliverabilityModule {}
