import { Injectable } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { encrypt, decrypt } from '@hyperscale/sessions';
import { createLogger } from '../common/logger';

const logger = createLogger('settings');

interface ProviderConfig {
  name: string;
  label: string;
  testUrl: string;
  testMethod: 'GET' | 'POST';
  testBody?: Record<string, unknown>;
  authStyle: 'bearer' | 'query' | 'header-key' | 'path-token';
  authParam?: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'neverbounce',
    label: 'NeverBounce',
    testUrl: 'https://api.neverbounce.com/v4.2/account/info',
    testMethod: 'GET',
    authStyle: 'query',
    authParam: 'key',
  },
  {
    name: 'bounceban',
    label: 'BounceBan',
    testUrl: 'https://api.bounceban.com/v1/account',
    testMethod: 'GET',
    authStyle: 'header-key',
    authParam: 'x-api-key',
  },
  {
    name: 'instantly',
    label: 'Instantly',
    testUrl: 'https://api.instantly.ai/api/v2/accounts',
    testMethod: 'GET',
    authStyle: 'bearer',
  },
  {
    name: 'anthropic',
    label: 'Anthropic',
    testUrl: 'https://api.anthropic.com/v1/messages',
    testMethod: 'POST',
    testBody: {
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    },
    authStyle: 'header-key',
    authParam: 'x-api-key',
  },
  {
    name: 'apollo',
    label: 'Apollo',
    testUrl: 'https://api.apollo.io/v1/auth/health',
    testMethod: 'GET',
    authStyle: 'header-key',
    authParam: 'x-api-key',
  },
  {
    name: 'snovio',
    label: 'Snov.io',
    testUrl: 'https://api.snov.io/v1/get-domain-emails-count?domain=example.com',
    testMethod: 'GET',
    authStyle: 'bearer',
  },
  {
    name: 'exa',
    label: 'Exa',
    testUrl: 'https://api.exa.ai/search',
    testMethod: 'POST',
    testBody: { query: 'test', numResults: 1 },
    authStyle: 'bearer',
  },
  {
    name: 'apify',
    label: 'Apify',
    testUrl: 'https://api.apify.com/v2/users/me',
    testMethod: 'GET',
    authStyle: 'query',
    authParam: 'token',
  },
  {
    name: 'hetrixtools',
    label: 'HetrixTools',
    testUrl: 'https://api.hetrixtools.com/v2/{token}/blacklist-monitors/',
    testMethod: 'GET',
    authStyle: 'path-token',
  },
  {
    name: 'getprospect',
    label: 'GetProspect',
    testUrl: 'https://api.getprospect.com/public/v1/account',
    testMethod: 'GET',
    authStyle: 'header-key',
    authParam: 'apiKey',
  },
  {
    name: 'lusha',
    label: 'Lusha',
    testUrl: 'https://api.lusha.com/person',
    testMethod: 'GET',
    authStyle: 'header-key',
    authParam: 'api_key',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    testUrl: 'https://api.openai.com/v1/models',
    testMethod: 'GET',
    authStyle: 'bearer',
  },
];

function maskKey(key: string): string {
  if (key.length <= 4) return '●'.repeat(key.length);
  return '●'.repeat(key.length - 4) + key.slice(-4);
}

function isVaultConfigured(): boolean {
  return !!process.env.SESSION_ENCRYPTION_KEY;
}

@Injectable()
export class SettingsService {
  async getProviders() {
    const vaultOk = isVaultConfigured();

    const credentials = vaultOk
      ? await prisma.sessionCredential.findMany({
          where: { account: 'api_key' },
        })
      : [];

    return PROVIDERS.map((provider) => {
      const cred = credentials.find((c) => c.service === provider.name);
      let maskedKey: string | null = null;

      if (cred?.encryptedPassword) {
        try {
          const raw = decrypt(Buffer.from(cred.encryptedPassword));
          maskedKey = maskKey(raw);
        } catch {
          maskedKey = '●●●● (decrypt error)';
        }
      }

      return {
        name: provider.name,
        label: provider.label,
        configured: !!cred,
        maskedKey,
        status: cred ? 'configured' : 'unconfigured',
        vaultWarning: !vaultOk,
      };
    });
  }

  async setApiKey(provider: string, key: string): Promise<void> {
    if (!isVaultConfigured()) {
      throw new Error(
        'SESSION_ENCRYPTION_KEY is not set. Cannot store encrypted credentials.',
      );
    }

    const providerConfig = PROVIDERS.find((p) => p.name === provider);
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const encrypted = encrypt(key);

    const existing = await prisma.sessionCredential.findFirst({
      where: { service: provider, account: 'api_key' },
    });

    if (existing) {
      await prisma.sessionCredential.update({
        where: { id: existing.id },
        data: { encryptedPassword: encrypted },
      });
    } else {
      await prisma.sessionCredential.create({
        data: {
          service: provider,
          account: 'api_key',
          encryptedPassword: encrypted,
          status: 'active',
        },
      });
    }

    logger.info({ provider }, 'API key stored');
  }

  async testConnection(
    provider: string,
  ): Promise<{ success: boolean; message: string }> {
    const providerConfig = PROVIDERS.find((p) => p.name === provider);
    if (!providerConfig) {
      return { success: false, message: `Unknown provider: ${provider}` };
    }

    if (!isVaultConfigured()) {
      return {
        success: false,
        message: 'Vault not configured (SESSION_ENCRYPTION_KEY missing)',
      };
    }

    const cred = await prisma.sessionCredential.findFirst({
      where: { service: provider, account: 'api_key' },
    });

    if (!cred?.encryptedPassword) {
      return { success: false, message: 'No API key configured' };
    }

    let apiKey: string;
    try {
      apiKey = decrypt(Buffer.from(cred.encryptedPassword));
    } catch {
      return { success: false, message: 'Failed to decrypt API key' };
    }

    try {
      let url = providerConfig.testUrl;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      switch (providerConfig.authStyle) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${apiKey}`;
          break;
        case 'query': {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}${providerConfig.authParam}=${encodeURIComponent(apiKey)}`;
          break;
        }
        case 'header-key':
          headers[providerConfig.authParam!] = apiKey;
          break;
        case 'path-token':
          url = url.replace('{token}', encodeURIComponent(apiKey));
          break;
      }

      const init: RequestInit = {
        method: providerConfig.testMethod,
        headers,
        signal: AbortSignal.timeout(10_000),
      };

      if (providerConfig.testMethod === 'POST' && providerConfig.testBody) {
        init.body = JSON.stringify(providerConfig.testBody);
      }

      const res = await fetch(url, init);

      if (res.ok || res.status === 401 || res.status === 403) {
        const connected = res.ok;
        return {
          success: connected,
          message: connected
            ? `Connected (${res.status})`
            : `Authentication failed (${res.status})`,
        };
      }

      return {
        success: false,
        message: `API returned ${res.status}: ${res.statusText}`,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Connection failed';
      logger.warn({ provider, error: message }, 'Connection test failed');
      return { success: false, message };
    }
  }
}
