import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { AlertService } from './alert.service';

@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @Get()
  async list(@Query('severity') severity?: string) {
    return this.alertService.getUnacknowledged(severity);
  }

  @Get('recent')
  async recent(@Query('hours') hours?: string) {
    return this.alertService.getRecentAlerts(hours ? parseInt(hours, 10) : 24);
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string) {
    await this.alertService.acknowledge(id);
    return { success: true };
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string) {
    await this.alertService.resolve(id);
    return { success: true };
  }
}
