import { PrismaClient, PeriodType } from '@prisma/client';
import { logger } from '../utils/logger';
import { UserProfile, ProfileAggregate } from '../types';
import { thirdwebService } from './thirdweb.service';

const prisma = new PrismaClient();

/**
 * Profile Aggregation & Scoring Service
 * 
 * Computes user financial profiles and credit scores based on:
 * - Income Verification (40%)
 * - Transaction Behavior (30%)
 * - Relationship Quality (20%)
 * - Growth Potential (10%)
 */
class ProfileService {
  
  /**
   * Get user's complete profile
   */
  async getUserProfile(mainBackendUserId: string): Promise<UserProfile | null> {
    const user = await prisma.user.findUnique({
      where: { mainBackendUserId },
      include: {
        receipts: {
          orderBy: { transactionDate: 'desc' },
          take: 1000,
        },
      },
    });
    
    if (!user) return null;
    
    // Calculate score components
    const components = await this.calculateScoreComponents(user.id);
    
    // Calculate overall credit score (weighted average)
    const creditScore = Math.round(
      components.incomeVerification * 0.4 +
      components.transactionBehavior * 0.3 +
      components.relationshipQuality * 0.2 +
      components.growthPotential * 0.1
    );
    
    // Determine trend
    const trend = await this.calculateTrend(user.id);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(user.totalReceipts);
    
    // Account age in days
    const accountAge = user.firstReceiptAt
      ? Math.floor(
          (Date.now() - user.firstReceiptAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;
    
    return {
      userId: user.id,
      smartWalletAddress: user.smartWalletAddress,
      did: user.did || undefined,
      
      level: user.level,
      creditScore,
      totalReceipts: user.totalReceipts,
      
      accountAge,
      firstReceiptDate: user.firstReceiptAt || undefined,
      lastReceiptDate: user.lastReceiptAt || undefined,
      
      receiptMerkleRoot: user.receiptMerkleRoot || undefined,
      profileMerkleRoot: user.profileMerkleRoot || undefined,
      
      scoreComponents: components,
      
      trend,
      confidence,
    };
  }
  
  /**
   * Calculate four score components
   */
  private async calculateScoreComponents(userId: string): Promise<{
    incomeVerification: number;
    transactionBehavior: number;
    relationshipQuality: number;
    growthPotential: number;
  }> {
    const receipts = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'asc' },
    });
    
    if (receipts.length === 0) {
      return {
        incomeVerification: 0,
        transactionBehavior: 0,
        relationshipQuality: 0,
        growthPotential: 0,
      };
    }
    
    // Component 1: Income Verification (40%)
    const incomeVerification = this.calculateIncomeVerification(receipts);
    
    // Component 2: Transaction Behavior (30%)
    const transactionBehavior = this.calculateTransactionBehavior(receipts);
    
    // Component 3: Relationship Quality (20%)
    const relationshipQuality = this.calculateRelationshipQuality(receipts);
    
    // Component 4: Growth Potential (10%)
    const growthPotential = this.calculateGrowthPotential(receipts);
    
    return {
      incomeVerification,
      transactionBehavior,
      relationshipQuality,
      growthPotential,
    };
  }
  
  /**
   * Income Verification Score (0-850)
   * Based on: consistency, sufficiency, growth, diversity
   */
  private calculateIncomeVerification(receipts: any[]): number {
    if (receipts.length === 0) return 0;
    
    // Group by month
    const monthlyGroups = this.groupByMonth(receipts);
    const monthCount = Object.keys(monthlyGroups).length;
    
    // Consistency: how many consecutive months with transactions
    const consistency = Math.min((monthCount / 12) * 100, 100);
    
    // Sufficiency: based on transaction count
    const sufficiency = Math.min((receipts.length / 100) * 100, 100);
    
    // Diversity: unique transaction types
    const uniqueTypes = new Set(receipts.map((r) => r.txType)).size;
    const diversity = (uniqueTypes / 10) * 100;
    
    // Combined score
    const score = (consistency * 0.5 + sufficiency * 0.3 + diversity * 0.2);
    
    // Scale to 0-850
    return Math.round((score / 100) * 850);
  }
  
  /**
   * Transaction Behavior Score (0-850)
   * Based on: volume, partners, patterns, longevity
   */
  private calculateTransactionBehavior(receipts: any[]): number {
    if (receipts.length === 0) return 0;
    
    // Volume score
    const volumeScore = Math.min((receipts.length / 200) * 100, 100);
    
    // Time span in months
    const firstDate = new Date(receipts[0].transactionDate);
    const lastDate = new Date(receipts[receipts.length - 1].transactionDate);
    const monthsActive = this.monthDiff(firstDate, lastDate) + 1;
    const longevityScore = Math.min((monthsActive / 24) * 100, 100);
    
    // Pattern regularity (standard deviation of gaps)
    const patternScore = this.calculatePatternRegularity(receipts);
    
    // Combined
    const score = (volumeScore * 0.4 + longevityScore * 0.3 + patternScore * 0.3);
    
    return Math.round((score / 100) * 850);
  }
  
  /**
   * Relationship Quality Score (0-850)
   * Based on: repeat transactions, source reliability
   */
  private calculateRelationshipQuality(receipts: any[]): number {
    if (receipts.length === 0) return 0;
    
    // Count repeat transaction patterns (same type, similar timing)
    const monthlyGroups = this.groupByMonth(receipts);
    
    let repeatCount = 0;
    let totalMonths = Object.keys(monthlyGroups).length;
    
    for (const month in monthlyGroups) {
      const txs = monthlyGroups[month];
      if (txs.length >= 2) repeatCount++;
    }
    
    const repeatRatio = totalMonths > 0 ? (repeatCount / totalMonths) * 100 : 0;
    
    // Reliability: consistency month over month
    const reliability = Math.min(repeatRatio, 100);
    
    return Math.round((reliability / 100) * 850);
  }
  
  /**
   * Growth Potential Score (0-850)
   * Based on: trajectory, expanding network, upward mobility
   */
  private calculateGrowthPotential(receipts: any[]): number {
    if (receipts.length < 3) return 300; // Base score for new users
    
    // Split into first half and second half
    const midPoint = Math.floor(receipts.length / 2);
    const firstHalf = receipts.slice(0, midPoint);
    const secondHalf = receipts.slice(midPoint);
    
    const firstHalfRate = firstHalf.length / this.monthSpan(firstHalf);
    const secondHalfRate = secondHalf.length / this.monthSpan(secondHalf);
    
    // Growth rate
    let growthScore = 50; // Neutral
    if (secondHalfRate > firstHalfRate * 1.2) {
      growthScore = 90; // Strong growth
    } else if (secondHalfRate > firstHalfRate) {
      growthScore = 70; // Moderate growth
    } else if (secondHalfRate < firstHalfRate * 0.8) {
      growthScore = 30; // Declining
    }
    
    // Trajectory
    const trajectory = this.calculateTrendScore(receipts);
    
    const score = (growthScore * 0.6 + trajectory * 0.4);
    
    return Math.round((score / 100) * 850);
  }
  
  /**
   * Calculate user trend (improving/stable/declining)
   */
  private async calculateTrend(userId: string): Promise<'improving' | 'stable' | 'declining'> {
    const recent = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'desc' },
      take: 30,
    });
    
    const older = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'desc' },
      skip: 30,
      take: 30,
    });
    
    if (recent.length < 10) return 'stable';
    
    const recentRate = recent.length / this.monthSpan(recent);
    const olderRate = older.length > 0 ? older.length / this.monthSpan(older) : recentRate;
    
    if (recentRate > olderRate * 1.2) return 'improving';
    if (recentRate < olderRate * 0.8) return 'declining';
    return 'stable';
  }
  
  /**
   * Calculate confidence level (based on data quantity)
   */
  private calculateConfidence(receiptCount: number): number {
    // More receipts = higher confidence
    if (receiptCount >= 200) return 95;
    if (receiptCount >= 100) return 85;
    if (receiptCount >= 50) return 75;
    if (receiptCount >= 20) return 60;
    if (receiptCount >= 10) return 45;
    return 30;
  }
  
  /**
   * Update user's credit score on-chain
   */
  async updateOnChainScore(userId: string): Promise<void> {
    const profile = await this.getUserProfile(userId);
    if (!profile) return;
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    
    // Update database
    await prisma.user.update({
      where: { id: userId },
      data: { creditScore: profile.creditScore },
    });
    
    // Update on-chain
    await thirdwebService.updateCreditScore(
      user.smartWalletAddress,
      profile.creditScore,
      profile.profileMerkleRoot || '0x0'
    );
    
    logger.info('Updated on-chain credit score', {
      userId,
      score: profile.creditScore,
    });
  }
  
  /**
   * Generate period aggregates (for ZK proofs)
   */
  async generateAggregates(userId: string, periodType: PeriodType): Promise<void> {
    const receipts = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'asc' },
    });
    
    const periods = this.groupByPeriod(receipts, periodType);
    
    for (const [periodKey, periodReceipts] of Object.entries(periods)) {
      const { start, end } = this.parsePeriodKey(periodKey, periodType);
      
      // Calculate aggregate metrics
      const totalTransactions = periodReceipts.length;
      // Note: In production, decrypt amounts or use commitments
      const totalValue = 0; // Placeholder
      const averageValue = 0;
      
      const uniqueSources = new Set(
        periodReceipts.map((r) => r.txType)
      ).size;
      
      const transactionFrequency = totalTransactions / this.daysBetween(start, end);
      
      // Upsert aggregate
      await prisma.profileAggregate.upsert({
        where: {
          userId_periodType_periodStart: {
            userId,
            periodType,
            periodStart: start,
          },
        },
        create: {
          userId,
          periodType,
          periodStart: start,
          periodEnd: end,
          totalTransactions,
          totalValue,
          averageValue,
          uniqueSources,
          repeatSources: 0,
          transactionFrequency,
          consistencyScore: 0,
        },
        update: {
          totalTransactions,
          totalValue,
          averageValue,
          uniqueSources,
          transactionFrequency,
        },
      });
    }
    
    logger.info('Generated aggregates', {
      userId,
      periodType,
      count: Object.keys(periods).length,
    });
  }
  
  // ============ Helper Methods ============
  
  private groupByMonth(receipts: any[]): Record<string, any[]> {
    return receipts.reduce((acc, receipt) => {
      const date = new Date(receipt.transactionDate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(receipt);
      return acc;
    }, {} as Record<string, any[]>);
  }
  
  private groupByPeriod(receipts: any[], periodType: PeriodType): Record<string, any[]> {
    return receipts.reduce((acc, receipt) => {
      const date = new Date(receipt.transactionDate);
      let key: string;
      
      switch (periodType) {
        case PeriodType.DAILY:
          key = date.toISOString().split('T')[0];
          break;
        case PeriodType.WEEKLY:
          const week = this.getWeekNumber(date);
          key = `${date.getFullYear()}-W${week}`;
          break;
        case PeriodType.MONTHLY:
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case PeriodType.QUARTERLY:
          const quarter = Math.floor(date.getMonth() / 3) + 1;
          key = `${date.getFullYear()}-Q${quarter}`;
          break;
        case PeriodType.YEARLY:
          key = `${date.getFullYear()}`;
          break;
        default:
          key = date.toISOString().split('T')[0];
      }
      
      if (!acc[key]) acc[key] = [];
      acc[key].push(receipt);
      return acc;
    }, {} as Record<string, any[]>);
  }
  
  private parsePeriodKey(key: string, periodType: PeriodType): { start: Date; end: Date } {
    const now = new Date();
    let start: Date;
    let end: Date;
    
    switch (periodType) {
      case PeriodType.MONTHLY:
        const [year, month] = key.split('-').map(Number);
        start = new Date(year, month - 1, 1);
        end = new Date(year, month, 0, 23, 59, 59);
        break;
      default:
        start = new Date(key);
        end = new Date(key);
    }
    
    return { start, end };
  }
  
  private monthDiff(d1: Date, d2: Date): number {
    return (
      d2.getMonth() -
      d1.getMonth() +
      12 * (d2.getFullYear() - d1.getFullYear())
    );
  }
  
  private monthSpan(receipts: any[]): number {
    if (receipts.length === 0) return 1;
    const first = new Date(receipts[0].transactionDate);
    const last = new Date(receipts[receipts.length - 1].transactionDate);
    return Math.max(this.monthDiff(first, last), 1);
  }
  
  private daysBetween(d1: Date, d2: Date): number {
    return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  }
  
  private calculatePatternRegularity(receipts: any[]): number {
    if (receipts.length < 3) return 50;
    
    const gaps: number[] = [];
    for (let i = 1; i < receipts.length; i++) {
      const gap = this.daysBetween(
        new Date(receipts[i - 1].transactionDate),
        new Date(receipts[i].transactionDate)
      );
      gaps.push(gap);
    }
    
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance =
      gaps.reduce((sum, gap) => sum + Math.pow(gap - mean, 2), 0) / gaps.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower std dev = more regular = higher score
    const regularityScore = Math.max(0, 100 - (stdDev / mean) * 100);
    
    return regularityScore;
  }
  
  private calculateTrendScore(receipts: any[]): number {
    if (receipts.length < 5) return 50;
    
    // Simple linear regression on receipt count over time
    const points = receipts.map((r, i) => ({
      x: i,
      y: 1, // Each receipt counts as 1
    }));
    
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Positive slope = upward trend
    const trendScore = Math.min(Math.max((slope + 1) * 50, 0), 100);
    
    return trendScore;
  }
  
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }
}

export const profileService = new ProfileService();

