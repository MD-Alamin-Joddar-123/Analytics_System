export function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

export function sendError(res, statusCode, message, code, details) {
  return res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      ...(details !== undefined ? { details } : {}),
    },
  });
}
