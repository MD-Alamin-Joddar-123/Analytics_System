import { authService } from '../services/auth/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function register(req, res, next) {
  try {
    const result = await authService.registerUser(req.validated);
    sendSuccess(res, result, 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const result = await authService.loginUser(req.validated);
    sendSuccess(res, result, 200);
  } catch (error) {
    next(error);
  }
}

export async function me(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    sendSuccess(res, { user }, 200);
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    const result = authService.logout();
    sendSuccess(res, result, 200);
  } catch (error) {
    next(error);
  }
}
