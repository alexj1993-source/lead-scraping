import { ApifyClient } from 'apify-client';
import { BaseAdapter, type AdapterResult, type LeadInput } from '../base';
import { qualifyAd, type RawFacebookAd } from './qualify';

const ACTOR_ID = 'curious_coder~facebook-ads-library-scraper';

interface ApifyAdResult {
  adId?: string;
  pageId?: string;
  pageName?: string;
  adText?: string;
  linkUrl?: string;
  linkCaption?: string;
  linkTitle?: string;
  linkDescription?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  currency?: string;
  spendLower?: number;
  spendUpper?: number;
  impressionsLower?: number;
  impressionsUpper?: number;
}

export class FacebookTier2Adapter extends BaseAdapter {
  private client: ApifyClient;

  constructor() {
    super('facebook_ads');
    this.client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? '' });
  }

  async scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    const maxResults = options?.maxResults ?? 200;
    const country = options?.country ?? 'US';
    const tier = 'tier2';
    const startTime = Date.now();
    const jobId = await this.createScrapeJob(keyword, tier);

    try {
      this.logger.info({ keyword, country, maxResults }, 'Starting Facebook Tier 2 (Apify) scrape');

      const run = await this.client.actor(ACTOR_ID).call({
        searchTerms: [keyword],
        countryCode: country,
        adType: 'all',
        adActiveStatus: 'active',
        maxItems: maxResults * 2,
      });

      this.logger.info({ runId: run.id }, 'Apify run started, waiting for completion');

      const { items } = await this.client
        .dataset(run.defaultDatasetId)
        .listItems();

      const apifyResults = items as unknown as ApifyAdResult[];
      this.logger.info({ totalItems: apifyResults.length }, 'Apify run completed');

      const leads: LeadInput[] = [];

      for (const item of apifyResults) {
        if (leads.length >= maxResults) break;

        const rawAd = this.mapToRawAd(item, country);
        const qualification = qualifyAd(rawAd);

        if (!qualification.qualified) {
          this.logger.debug({ pageId: rawAd.pageId, reason: qualification.reason }, 'Ad disqualified');
          continue;
        }

        leads.push(this.mapToLead(rawAd));
      }

      const result: AdapterResult = {
        leads,
        metadata: {
          source: this.source,
          tier,
          keyword,
          leadsFound: apifyResults.length,
          costEstimate: this.estimateCost(apifyResults.length),
          durationMs: Date.now() - startTime,
        },
      };

      await this.completeScrapeJob(jobId, result);
      this.logger.info({ leadsFound: leads.length }, 'Tier 2 scrape completed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message, keyword }, 'Tier 2 scrape failed');
      await this.failScrapeJob(jobId, message);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    if (!process.env.APIFY_TOKEN) {
      return { healthy: false, message: 'APIFY_TOKEN not configured' };
    }

    try {
      const actor = await this.client.actor(ACTOR_ID).get();
      if (!actor) {
        return { healthy: false, message: 'Facebook Ads Library Scraper actor not found' };
      }
      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }

  private mapToRawAd(item: ApifyAdResult, country: string): RawFacebookAd {
    const bodies = item.adText ? [item.adText] : [];
    const titles = item.linkTitle ? [item.linkTitle] : [];
    const descriptions = item.linkDescription ? [item.linkDescription] : [];

    return {
      pageId: item.pageId ?? '',
      pageName: item.pageName ?? '',
      adCreativeId: item.adId ?? '',
      adText: [...bodies, ...titles, ...descriptions].join(' '),
      adCreativeBodies: bodies,
      adCreativeLinkTitles: titles,
      adCreativeLinkDescriptions: descriptions,
      landingPageUrl: item.linkUrl ?? '',
      adSnapshotUrl: '',
      adDeliveryStopTime: item.endDate ?? null,
      country: item.country ?? country,
      startDate: item.startDate ?? '',
    };
  }

  private mapToLead(ad: RawFacebookAd): LeadInput {
    return {
      companyName: this.normalizeCompanyName(ad.pageName),
      sourceUrl: `https://www.facebook.com/${ad.pageId}`,
      source: this.source,
      facebookUrl: `https://www.facebook.com/${ad.pageId}`,
      adCreativeId: ad.adCreativeId,
      landingPageUrl: ad.landingPageUrl,
      country: ad.country,
    };
  }

  private estimateCost(itemCount: number): number {
    return itemCount * 0.002;
  }
}
