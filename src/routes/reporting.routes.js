import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { verifyWebsiteOwnership } from '../middleware/verifyWebsiteOwnership.js';
import {
  validateReportQuery,
  validatePagination,
  validateProductSort,
  validateProductIdParam,
  validateVisitorSort,
  validateVisitorIdParam,
  validateSessionSort,
  validateSessionIdParam,
  validateEventSort,
  validateEventIdParam,
  validateOrderSort,
  validateOrderIdParam,
  validateOptionalDateRange,
  validateEventTypeFilter,
  validateActivityIdFilters,
} from '../validators/reporting.validator.js';
import {
  getOverview,
  getTimeSeries,
  getTopProducts,
  getProductDetail,
  getConversionReport,
  getCartCheckoutReport,
  getRevenueReport,
  getTrafficSourcesReport,
  listVisitors,
  getVisitorDetail,
  listSessions,
  getSessionDetail,
  listEvents,
  getEventDetail,
  listOrders,
  getOrderDetail,
} from '../controllers/reporting.controller.js';

const router = Router({ mergeParams: true });

// Phase 9 §9: every reporting route requires authentication AND ownership
// of the requested website — JWT -> authenticated user -> requested
// website -> ownership verification -> [validators] -> controller ->
// service -> repository -> MongoDB. `:websiteId` is the PUBLIC tracking
// id (the same identifier every analytics collection is keyed by), not
// Website's internal `_id` — see verifyWebsiteOwnership.js.
router.use('/:websiteId', authenticate, verifyWebsiteOwnership);

router.get('/:websiteId/overview', validateReportQuery, getOverview);
router.get('/:websiteId/timeseries', validateReportQuery, getTimeSeries);
router.get('/:websiteId/products', validateReportQuery, validateProductSort, validatePagination, getTopProducts);
router.get('/:websiteId/products/:productId', validateProductIdParam, validateReportQuery, getProductDetail);
router.get('/:websiteId/conversion', validateReportQuery, getConversionReport);
router.get('/:websiteId/cart-checkout', validateReportQuery, getCartCheckoutReport);
router.get('/:websiteId/revenue', validateReportQuery, getRevenueReport);
router.get('/:websiteId/traffic-sources', validateReportQuery, getTrafficSourcesReport);

// Phase 12.5 — Tracking Observability: raw Visitor/Session/Event/Order
// activity, read-only, same auth -> ownership -> validate -> controller ->
// service -> repository chain as every route above.
router.get('/:websiteId/visitors', validateVisitorSort, validatePagination, listVisitors);
router.get('/:websiteId/visitors/:visitorId', validateVisitorIdParam, getVisitorDetail);

router.get('/:websiteId/sessions', validateSessionSort, validatePagination, listSessions);
router.get('/:websiteId/sessions/:sessionId', validateSessionIdParam, getSessionDetail);

router.get(
  '/:websiteId/events',
  validateEventTypeFilter,
  validateOptionalDateRange,
  validateActivityIdFilters,
  validateEventSort,
  validatePagination,
  listEvents
);
router.get('/:websiteId/events/:eventId', validateEventIdParam, getEventDetail);

router.get('/:websiteId/orders', validateOrderSort, validatePagination, listOrders);
router.get('/:websiteId/orders/:orderId', validateOrderIdParam, getOrderDetail);

export default router;
