import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Metrics Controller for zkVerify Grant Reporting
 * Tracks proof volume, users, and verification status
 */
export class MetricsController {
  
  /**
   * GET /api/v1/metrics/proof-volume
   * Get proof submission volume for milestone reporting
   */
  async getProofVolume(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();
      
      // Total proofs submitted to zkVerify
      const totalProofs = await prisma.proof.count({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
      });
      
      // Proofs by type
      const proofsByType = await prisma.proof.groupBy({
        by: ['claimType'],
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
        _count: true,
      });
      
      // Proofs by status
      const proofsByStatus = await prisma.proof.groupBy({
        by: ['verificationStatus'],
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
        _count: true,
      });
      
      // Unique users
      const uniqueUsers = await prisma.proof.findMany({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      });
      
      // Success rate
      const verifiedCount = await prisma.proof.count({
        where: {
          submittedToZkVerify: true,
          verificationStatus: 'verified',
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
      });
      
      const successRate = totalProofs > 0 ? (verifiedCount / totalProofs) * 100 : 0;
      
      res.json({
        success: true,
        data: {
          period: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          totalProofs,
          uniqueUsers: uniqueUsers.length,
          successRate: successRate.toFixed(2) + '%',
          proofsByType: proofsByType.map(p => ({
            type: p.claimType,
            count: p._count,
          })),
          proofsByStatus: proofsByStatus.map(p => ({
            status: p.verificationStatus || 'unknown',
            count: p._count,
          })),
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getProofVolume', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error.message || 'Failed to fetch proof volume',
        },
      });
    }
  }
  
  /**
   * GET /api/v1/metrics/user-engagement
   * Get user engagement metrics
   */
  async getUserEngagement(req: Request, res: Response) {
    try {
      const { startDate, endDate } = req.query;
      
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();
      
      // Users who generated proofs
      const activeUsers = await prisma.proof.findMany({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
        distinct: ['userId'],
        select: {
          userId: true,
          user: {
            select: {
              smartWalletAddress: true,
              createdAt: true,
            },
          },
        },
      });
      
      // Average proofs per user
      const totalProofs = await prisma.proof.count({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
      });
      
      const avgProofsPerUser = activeUsers.length > 0 ? (totalProofs / activeUsers.length).toFixed(2) : 0;
      
      // Power users (top 10%)
      const proofsPerUser = await prisma.proof.groupBy({
        by: ['userId'],
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: start,
            lte: end,
          },
        },
        _count: true,
        orderBy: {
          _count: {
            userId: 'desc',
          },
        },
        take: Math.ceil(activeUsers.length * 0.1) || 1,
      });
      
      res.json({
        success: true,
        data: {
          period: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          totalActiveUsers: activeUsers.length,
          avgProofsPerUser,
          powerUsers: proofsPerUser.length,
          powerUserProofs: proofsPerUser.reduce((sum, u) => sum + u._count, 0),
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getUserEngagement', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error.message || 'Failed to fetch user engagement',
        },
      });
    }
  }
  
  /**
   * GET /api/v1/metrics/milestone-report
   * Generate milestone report for Thrive Protocol
   */
  async getMilestoneReport(req: Request, res: Response) {
    try {
      const { milestone } = req.query; // 1, 2, or 3
      
      let startDate: Date;
      const endDate = new Date();
      
      // Calculate period based on milestone
      switch (milestone) {
        case '1':
          startDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
          break;
        case '2':
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '3':
          startDate = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      }
      
      const totalProofs = await prisma.proof.count({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
      
      const uniqueUsers = await prisma.proof.findMany({
        where: {
          submittedToZkVerify: true,
          zkVerifySubmittedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      });
      
      // Milestone thresholds
      const milestoneThresholds = {
        '1': { proofs: 1000, users: 50 },
        '2': { proofs: 25000, users: 250 },
        '3': { proofs: 250000, users: 2500 },
      };
      
      const threshold = milestoneThresholds[milestone as keyof typeof milestoneThresholds] || milestoneThresholds['2'];
      
      res.json({
        success: true,
        data: {
          milestone: milestone || '2',
          period: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            days: Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
          },
          achievements: {
            totalProofs,
            uniqueUsers: uniqueUsers.length,
            proofTarget: threshold.proofs,
            userTarget: threshold.users,
            proofProgress: ((totalProofs / threshold.proofs) * 100).toFixed(2) + '%',
            userProgress: ((uniqueUsers.length / threshold.users) * 100).toFixed(2) + '%',
          },
          milestoneCompleted: totalProofs >= threshold.proofs || uniqueUsers.length >= threshold.users,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
          reportGenerated: endDate.toISOString(),
        },
      });
    } catch (error: any) {
      logger.error('Error in getMilestoneReport', { error });
      res.status(500).json({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error.message || 'Failed to generate milestone report',
        },
      });
    }
  }
}

export const metricsController = new MetricsController();
