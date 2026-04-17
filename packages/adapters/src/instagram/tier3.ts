import { BaseAdapter, type AdapterResult, type LeadInput } from '../base';
import {
  qualifyProfile,
  validateBioLink,
  extractCompanyName,
  type RawInstagramProfile,
} from './qualify';
import {
  getActiveCredentials,
  getCredential,
  type DecryptedCredential,
} from '@hyperscale/sessions';
import { icpConfig } from '@hyperscale/config';
import type { Browser, BrowserContext, Page } from 'playwright-core';

const MAX_PROFILES_PER_SESSION = 50;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

interface ScrapeSession {
  credential: DecryptedCredential;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  profileCount: number;
}

export class InstagramTier3Adapter extends BaseAdapter {
  private createBrowserFn: (() => Promise<Browser>) | undefined;
  private createContextFn: ((browser: Browser, cookies?: string) => Promise<BrowserContext>) | undefined;
  private closeBrowserFn: ((browser: Browser) => Promise<void>) | undefined;

  constructor(opts?: {
    createBrowser?: () => Promise<Browser>;
    createStealthContext?: (browser: Browser, cookies?: string) => Promise<BrowserContext>;
    closeBrowser?: (browser: Browser) => Promise<void>;
  }) {
    super('instagram');
    this.createBrowserFn = opts?.createBrowser;
    this.createContextFn = opts?.createStealthContext;
    this.closeBrowserFn = opts?.closeBrowser;
  }

  private async getCreateBrowser(): Promise<() => Promise<Browser>> {
    if (this.createBrowserFn) return this.createBrowserFn;
    const { createBrowser } = await import('../../../../apps/scraper/src/browser.js');
    return createBrowser;
  }

  private async getCreateContext(): Promise<(browser: Browser, cookies?: string) => Promise<BrowserContext>> {
    if (this.createContextFn) return this.createContextFn;
    const { createStealthContext } = await import('../../../../apps/scraper/src/browser.js');
    return createStealthContext;
  }

  private async getCloseBrowser(): Promise<(browser: Browser) => Promise<void>> {
    if (this.closeBrowserFn) return this.closeBrowserFn;
    const { closeBrowser } = await import('../../../../apps/scraper/src/browser.js');
    return closeBrowser;
  }

  async scrape(
    keyword: string,
    options?: { country?: string; maxResults?: number },
  ): Promise<AdapterResult> {
    const maxResults = options?.maxResults ?? 100;
    const tier = 'tier3';
    const startTime = Date.now();
    const jobId = await this.createScrapeJob(keyword, tier);

    const leads: LeadInput[] = [];
    const seenHandles = new Set<string>();
    let session: ScrapeSession | null = null;

    try {
      this.logger.info({ keyword, maxResults }, 'Starting Instagram Tier 3 (Playwright) scrape');

      session = await this.startSession();
      if (!session) {
        throw new Error('No active Instagram session credentials available');
      }

      const searchQuery = `${keyword} coach`;
      const profiles = await this.searchProfiles(session, searchQuery, maxResults * 3);

      for (const profile of profiles) {
        if (leads.length >= maxResults) break;

        if (seenHandles.has(profile.username)) continue;
        seenHandles.add(profile.username);

        session = await this.ensureSession(session);
        if (!session) break;

        const qualification = qualifyProfile(profile);
        if (!qualification.qualified) {
          this.logger.debug({ handle: profile.username, reason: qualification.reason }, 'Profile disqualified');
          continue;
        }

        if (profile.bioLinkUrl) {
          const linkCheck = await validateBioLink(profile.bioLinkUrl);
          if (!linkCheck.isTrainingPage) {
            this.logger.debug({ handle: profile.username }, 'Bio link is not a training page');
            continue;
          }
        }

        leads.push(this.mapToLead(profile));

        if (profile.bioLinkUrl) {
          const suggested = await this.getSuggestedProfiles(session, profile.username);
          for (const sugProfile of suggested) {
            if (leads.length >= maxResults) break;
            if (seenHandles.has(sugProfile.username)) continue;
            seenHandles.add(sugProfile.username);

            const sugQual = qualifyProfile(sugProfile);
            if (!sugQual.qualified) continue;

            if (sugProfile.bioLinkUrl) {
              const sugLinkCheck = await validateBioLink(sugProfile.bioLinkUrl);
              if (!sugLinkCheck.isTrainingPage) continue;
            }

            leads.push(this.mapToLead(sugProfile));
          }
        }
      }

      const result: AdapterResult = {
        leads,
        metadata: {
          source: this.source,
          tier,
          keyword,
          leadsFound: seenHandles.size,
          costEstimate: 0,
          durationMs: Date.now() - startTime,
        },
      };

      await this.completeScrapeJob(jobId, result);
      this.logger.info({ leadsFound: leads.length, profilesChecked: seenHandles.size }, 'Tier 3 scrape completed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message, keyword }, 'Tier 3 scrape failed');
      await this.failScrapeJob(jobId, message);
      throw error;
    } finally {
      await this.endSession(session);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const creds = await getActiveCredentials('instagram');
      if (creds.length === 0) {
        return { healthy: false, message: 'No active Instagram session credentials' };
      }
      return { healthy: true, message: `${creds.length} active credential(s)` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, message };
    }
  }

  private async startSession(): Promise<ScrapeSession | null> {
    const credentials = await getActiveCredentials('instagram');
    if (credentials.length === 0) return null;

    for (const cred of credentials) {
      try {
        const fullCred = await getCredential(cred.id);
        if (!fullCred.cookies) {
          this.logger.warn({ credentialId: cred.id }, 'Credential has no cookies — skipping');
          continue;
        }

        const createBrowser = await this.getCreateBrowser();
        const createContext = await this.getCreateContext();

        const browser = await createBrowser();
        const context = await createContext(browser, fullCred.cookies);
        const page = await context.newPage();

        const loggedIn = await this.verifyLogin(page);
        if (!loggedIn) {
          this.logger.warn({ credentialId: cred.id }, 'Session cookies expired — skipping');
          await page.close();
          await context.close();
          const closeBrowser = await this.getCloseBrowser();
          await closeBrowser(browser);
          continue;
        }

        this.logger.info({ credentialId: cred.id, account: cred.account }, 'Instagram session started');
        return { credential: fullCred, browser, context, page, profileCount: 0 };
      } catch (err) {
        this.logger.warn({ credentialId: cred.id, err }, 'Failed to start session with credential');
      }
    }

    return null;
  }

  private async ensureSession(session: ScrapeSession | null): Promise<ScrapeSession | null> {
    if (!session) return this.startSession();
    if (session.profileCount < MAX_PROFILES_PER_SESSION) return session;

    this.logger.info(
      { profileCount: session.profileCount },
      'Session profile limit reached — rotating',
    );
    await this.endSession(session);
    await delay(RATE_LIMIT_COOLDOWN_MS / 60);
    return this.startSession();
  }

  private async endSession(session: ScrapeSession | null): Promise<void> {
    if (!session) return;
    try {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
      const closeBrowser = await this.getCloseBrowser();
      await closeBrowser(session.browser);
    } catch {
      // best-effort cleanup
    }
  }

  private async verifyLogin(page: Page): Promise<boolean> {
    try {
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await delay(3000, 5000);

      const url = page.url();
      if (url.includes('/accounts/login') || url.includes('/challenge')) {
        return false;
      }

      const profileIcon = await page.$('[data-testid="user-avatar"]')
        ?? await page.$('img[data-testid="user-avatar"]')
        ?? await page.$('span[role="img"][aria-label]')
        ?? await page.$('svg[aria-label="Home"]')
        ?? await page.$('a[href*="/direct/inbox"]');

      return profileIcon !== null;
    } catch {
      return false;
    }
  }

  private async searchProfiles(
    session: ScrapeSession,
    query: string,
    limit: number,
  ): Promise<RawInstagramProfile[]> {
    const profiles: RawInstagramProfile[] = [];
    const page = session.page;

    try {
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await delay(3000, 5000);

      const searchButton = await page.$('a[href="/explore/"]')
        ?? await page.$('svg[aria-label="Search"]')
        ?? await page.$('[aria-label="Search"]')
        ?? await page.$('a[role="link"][href*="search"]');

      if (searchButton) {
        await searchButton.click();
        await delay(1000, 2000);
      }

      const searchInput = await page.waitForSelector(
        'input[aria-label="Search input"], input[placeholder="Search"], input[type="text"]',
        { timeout: 10_000 },
      );

      if (!searchInput) {
        this.logger.warn('Could not find search input');
        return profiles;
      }

      await searchInput.click();
      await delay(500, 1000);

      for (const char of query) {
        await searchInput.type(char, { delay: randomBetween(50, 150) });
      }

      await delay(2000, 4000);

      const resultLinks = await page.$$('a[href*="instagram.com/"][role="link"], a[href^="/"][role="link"]');

      const usernames: string[] = [];
      for (const link of resultLinks) {
        const href = await link.getAttribute('href');
        if (!href) continue;
        const match = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?$/) ??
                      href.match(/^\/([a-zA-Z0-9_.]+)\/?$/);
        if (match && !['explore', 'p', 'reel', 'stories', 'direct', 'accounts'].includes(match[1])) {
          usernames.push(match[1]);
        }
        if (usernames.length >= Math.min(limit, 20)) break;
      }

      this.logger.info({ query, results: usernames.length }, 'Search results collected');

      for (const username of usernames) {
        if (profiles.length >= limit) break;

        session.profileCount++;
        session = (await this.ensureSession(session))!;
        if (!session) break;

        try {
          const profile = await this.scrapeProfile(session.page, username);
          if (profile) profiles.push(profile);
          await delay(3000, 8000);
        } catch (err) {
          this.logger.warn({ username, err }, 'Failed to scrape profile');
        }
      }
    } catch (err) {
      this.logger.error({ query, err }, 'Search failed');
    }

    return profiles;
  }

  private async scrapeProfile(page: Page, username: string): Promise<RawInstagramProfile | null> {
    try {
      const response = await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });

      if (!response || response.status() === 404) {
        return null;
      }

      await delay(2000, 4000);

      if (page.url().includes('/accounts/login') || page.url().includes('/challenge')) {
        this.logger.warn({ username }, 'Redirected to login — session may be expired');
        return null;
      }

      const fullName = await this.extractText(page, [
        'header section span',
        'h2',
        '[data-testid="user-name"]',
      ]) ?? username;

      const bio = await this.extractText(page, [
        'header section > div:last-child span',
        'div.-vDIg span',
        'section > div > span',
      ]) ?? '';

      const bioLinkUrl = await this.extractBioLink(page);

      const followerCount = await this.extractFollowerCount(page);

      this.logger.debug({
        username,
        fullName,
        bioLength: bio.length,
        hasLink: !!bioLinkUrl,
        followers: followerCount,
      }, 'Profile scraped');

      return {
        username,
        fullName,
        bio,
        bioLinkUrl: bioLinkUrl ?? undefined,
        followerCount,
        profileUrl: `https://www.instagram.com/${username}/`,
      };
    } catch (err) {
      this.logger.warn({ username, err }, 'Profile scrape error');
      return null;
    }
  }

  private async extractText(page: Page, selectors: string[]): Promise<string | null> {
    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const text = await el.textContent();
          if (text?.trim()) return text.trim();
        }
      } catch {
        // try next selector
      }
    }
    return null;
  }

  private async extractBioLink(page: Page): Promise<string | null> {
    const selectors = [
      'a[rel="me nofollow noopener noreferrer"]',
      'header a[target="_blank"]',
      'a[href*="l.instagram.com"]',
      'div.x7a106z a',
    ];

    for (const selector of selectors) {
      try {
        const link = await page.$(selector);
        if (!link) continue;

        const href = await link.getAttribute('href');
        if (!href) continue;

        if (href.includes('l.instagram.com/')) {
          try {
            const url = new URL(href);
            const redirect = url.searchParams.get('u');
            if (redirect) return decodeURIComponent(redirect);
          } catch {
            // fall through
          }
        }

        if (href.startsWith('http')) return href;
      } catch {
        // try next selector
      }
    }

    return null;
  }

  private async extractFollowerCount(page: Page): Promise<number> {
    try {
      const followerSelectors = [
        'a[href*="/followers/"] span',
        'li:nth-child(2) span',
        '[title]',
      ];

      for (const selector of followerSelectors) {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const title = await el.getAttribute('title');
          const text = title ?? (await el.textContent());
          if (!text) continue;

          const count = parseFollowerString(text);
          if (count > 0) return count;
        }
      }

      const pageContent = await page.content();
      const followerMatch = pageContent.match(/"edge_followed_by":\s*\{"count":\s*(\d+)\}/);
      if (followerMatch) return parseInt(followerMatch[1], 10);

      const metaMatch = pageContent.match(/(\d[\d,.]*[KkMm]?)\s*[Ff]ollowers/);
      if (metaMatch) return parseFollowerString(metaMatch[1]);
    } catch {
      // best effort
    }

    return 0;
  }

  private async getSuggestedProfiles(
    session: ScrapeSession,
    username: string,
  ): Promise<RawInstagramProfile[]> {
    const suggested: RawInstagramProfile[] = [];

    try {
      const page = session.page;

      await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await delay(2000, 4000);

      const similarButton = await page.$('button:has-text("Similar accounts")')
        ?? await page.$('[aria-label="Similar accounts"]')
        ?? await page.$('button svg[aria-label="Down chevron icon"]');

      if (similarButton) {
        await similarButton.click();
        await delay(2000, 4000);
      }

      const suggestedLinks = await page.$$('div[role="dialog"] a[href^="/"], aside a[href^="/"]');

      const usernames: string[] = [];
      for (const link of suggestedLinks) {
        const href = await link.getAttribute('href');
        if (!href) continue;
        const match = href.match(/^\/([a-zA-Z0-9_.]+)\/?$/);
        if (match && !['explore', 'p', 'reel', 'stories', 'direct', 'accounts'].includes(match[1])) {
          usernames.push(match[1]);
        }
        if (usernames.length >= 5) break;
      }

      for (const sugUsername of usernames) {
        session.profileCount++;
        if (session.profileCount >= MAX_PROFILES_PER_SESSION) break;

        try {
          const profile = await this.scrapeProfile(page, sugUsername);
          if (profile) suggested.push(profile);
          await delay(3000, 8000);
        } catch {
          // skip failed profiles
        }
      }
    } catch (err) {
      this.logger.debug({ username, err }, 'Failed to get suggested profiles');
    }

    return suggested;
  }

  private mapToLead(profile: RawInstagramProfile): LeadInput {
    const companyName = extractCompanyName(profile.fullName, profile.bio);
    return {
      companyName: this.normalizeCompanyName(companyName),
      sourceUrl: profile.profileUrl,
      source: this.source,
      instagramUrl: profile.profileUrl,
      websiteUrl: profile.bioLinkUrl,
      landingPageUrl: profile.bioLinkUrl,
      sourceHandle: profile.username,
      fullName: profile.fullName,
    };
  }
}

function parseFollowerString(text: string): number {
  const cleaned = text.replace(/,/g, '').trim().toLowerCase();

  const kMatch = cleaned.match(/^([\d.]+)\s*k$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000);

  const mMatch = cleaned.match(/^([\d.]+)\s*m$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1_000_000);

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

function delay(minMs: number, maxMs?: number): Promise<void> {
  const ms = maxMs ? randomBetween(minMs, maxMs) : minMs;
  return new Promise((r) => setTimeout(r, ms));
}
