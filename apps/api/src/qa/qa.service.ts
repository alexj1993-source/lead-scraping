import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { createLogger } from '../common/logger';
import { QueueService } from '../queues/queue.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface QaResult {
  passed: boolean;
  failures: string[];
}

@Injectable()
export class QaService {
  private logger = createLogger('qa');

  constructor(private readonly queueService: QueueService) {}

  async validateLead(leadId: string): Promise<QaResult> {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });

    const failures: string[] = [];

    if (!lead.email) {
      failures.push('missing_email');
    } else if (!EMAIL_REGEX.test(lead.email)) {
      failures.push('invalid_email_format');
    }

    if (!lead.firstName) {
      failures.push('missing_first_name');
    }

    if (!lead.companyName) {
      failures.push('missing_company_name');
    }

    if (!lead.leadMagnetDescription) {
      failures.push('missing_lead_magnet');
    }

    if (lead.status !== 'READY_TO_UPLOAD') {
      failures.push(`unexpected_status:${lead.status}`);
    }

    const personalization = lead.personalization as Record<string, any> | null;
    if (!personalization?.icebreaker || !personalization?.subjectLine) {
      failures.push('incomplete_personalization');
    }

    if (lead.email) {
      const duplicate = await prisma.lead.findFirst({
        where: {
          email: lead.email,
          status: 'UPLOADED',
          id: { not: leadId },
        },
        select: { id: true },
      });
      if (duplicate) {
        failures.push(`duplicate_uploaded_email:${duplicate.id}`);
      }
    }

    if (failures.length > 0) {
      this.logger.warn({ leadId, failures }, 'QA failed');
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'ERROR' },
      });
      return { passed: false, failures };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'REVIEW_PENDING' },
    });

    await this.queueService.addJob('upload', { leadId });

    this.logger.info({ leadId }, 'QA passed, queued for upload');
    return { passed: true, failures: [] };
  }
}
