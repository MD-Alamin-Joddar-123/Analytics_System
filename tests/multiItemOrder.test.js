import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { setupMockCommercePipeline } from './helpers/mockCommercePipeline.js';
import { postAndProcess } from './helpers/postAndProcess.js';

const WEBSITE_ID = 'a1b2c3d4e5f60718';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(pipeline, body) {
  return postAndProcess(baseUrl, body, pipeline);
}

const twoItemPurchase = () => ({
  websiteId: WEBSITE_ID,
  event: 'purchase',
  anonymousId: 'anon-multi',
  sessionId: 'sess-multi',
  data: {
    orderId: 'ORD-20260820-7734',
    revenue: 119960,
    currency: 'BDT',
    items: [
      { productId: 'p-rui', name: 'Rui Fish (1 kg)', price: 59800, quantity: 1 },
      { productId: 'p-katla', name: 'Katla Fish (1 kg)', price: 30080, quantity: 2 },
    ],
  },
});

describe('Multi-item purchase — end-to-end (ingestion -> processing -> storage)', () => {
  test('a 2-item purchase is accepted by /api/collect', async (t) => {
    const pipeline = setupMockCommercePipeline(t);

    const { res, body } = await fetch(`${baseUrl}/api/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(twoItemPurchase()),
    }).then((r) => r.json().then((json) => ({ res: r, body: json })));

    assert.equal(res.status, 202, `expected 202, got ${res.status}: ${JSON.stringify(body)}`);
  });

  test('the processed multi-item order is stored with BOTH line items', async (t) => {
    const pipeline = setupMockCommercePipeline(t);
    const { orders, orderItems } = pipeline;

    const { res, processingResult } = await post(pipeline, twoItemPurchase());

    assert.equal(res.status, 202);
    assert.equal(processingResult?.processed, true, `processing failed: ${JSON.stringify(processingResult)}`);
    assert.equal(orders.size, 1, 'the order itself must be stored');

    const order = orders.get(`${WEBSITE_ID}:ORD-20260820-7734`);
    assert.ok(order, 'order findable by websiteId + externalOrderId');
    assert.equal(order.total, 11996000);
    assert.equal(order.currency, 'BDT');

    const lines = orderItems.filter((oi) => String(oi.orderId) === String(order._id));
    assert.equal(lines.length, 2, 'both line items recorded');
    const byProduct = Object.fromEntries(lines.map((line) => [line.externalProductId, line]));
    assert.deepEqual(
      { unitPrice: byProduct['p-rui'].unitPrice, quantity: byProduct['p-rui'].quantity },
      { unitPrice: 5980000, quantity: 1 }
    );
    assert.deepEqual(
      { unitPrice: byProduct['p-katla'].unitPrice, quantity: byProduct['p-katla'].quantity },
      { unitPrice: 3008000, quantity: 2 }
    );
    assert.equal(lines.reduce((sum, l) => sum + l.total, 0), order.total);
  });

  test('the stored order appears in the dashboard Orders listing (GET /api/reports/:websiteId/orders)', async (t) => {
    const { setupMockObservabilityPipeline } = await import('./helpers/mockObservabilityPipeline.js');
    const pipeline = setupMockObservabilityPipeline(t);

    await post(pipeline, twoItemPurchase());

    const res = await fetch(`${baseUrl}/api/reports/${WEBSITE_ID}/orders`, {
      headers: { Authorization: `Bearer ${pipeline.token}` },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.pagination.total, 1, 'the multi-item order is listed');
    const summary = body.data.items.find((o) => o.orderId === 'ORD-20260820-7734');
    assert.ok(summary, 'order findable on the Orders page');
    assert.equal(summary.itemCount, 2, 'both line items counted');
  });
});
