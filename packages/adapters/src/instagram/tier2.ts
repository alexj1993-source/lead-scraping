import { ApifyClient } from 'apify-client';
import { BaseAdapter, type AdapterResult, type LeadInput } from '../base';
import { icpConfig } from '@hyperscale/config';

const ACTOR_ID = 'apify~instagram-scraper';

const BIO_KEYWORDS = [
  'coach', 'coaching', 'consultant', 'consulting', 'course',
  'mentor', 'mentoring', 'trainer', 'training', 'strategist',
  'advisor', 'agency', 'expert', 'specialist',
];

interface ApifyProfileResult {
  username?: string;
  fullName?: string;
  biography?: string;
  externalUrl?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  isBusinessAccount?: boolean;
  businessCategoryName?: string;
  profilePicUrl?: string;
  id?: string;
}

export class InstagramTier2Adapter extends BaseAdapter {
  private client: ApifyClient;

  constructor() {
    super('instagram');
    this.client = new ApifyClient({ token: process.env.APIFY_TOKEN ?? '' });
  }

  async scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    const maxResults = options?.maxResults ?? 100;
    const tier = 'tier2';
    const startTime = Date.now();
    const jobId = await this.createScrapeJob(keyword, tier);

    try {
      this.logger.info({ keyword, maxResults }, 'Starting Instagram Tier 2 (Apify) scrape');

      const hashtags = this.keywordToHashtags(keyword);
      const searchTerms = [keyword, ...hashtags];

      const run = await this.client.actor(ACTOR_ID).call({
        search: searchTerms.join(','),
        searchType: 'hashtag',
        resultsType: 'users',
        resultsLimit: maxResults * 3,
        extendOutputFunction: '',
      });

      this.logger.info({ runId: run.id }, 'Apify run started, waiting for completion');

      const { items } = await this.client
        .dataset(run.defaultDatasetId)
        .listItems();

      const profiles = items as unknown as ApifyProfileResult[];
      this.logger.info({ totalProfiles: profiles.length }, 'Apify run completed');

      const leads: LeadInput[] = [];
      const seenHandles = new Set<string>();

      for (const profile of profiles) {
        if (leads.length >= maxResults) break;

        const handle = profile.username ?? '';
        if (!handle || seenHandles.has(handle)) continue;
        seenHandles.add(handle);

        if (!this.isQualifiedProfile(profile)) {
          this.logger.debug({ handle }, 'Profile disqualified');
          continue;
        }

        leads.push(this.mapToLead(profile));
      }

      const result: AdapterResult = {
        leads,
        metadata: {
          source: this.source,
          tier,
          keyword,
          leadsFound: profiles.length,
          costEstimate: this.estimateCost(profiles.length),
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
        return { healthy: false, message: 'Instagram Scraper actor not found' };
      }
      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }

  private isQualifiedProfile(profile: ApifyProfileResult): boolean {
    if (!profile.externalUrl) return false;

    const bio = (profile.biography ?? '').toLowerCase();
    const hasBioKeyword = BIO_KEYWORDS.some((kw) => bio.includes(kw));
    if (!hasBioKeyword) return false;

    const isBlocklisted = icpConfig.blocklist.phrases.some((phrase) =>
      bio.includes(phrase),
    );
    if (isBlocklisted) return false;

    try {
      const domain = new URL(profile.externalUrl).hostname.toLowerCase();
      const domainBlocked = icpConfig.blocklist.domains.some(
        (d) => domain === d || domain.endsWith(`.${d}`),
      );
      if (domainBlocked) return false;
    } catch {
      return false;
    }

    return true;
  }

  private mapToLead(profile: ApifyProfileResult): LeadInput {
    const handle = profile.username ?? '';
    return {
      companyName: this.normalizeCompanyName(profile.fullName ?? handle),
      sourceUrl: `https://www.instagram.com/${handle}`,
      source: this.source,
      instagramUrl: `https://www.instagram.com/${handle}`,
      websiteUrl: profile.externalUrl,
      sourceHandle: handle,
      fullName: profile.fullName,
    };
  }

  private keywordToHashtags(keyword: string): string[] {
    const base = keyword.toLowerCase().replace(/\s+/g, '');
    return [
      base,
      `${base}tips`,
      `${base}expert`,
    ];
  }

  private estimateCost(itemCount: number): number {
    return itemCount * 0.003;
  }
}
