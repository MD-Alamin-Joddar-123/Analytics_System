import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRateLimiter } from '../src/middleware/rateLimiter.js';


function mockReqRes(overrides = {}) {
  const headers = {};
  return {
    req: { ip: '127.0.0.1', ...overrides },
    res: {
      headers,
      setHeader(name, value) {
        this.headers[name] = value;
      },
    },
  };
}

describe('createInMemoryRateLimiter', () => {
  test('allows requests under the limit', () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 10_000, max: 3, keyGenerator: (r) => r.ip });
    const { req, res } = mockReqRes();

    for (let i = 0; i < 3; i += 1) {
      let called = false;
      limiter(req, res, (err) => {
        called = true;
        assert.equal(err, undefined);
      });
      assert.equal(called, true);
    }
  });

  test('rejects once the limit is exceeded within the window, with a 429 and Retry-After', () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 10_000, max: 2, keyGenerator: (r) => r.ip });
    const { req, res } = mockReqRes();

    limiter(req, res, () => {});
    limiter(req, res, () => {});

    let errArg;
    limiter(req, res, (err) => {
      errArg = err;
    });

    assert.equal(errArg.statusCode, 429);
    assert.equal(errArg.code, 'RATE_LIMITED');
    assert.ok(res.headers['Retry-After']);
  });

  test('tracks separate keys independently', () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 10_000, max: 1, keyGenerator: (r) => r.ip });
    const a = mockReqRes({ ip: '1.1.1.1' });
    const b = mockReqRes({ ip: '2.2.2.2' });

    let aErr;
    let bErr;
    limiter(a.req, a.res, (err) => {
      aErr = err;
    });
    limiter(b.req, b.res, (err) => {
      bErr = err;
    });

    assert.equal(aErr, undefined);
    assert.equal(bErr, undefined);
  });

  test('resets after the window elapses', async () => {
    const limiter = createInMemoryRateLimiter({ windowMs: 50, max: 1, keyGenerator: (r) => r.ip });
    const { req, res } = mockReqRes();

    limiter(req, res, () => {});

    let blockedErr;
    limiter(req, res, (err) => {
      blockedErr = err;
    });
    assert.equal(blockedErr.statusCode, 429);

    await new Promise((resolve) => setTimeout(resolve, 60));

    let afterWindowErr = 'not-called';
    limiter(req, res, (err) => {
      afterWindowErr = err;
    });
    assert.equal(afterWindowErr, undefined);
  });
});
