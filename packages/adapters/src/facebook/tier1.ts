import { BaseAdapter, type AdapterResult, type LeadInput } from '../base';
import { qualifyAd, type RawFacebookAd } from './qualify';
import { icpConfig } from '@hyperscale/config';

const FB_AD_LIBRARY_BASE = 'https://graph.facebook.com/v18.0/ads_archive';

const FIELDS = [
  'id',
  'ad_creation_time',
  'ad_creative_bodies',
  'ad_creative_link_captions',
  'ad_creative_link_titles',
  'ad_creative_link_descriptions',
  'page_id',
  'page_name',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'publisher_platforms',
  'demographic_distribution',
  'byline',
  'ad_snapshot_url',
].join(',');

/** 200 calls/hour → minimum 18s between requests */
const MIN_REQUEST_INTERVAL_MS = 18_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface AdLibraryAd {
  id: string;
  ad_creation_time?: string;
  page_id: string;
  page_name: string;
  ad_creative_bodies?: string[];
  ad_creative_link_captions?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_snapshot_url?: string;
  byline?: string;
  publisher_platforms?: string[];
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  demographic_distribution?: Array<{
    percentage: string;
    age: string;
    gender: string;
  }>;
}

interface AdLibraryResponse {
  data: AdLibraryAd[];
  paging?: {
    cursors: { before?: string; after?: string };
    next?: string;
  };
}

export class FacebookTier1Adapter extends BaseAdapter {
  private token: string;

  constructor() {
    super('facebook_ads');
    this.token = process.env.META_ACCESS_TOKEN ?? '';
  }

  async scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    const maxResults = options?.maxResults ?? 200;
    const countries = options?.country
      ? [options.country]
      : [...icpConfig.adTargetCountries];
    const tier = 'tier1';
    const startTime = Date.now();
    const jobId = await this.createScrapeJob(keyword, tier);

    try {
      this.logger.info(
        { keyword, countries, maxResults },
        'Starting Facebook Tier 1 (Meta Ad Library API) scrape',
      );

      const allRawAds: AdLibraryAd[] = [];

      for (const country of countries) {
        if (allRawAds.length >= maxResults * 3) break;

        const ads = await this.fetchAllPages(keyword, country, maxResults * 3);
        allRawAds.push(...ads);
      }

      const leads: LeadInput[] = [];
      const seenPageIds = new Set<string>();

      for (const ad of allRawAds) {
        if (leads.length >= maxResults) break;
        if (seenPageIds.has(ad.page_id)) continue;

        const rawAd = this.mapToRawAd(ad);
        const qualification = qualifyAd(rawAd);

        if (!qualification.qualified) {
          this.logger.debug(
            { pageId: rawAd.pageId, reason: qualification.reason },
            'Ad disqualified',
          );
          continue;
        }

        seenPageIds.add(ad.page_id);
        leads.push(this.mapToLead(rawAd, ad));
      }

      const result: AdapterResult = {
        leads,
        metadata: {
          source: this.source,
          tier,
          keyword,
          leadsFound: allRawAds.length,
          costEstimate: 0,
          durationMs: Date.now() - startTime,
        },
      };

      await this.completeScrapeJob(jobId, result);
      this.logger.info(
        { leadsFound: leads.length, totalFetched: allRawAds.length },
        'Tier 1 scrape completed',
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message, keyword }, 'Tier 1 scrape failed');
      await this.failScrapeJob(jobId, message);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    if (!this.token) {
      return { healthy: false, message: 'META_ACCESS_TOKEN not configured' };
    }

    try {
      const url = this.buildSearchUrl('test', 'US', 1);
      const res = await fetch(url);
      if (!res.ok) {
        return {
          healthy: false,
          message: `API returned ${res.status}: ${res.statusText}`,
        };
      }
      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }

  private async fetchAllPages(
    keyword: string,
    country: string,
    maxRaw: number,
  ): Promise<AdLibraryAd[]> {
    const ads: AdLibraryAd[] = [];
    let afterCursor: string | null = null;
    let retries = 0;

    while (ads.length < maxRaw) {
      const url = this.buildSearchUrl(keyword, country, 25, afterCursor);

      await this.rateLimit();
      const res = await fetch(url);

      if (res.status === 429) {
        retries++;
        const backoff = Math.min(
          MIN_REQUEST_INTERVAL_MS * Math.pow(2, retries),
          MAX_BACKOFF_MS,
        );
        this.logger.warn(
          { retries, backoffMs: backoff },
          'Rate limited by Meta API, backing off',
        );
        await this.sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Meta Ad Library API error ${res.status}: ${body}`);
      }

      retries = 0;
      const data = (await res.json()) as AdLibraryResponse;

      if (!data.data || data.data.length === 0) break;
      ads.push(...data.data);

      afterCursor = data.paging?.cursors?.after ?? null;
      if (!afterCursor || !data.paging?.next) break;
    }

    return ads;
  }

  private buildSearchUrl(
    keyword: string,
    country: string,
    limit = 25,
    afterCursor?: string | null,
  ): string {
    const params = new URLSearchParams({
      access_token: this.token,
      search_terms: keyword,
      ad_reached_countries: `["${country}"]`,
      ad_type: 'POLITICAL_AND_ISSUE_ADS_TOGETHER',
      fields: FIELDS,
      limit: String(limit),
    });
    if (afterCursor) {
      params.set('after', afterCursor);
    }
    return `${FB_AD_LIBRARY_BASE}?${params.toString()}`;
  }

  private lastRequestTime = 0;

  private async rateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await this.sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapToRawAd(ad: AdLibraryAd): RawFacebookAd {
    const adText = [
      ...(ad.ad_creative_bodies ?? []),
      ...(ad.ad_creative_link_titles ?? []),
      ...(ad.ad_creative_link_descriptions ?? []),
    ].join(' ');

    const landingPageUrl = this.extractLandingPage(ad);

    return {
      pageId: ad.page_id,
      pageName: ad.page_name,
      adCreativeId: ad.id,
      adText,
      adCreativeBodies: ad.ad_creative_bodies ?? [],
      adCreativeLinkTitles: ad.ad_creative_link_titles ?? [],
      adCreativeLinkDescriptions: ad.ad_creative_link_descriptions ?? [],
      landingPageUrl,
      adSnapshotUrl: ad.ad_snapshot_url ?? '',
      adDeliveryStopTime: ad.ad_delivery_stop_time ?? null,
      country: '', // set per-ad by caller if needed
      startDate: ad.ad_delivery_start_time ?? '',
    };
  }

  private extractLandingPage(ad: AdLibraryAd): string {
    const captions = ad.ad_creative_link_captions ?? [];
    for (const caption of captions) {
      if (caption.startsWith('http')) return caption;
    }

    const allText = [
      ...(ad.ad_creative_link_descriptions ?? []),
      ...(ad.ad_creative_link_captions ?? []),
    ];
    for (const text of allText) {
      const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) return urlMatch[0];
    }

    return '';
  }

  private mapToLead(ad: RawFacebookAd, raw: AdLibraryAd): LeadInput {
    return {
      companyName: this.normalizeCompanyName(ad.pageName),
      sourceUrl: ad.adSnapshotUrl || `https://www.facebook.com/${ad.pageId}`,
      source: this.source,
      facebookUrl: `https://www.facebook.com/${ad.pageId}`,
      sourceHandle: ad.pageId,
      adCreativeId: ad.adCreativeId,
      landingPageUrl: ad.landingPageUrl,
      country: ad.country,
    };
  }
}
