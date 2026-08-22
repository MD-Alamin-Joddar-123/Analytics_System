import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

let connectionPromise = null;

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(env.mongodbUri)
    .then((instance) => {
      logger.info('MongoDB connected', { host: instance.connection.host });
      return instance.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      logger.error('MongoDB connection failed', { message: error.message });
      throw error;
    });

  return connectionPromise;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.disconnect();
  connectionPromise = null;
  logger.info('MongoDB disconnected');
}

export function getDatabaseState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

mongoose.connection.on('error', (error) => {
  logger.error('MongoDB connection error', { message: error.message });
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection lost');
});
