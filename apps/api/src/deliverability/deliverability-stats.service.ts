import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';

const logger = createLogger('deliverability-stats');

interface DeliverabilityOverview {
  domains: {
    total: number;
    healthy: number;
    degraded: number;
    blacklisted: number;
    burned: number;
    averageAgeDays: number;
    dnsComplianceRate: number;
  };
  inboxes: {
    total: number;
    active: number;
    standby: number;
    warming: number;
    burned: number;
    rotatedOut: number;
  };
  capacity: {
    totalDailySend: number;
  };
}

interface DomainTimelineEntry {
  date: string;
  healthStatus: string;
  blacklistTempCount: number;
  blacklistPermCount: number;
  reputation: string;
}

interface RotationHistoryEntry {
  id: string;
  timestamp: string;
  email: string;
  action: string;
  reason: string;
  replacementId: string | null;
}

@Injectable()
export class DeliverabilityStatsService {
  async getOverview(): Promise<DeliverabilityOverview> {
    const [
      domainCounts,
      dnsCompliant,
      totalDomains,
      domainAges,
      inboxCounts,
      capacity,
    ] = await Promise.all([
      prisma.domain.groupBy({
        by: ['healthStatus'],
        _count: true,
      }),
      prisma.domain.count({
        where: { dkimOk: true, spfOk: true, dmarcOk: true },
      }),
      prisma.domain.count(),
      prisma.domain.aggregate({ _min: { createdAt: true } }),
      prisma.inbox.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.inbox.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { dailyCampaignLimit: true },
      }),
    ]);

    const domainStatusMap = Object.fromEntries(
      domainCounts.map((d) => [d.healthStatus, d._count]),
    );
    const inboxStatusMap = Object.fromEntries(
      inboxCounts.map((i) => [i.status, i._count]),
    );

    const oldestDomain = domainAges._min.createdAt;
    const now = Date.now();
    let averageAgeDays = 0;

    if (totalDomains > 0 && oldestDomain) {
      const allDomains = await prisma.domain.findMany({
        select: { createdAt: true },
      });
      const totalAgeDays = allDomains.reduce(
        (sum, d) =>
          sum + (now - d.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        0,
      );
      averageAgeDays = Math.round(totalAgeDays / allDomains.length);
    }

    const inboxTotal = Object.values(inboxStatusMap).reduce(
      (a, b) => a + b,
      0,
    );

    logger.debug(
      { totalDomains, inboxTotal },
      'Deliverability overview generated',
    );

    return {
      domains: {
        total: totalDomains,
        healthy: domainStatusMap['HEALTHY'] ?? 0,
        degraded: domainStatusMap['DEGRADED'] ?? 0,
        blacklisted: domainStatusMap['BLACKLISTED'] ?? 0,
        burned: domainStatusMap['BURNED'] ?? 0,
        averageAgeDays,
        dnsComplianceRate:
          totalDomains > 0
            ? Math.round((dnsCompliant / totalDomains) * 100)
            : 0,
      },
      inboxes: {
        total: inboxTotal,
        active: inboxStatusMap['ACTIVE'] ?? 0,
        standby: inboxStatusMap['STANDBY'] ?? 0,
        warming: inboxStatusMap['WARMING'] ?? 0,
        burned: inboxStatusMap['BURNED'] ?? 0,
        rotatedOut: inboxStatusMap['ROTATED_OUT'] ?? 0,
      },
      capacity: {
        totalDailySend: capacity._sum.dailyCampaignLimit ?? 0,
      },
    };
  }

  async getDomainTimeline(
    domainId: string,
    days = 30,
  ): Promise<DomainTimelineEntry[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const alerts = await prisma.alert.findMany({
      where: {
        category: { in: ['domain_health', 'dns_compliance', 'blacklist', 'domain_reputation'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    const domain = await prisma.domain.findUniqueOrThrow({
      where: { id: domainId },
    });

    const relevantAlerts = alerts.filter((a) => {
      const ctx = a.context as Record<string, unknown>;
      return ctx?.domainId === domainId;
    });

    const timeline: DomainTimelineEntry[] = relevantAlerts.map((a) => ({
      date: a.createdAt.toISOString(),
      healthStatus:
        (a.context as Record<string, unknown>)?.status?.toString() ??
        domain.healthStatus,
      blacklistTempCount:
        Number((a.context as Record<string, unknown>)?.temp) ||
        domain.blacklistTempCount,
      blacklistPermCount:
        Number((a.context as Record<string, unknown>)?.perm) ||
        domain.blacklistPermCount,
      reputation:
        (a.context as Record<string, unknown>)?.reputation?.toString() ??
        domain.reputation,
    }));

    if (timeline.length === 0) {
      timeline.push({
        date: new Date().toISOString(),
        healthStatus: domain.healthStatus,
        blacklistTempCount: domain.blacklistTempCount,
        blacklistPermCount: domain.blacklistPermCount,
        reputation: domain.reputation,
      });
    }

    return timeline;
  }

  async getRotationHistory(days = 7): Promise<RotationHistoryEntry[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await prisma.alert.findMany({
      where: {
        category: { in: ['rotation_audit', 'inbox_rotation'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map((e) => {
      const ctx = e.context as Record<string, unknown>;
      return {
        id: e.id,
        timestamp: e.createdAt.toISOString(),
        email: (ctx?.email as string) ?? '',
        action: (ctx?.action as string) ?? e.category,
        reason: e.description,
        replacementId: (ctx?.replacementId as string) ?? null,
      };
    });
  }
}
