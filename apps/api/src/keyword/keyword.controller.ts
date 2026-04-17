import { Controller, Get, Post, Put, Delete, Patch, Param, Body, Query } from '@nestjs/common';
import { KeywordService } from './keyword.service';
import type { Source } from '@hyperscale/types';

@Controller('keywords')
export class KeywordController {
  constructor(private readonly keywordService: KeywordService) {}

  @Get()
  async list(
    @Query('source') source?: Source,
    @Query('enabled') enabled?: string,
  ) {
    return this.keywordService.getKeywords({
      source,
      enabled: enabled != null ? enabled === 'true' : undefined,
    });
  }

  @Post()
  async create(
    @Body() body: { primary: string; source: Source; secondary?: string; discoveredBy?: string; labels?: string[] },
  ) {
    return this.keywordService.addKeyword(
      body.primary,
      body.source,
      body.discoveredBy,
      body.secondary,
      body.labels,
    );
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { primary?: string; secondary?: string; enabled?: boolean; labels?: string[] },
  ) {
    return this.keywordService.updateKeyword(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.keywordService.deleteKeyword(id);
    return { success: true };
  }

  @Patch(':id/toggle')
  async toggle(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    await this.keywordService.toggleKeyword(id, body.enabled);
    return { success: true };
  }

  @Post('recalc')
  async recalcAll() {
    await this.keywordService.recalcAllScores();
    return { success: true, message: 'Recalculation complete' };
  }
}
