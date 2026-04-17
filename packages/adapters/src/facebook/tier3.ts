import { BaseAdapter, type AdapterResult } from '../base';

export class FacebookTier3Adapter extends BaseAdapter {
  constructor() {
    super('facebook_ads');
  }

  async scrape(
    keyword: string,
    _options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    this.logger.warn(
      { keyword },
      'Tier 3 (Playwright) is a placeholder — requires the scraper app to be deployed',
    );

    return {
      leads: [],
      metadata: {
        source: this.source,
        tier: 'tier3',
        keyword,
        leadsFound: 0,
        costEstimate: 0,
        durationMs: 0,
      },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: false, message: 'Tier 3 requires scraper app' };
  }
}
