import { Request, Response } from 'express';
import { profileService } from '../services/profile.service';
import { logger } from '../utils/logger';

/**
 * Profile & Score Controller
 */
export class ProfileController {
  
  /**
   * GET /api/v1/profile/:userId
   * Get user profile
   */
  async getProfile(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      
      const profile = await profileService.getUserProfile(userId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User profile not found',
          },
        });
      }
      
      res.json({
        success: true,
        data: profile,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getProfile', { error });
      
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
   * GET /api/v1/profile/:userId/score
   * Get user credit score
   */
  async getScore(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      
      const profile = await profileService.getUserProfile(userId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }
      
      res.json({
        success: true,
        data: {
          creditScore: profile.creditScore,
          level: profile.level,
          components: profile.scoreComponents,
          trend: profile.trend,
          confidence: profile.confidence,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getScore', { error });
      
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
   * GET /api/v1/profile/:userId/level
   * Get user level
   */
  async getLevel(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      
      const profile = await profileService.getUserProfile(userId);
      
      if (!profile) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }
      
      // Calculate thresholds for next level
      const thresholds = [1, 10, 50, 200, 1000];
      const nextThreshold = thresholds[profile.level] || null;
      const progress = nextThreshold
        ? (profile.totalReceipts / nextThreshold) * 100
        : 100;
      
      res.json({
        success: true,
        data: {
          currentLevel: profile.level,
          totalReceipts: profile.totalReceipts,
          nextLevel: profile.level < 5 ? profile.level + 1 : null,
          receiptsToNextLevel: nextThreshold
            ? Math.max(0, nextThreshold - profile.totalReceipts)
            : 0,
          progress: Math.min(progress, 100),
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getLevel', { error });
      
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

export const profileController = new ProfileController();

