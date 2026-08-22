import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/utils/ApiError.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const mockReq = { method: 'GET', originalUrl: '/test' };

describe('ApiError', () => {
  test('factory methods set the correct status codes and error codes', () => {
    assert.equal(ApiError.badRequest('bad').statusCode, 400);
    assert.equal(ApiError.unauthorized().statusCode, 401);
    assert.equal(ApiError.forbidden().statusCode, 403);
    assert.equal(ApiError.notFound().statusCode, 404);
    assert.equal(ApiError.conflict('dup').statusCode, 409);
    assert.equal(ApiError.internal().code, 'INTERNAL_SERVER_ERROR');
    assert.equal(ApiError.serviceUnavailable().statusCode, 503);
  });
});

describe('errorHandler', () => {
  test('formats a known ApiError using the consistent response envelope', () => {
    const res = mockRes();
    const err = ApiError.notFound('Widget not found');

    errorHandler(err, mockReq, res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, 'Widget not found');
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('normalizes an unknown error to a generic 500 without leaking internals', () => {
    const res = mockRes();
    const err = new Error('some internal detail: password=hunter2');

    errorHandler(err, mockReq, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.equal(res.body.message, 'Something went wrong');
  });

  test('normalizes a Mongoose ValidationError to 400', () => {
    const res = mockRes();
    const err = new Error('Path `name` is required.');
    err.name = 'ValidationError';

    errorHandler(err, mockReq, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('normalizes a duplicate key error to 409', () => {
    const res = mockRes();
    const err = new Error('duplicate key');
    err.code = 11000;

    errorHandler(err, mockReq, res, () => {});

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  });
});
