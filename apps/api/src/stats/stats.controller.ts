import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('today')
  async today() {
    return this.stats.getTodayNumbers();
  }

  @Get('weekly')
  async weekly() {
    return this.stats.getWeeklyTrend();
  }
}
