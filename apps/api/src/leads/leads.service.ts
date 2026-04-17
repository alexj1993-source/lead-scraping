import { Injectable } from '@nestjs/common';
import { prisma, type Lead, Prisma } from '@hyperscale/database';
import type { LeadInput } from '@hyperscale/types';
import { createLogger } from '../common/logger';

const logger = createLogger('leads');

export interface LeadFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  source?: string;
  minScore?: number;
  maxScore?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

interface TimelineEvent {
  event: string;
  timestamp: Date | null;
  detail?: string;
}

@Injectable()
export class LeadsService {
  async findAll(
    filters: LeadFilters,
  ): Promise<{ leads: Lead[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;

    const where: Prisma.LeadWhereInput = {};

    if (filters.status) {
      where.status = filters.status as any;
    }
    if (filters.source) {
      where.source = filters.source as any;
    }
    if (filters.minScore != null || filters.maxScore != null) {
      where.icpScore = {
        ...(filters.minScore != null ? { gte: filters.minScore } : {}),
        ...(filters.maxScore != null ? { lte: filters.maxScore } : {}),
      };
    }
    if (filters.dateFrom || filters.dateTo) {
      where.scrapedAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }
    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { fullName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { scrapedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ]);

    return { leads, total };
  }

  async findById(id: string): Promise<Lead> {
    return prisma.lead.findUniqueOrThrow({ where: { id } });
  }

  async getTimeline(id: string): Promise<TimelineEvent[]> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id },
      include: { remediations: { orderBy: { createdAt: 'asc' } } },
    });

    const events: TimelineEvent[] = [
      { event: 'scraped', timestamp: lead.scrapedAt },
    ];

    if (lead.status !== 'RAW') {
      events.push({
        event: 'enriched',
        timestamp: lead.updatedAt,
        detail: `Email: ${lead.email ?? 'none'}`,
      });
    }
    if (lead.icpScoredAt) {
      events.push({
        event: 'scored',
        timestamp: lead.icpScoredAt,
        detail: `Score: ${lead.icpScore}, Pass: ${lead.icpPass}`,
      });
    }
    if (lead.validatedAt) {
      events.push({
        event: 'validated',
        timestamp: lead.validatedAt,
        detail: `NB: ${lead.neverbounceResult}, BB: ${lead.bouncebanResult}`,
      });
    }
    if (lead.personalizedAt) {
      events.push({ event: 'personalized', timestamp: lead.personalizedAt });
    }
    if (lead.uploadedAt) {
      events.push({
        event: 'uploaded',
        timestamp: lead.uploadedAt,
        detail: `Campaign: ${lead.instantlyCampaignId}`,
      });
    }
    if (lead.emailReplied) {
      events.push({
        event: 'replied',
        timestamp: lead.replyClassifiedAt,
        detail: `Classification: ${lead.replyClassification}`,
      });
    }
    if (lead.meetingBookedAt) {
      events.push({ event: 'booked', timestamp: lead.meetingBookedAt });
    }

    for (const rem of lead.remediations) {
      events.push({
        event: `remediation:${rem.trigger}`,
        timestamp: rem.createdAt,
        detail: `Status: ${rem.status}, Actor: ${rem.actor}`,
      });
    }

    return events.sort(
      (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
    );
  }

  async updateStatus(id: string, status: string): Promise<Lead> {
    return prisma.lead.update({
      where: { id },
      data: { status: status as any },
    });
  }

  async bulkImport(
    leads: LeadInput[],
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const input of leads) {
      const normalized = input.companyName.toLowerCase().replace(/\s+/g, ' ').trim();

      const existing = await prisma.lead.findFirst({
        where: {
          companyNameNormalized: normalized,
          ...(input.email ? { email: input.email } : {}),
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.lead.create({
        data: {
          companyName: input.companyName,
          companyNameNormalized: normalized,
          source: 'MANUAL_IMPORT',
          sourceUrl: input.sourceUrl,
          firstName: input.firstName,
          fullName: input.fullName,
          title: input.title,
          email: input.email,
          websiteUrl: input.websiteUrl,
          linkedinUrl: input.linkedinUrl,
          instagramUrl: input.instagramUrl,
          facebookUrl: input.facebookUrl,
          phoneNumber: input.phoneNumber,
          country: input.country,
        },
      });
      imported++;
    }

    logger.info({ imported, skipped }, 'Bulk import complete');
    return { imported, skipped };
  }

  async getRecentLeads(limit = 20): Promise<Lead[]> {
    return prisma.lead.findMany({
      orderBy: { scrapedAt: 'desc' },
      take: limit,
    });
  }
}
