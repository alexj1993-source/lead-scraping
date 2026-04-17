import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { prisma } from '@hyperscale/database';

@Controller('manual-review')
export class ManualReviewController {
  @Get()
  async list() {
    const alerts = await prisma.alert.findMany({
      where: {
        acknowledged: false,
        severity: { in: ['critical', 'warning'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return alerts.map((alert) => ({
      id: alert.id,
      trigger: alert.title,
      triggerDetail: alert.description,
      autoRemediation: alert.actionTaken ?? 'None taken',
      paperclipRecommendation: 'Review and decide on appropriate action',
      severity: alert.severity as 'critical' | 'warning' | 'info',
      timestamp: alert.createdAt.toISOString(),
    }));
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    await prisma.alert.update({
      where: { id },
      data: { acknowledged: true, resolvedAt: new Date() },
    });
    return { success: true };
  }

  @Post(':id/override')
  async override(
    @Param('id') id: string,
    @Body() body: { action: string },
  ) {
    await prisma.alert.update({
      where: { id },
      data: {
        acknowledged: true,
        actionTaken: `OVERRIDE: ${body.action}`,
        resolvedAt: new Date(),
      },
    });
    return { success: true };
  }
}
