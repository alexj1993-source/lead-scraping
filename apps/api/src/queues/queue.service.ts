import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { createLogger } from '../common/logger';

const logger = createLogger('queue-service');

@Injectable()
export class QueueService {
  private readonly queues = new Map<string, Queue>();

  constructor(
    @InjectQueue('scrape-facebook') private scrapeFb: Queue,
    @InjectQueue('scrape-instagram') private scrapeIg: Queue,
    @InjectQueue('enrich') private enrich: Queue,
    @InjectQueue('score') private score: Queue,
    @InjectQueue('dedup') private dedup: Queue,
    @InjectQueue('validate') private validate: Queue,
    @InjectQueue('validate-neverbounce') private validateNb: Queue,
    @InjectQueue('validate-bounceban') private validateBb: Queue,
    @InjectQueue('personalize') private personalize: Queue,
    @InjectQueue('qa') private qa: Queue,
    @InjectQueue('upload') private upload: Queue,
    @InjectQueue('reply-sync') private replySync: Queue,
    @InjectQueue('reply-classify') private replyClassify: Queue,
    @InjectQueue('remediate') private remediate: Queue,
    @InjectQueue('session-health-check') private sessionHealth: Queue,
    @InjectQueue('session-auto-reauth') private sessionReauth: Queue,
    @InjectQueue('paperclip-15min') private paperclip15: Queue,
    @InjectQueue('paperclip-hourly') private paperclipHourly: Queue,
    @InjectQueue('paperclip-daily') private paperclipDaily: Queue,
    @InjectQueue('paperclip-weekly') private paperclipWeekly: Queue,
    @InjectQueue('exa-search') private exaSearch: Queue,
    @InjectQueue('keyword-score') private keywordScore: Queue,
    @InjectQueue('stats-rollup') private statsRollup: Queue,
  ) {
    this.queues.set('scrape-facebook', scrapeFb);
    this.queues.set('scrape-instagram', scrapeIg);
    this.queues.set('enrich', enrich);
    this.queues.set('score', score);
    this.queues.set('dedup', dedup);
    this.queues.set('validate', validate);
    this.queues.set('validate-neverbounce', validateNb);
    this.queues.set('validate-bounceban', validateBb);
    this.queues.set('personalize', personalize);
    this.queues.set('qa', qa);
    this.queues.set('upload', upload);
    this.queues.set('reply-sync', replySync);
    this.queues.set('reply-classify', replyClassify);
    this.queues.set('remediate', remediate);
    this.queues.set('session-health-check', sessionHealth);
    this.queues.set('session-auto-reauth', sessionReauth);
    this.queues.set('paperclip-15min', paperclip15);
    this.queues.set('paperclip-hourly', paperclipHourly);
    this.queues.set('paperclip-daily', paperclipDaily);
    this.queues.set('paperclip-weekly', paperclipWeekly);
    this.queues.set('exa-search', exaSearch);
    this.queues.set('keyword-score', keywordScore);
    this.queues.set('stats-rollup', statsRollup);
  }

  private getQueue(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  async addJob(
    queueName: string,
    data: any,
    opts?: { delay?: number; priority?: number; attempts?: number },
  ): Promise<string> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(queueName, data, {
      delay: opts?.delay,
      priority: opts?.priority,
      attempts: opts?.attempts ?? 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    logger.info({ queue: queueName, jobId: job.id }, 'Job added');
    return job.id!;
  }

  async addBulk(
    queueName: string,
    jobs: Array<{ data: any; opts?: any }>,
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    const added = await queue.addBulk(
      jobs.map((j) => ({
        name: queueName,
        data: j.data,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          ...j.opts,
        },
      })),
    );
    logger.info({ queue: queueName, count: added.length }, 'Bulk jobs added');
    return added.map((j) => j.id!);
  }

  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.getQueue(queueName);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }

  async getDlqItems(queueName: string, limit = 50): Promise<any[]> {
    const queue = this.getQueue(queueName);
    const failed = await queue.getFailed(0, limit);
    return failed.map((j) => ({
      id: j.id,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
    }));
  }

  async retryDlqItem(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found in ${queueName}`);
    await job.retry();
    logger.info({ queue: queueName, jobId }, 'DLQ item retried');
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
    logger.warn({ queue: queueName }, 'Queue paused');
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
    logger.info({ queue: queueName }, 'Queue resumed');
  }
}
