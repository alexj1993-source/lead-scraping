import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { DomainService } from './domain.service';
import { InboxService } from './inbox.service';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';

const logger = createLogger('rotation');

interface RotationEvent {
  inboxId: string;
  email: string;
  reason: string;
  action: 'rotated_out' | 'rotated_in' | 'burned';
  replacementId?: string;
  timestamp: Date;
}

@Injectable()
export class RotationService {
  constructor(
    private readonly domainService: DomainService,
    private readonly inboxService: InboxService,
    private readonly alertService: AlertService,
  ) {}

  async checkAndRotate(): Promise<RotationEvent[]> {
    const events: RotationEvent[] = [];

    const activeInboxes = await prisma.inbox.findMany({
      where: { status: 'ACTIVE' },
      include: { domain: true },
    });

    if (activeInboxes.length === 0) {
      logger.info('No active inboxes to check');
      return events;
    }

    logger.info(
      { count: activeInboxes.length },
      'Checking active inboxes for rotation triggers',
    );

    for (const inbox of activeInboxes) {
      try {
        const reason = this.getRotationReason(inbox);
        if (!reason) continue;

        await this.inboxService.rotateOut(inbox.id, reason);
        events.push({
          inboxId: inbox.id,
          email: inbox.email,
          reason,
          action: 'rotated_out',
          timestamp: new Date(),
        });

        const replacement = await this.findAndRotateIn(inbox.campaignId);
        if (replacement) {
          events.push({
            inboxId: replacement.id,
            email: replacement.email,
            reason: `Replacing ${inbox.email}`,
            action: 'rotated_in',
            replacementId: inbox.id,
            timestamp: new Date(),
          });
        } else {
          await this.alertService.createAlert(
            'high',
            'inbox_capacity',
            'No standby inbox available for rotation',
            `Inbox ${inbox.email} was rotated out (${reason}) but no replacement is available. Sending capacity is reducing.`,
            {
              rotatedOutInboxId: inbox.id,
              rotatedOutEmail: inbox.email,
              reason,
            },
          );
        }

        logger.info(
          {
            inbox: inbox.email,
            reason,
            replacement: replacement?.email ?? null,
          },
          'Rotation complete',
        );
      } catch (err) {
        logger.error(
          { inboxId: inbox.id, email: inbox.email, err },
          'Error during rotation check',
        );
      }
    }

    if (events.length > 0) {
      await this.logRotationEvents(events);
      logger.info({ eventCount: events.length }, 'Rotation cycle complete');
    }

    return events;
  }

  private getRotationReason(
    inbox: Awaited<
      ReturnType<typeof prisma.inbox.findMany<{ include: { domain: true } }>>
    >[number],
  ): string | null {
    const domain = inbox.domain;

    if (domain.healthStatus === 'BLACKLISTED') {
      return `Domain ${domain.domain} is blacklisted`;
    }

    if (domain.healthStatus === 'BURNED') {
      return `Domain ${domain.domain} is burned`;
    }

    if (domain.reputation === 'LOW') {
      return `Domain ${domain.domain} reputation is poor (${domain.reputation})`;
    }

    const dailyLimit = inbox.dailyCampaignLimit;
    const warmupSent = inbox.warmupEmailsSent;

    if (dailyLimit > 0) {
      const utilizationPct = (warmupSent / dailyLimit) * 100;

      if (utilizationPct > 100) {
        return `Daily send limit exceeded (${warmupSent}/${dailyLimit})`;
      }

      if (utilizationPct > 90) {
        logger.warn(
          {
            inbox: inbox.email,
            sent: warmupSent,
            limit: dailyLimit,
            pct: utilizationPct.toFixed(1),
          },
          'Inbox approaching daily send limit',
        );
      }
    }

    return null;
  }

  private async findAndRotateIn(
    campaignId: string | null,
  ): Promise<{ id: string; email: string } | null> {
    if (!campaignId) return null;

    const candidates = await this.getRotationCandidates();
    if (candidates.length === 0) return null;

    const chosen = candidates[0];
    await this.inboxService.rotateIn(chosen.id, campaignId);
    return { id: chosen.id, email: chosen.email };
  }

  async getRotationCandidates() {
    return prisma.inbox.findMany({
      where: {
        status: 'STANDBY',
        warmupEmailsSent: { gte: 95 },
        domain: { healthStatus: { in: ['HEALTHY'] } },
      },
      include: { domain: true },
      orderBy: { warmupEmailsSent: 'desc' },
    });
  }

  private async logRotationEvents(events: RotationEvent[]): Promise<void> {
    for (const event of events) {
      await prisma.alert.create({
        data: {
          severity: 'info',
          category: 'rotation_audit',
          title: `${event.action}: ${event.email}`,
          description: event.reason,
          context: {
            inboxId: event.inboxId,
            email: event.email,
            action: event.action,
            replacementId: event.replacementId ?? null,
          },
        },
      });
    }
  }
}
