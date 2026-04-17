import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import pino from 'pino';
import { prisma } from '@hyperscale/database';
import {
  getCredential,
  encrypt,
  generateTOTP,
  markActive,
  resetFailureCount,
  markChallenged,
  markBurned,
} from '@hyperscale/sessions';
import { createBrowser, createStealthContext, closeBrowser } from './browser';

const logger = pino({ name: 'reauth-worker' });

const MAX_REAUTH_FAILURES = 5;
const TWILIO_POLL_INTERVAL_MS = 3_000;
const TWILIO_POLL_TIMEOUT_MS = 60_000;

interface ReauthJobData {
  provider: string;
  sessionId: string;
}

async function handleReauth(job: Job<ReauthJobData>): Promise<void> {
  const { provider, sessionId } = job.data;

  logger.info({ jobId: job.id, provider, sessionId }, 'Starting auto-reauth');

  const credential = await getCredential(sessionId);
  if (!credential.password) {
    logger.error({ sessionId }, 'No password stored — cannot reauth');
    await markChallenged(sessionId);
    return;
  }

  const browser = await createBrowser();

  try {
    const context = await createStealthContext(browser, credential.cookies);
    const page = await context.newPage();

    let newCookies: string | undefined;

    switch (provider) {
      case 'linkedin':
        newCookies = await reauthLinkedIn(page, credential);
        break;
      case 'instagram':
        newCookies = await reauthInstagram(page, credential);
        break;
      default:
        newCookies = await reauthGeneric(page, credential);
        break;
    }

    if (newCookies) {
      await prisma.sessionCredential.update({
        where: { id: sessionId },
        data: {
          encryptedCookies: encrypt(newCookies),
          lastReauthAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      await markActive(sessionId);
      await resetFailureCount(sessionId);

      logger.info({ sessionId, provider }, 'Reauth succeeded — cookies updated');
    } else {
      await handleReauthFailure(sessionId, provider);
    }

    await context.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, provider, error: message }, 'Reauth error');
    await handleReauthFailure(sessionId, provider);
  } finally {
    await closeBrowser(browser);
  }
}

async function handleReauthFailure(
  sessionId: string,
  provider: string,
): Promise<void> {
  const updated = await prisma.sessionCredential.update({
    where: { id: sessionId },
    data: { failureCount: { increment: 1 } },
  });

  if (updated.failureCount >= MAX_REAUTH_FAILURES) {
    await markBurned(sessionId);
    logger.warn(
      { sessionId, provider, failureCount: updated.failureCount },
      'Account burned after repeated reauth failures — escalating',
    );
  } else if (updated.failureCount >= 3) {
    await markChallenged(sessionId);
    logger.warn(
      { sessionId, provider, failureCount: updated.failureCount },
      'Account challenged — multiple reauth failures',
    );
  }
}

// ---------------------------------------------------------------------------
// Platform-specific reauth flows
// ---------------------------------------------------------------------------

async function reauthLinkedIn(
  page: any,
  credential: { username?: string; password: string; totpSecret?: string; phoneNumber?: string },
): Promise<string | undefined> {
  logger.info('Executing LinkedIn reauth flow');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle' });
  await randomDelay(1000, 2000);

  await page.fill('#username', credential.username ?? '');
  await randomDelay(300, 700);
  await page.fill('#password', credential.password);
  await randomDelay(500, 1000);
  await page.click('[data-litms-control-urn="login-submit"]');

  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  const url = page.url();

  if (url.includes('checkpoint/challenge')) {
    logger.info('LinkedIn 2FA challenge detected');

    if (credential.totpSecret) {
      const code = generateTOTP(credential.totpSecret);
      await page.fill('input[name="pin"]', code);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    } else if (credential.phoneNumber) {
      const smsCode = await pollForSmsCode(credential.phoneNumber);
      if (smsCode) {
        await page.fill('input[name="pin"]', smsCode);
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      } else {
        logger.error('SMS code retrieval timed out');
        return undefined;
      }
    } else {
      logger.error('2FA required but no TOTP secret or phone number available');
      return undefined;
    }
  }

  if (page.url().includes('/feed') || page.url().includes('/mynetwork')) {
    const cookies = await page.context().cookies();
    return JSON.stringify(cookies);
  }

  logger.warn({ finalUrl: page.url() }, 'LinkedIn reauth did not reach feed');
  return undefined;
}

async function reauthInstagram(
  page: any,
  credential: { username?: string; password: string; totpSecret?: string; phoneNumber?: string },
): Promise<string | undefined> {
  logger.info('Executing Instagram reauth flow');

  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle' });
  await randomDelay(2000, 4000);

  await page.fill('input[name="username"]', credential.username ?? '');
  await randomDelay(300, 700);
  await page.fill('input[name="password"]', credential.password);
  await randomDelay(500, 1000);
  await page.click('button[type="submit"]');

  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  const url = page.url();

  if (url.includes('challenge') || url.includes('two_factor')) {
    logger.info('Instagram 2FA challenge detected');

    if (credential.totpSecret) {
      const code = generateTOTP(credential.totpSecret);
      const securityInput = await page.$('input[name="verificationCode"]') ?? await page.$('input[name="security_code"]');
      if (securityInput) {
        await securityInput.fill(code);
        await page.click('button[type="button"]:has-text("Confirm")').catch(() =>
          page.click('button[type="submit"]'),
        );
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      }
    } else if (credential.phoneNumber) {
      const smsCode = await pollForSmsCode(credential.phoneNumber);
      if (smsCode) {
        const input = await page.$('input[name="security_code"]') ?? await page.$('input[name="verificationCode"]');
        if (input) {
          await input.fill(smsCode);
          await page.click('button[type="submit"]');
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
        }
      } else {
        logger.error('SMS code retrieval timed out');
        return undefined;
      }
    }
  }

  if (!page.url().includes('login') && !page.url().includes('challenge')) {
    const cookies = await page.context().cookies();
    return JSON.stringify(cookies);
  }

  logger.warn({ finalUrl: page.url() }, 'Instagram reauth did not reach home');
  return undefined;
}

async function reauthGeneric(
  page: any,
  credential: { username?: string; password: string },
): Promise<string | undefined> {
  logger.warn('Generic reauth flow — no platform-specific logic');
  return undefined;
}

// ---------------------------------------------------------------------------
// SMS code retrieval via Twilio
// ---------------------------------------------------------------------------

async function pollForSmsCode(phoneNumber: string): Promise<string | undefined> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    logger.error('Twilio credentials not configured');
    return undefined;
  }

  const startTime = Date.now();
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  logger.info({ phoneNumber }, 'Polling Twilio for SMS verification code');

  while (Date.now() - startTime < TWILIO_POLL_TIMEOUT_MS) {
    try {
      const url = `${baseUrl}?To=${encodeURIComponent(phoneNumber)}&PageSize=1`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${credentials}` },
      });

      if (res.ok) {
        const data = (await res.json()) as { messages: Array<{ body: string; date_sent: string }> };
        const latest = data.messages?.[0];

        if (latest) {
          const sentAt = new Date(latest.date_sent).getTime();
          if (sentAt > startTime) {
            const codeMatch = latest.body.match(/\b(\d{4,8})\b/);
            if (codeMatch) {
              logger.info('SMS verification code retrieved');
              return codeMatch[1];
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Error polling Twilio');
    }

    await new Promise((r) => setTimeout(r, TWILIO_POLL_INTERVAL_MS));
  }

  logger.error({ phoneNumber }, 'Twilio SMS poll timed out');
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

export function createReauthWorker(redis: IORedis): Worker {
  return new Worker('session-auto-reauth', handleReauth, {
    connection: redis,
    concurrency: 1,
    limiter: { max: 3, duration: 300_000 },
  });
}
