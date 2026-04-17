import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { createReauthWorker } from './reauth-worker';

const logger = pino({ name: 'scraper' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const SCRAPE_QUEUES = [
  'scrape-facebook',
  'scrape-instagram',
] as const;

async function main() {
  logger.info('Starting Hyperscale scraper service...');

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));

  const workers: Worker[] = [];

  for (const queueName of SCRAPE_QUEUES) {
    const worker = new Worker(
      queueName,
      async (job) => {
        const { keyword, country, maxResults } = job.data;
        const source = queueName.split(':')[1];
        logger.info(
          { jobId: job.id, source, keyword, country },
          'Processing scrape job',
        );

        // TODO: Implement per-source Playwright scraping
        // 1. Select best session credential for this source
        // 2. Launch stealth browser with proxy
        // 3. Execute source-specific scrape flow
        // 4. Parse results into LeadInput[]
        // 5. Push leads to enrich queue
        // 6. Update ScrapeJob record with results

        logger.warn(
          { jobId: job.id, source },
          'Scraping not yet implemented — placeholder worker',
        );
      },
      {
        connection: redis,
        concurrency: 2,
        limiter: { max: 5, duration: 60_000 },
      },
    );

    worker.on('completed', (job) =>
      logger.info({ jobId: job.id, queue: queueName }, 'Job completed'),
    );
    worker.on('failed', (job, err) =>
      logger.error({ jobId: job?.id, queue: queueName, err: err.message }, 'Job failed'),
    );

    workers.push(worker);
    logger.info({ queue: queueName }, 'Registered scrape worker');
  }

  const reauthWorker = createReauthWorker(redis);
  workers.push(reauthWorker);
  logger.info({ queue: 'session-auto-reauth' }, 'Registered reauth worker');

  logger.info(
    { workers: workers.length },
    'Scraper service ready — listening for jobs',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down scraper service...');
    await Promise.all(workers.map((w) => w.close()));
    await redis.quit();
    logger.info('Scraper service stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start scraper service');
  process.exit(1);
});
