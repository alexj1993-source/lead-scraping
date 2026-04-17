import { Injectable } from '@nestjs/common';
import { DomainService } from './domain.service';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';
import type { Domain, DomainReputation } from '@hyperscale/database';

const logger = createLogger('reputation-monitor');

const GOOGLE_REPUTATION_MAP: Record<string, DomainReputation> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  BAD: 'LOW',
};

@Injectable()
export class ReputationMonitorService {
  constructor(
    private readonly domainService: DomainService,
    private readonly alertService: AlertService,
  ) {}

  async checkAllDomains(): Promise<void> {
    const domains = await this.domainService.getDomainsNeedingCheck(
      'reputation',
      12,
    );

    if (domains.length === 0) {
      logger.info('No domains need reputation checks');
      return;
    }

    logger.info({ count: domains.length }, 'Running reputation checks');

    const hasGoogle = !!process.env.GOOGLE_POSTMASTER_REFRESH_TOKEN;
    const hasGlockApps = !!process.env.GLOCKAPPS_API_KEY;

    if (!hasGoogle && !hasGlockApps) {
      logger.warn(
        'No reputation provider configured (GOOGLE_POSTMASTER_REFRESH_TOKEN / GLOCKAPPS_API_KEY) — skipping',
      );
      return;
    }

    for (const domain of domains) {
      try {
        if (hasGoogle) {
          await this.checkWithGooglePostmaster(domain);
        } else if (hasGlockApps) {
          await this.checkWithGlockApps(domain);
        }
      } catch (err) {
        logger.error(
          { domain: domain.domain, err },
          'Reputation check failed for domain',
        );
      }
    }
  }

  private async checkWithGooglePostmaster(domain: Domain): Promise<void> {
    const refreshToken = process.env.GOOGLE_POSTMASTER_REFRESH_TOKEN!;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logger.warn(
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — skipping Google Postmaster',
      );
      return;
    }

    let accessToken: string;
    try {
      accessToken = await this.getGoogleAccessToken(
        refreshToken,
        clientId,
        clientSecret,
      );
    } catch (err) {
      logger.error({ err }, 'Failed to get Google access token');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const url =
      `https://gmailpostmastertools.googleapis.com/v1beta1/domains/${domain.domain}/trafficStats/${today}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) {
      logger.debug(
        { domain: domain.domain },
        'No Google Postmaster data available',
      );
      return;
    }

    if (!res.ok) {
      logger.warn(
        { domain: domain.domain, status: res.status },
        'Google Postmaster API error',
      );
      return;
    }

    const data = (await res.json()) as { domainReputation?: string };
    const rawReputation = data.domainReputation ?? 'UNKNOWN';
    const reputation: DomainReputation =
      GOOGLE_REPUTATION_MAP[rawReputation] ?? 'UNKNOWN';

    await this.domainService.updateReputation(domain.id, reputation);
    await this.handleReputationChange(domain, reputation);

    logger.info(
      { domain: domain.domain, rawReputation, reputation },
      'Google Postmaster reputation check complete',
    );
  }

  private async checkWithGlockApps(domain: Domain): Promise<void> {
    const apiKey = process.env.GLOCKAPPS_API_KEY!;

    const res = await fetch(
      `https://gappapi.com/api/v1/seed-tests?domain=${encodeURIComponent(domain.domain)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      logger.warn(
        { domain: domain.domain, status: res.status },
        'GlockApps API error',
      );
      return;
    }

    const data = (await res.json()) as {
      results?: Array<{ inbox_pct?: number }>;
    };

    const latestResult = data.results?.[0];
    if (!latestResult) {
      logger.debug(
        { domain: domain.domain },
        'No GlockApps results available',
      );
      return;
    }

    const inboxPct = latestResult.inbox_pct ?? 0;
    let reputation: DomainReputation;
    if (inboxPct >= 90) reputation = 'HIGH';
    else if (inboxPct >= 70) reputation = 'MEDIUM';
    else if (inboxPct >= 50) reputation = 'LOW';
    else reputation = 'LOW';

    await this.domainService.updateReputation(domain.id, reputation);
    await this.handleReputationChange(domain, reputation);

    logger.info(
      { domain: domain.domain, inboxPct, reputation },
      'GlockApps reputation check complete',
    );
  }

  private async handleReputationChange(
    domain: Domain,
    reputation: DomainReputation,
  ): Promise<void> {
    if (reputation === 'LOW') {
      await this.alertService.createAlert(
        'medium',
        'domain_reputation',
        `Domain ${domain.domain} reputation is ${reputation}`,
        'Reputation has dropped below GOOD. Consider reducing send volume or rotating domains.',
        {
          domainId: domain.id,
          domain: domain.domain,
          reputation,
          previousReputation: domain.reputation,
        },
      );

      if (
        domain.healthStatus === 'HEALTHY' ||
        domain.healthStatus === 'DEGRADED'
      ) {
        await this.domainService.updateHealthStatus(domain.id, 'DEGRADED');
        logger.warn(
          { domain: domain.domain, reputation },
          'Domain degraded due to poor reputation',
        );
      }
    }
  }

  private async getGoogleAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Google OAuth token refresh failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }
}
