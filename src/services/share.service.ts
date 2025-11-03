import { PrismaClient, RecipientType } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { config } from '../config/env';
import {
  ShareRequest,
  ShareToken,
  ShareAccessResult,
} from '../types';
import { profileService } from './profile.service';
import { receiptService } from './receipt.service';
import { zkProofService } from './zkproof.service';

const prisma = new PrismaClient();

/**
 * Share & Access Control Service
 * 
 * Manages selective disclosure of financial data:
 * - Create time-limited, scoped shares
 * - Generate shareable tokens (JWT)
 * - Control what data is revealed
 * - Track access and revoke shares
 * - Audit trail for compliance
 */
class ShareService {
  
  /**
   * Create a new share
   */
  async createShare(request: ShareRequest): Promise<ShareToken> {
    try {
      logger.info('Creating share', {
        userId: request.userId,
        recipientType: request.recipientType,
        expiresIn: request.expiresIn,
      });
      
      // Get user
      const user = await prisma.user.findUnique({
        where: { mainBackendUserId: request.userId },
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Calculate expiry
      const expiresAt = new Date(Date.now() + request.expiresIn * 1000);
      
      // Create share record
      const share = await prisma.share.create({
        data: {
          userId: user.id,
          scope: request.scope,
          purpose: request.purpose,
          recipientName: request.recipientName,
          recipientType: request.recipientType,
          recipientDid: request.recipientDid,
          active: true,
          maxViews: request.maxViews,
          expiresAt,
          shareToken: '', // Will be updated with JWT
        },
      });
      
      // Generate JWT token with share ID and scope
      const token = jwt.sign(
        {
          shareId: share.id,
          userId: user.id,
          scope: request.scope,
          recipientType: request.recipientType,
        },
        config.security.jwtSecret,
        {
          expiresIn: request.expiresIn,
          issuer: 'nexuspay-receipt-engine',
          subject: user.id,
        }
      );
      
      // Update share with token
      await prisma.share.update({
        where: { id: share.id },
        data: { shareToken: token },
      });
      
      logger.info('Share created', {
        shareId: share.id,
        userId: user.id,
        expiresAt,
      });
      
      return {
        shareId: share.id,
        token,
        userId: user.id,
        scope: request.scope,
        recipientType: request.recipientType,
        expiresAt,
        viewsRemaining: request.maxViews,
        active: true,
      };
    } catch (error) {
      logger.error('Error creating share', { request, error });
      throw error;
    }
  }
  
  /**
   * Access shared data using token
   */
  async accessShare(
    token: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      location?: string;
    }
  ): Promise<ShareAccessResult> {
    try {
      // Verify and decode token
      const decoded: any = jwt.verify(token, config.security.jwtSecret);
      
      const { shareId } = decoded;
      
      // Get share
      const share = await prisma.share.findUnique({
        where: { id: shareId },
        include: { user: true },
      });
      
      if (!share) {
        throw new Error('Share not found');
      }
      
      // Check if share is still active
      if (!share.active) {
        throw new Error('Share has been revoked');
      }
      
      // Check if expired
      if (share.expiresAt < new Date()) {
        await this.revokeShare(shareId);
        throw new Error('Share has expired');
      }
      
      // Check view limits
      if (share.maxViews && share.viewCount >= share.maxViews) {
        await this.revokeShare(shareId);
        throw new Error('Share view limit reached');
      }
      
      logger.info('Accessing share', {
        shareId,
        userId: share.userId,
        viewCount: share.viewCount + 1,
      });
      
      // Build response data based on scope
      const data: any = {};
      const scope = share.scope as any;
      
      // Profile data
      if (scope.includeProfile) {
        const profile = await profileService.getUserProfile(
          share.user.mainBackendUserId
        );
        
        // Apply selective disclosure
        data.profile = this.applyProfileDisclosure(profile, scope);
      }
      
      // Score data
      if (scope.includeScore) {
        const profile = await profileService.getUserProfile(
          share.user.mainBackendUserId
        );
        
        data.score = profile?.creditScore;
        
        if (scope.includeScoreComponents) {
          data.scoreComponents = profile?.scoreComponents;
        }
      }
      
      // Receipt data
      if (scope.includeReceipts) {
        const receipts = await receiptService.getUserReceipts(
          share.user.mainBackendUserId,
          {
            fromDate: scope.fromDate,
            toDate: scope.toDate,
          }
        );
        
        // Apply selective disclosure
        data.receipts = receipts.map((r) => this.applyReceiptDisclosure(r, scope));
      }
      
      // Proof data
      if (scope.proofTypes && scope.proofTypes.length > 0) {
        const proofs = await prisma.proof.findMany({
          where: {
            userId: share.userId,
            proofType: { in: scope.proofTypes },
            verified: true,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        
        data.proofs = proofs;
      }
      
      // Update share stats
      await prisma.share.update({
        where: { id: shareId },
        data: {
          viewCount: { increment: 1 },
          lastAccessedAt: new Date(),
        },
      });
      
      // Log access
      await prisma.accessLog.create({
        data: {
          shareId,
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
          location: metadata?.location,
          dataAccessed: scope,
          proofGenerated: !!scope.proofTypes,
        },
      });
      
      logger.info('Share accessed successfully', {
        shareId,
        dataKeys: Object.keys(data),
      });
      
      return {
        shareId,
        data,
        accessedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error accessing share', { error });
      throw error;
    }
  }
  
  /**
   * Revoke a share
   */
  async revokeShare(shareId: string): Promise<void> {
    await prisma.share.update({
      where: { id: shareId },
      data: {
        active: false,
        revokedAt: new Date(),
      },
    });
    
    logger.info('Share revoked', { shareId });
  }
  
  /**
   * Get user's active shares
   */
  async getUserShares(userId: string): Promise<any[]> {
    const user = await prisma.user.findUnique({
      where: { mainBackendUserId: userId },
    });
    
    if (!user) return [];
    
    return await prisma.share.findMany({
      where: {
        userId: user.id,
        active: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Get share access logs
   */
  async getShareLogs(shareId: string): Promise<any[]> {
    return await prisma.accessLog.findMany({
      where: { shareId },
      orderBy: { accessedAt: 'desc' },
    });
  }
  
  // ============ Selective Disclosure Helpers ============
  
  private applyProfileDisclosure(profile: any, scope: any): any {
    if (!profile) return null;
    
    const disclosed: any = {
      level: profile.level,
      accountAge: profile.accountAge,
      trend: profile.trend,
      confidence: profile.confidence,
    };
    
    if (scope.includeScore) {
      disclosed.creditScore = profile.creditScore;
    }
    
    if (scope.incomeRange) {
      // Show range instead of exact
      disclosed.incomeRange = this.getScoreRange(profile.creditScore);
    }
    
    if (scope.exactAmounts) {
      disclosed.totalReceipts = profile.totalReceipts;
    } else {
      // Show threshold instead
      disclosed.receiptThreshold = this.getReceiptThreshold(profile.totalReceipts);
    }
    
    return disclosed;
  }
  
  private applyReceiptDisclosure(receipt: any, scope: any): any {
    const disclosed: any = {
      receiptId: receipt.receiptId,
      tokenId: receipt.tokenId,
      txType: receipt.txType,
      category: receipt.category,
    };
    
    if (scope.transactionDates) {
      disclosed.transactionDate = receipt.transactionDate;
    } else {
      // Show only month/year
      const date = new Date(receipt.transactionDate);
      disclosed.transactionPeriod = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    
    if (scope.sourceDetails) {
      disclosed.verified = receipt.verified;
    }
    
    // Never include exact amounts or commitments unless explicitly requested
    if (scope.exactAmounts) {
      disclosed.commitments = receipt.commitments;
    }
    
    return disclosed;
  }
  
  private getScoreRange(score: number): string {
    if (score >= 750) return 'Excellent (750+)';
    if (score >= 700) return 'Good (700-749)';
    if (score >= 650) return 'Fair (650-699)';
    if (score >= 600) return 'Building (600-649)';
    return 'New (<600)';
  }
  
  private getReceiptThreshold(count: number): string {
    if (count >= 1000) return '1000+';
    if (count >= 500) return '500-999';
    if (count >= 200) return '200-499';
    if (count >= 100) return '100-199';
    if (count >= 50) return '50-99';
    if (count >= 20) return '20-49';
    if (count >= 10) return '10-19';
    return '<10';
  }
}

export const shareService = new ShareService();

