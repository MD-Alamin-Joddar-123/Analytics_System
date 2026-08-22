import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_QUEUE_NAME, defaultJobOptions, buildEventJobId } from '../src/config/queue.js';
import { env } from '../src/config/env.js';

describe('Queue configuration', () => {
  test('the event queue name is stable', () => {
    assert.equal(EVENT_QUEUE_NAME, 'analytics-events');
  });

  test('job deduplication id is deterministic: websiteId_eventId', () => {
    assert.equal(buildEventJobId('site-a', 'evt-1'), 'site-a_evt-1');
    assert.equal(buildEventJobId('site-a', 'evt-1'), buildEventJobId('site-a', 'evt-1'));
    assert.notEqual(buildEventJobId('site-a', 'evt-1'), buildEventJobId('site-b', 'evt-1'));
    assert.notEqual(buildEventJobId('site-a', 'evt-1'), buildEventJobId('site-a', 'evt-2'));
  });

  // A real, previously-shipped bug: `${websiteId}:${eventId}` (exactly one
  // colon) is REJECTED by BullMQ's own Job.validateOptions — it only
  // special-cases 0 or exactly 2 colons (reserved for its internal
  // repeatable-job id format). Every FakeQueue-based test below is
  // deliberately blind to this, by design (it never touches real BullMQ),
  // which is exactly how this shipped undetected — the queue is ALSO
  // always mocked at the eventQueueService boundary in every collect.*
  // test. This test exercises BullMQ's REAL Job validation directly
  // (proven to run synchronously, before any Redis I/O — see the comment
  // below) specifically so this class of bug can't silently return.
  test('the real jobId format is never rejected by BullMQ\'s own Job validation (regression)', async () => {
    const { Queue } = await import('bullmq');
    // A connection target that's guaranteed unreachable (port 1) with no
    // retries — jobId validation happens BEFORE any connection attempt, so
    // this test never needs live Redis; it only needs to distinguish
    // "rejected by validation" from "failed to connect" (expected here).
    const queue = new Queue('validation-only-test-queue', {
      connection: { host: '127.0.0.1', port: 1, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null },
    });
    try {
      await assert.rejects(
        () => queue.add('process-event', {}, { jobId: buildEventJobId('a1b2c3d4e5f60718', 'evt-1') }),
        (error) => {
          assert.notEqual(error.message, 'Custom Id cannot contain :', 'buildEventJobId must never produce a jobId BullMQ rejects');
          return true; // any OTHER rejection (a connection error, expected here) is fine
        }
      );
    } finally {
      await queue.close();
    }
  });

  test('retry attempts are configurable via QUEUE_ATTEMPTS, not hard-coded', () => {
    assert.equal(defaultJobOptions.attempts, env.queueAttempts);
    assert.equal(typeof defaultJobOptions.attempts, 'number');
    assert.ok(defaultJobOptions.attempts > 0);
  });

  test('backoff is exponential, with a configurable base delay (QUEUE_BACKOFF)', () => {
    assert.equal(defaultJobOptions.backoff.type, 'exponential');
    assert.equal(defaultJobOptions.backoff.delay, env.queueBackoffDelayMs);
    assert.ok(defaultJobOptions.backoff.delay > 0);
  });

  test('failed jobs are retained, not silently discarded (§10)', () => {
    assert.equal(defaultJobOptions.removeOnFail, false);
  });

  test('completed jobs are retained with a bounded history, not kept forever', () => {
    assert.equal(typeof defaultJobOptions.removeOnComplete, 'object');
    assert.ok(defaultJobOptions.removeOnComplete.age > 0);
    assert.ok(defaultJobOptions.removeOnComplete.count > 0);
  });
});

// A minimal in-memory stand-in for BullMQ's relevant Queue.add(name, data,
// {jobId}) dedup semantics — demonstrates the CONCEPT buildEventJobId
// exists to support (queue-level idempotent job submission, §16), fully
// isolated from real Redis/BullMQ. The actual eventQueueService (backed by
// a real BullMQ Queue) is exercised indirectly through every collect.*
// test that mocks it at the enqueueEventProcessing boundary — this test
// documents and verifies the underlying assumption those mocks stand in
// for: that adding a job with an already-used jobId does not create a
// second job.
class FakeQueue {
  constructor() {
    this.jobs = new Map(); // jobId -> job
  }

  add(name, data, { jobId }) {
    if (this.jobs.has(jobId)) {
      return this.jobs.get(jobId); // BullMQ: adding a duplicate jobId is a no-op, returns the existing job
    }
    const job = { id: jobId, name, data };
    this.jobs.set(jobId, job);
    return job;
  }
}

describe('Job creation and deduplication (simulated queue)', () => {
  test('a new event produces a new job, keyed by websiteId:eventId', () => {
    const queue = new FakeQueue();
    const jobId = buildEventJobId('site-a', 'evt-1');

    const job = queue.add('process-event', { eventObjectId: 'obj-1', websiteId: 'site-a', eventId: 'evt-1' }, { jobId });

    assert.equal(queue.jobs.size, 1);
    assert.equal(job.id, 'site-a_evt-1');
    assert.equal(job.data.eventObjectId, 'obj-1');
  });

  test('re-adding the same websiteId+eventId does not create a second job', () => {
    const queue = new FakeQueue();
    const jobId = buildEventJobId('site-a', 'evt-1');

    queue.add('process-event', { eventObjectId: 'obj-1', websiteId: 'site-a', eventId: 'evt-1' }, { jobId });
    queue.add('process-event', { eventObjectId: 'obj-1', websiteId: 'site-a', eventId: 'evt-1' }, { jobId });
    queue.add('process-event', { eventObjectId: 'obj-1', websiteId: 'site-a', eventId: 'evt-1' }, { jobId });

    assert.equal(queue.jobs.size, 1);
  });

  test('different events produce independent jobs', () => {
    const queue = new FakeQueue();

    queue.add('process-event', {}, { jobId: buildEventJobId('site-a', 'evt-1') });
    queue.add('process-event', {}, { jobId: buildEventJobId('site-a', 'evt-2') });
    queue.add('process-event', {}, { jobId: buildEventJobId('site-b', 'evt-1') });

    assert.equal(queue.jobs.size, 3);
  });
});
