import { Controller, Get, Put, Post, Param, Body } from '@nestjs/common';
import { SourceService } from './source.service';
import type { Source, SourceTier } from '@hyperscale/types';

@Controller('sources')
export class SourceController {
  constructor(private readonly sourceService: SourceService) {}

  @Get()
  async listAll() {
    return this.sourceService.getSources();
  }

  @Get('health')
  async health() {
    return this.sourceService.getSourceHealth();
  }

  @Get(':source/config')
  async getConfig(@Param('source') source: Source) {
    return this.sourceService.getSourceConfig(source);
  }

  @Put(':source/config')
  async updateConfig(
    @Param('source') source: string,
    @Body() body: {
      autoTierSwitch?: boolean;
      tier1Config?: any;
      tier2Config?: any;
      tier3Config?: any;
      scheduleEnabled?: boolean;
      scheduleDailyTarget?: number;
    },
  ) {
    return this.sourceService.updateSourceConfig(source, body);
  }

  @Post(':source/toggle')
  async toggle(
    @Param('source') source: string,
    @Body() body: { enabled: boolean },
  ) {
    await this.sourceService.toggleSource(source, body.enabled);
    return { success: true };
  }

  @Post(':source/run')
  async run(
    @Param('source') source: string,
    @Body() body: { count?: number },
  ) {
    return this.sourceService.runSource(source, body.count ?? 10);
  }

  @Post(':source/switch-tier')
  async switchTier(
    @Param('source') source: Source,
    @Body() body: { toTier: SourceTier; reason: string },
  ) {
    await this.sourceService.executeTierSwitch(
      source,
      body.toTier,
      body.reason,
    );
    return { success: true };
  }

  @Get(':source/history')
  async history(@Param('source') source: Source) {
    return this.sourceService.getTierSwitchHistory(source);
  }
}
