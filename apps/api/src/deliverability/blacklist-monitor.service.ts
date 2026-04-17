import { Injectable } from '@nestjs/common';
import { DomainService } from './domain.service';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';

const logger = createLogger('blacklist-monitor');

interface HetrixMonitor {
  Domain: string;
  Blacklisted_On: number;
  Blacklisted_On_Permanent: number;
}

@Injectable()
export class BlacklistMonitorService {
  constructor(
    private readonly domainService: DomainService,
    private readonly alertService: AlertService,
  ) {}

  async checkAllDomains(): Promise<void> {
    const apiKey = process.env.HETRIXTOOLS_API_KEY;

    if (!apiKey) {
      logger.warn('HETRIXTOOLS_API_KEY not configured — skipping blacklist check');
      return;
    }

    const domains = await this.domainService.getDomainsNeedingCheck(
      'blacklist',
      4,
    );

    if (domains.length === 0) {
      logger.info('No domains need blacklist checks');
      return;
    }

    logger.info({ count: domains.length }, 'Running blacklist checks');

    let monitors: HetrixMonitor[];
    try {
      monitors = await this.fetchMonitors(apiKey);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch HetrixTools monitors');
      return;
    }

    const monitorMap = new Map<string, HetrixMonitor>();
    for (const m of monitors) {
      monitorMap.set(m.Domain.toLowerCase(), m);
    }

    for (const domain of domains) {
      const monitor = monitorMap.get(domain.domain.toLowerCase());

      if (!monitor) {
        logger.debug(
          { domain: domain.domain },
          'No HetrixTools monitor found for domain',
        );
        await this.domainService.updateBlacklistCounts(domain.id, 0, 0);
        continue;
      }

      const temp = monitor.Blacklisted_On ?? 0;
      const perm = monitor.Blacklisted_On_Permanent ?? 0;

      await this.domainService.updateBlacklistCounts(domain.id, temp, perm);

      if (perm > 0) {
        await this.alertService.createAlert(
          'high',
          'blacklist',
          `Domain ${domain.domain} on ${perm} permanent blacklists`,
          `Temporary: ${temp}, Permanent: ${perm}. Immediate attention required.`,
          {
            domainId: domain.id,
            domain: domain.domain,
            temp,
            perm,
          },
        );
        await this.domainService.updateHealthStatus(domain.id, 'BLACKLISTED');
        logger.error(
          { domain: domain.domain, perm, temp },
          'Domain permanently blacklisted',
        );
      } else if (temp > 2) {
        await this.alertService.createAlert(
          'medium',
          'blacklist',
          `Domain ${domain.domain} on ${temp} temporary blacklists`,
          `Temporary blacklist count exceeds threshold (>2). Monitor closely.`,
          {
            domainId: domain.id,
            domain: domain.domain,
            temp,
            perm,
          },
        );

        if (domain.healthStatus === 'HEALTHY') {
          await this.domainService.updateHealthStatus(domain.id, 'DEGRADED');
        }

        logger.warn(
          { domain: domain.domain, temp },
          'Domain on multiple temporary blacklists',
        );
      }

      logger.info(
        { domain: domain.domain, temp, perm },
        'Blacklist check complete',
      );
    }
  }

  private async fetchMonitors(apiKey: string): Promise<HetrixMonitor[]> {
    const url = `https://api.hetrixtools.com/v2/${apiKey}/blacklist-monitors`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(
        `HetrixTools API returned ${res.status}: ${await res.text()}`,
      );
    }

    const data = (await res.json()) as { monitors?: HetrixMonitor[] };
    return data.monitors ?? [];
  }
}
