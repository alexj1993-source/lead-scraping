import { Controller, Get, Post, Param, Query, Body, Headers, HttpCode, BadRequestException } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';
import { ReplyService } from './reply.service';
import { createLogger } from '../common/logger';

const logger = createLogger('reply-controller');

@Controller('replies')
export class ReplyController {
  constructor(
    private readonly queue: QueueService,
    private readonly replyService: ReplyService,
  ) {}

  @Get()
  async list(
    @Query('classification') classification?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 50;

    const where: any = { emailReplied: true };
    if (classification) {
      where.replyClassification = classification;
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { replyClassifiedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        select: {
          id: true,
          companyName: true,
          email: true,
          firstName: true,
          replyText: true,
          replyClassification: true,
          replyClassifiedAt: true,
          draftReply: true,
          source: true,
          instantlyCampaignId: true,
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return { leads, total, page: p, pageSize: ps };
  }

  @Get('pending-review')
  async pendingReview() {
    const leads = await prisma.lead.findMany({
      where: {
        emailReplied: true,
        draftReply: { not: undefined },
        replyClassification: { in: ['DIRECT_INTEREST', 'INTEREST_OBJECTION'] },
      },
      orderBy: { replyClassifiedAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        email: true,
        firstName: true,
        replyText: true,
        replyClassification: true,
        replyClassifiedAt: true,
        draftReply: true,
        source: true,
      },
    });

    return { leads, total: leads.length };
  }

  @Post(':leadId/reclassify')
  async reclassify(
    @Param('leadId') leadId: string,
    @Body() body: { classification?: string },
  ) {
    if (body.classification) {
      await this.replyService.reclassify(leadId, body.classification);
      return { success: true, classification: body.classification };
    }

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { id: true, replyText: true },
    });

    const jobId = await this.queue.addJob('reply-classify', {
      replyId: lead.id,
      body: lead.replyText ?? '',
      leadId: lead.id,
    });

    return { jobId, message: 'Reclassification queued' };
  }

  @Post(':leadId/approve-draft')
  async approveDraft(@Param('leadId') leadId: string) {
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { id: true, draftReply: true, email: true, companyName: true },
    });

    if (!lead.draftReply) {
      throw new BadRequestException('No draft reply to approve');
    }

    logger.info({ leadId, email: lead.email }, 'Draft reply approved — ready to send');

    return { success: true, message: 'Draft approved. Manual send required via Instantly.' };
  }
}

@Controller('webhooks/instantly')
export class InstantlyWebhookController {
  constructor(private readonly replyService: ReplyService) {}

  @Post('reply')
  @HttpCode(200)
  async handleReplyWebhook(
    @Body() body: any,
    @Headers('x-instantly-signature') signature?: string,
  ) {
    const expectedSecret = process.env.INSTANTLY_WEBHOOK_SECRET;
    if (expectedSecret && signature !== expectedSecret) {
      logger.warn({ signature: signature?.slice(0, 8) }, 'Invalid Instantly webhook signature');
      throw new BadRequestException('Invalid webhook signature');
    }

    const email = body.from_email ?? body.email ?? body.lead_email;
    const replyBody = body.body ?? body.text ?? body.reply_body ?? '';
    const subject = body.subject ?? '';
    const campaignId = body.campaign_id ?? body.campaignId;
    const instantlyLeadId = body.lead_id ?? body.leadId;

    if (!email) {
      logger.warn({ body: JSON.stringify(body).slice(0, 500) }, 'Webhook missing email');
      throw new BadRequestException('Missing email field');
    }

    if (!replyBody) {
      logger.warn({ email }, 'Webhook missing reply body');
      throw new BadRequestException('Missing reply body');
    }

    logger.info({ email, campaignId, hasBody: !!replyBody }, 'Instantly reply webhook received');

    const result = await this.replyService.processReply({
      email,
      body: replyBody,
      subject,
      campaignId,
      instantlyLeadId,
      timestamp: body.timestamp ?? body.created_at,
    });

    return {
      success: true,
      processed: !!result,
      ...(result ?? {}),
    };
  }
}
