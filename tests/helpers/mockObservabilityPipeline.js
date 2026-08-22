import { visitorRepository } from '../../src/repositories/visitor.repository.js';
import { sessionRepository } from '../../src/repositories/session.repository.js';
import { eventRepository } from '../../src/repositories/event.repository.js';
import { orderRepository } from '../../src/repositories/order.repository.js';
import { orderItemRepository } from '../../src/repositories/orderItem.repository.js';
import { websiteRepository } from '../../src/repositories/website.repository.js';
import { userRepository } from '../../src/repositories/user.repository.js';
import { setupMockCommercePipeline } from './mockCommercePipeline.js';
import { makeFakeWebsite, makeFakeUserRecord } from './fakeWebsite.js';
import { signAuthToken } from '../../src/utils/jwt.js';

function sortAndPage(docs, { sortField, sortOrder, skip, limit }) {
  const sorted = [...docs].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const aTime = av instanceof Date ? av.getTime() : av;
    const bTime = bv instanceof Date ? bv.getTime() : bv;
    if (aTime === bTime) return 0;
    return sortOrder === 1 ? (aTime < bTime ? -1 : 1) : aTime < bTime ? 1 : -1;
  });
  return sorted.slice(skip, skip + limit);
}

function matchesEventFilter(event, filters = {}) {
  if (filters.eventName !== undefined && event.eventName !== filters.eventName) return false;
  if (filters.anonymousId !== undefined && event.anonymousId !== filters.anonymousId) return false;
  if (filters.sessionId !== undefined && event.sessionId !== filters.sessionId) return false;
  if (filters.from !== undefined && event.timestamp.getTime() < filters.from.getTime()) return false;
  if (filters.to !== undefined && event.timestamp.getTime() > filters.to.getTime()) return false;
  return true;
}

// Builds on setupMockCommercePipeline (real end-to-end POST /api/collect +
// postAndProcess produces real-shaped Visitor/Session/Event/Order/OrderItem
// documents in its in-memory stores — see mockCollectPipeline.js/
// mockCommercePipeline.js), then adds realistic in-memory implementations
// of Phase 12.5's new READ-ONLY listing/detail repository methods on top of
// those same stores, mirroring the exact sort/filter/pagination semantics
// the real Mongoose queries implement (src/repositories/*.js). This lets
// observability tests seed data through the real collector pipeline (the
// same one every other phase's tests already exercise) and then verify
// what the new /api/reports/:websiteId/{visitors,sessions,events,orders}
// endpoints return for it.
export function setupMockObservabilityPipeline(t, { ownerId = 'user-1', ...options } = {}) {
  const pipeline = setupMockCommercePipeline(t, options);
  const { visitors, sessions, events, orders, orderItems, checkouts, websiteId } = pipeline;

  // The reporting routes' auth -> ownership chain (authenticate ->
  // verifyWebsiteOwnership) is separate from the collector's own
  // websiteRepository.findByWebsiteId mock (setupMockPipeline already sets
  // that up for POST /api/collect) — reporting reads req.user.id via JWT
  // and resolves ownership through websiteRepository.findByWebsiteIdAndOwner,
  // exactly like setupMockReportingPipeline (Phase 9) does.
  const websites = new Map();
  websites.set(websiteId, makeFakeWebsite({ websiteId, ownerId, status: 'active' }));

  t.mock.method(userRepository, 'findById', async (id) => (id === ownerId ? makeFakeUserRecord(ownerId) : null));
  t.mock.method(websiteRepository, 'findByWebsiteIdAndOwner', async (wId, oId) => {
    const site = websites.get(wId);
    return site && site.ownerId === oId ? { ...site } : null;
  });

  t.mock.method(visitorRepository, 'findManyByWebsite', async (websiteId, opts) => {
    const docs = [...visitors.values()].filter((v) => v.websiteId === websiteId);
    return sortAndPage(docs, opts);
  });
  t.mock.method(visitorRepository, 'countByWebsite', async (websiteId) =>
    [...visitors.values()].filter((v) => v.websiteId === websiteId).length
  );

  t.mock.method(sessionRepository, 'findManyByWebsite', async (websiteId, opts) => {
    const docs = [...sessions.values()].filter((s) => s.websiteId === websiteId);
    return sortAndPage(docs, opts);
  });
  t.mock.method(sessionRepository, 'countByWebsite', async (websiteId) =>
    [...sessions.values()].filter((s) => s.websiteId === websiteId).length
  );
  t.mock.method(sessionRepository, 'findManyByWebsiteAndVisitor', async (websiteId, visitorObjectId, { limit }) => {
    const docs = [...sessions.values()]
      .filter((s) => s.websiteId === websiteId && String(s.visitorId) === String(visitorObjectId))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return docs.slice(0, limit);
  });

  t.mock.method(eventRepository, 'findManyByWebsiteFiltered', async (websiteId, filters, opts) => {
    const docs = [...events.values()].filter((e) => e.websiteId === websiteId && matchesEventFilter(e, filters));
    return sortAndPage(docs, opts);
  });
  t.mock.method(eventRepository, 'countByWebsiteFiltered', async (websiteId, filters) =>
    [...events.values()].filter((e) => e.websiteId === websiteId && matchesEventFilter(e, filters)).length
  );
  t.mock.method(eventRepository, 'findPurchaseEventByOrderId', async (websiteId, externalOrderId) =>
    [...events.values()].find(
      (e) => e.websiteId === websiteId && e.eventName === 'purchase' && e.data?.orderId === externalOrderId
    ) ?? null
  );
  t.mock.method(eventRepository, 'findManyByWebsiteAndSessionObjectId', async (websiteId, sessionObjectId, { limit }) => {
    const docs = [...events.values()]
      .filter((e) => e.websiteId === websiteId && String(e.sessionObjectId) === String(sessionObjectId))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return docs.slice(0, limit);
  });

  t.mock.method(orderRepository, 'findManyByWebsite', async (websiteId, opts) => {
    const docs = [...orders.values()].filter((o) => o.websiteId === websiteId);
    return sortAndPage(docs, opts);
  });
  t.mock.method(orderRepository, 'countByWebsite', async (websiteId) =>
    [...orders.values()].filter((o) => o.websiteId === websiteId).length
  );

  t.mock.method(orderItemRepository, 'countByOrders', async (websiteId, orderObjectIds) => {
    const ids = orderObjectIds.map(String);
    const counts = {};
    for (const item of orderItems) {
      if (item.websiteId !== websiteId) continue;
      const key = String(item.orderId);
      if (!ids.includes(key)) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });

  return {
    ...pipeline,
    visitors,
    sessions,
    events,
    orders,
    orderItems,
    checkouts,
    ownerId,
    token: signAuthToken({ _id: ownerId, role: 'user' }),
    websites,
    seedWebsite(wId, overrides) {
      websites.set(wId, makeFakeWebsite({ websiteId: wId, ownerId, status: 'active', ...overrides }));
    },
  };
}
