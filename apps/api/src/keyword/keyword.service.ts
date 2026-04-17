import { Injectable } from '@nestjs/common';
import { prisma, type Keyword } from '@hyperscale/database';
import { findSimilarToLandingPage } from '@hyperscale/exa';
import type { Source } from '@hyperscale/types';
import { createLogger } from '../common/logger';

const logger = createLogger('keyword');

const SOURCE_ENUM_MAP: Record<Source, string> = {
  facebook_ads: 'FACEBOOK_ADS',
  instagram: 'INSTAGRAM',
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

@Injectable()
export class KeywordService {
  async getKeywords(filters?: {
    source?: Source;
    enabled?: boolean;
  }): Promise<Keyword[]> {
    const where: any = {};
    if (filters?.source) where.source = SOURCE_ENUM_MAP[filters.source];
    if (filters?.enabled != null) where.enabled = filters.enabled;

    return prisma.keyword.findMany({
      where,
      orderBy: { score: 'desc' },
    });
  }

  async getTopKeywords(source: Source, limit = 20): Promise<Keyword[]> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    return prisma.keyword.findMany({
      where: { source: enumVal, enabled: true },
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  async recalcAllScores(): Promise<void> {
    const keywords = await prisma.keyword.findMany({
      where: { enabled: true },
      select: { id: true },
    });

    for (const kw of keywords) {
      await this.updateScore(kw.id);
    }

    logger.info({ count: keywords.length }, 'All keyword scores recalculated');
  }

  async updateScore(keywordId: string): Promise<void> {
    const keyword = await prisma.keyword.findUniqueOrThrow({
      where: { id: keywordId },
    });

    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);
    const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS);

    const recentLeads = await prisma.lead.findMany({
      where: {
        keywordId,
        scrapedAt: { gte: thirtyDaysAgo },
      },
      select: { icpPass: true, meetingBooked: true, meetingBookedAt: true },
    });

    const totalYield = recentLeads.length;
    const icpPassCount = recentLeads.filter((l) => l.icpPass).length;
    const icpPassRate = totalYield > 0 ? icpPassCount / totalYield : 0;

    const bookingLeads = await prisma.lead.count({
      where: {
        keywordId,
        meetingBooked: true,
        meetingBookedAt: { gte: sixtyDaysAgo },
      },
    });

    const rawScore =
      totalYield * 0.3 +
      icpPassRate * 100 * 0.3 +
      bookingLeads * 50 * 0.4;

    const maxPossible = 100 * 0.3 + 100 * 0.3 + 250 * 0.4;
    const score = Math.min(10, (rawScore / maxPossible) * 10);

    await prisma.keyword.update({
      where: { id: keywordId },
      data: {
        totalYield,
        icpPassRate: Math.round(icpPassRate * 1000) / 1000,
        bookingYield: bookingLeads,
        score: Math.round(score * 100) / 100,
      },
    });

    logger.info(
      { keywordId, keyword: keyword.primary, totalYield, icpPassRate, bookingLeads, score },
      'Keyword score updated',
    );
  }

  async toggleKeyword(keywordId: string, enabled: boolean): Promise<void> {
    await prisma.keyword.update({
      where: { id: keywordId },
      data: { enabled },
    });
  }

  async addKeyword(
    primary: string,
    source: Source,
    discoveredBy = 'manual',
    secondary?: string,
    labels?: string[],
  ): Promise<Keyword> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    return prisma.keyword.create({
      data: {
        primary,
        source: enumVal,
        discoveredBy,
        ...(secondary ? { secondary } : {}),
        ...(labels ? { labels } : {}),
      },
    });
  }

  async updateKeyword(
    id: string,
    data: { primary?: string; secondary?: string; enabled?: boolean; labels?: string[] },
  ): Promise<Keyword> {
    return prisma.keyword.update({
      where: { id },
      data,
    });
  }

  async deleteKeyword(id: string): Promise<void> {
    await prisma.keyword.delete({ where: { id } });
    logger.info({ keywordId: id }, 'Keyword deleted');
  }

  async autoRetireKeywords(): Promise<string[]> {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);
    const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS);

    const keywords = await prisma.keyword.findMany({
      where: { enabled: true },
      include: {
        leads: {
          where: { scrapedAt: { gte: thirtyDaysAgo } },
          select: { id: true, icpPass: true, meetingBooked: true, meetingBookedAt: true },
        },
      },
    });

    const retired: string[] = [];

    for (const kw of keywords) {
      const recentLeads = kw.leads;
      const totalYield = recentLeads.length;
      const icpPassCount = recentLeads.filter((l) => l.icpPass).length;
      const icpPassRate = totalYield > 0 ? icpPassCount / totalYield : 0;
      const recentBookings = recentLeads.filter(
        (l) => l.meetingBooked && l.meetingBookedAt && l.meetingBookedAt >= sixtyDaysAgo,
      ).length;

      if (totalYield < 5 && icpPassRate < 0.4 && recentBookings === 0) {
        await prisma.keyword.update({
          where: { id: kw.id },
          data: { enabled: false },
        });

        await prisma.paperclipAction.create({
          data: {
            category: 'keyword',
            action: 'auto_retire',
            reasoning: `Keyword "${kw.primary}" auto-retired: ${totalYield} leads (last 30d), ${(icpPassRate * 100).toFixed(0)}% ICP pass, ${recentBookings} bookings (last 60d)`,
            inputContext: {
              keywordId: kw.id,
              keyword: kw.primary,
              totalYield,
              icpPassRate,
              recentBookings,
            } as any,
            outputResult: { disabled: true } as any,
          },
        });

        retired.push(kw.id);
        logger.info(
          { keywordId: kw.id, keyword: kw.primary, totalYield, icpPassRate, recentBookings },
          'Keyword auto-retired',
        );
      }
    }

    logger.info({ retiredCount: retired.length }, 'Keyword auto-retirement complete');
    return retired;
  }

  async proposeNewKeywords(
    bookedLeadIds: string[],
  ): Promise<Array<{ keyword: string; reasoning: string; score: number }>> {
    if (bookedLeadIds.length === 0) return [];

    const bookedLeads = await prisma.lead.findMany({
      where: { id: { in: bookedLeadIds } },
      select: { id: true, landingPageUrl: true, companyName: true, source: true },
    });

    const existingKeywords = await prisma.keyword.findMany({
      select: { primary: true },
    });
    const existingSet = new Set(existingKeywords.map((k) => k.primary.toLowerCase()));

    const keywordCandidates = new Map<string, { count: number; sources: string[] }>();

    for (const lead of bookedLeads) {
      if (!lead.landingPageUrl) continue;

      try {
        const similar = await findSimilarToLandingPage(lead.landingPageUrl);
        const results = (similar as any)?.results ?? similar ?? [];

        if (!Array.isArray(results)) continue;

        for (const result of results) {
          const title = (result.title ?? '').toLowerCase();
          const words = title
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter((w: string) => w.length > 3);

          for (let i = 0; i < words.length - 1; i++) {
            const bigram = `${words[i]} ${words[i + 1]}`;
            if (!existingSet.has(bigram)) {
              const existing = keywordCandidates.get(bigram);
              if (existing) {
                existing.count++;
                if (!existing.sources.includes(lead.source)) {
                  existing.sources.push(lead.source);
                }
              } else {
                keywordCandidates.set(bigram, { count: 1, sources: [lead.source] });
              }
            }
          }
        }
      } catch (err) {
        logger.warn(
          { leadId: lead.id, landingPageUrl: lead.landingPageUrl, err },
          'Failed to find similar pages for keyword proposal',
        );
      }
    }

    const proposals = Array.from(keywordCandidates.entries())
      .filter(([, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([keyword, data]) => ({
        keyword,
        reasoning: `Found ${data.count} times across similar pages of booked leads (sources: ${data.sources.join(', ')})`,
        score: Math.min(10, data.count * 2),
      }));

    logger.info(
      { proposalCount: proposals.length, bookedLeadCount: bookedLeadIds.length },
      'New keyword proposals generated',
    );

    return proposals;
  }
}
