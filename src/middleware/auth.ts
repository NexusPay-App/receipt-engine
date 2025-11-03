import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Authentication Middleware
 * Validates API key from main backend or JWT token
 */
export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    const authHeader = req.headers['authorization'];
    
    // Check API key (for main backend integration)
    if (apiKey === config.mainBackend.apiKey) {
      return next();
    }
    
    // Check Bearer token (for user auth)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // In production, verify JWT token here
      // For now, just check if token exists
      if (token) {
        return next();
      }
    }
    
    logger.warn('Unauthorized access attempt', {
      ip: req.ip,
      path: req.path,
    });
    
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing authentication credentials',
      },
    });
  } catch (error) {
    logger.error('Error in auth middleware', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
      },
    });
  }
};

