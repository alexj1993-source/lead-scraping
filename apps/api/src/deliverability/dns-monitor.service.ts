import { Injectable } from '@nestjs/common';
import * as dns from 'dns/promises';
import { DomainService } from './domain.service';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';
import type { Domain } from '@hyperscale/database';

const logger = createLogger('dns-monitor');

interface DnsCheckResult {
  dkimOk: boolean;
  spfOk: boolean;
  dmarcOk: boolean;
}

@Injectable()
export class DnsMonitorService {
  constructor(
    private readonly domainService: DomainService,
    private readonly alertService: AlertService,
  ) {}

  async checkAllDomains(): Promise<void> {
    const domains = await this.domainService.getDomainsNeedingCheck('dns', 6);

    if (domains.length === 0) {
      logger.info('No domains need DNS checks');
      return;
    }

    logger.info({ count: domains.length }, 'Running DNS checks');

    for (const domain of domains) {
      try {
        await this.checkDomain(domain);
      } catch (err) {
        logger.error(
          { domain: domain.domain, err },
          'DNS check failed for domain',
        );
      }
    }
  }

  async checkDomain(
    domain: Domain,
    selector = 'default',
  ): Promise<DnsCheckResult> {
    const [dkimOk, spfOk, dmarcOk] = await Promise.all([
      this.checkDkim(domain.domain, selector),
      this.checkSpf(domain.domain),
      this.checkDmarc(domain.domain),
    ]);

    const result = { dkimOk, spfOk, dmarcOk };

    await this.domainService.updateDnsStatus(domain.id, result);

    const failures: string[] = [];
    if (!dkimOk) failures.push('DKIM');
    if (!spfOk) failures.push('SPF');
    if (!dmarcOk) failures.push('DMARC');

    if (failures.length > 0) {
      await this.alertService.createAlert(
        'warning',
        'dns_compliance',
        `DNS check failed for ${domain.domain}`,
        `Missing records: ${failures.join(', ')}`,
        {
          domainId: domain.id,
          domain: domain.domain,
          ...result,
          failures,
        },
      );

      if (domain.healthStatus === 'HEALTHY') {
        await this.domainService.updateHealthStatus(domain.id, 'DEGRADED');
        logger.warn(
          { domain: domain.domain, failures },
          'Domain degraded due to DNS failures',
        );
      }
    }

    logger.info({ domain: domain.domain, ...result }, 'DNS check complete');
    return result;
  }

  private async checkDkim(
    domain: string,
    selector: string,
  ): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
      return records.flat().some((r) => r.includes('v=DKIM1'));
    } catch {
      return false;
    }
  }

  private async checkSpf(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(domain);
      return records.flat().some((r) => r.startsWith('v=spf1'));
    } catch {
      return false;
    }
  }

  private async checkDmarc(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`_dmarc.${domain}`);
      return records.flat().some((r) => r.startsWith('v=DMARC1'));
    } catch {
      return false;
    }
  }
}
