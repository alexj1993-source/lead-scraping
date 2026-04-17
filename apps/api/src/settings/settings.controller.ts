import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { prisma } from '@hyperscale/database';
import Redis from 'ioredis';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async listProviders() {
    return this.settingsService.getProviders();
  }

  @Get('services')
  async serviceStatus() {
    const checks: Array<{ name: string; status: string; latency?: string }> = [];

    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.push({ name: 'PostgreSQL', status: 'connected', latency: `${Date.now() - dbStart}ms` });
    } catch {
      checks.push({ name: 'PostgreSQL', status: 'disconnected' });
    }

    const redisStart = Date.now();
    try {
      const redis = new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD ?? undefined,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
      });
      await redis.ping();
      await redis.quit();
      checks.push({ name: 'Redis', status: 'connected', latency: `${Date.now() - redisStart}ms` });
    } catch {
      checks.push({ name: 'Redis', status: 'disconnected' });
    }

    checks.push({ name: 'BullMQ Workers', status: 'connected' });

    const providers = await this.settingsService.getProviders();
    for (const p of providers) {
      if (p.configured) {
        checks.push({ name: `${p.label} API`, status: 'connected' });
      }
    }

    return checks;
  }

  @Get('flags')
  async featureFlags() {
    const cached = await prisma.apiCache.findUnique({ where: { key: 'feature_flags' } });
    if (cached) return cached.response;

    return [
      { key: 'paperclip_autonomous', label: 'Paperclip Autonomous Mode', description: 'Allow Paperclip to make decisions without human approval', enabled: true },
      { key: 'auto_tier_switch', label: 'Auto Tier Switch', description: 'Automatically switch source tiers based on health metrics', enabled: true },
      { key: 'keyword_rotation', label: 'Keyword Rotation', description: 'Automatically retire underperforming keywords', enabled: true },
      { key: 'email_warmup', label: 'Email Warmup', description: 'Enable gradual email sending volume increase', enabled: false },
      { key: 'exa_enrichment', label: 'Exa Enrichment', description: 'Use Exa for additional lead enrichment data', enabled: true },
    ];
  }

  @Get('onboarding-status')
  async onboardingStatus() {
    const providers = await this.settingsService.getProviders();

    const requiredProviders = ['apify', 'instantly', 'anthropic'];
    const configuredRequired = providers.filter(
      (p) => requiredProviders.includes(p.name) && p.configured,
    ).length;

    const keywordCount = await prisma.keyword.count();
    const sourceCount = await prisma.sourceConfig.count();

    const scheduleCache = await prisma.apiCache.findUnique({
      where: { key: 'schedule_config' },
    });

    const steps = {
      apiKeys: {
        configured: configuredRequired,
        required: requiredProviders.length,
        requiredProviders,
      },
      keywords: { count: keywordCount, minimum: 5 },
      sources: { configured: sourceCount, minimum: 1 },
      schedule: { configured: !!scheduleCache },
    };

    const complete =
      configuredRequired >= requiredProviders.length &&
      keywordCount >= 5 &&
      sourceCount >= 1 &&
      !!scheduleCache;

    return { complete, steps };
  }

  @Put(':provider')
  async setApiKey(
    @Param('provider') provider: string,
    @Body() body: { apiKey: string },
  ) {
    if (!body.apiKey) {
      throw new HttpException('apiKey is required', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.settingsService.setApiKey(provider, body.apiKey);
      return { success: true, message: `API key saved for ${provider}` };
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : 'Failed to save API key',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':provider/test')
  async testConnection(@Param('provider') provider: string) {
    return this.settingsService.testConnection(provider);
  }
}
