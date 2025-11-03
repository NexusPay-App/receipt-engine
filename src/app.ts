import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import { logger } from './utils/logger';
import routes from './routes';

/**
 * Initialize Express Application
 */
export function createApp(): Application {
  const app = express();
  
  // Security middleware
  app.use(helmet());
  
  // CORS - only allow main backend
  app.use(cors({
    origin: [
      config.mainBackend.url,
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    credentials: true,
  }));
  
  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    });
    
    next();
  });
  
  // API Routes
  app.use('/api/v1', routes);
  
  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'NexusPay Receipt Engine',
      version: '1.0.0',
      status: 'running',
      documentation: '/api/v1/health',
    });
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
        path: req.path,
      },
    });
  });
  
  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: config.nodeEnv === 'production'
          ? 'An internal error occurred'
          : err.message,
      },
    });
  });
  
  return app;
}

