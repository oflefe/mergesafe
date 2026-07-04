import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { VerificationRequest, VerificationResult } from '../domain/types';
import { VerificationOrchestrator } from '../verification/verification.orchestrator';

export const VERIFICATION_QUEUE = Symbol('VERIFICATION_QUEUE');

export interface VerificationQueue {
  enqueue(request: VerificationRequest): Promise<VerificationResult>;
}

@Injectable()
export class InlineVerificationQueue implements VerificationQueue {
  constructor(private readonly orchestrator: VerificationOrchestrator) {}

  enqueue(request: VerificationRequest): Promise<VerificationResult> {
    return this.orchestrator.run(request);
  }
}

@Injectable()
export class BullMqVerificationQueue implements VerificationQueue {
  private readonly queue: Queue<VerificationRequest>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<VerificationRequest>;

  constructor(private readonly orchestrator: VerificationOrchestrator) {
    const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
    this.queue = new Queue<VerificationRequest>('verification-jobs', { connection });
    this.queueEvents = new QueueEvents('verification-jobs', { connection });
    this.worker = new Worker<VerificationRequest>(
      'verification-jobs',
      async (job) => this.orchestrator.run(job.data),
      { connection },
    );
  }

  async enqueue(request: VerificationRequest): Promise<VerificationResult> {
    if (!process.env.REDIS_URL) {
      return this.orchestrator.run(request);
    }
    const job = await this.queue.add('verify-pr', request);
    const settled = await job.waitUntilFinished(this.queueEvents);
    return settled as VerificationResult;
  }
}

export function verificationQueueProvider(orchestrator: VerificationOrchestrator) {
  return process.env.REDIS_URL
    ? new BullMqVerificationQueue(orchestrator)
    : new InlineVerificationQueue(orchestrator);
}
