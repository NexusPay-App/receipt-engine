import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const redis = new Redis(config.redis.url);

/**
 * Rate Limiting Middleware
 * Implements sliding window rate limiting using Redis
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const identifier = req.ip || 'unknown';
    const key = `${config.redis.prefix}ratelimit:${identifier}`;
    
    const now = Date.now();
    const windowMs = config.security.rateLimitWindowMs;
    const maxRequests = config.security.rateLimitMax;
    
    // Remove old entries outside the window
    await redis.zremrangebyscore(key, 0, now - windowMs);
    
    // Count requests in current window
    const requestCount = await redis.zcard(key);
    
    if (requestCount >= maxRequests) {
      logger.warn('Rate limit exceeded', {
        ip: identifier,
        count: requestCount,
        limit: maxRequests,
      });
      
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      });
    }
    
    // Add current request
    await redis.zadd(key, now, `${now}-${Math.random()}`);
    await redis.expire(key, Math.ceil(windowMs / 1000));
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (maxRequests - requestCount - 1).toString());
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
    
    next();
  } catch (error) {
    logger.error('Error in rate limit middleware', { error });
    // Don't block request on rate limit errors
    next();
  }
};

