import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';

@Controller('sessions')
export class SessionController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  async listAll() {
    return prisma.sessionCredential.findMany({
      select: {
        id: true,
        service: true,
        account: true,
        status: true,
        lastUsedAt: true,
        lastHealthCheckAt: true,
        failureCount: true,
        notes: true,
      },
      orderBy: { service: 'asc' },
    });
  }

  @Post()
  async addCredential(
    @Body()
    body: {
      service: string;
      account: string;
      notes?: string;
    },
  ) {
    return prisma.sessionCredential.create({
      data: {
        service: body.service,
        account: body.account,
        status: 'active',
        notes: body.notes,
      },
    });
  }

  @Post(':id/reauth')
  async reauth(@Param('id') id: string) {
    const session = await prisma.sessionCredential.findUniqueOrThrow({
      where: { id },
    });

    const jobId = await this.queue.addJob('session-auto-reauth', {
      provider: session.service,
      sessionId: session.id,
    });

    return { jobId, message: 'Reauth job queued' };
  }

  @Get('pool/:service')
  async poolHealth(@Param('service') service: string) {
    const sessions = await prisma.sessionCredential.findMany({
      where: { service },
      select: {
        id: true,
        account: true,
        status: true,
        lastUsedAt: true,
        lastHealthCheckAt: true,
        failureCount: true,
      },
    });

    const active = sessions.filter((s) => s.status === 'active').length;
    const total = sessions.length;

    return {
      service,
      total,
      active,
      unhealthy: total - active,
      sessions,
    };
  }
}
