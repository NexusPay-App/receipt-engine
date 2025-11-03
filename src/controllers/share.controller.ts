import { Request, Response } from 'express';
import { z } from 'zod';
import { shareService } from '../services/share.service';
import { logger } from '../utils/logger';
import { RecipientType, ProofType } from '../types';

const createShareSchema = z.object({
  userId: z.string(),
  scope: z.object({
    includeProfile: z.boolean().optional(),
    includeScore: z.boolean().optional(),
    includeScoreComponents: z.boolean().optional(),
    includeReceipts: z.boolean().optional(),
    incomeRange: z.boolean().optional(),
    exactAmounts: z.boolean().optional(),
    transactionDates: z.boolean().optional(),
    sourceDetails: z.boolean().optional(),
    fromDate: z.string().datetime().optional(),
    toDate: z.string().datetime().optional(),
    proofTypes: z.array(z.nativeEnum(ProofType)).optional(),
  }),
  recipientName: z.string().optional(),
  recipientType: z.nativeEnum(RecipientType),
  recipientDid: z.string().optional(),
  purpose: z.string().optional(),
  expiresIn: z.number(), // seconds
  maxViews: z.number().optional(),
});

/**
 * Share & Access Control Controller
 */
export class ShareController {
  
  /**
   * POST /api/v1/shares/create
   * Create a new share
   */
  async createShare(req: Request, res: Response) {
    try {
      const data = createShareSchema.parse(req.body);
      
      const share = await shareService.createShare({
        ...data,
        scope: {
          ...data.scope,
          fromDate: data.scope.fromDate ? new Date(data.scope.fromDate) : undefined,
          toDate: data.scope.toDate ? new Date(data.scope.toDate) : undefined,
        },
      });
      
      logger.info('Share created via API', {
        shareId: share.shareId,
        userId: data.userId,
      });
      
      res.status(201).json({
        success: true,
        data: share,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in createShare', { error });
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.errors,
          },
        });
      }
      
      res.status(500).json({
        success: false,
        error: {
          code: 'SHARE_CREATION_ERROR',
          message: error.message || 'Failed to create share',
        },
      });
    }
  }
  
  /**
   * GET /api/v1/shares/verify/:token
   * Access shared data using token
   */
  async verifyShare(req: Request, res: Response) {
    try {
      const { token } = req.params;
      
      const metadata = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        location: req.headers['x-forwarded-for'] as string,
      };
      
      const result = await shareService.accessShare(token, metadata);
      
      logger.info('Share accessed via API', {
        shareId: result.shareId,
      });
      
      res.json({
        success: true,
        data: result.data,
        meta: {
          shareId: result.shareId,
          accessedAt: result.accessedAt,
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in verifyShare', { error });
      
      // Differentiate error types
      if (error.message.includes('expired')) {
        return res.status(410).json({
          success: false,
          error: {
            code: 'SHARE_EXPIRED',
            message: error.message,
          },
        });
      }
      
      if (error.message.includes('revoked')) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'SHARE_REVOKED',
            message: error.message,
          },
        });
      }
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'SHARE_NOT_FOUND',
            message: error.message,
          },
        });
      }
      
      res.status(500).json({
        success: false,
        error: {
          code: 'SHARE_ACCESS_ERROR',
          message: error.message || 'Failed to access share',
        },
      });
    }
  }
  
  /**
   * DELETE /api/v1/shares/:shareId
   * Revoke a share
   */
  async revokeShare(req: Request, res: Response) {
    try {
      const { shareId } = req.params;
      
      await shareService.revokeShare(shareId);
      
      logger.info('Share revoked via API', { shareId });
      
      res.json({
        success: true,
        data: {
          shareId,
          revoked: true,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in revokeShare', { error });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'REVOCATION_ERROR',
          message: error.message,
        },
      });
    }
  }
  
  /**
   * GET /api/v1/shares/user/:userId
   * Get user's active shares
   */
  async getUserShares(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      
      const shares = await shareService.getUserShares(userId);
      
      res.json({
        success: true,
        data: {
          shares,
          count: shares.length,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getUserShares', { error });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'ERROR',
          message: error.message,
        },
      });
    }
  }
  
  /**
   * GET /api/v1/shares/:shareId/logs
   * Get share access logs
   */
  async getShareLogs(req: Request, res: Response) {
    try {
      const { shareId } = req.params;
      
      const logs = await shareService.getShareLogs(shareId);
      
      res.json({
        success: true,
        data: {
          logs,
          count: logs.length,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getShareLogs', { error });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'ERROR',
          message: error.message,
        },
      });
    }
  }
}

export const shareController = new ShareController();

