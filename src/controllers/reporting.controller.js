import { reportingService } from '../services/analytics/reporting.service.js';
import { observabilityService } from '../services/analytics/observability.service.js';
import { sendSuccess } from '../utils/apiResponse.js';


export async function getOverview(req, res, next) {
  try {
    const data = await reportingService.getOverview(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getTimeSeries(req, res, next) {
  try {
    const data = await reportingService.getTimeSeries(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getTopProducts(req, res, next) {
  try {
    const data = await reportingService.getTopProducts(req.website, req.reportQuery, req.sort, req.pagination);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getProductDetail(req, res, next) {
  try {
    const data = await reportingService.getProductDetail(req.website, req.params.productId, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getConversionReport(req, res, next) {
  try {
    const data = await reportingService.getConversionReport(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getCartCheckoutReport(req, res, next) {
  try {
    const data = await reportingService.getCartCheckoutReport(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getTrafficSourcesReport(req, res, next) {
  try {
    const data = await reportingService.getTrafficSourcesReport(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getRevenueReport(req, res, next) {
  try {
    const data = await reportingService.getRevenueReport(req.website, req.reportQuery);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}


export async function listVisitors(req, res, next) {
  try {
    const data = await observabilityService.listVisitors(req.website, req.sort, req.pagination);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getVisitorDetail(req, res, next) {
  try {
    const data = await observabilityService.getVisitorDetail(req.website, req.params.visitorId);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function listSessions(req, res, next) {
  try {
    const data = await observabilityService.listSessions(req.website, req.sort, req.pagination);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getSessionDetail(req, res, next) {
  try {
    const data = await observabilityService.getSessionDetail(req.website, req.params.sessionId);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function listEvents(req, res, next) {
  try {
    const filters = {
      eventName: req.eventTypeFilter,
      from: req.activityRange?.from,
      to: req.activityRange?.to,
      ...req.activityIdFilters,
    };
    const data = await observabilityService.listEvents(req.website, filters, req.sort, req.pagination);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getEventDetail(req, res, next) {
  try {
    const data = await observabilityService.getEventDetail(req.website, req.params.eventId);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function listOrders(req, res, next) {
  try {
    const data = await observabilityService.listOrders(req.website, req.sort, req.pagination);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getOrderDetail(req, res, next) {
  try {
    const data = await observabilityService.getOrderDetail(req.website, req.params.orderId);
    sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}
