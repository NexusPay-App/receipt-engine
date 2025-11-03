import { PrismaClient, TransactionType, IngestionStatus } from '@prisma/client';
import { IncomingTransaction } from '../types';
import { logger } from '../utils/logger';
import { receiptService } from './receipt.service';
import { Queue, Worker } from 'bullmq';
import { config } from '../config/env';

const prisma = new PrismaClient();

/**
 * Transaction Ingestion Service
 * 
 * Handles incoming transactions from ALL sources:
 * - Main backend (mobile money, crypto, merchant payments)
 * - Direct webhooks (M-Pesa, Stellar, etc.)
 * - Cron jobs (batch imports)
 * - Manual entries
 * 
 * Processes transactions through a queue for reliability
 */
class IngestionService {
  private ingestionQueue: Queue;
  private worker: Worker;
  
  constructor() {
    // Create BullMQ queue for async processing
    this.ingestionQueue = new Queue('transaction-ingestion', {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    
    // Worker to process ingestion jobs
    this.worker = new Worker(
      'transaction-ingestion',
      async (job) => {
        return await this.processTransaction(job.data);
      },
      {
        connection: {
          host: config.redis.host,
          port: config.redis.port,
        },
        concurrency: 10,
      }
    );
    
    this.worker.on('completed', (job) => {
      logger.info('Transaction ingestion completed', {
        jobId: job.id,
        sourceTransactionId: job.data.sourceTransactionId,
      });
    });
    
    this.worker.on('failed', (job, err) => {
      logger.error('Transaction ingestion failed', {
        jobId: job?.id,
        error: err.message,
        stack: err.stack,
      });
    });
    
    logger.info('Ingestion Service initialized');
  }
  
  /**
   * Ingest a single transaction
   * 
   * @param transaction - Incoming transaction data
   * @returns Ingestion record ID
   */
  async ingestTransaction(transaction: IncomingTransaction): Promise<string> {
    try {
      logger.info('Ingesting transaction', {
        sourceSystem: transaction.sourceSystem,
        sourceTransactionId: transaction.sourceTransactionId,
        userId: transaction.sourceUserId,
        type: transaction.txType,
      });
      
      // Validate transaction
      this.validateTransaction(transaction);
      
      // Check for duplicates
      const existing = await prisma.transactionIngestion.findUnique({
        where: {
          sourceSystem_sourceTransactionId: {
            sourceSystem: transaction.sourceSystem,
            sourceTransactionId: transaction.sourceTransactionId,
          },
        },
      });
      
      if (existing) {
        logger.warn('Duplicate transaction detected', {
          sourceTransactionId: transaction.sourceTransactionId,
          existingId: existing.id,
          status: existing.status,
        });
        
        // If failed before, retry
        if (existing.status === IngestionStatus.FAILED) {
          await this.retryIngestion(existing.id);
        }
        
        return existing.id;
      }
      
      // Create ingestion record
      const ingestion = await prisma.transactionIngestion.create({
        data: {
          sourceSystem: transaction.sourceSystem,
          sourceTransactionId: transaction.sourceTransactionId,
          sourceUserId: transaction.sourceUserId,
          status: IngestionStatus.PENDING,
          rawData: transaction as any,
          retryCount: 0,
        },
      });
      
      // Add to processing queue
      await this.ingestionQueue.add('process', {
        ingestionId: ingestion.id,
        transaction,
      });
      
      logger.info('Transaction queued for processing', {
        ingestionId: ingestion.id,
        sourceTransactionId: transaction.sourceTransactionId,
      });
      
      return ingestion.id;
    } catch (error) {
      logger.error('Error ingesting transaction', { transaction, error });
      throw error;
    }
  }
  
  /**
   * Batch ingest multiple transactions
   */
  async ingestBatch(transactions: IncomingTransaction[]): Promise<{
    success: number;
    failed: number;
    ingestionIds: string[];
  }> {
    logger.info('Batch ingesting transactions', { count: transactions.length });
    
    const results = await Promise.allSettled(
      transactions.map((tx) => this.ingestTransaction(tx))
    );
    
    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ingestionIds = results
      .filter((r) => r.status === 'fulfilled')
      .map((r: any) => r.value);
    
    logger.info('Batch ingestion completed', { success, failed });
    
    return { success, failed, ingestionIds };
  }
  
  /**
   * Process transaction and mint receipt
   * (Called by worker)
   */
  private async processTransaction(jobData: {
    ingestionId: string;
    transaction: IncomingTransaction;
  }): Promise<void> {
    const { ingestionId, transaction } = jobData;
    
    try {
      // Update status to processing
      await prisma.transactionIngestion.update({
        where: { id: ingestionId },
        data: { status: IngestionStatus.PROCESSING },
      });
      
      logger.info('Processing transaction', {
        ingestionId,
        sourceTransactionId: transaction.sourceTransactionId,
      });
      
      // Map transaction type to enum
      const txType = this.mapTransactionType(transaction);
      
      // Determine category based on metadata
      const category = this.determineCategory(transaction);
      
      // Create receipt
      const receipt = await receiptService.createReceipt({
        mainBackendUserId: transaction.sourceUserId,
        transaction: {
          id: transaction.sourceTransactionId,
          amount: transaction.amount,
          currency: transaction.currency,
          type: txType,
          category,
          sender: transaction.sender,
          receiver: transaction.receiver,
          timestamp: transaction.timestamp,
          metadata: transaction.metadata,
        },
      });
      
      // Update ingestion record
      await prisma.transactionIngestion.update({
        where: { id: ingestionId },
        data: {
          status: IngestionStatus.COMPLETED,
          processedAt: new Date(),
          receiptId: receipt.receiptId,
        },
      });
      
      logger.info('Transaction processed successfully', {
        ingestionId,
        receiptId: receipt.receiptId,
        tokenId: receipt.tokenId,
      });
    } catch (error: any) {
      logger.error('Error processing transaction', {
        ingestionId,
        error: error.message,
        stack: error.stack,
      });
      
      // Update with error
      await prisma.transactionIngestion.update({
        where: { id: ingestionId },
        data: {
          status: IngestionStatus.FAILED,
          errorMessage: error.message,
          retryCount: { increment: 1 },
        },
      });
      
      throw error;
    }
  }
  
  /**
   * Validate incoming transaction
   */
  private validateTransaction(transaction: IncomingTransaction): void {
    if (!transaction.sourceSystem) {
      throw new Error('Missing sourceSystem');
    }
    if (!transaction.sourceTransactionId) {
      throw new Error('Missing sourceTransactionId');
    }
    if (!transaction.sourceUserId) {
      throw new Error('Missing sourceUserId');
    }
    if (!transaction.amount || parseFloat(transaction.amount) <= 0) {
      throw new Error('Invalid amount');
    }
    if (!transaction.currency) {
      throw new Error('Missing currency');
    }
    if (!transaction.txType) {
      throw new Error('Missing transaction type');
    }
    if (!transaction.timestamp) {
      throw new Error('Missing timestamp');
    }
  }
  
  /**
   * Map transaction type from various sources to standard enum
   */
  private mapTransactionType(transaction: IncomingTransaction): TransactionType {
    const typeMap: Record<string, TransactionType> = {
      REMITTANCE: TransactionType.REMITTANCE,
      SALARY: TransactionType.SALARY,
      BUSINESS_REVENUE: TransactionType.BUSINESS_REVENUE,
      MERCHANT_PAYMENT: TransactionType.MERCHANT_PAYMENT,
      PEER_TO_PEER: TransactionType.PEER_TO_PEER,
      P2P: TransactionType.PEER_TO_PEER,
      DEFI_OPERATION: TransactionType.DEFI_OPERATION,
      DEFI: TransactionType.DEFI_OPERATION,
      STABLECOIN_TRANSFER: TransactionType.STABLECOIN_TRANSFER,
      STABLECOIN: TransactionType.STABLECOIN_TRANSFER,
      MOBILE_MONEY: TransactionType.MOBILE_MONEY,
      MPESA: TransactionType.MOBILE_MONEY,
      AIRTEL: TransactionType.MOBILE_MONEY,
      CROSS_CHAIN: TransactionType.CROSS_CHAIN,
      BRIDGE: TransactionType.CROSS_CHAIN,
    };
    
    const mapped = typeMap[transaction.txType.toUpperCase()];
    return mapped || TransactionType.OTHER;
  }
  
  /**
   * Determine transaction category from metadata
   */
  private determineCategory(transaction: IncomingTransaction): string {
    // Extract from metadata or infer from type
    if (transaction.category) {
      return transaction.category;
    }
    
    if (transaction.metadata?.category) {
      return transaction.metadata.category;
    }
    
    // Default categories by type
    const categoryMap: Record<string, string> = {
      [TransactionType.REMITTANCE]: 'International Transfer',
      [TransactionType.SALARY]: 'Employment Income',
      [TransactionType.BUSINESS_REVENUE]: 'Business Income',
      [TransactionType.MERCHANT_PAYMENT]: 'Merchant Payment',
      [TransactionType.PEER_TO_PEER]: 'Personal Transfer',
      [TransactionType.MOBILE_MONEY]: 'Mobile Money',
      [TransactionType.STABLECOIN_TRANSFER]: 'Stablecoin Transfer',
      [TransactionType.CROSS_CHAIN]: 'Cross-Chain Transfer',
      [TransactionType.DEFI_OPERATION]: 'DeFi Operation',
    };
    
    return categoryMap[transaction.txType] || 'Other';
  }
  
  /**
   * Retry failed ingestion
   */
  async retryIngestion(ingestionId: string): Promise<void> {
    const ingestion = await prisma.transactionIngestion.findUnique({
      where: { id: ingestionId },
    });
    
    if (!ingestion) {
      throw new Error('Ingestion not found');
    }
    
    if (ingestion.status === IngestionStatus.COMPLETED) {
      throw new Error('Ingestion already completed');
    }
    
    logger.info('Retrying ingestion', {
      ingestionId,
      retryCount: ingestion.retryCount,
    });
    
    await prisma.transactionIngestion.update({
      where: { id: ingestionId },
      data: { status: IngestionStatus.RETRY },
    });
    
    await this.ingestionQueue.add('process', {
      ingestionId,
      transaction: ingestion.rawData,
    });
  }
  
  /**
   * Get ingestion status
   */
  async getIngestionStatus(ingestionId: string) {
    return await prisma.transactionIngestion.findUnique({
      where: { id: ingestionId },
    });
  }
  
  /**
   * Get pending ingestions for user
   */
  async getUserPendingIngestions(sourceUserId: string) {
    return await prisma.transactionIngestion.findMany({
      where: {
        sourceUserId,
        status: {
          in: [IngestionStatus.PENDING, IngestionStatus.PROCESSING],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Clean up old completed ingestions
   */
  async cleanup(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await prisma.transactionIngestion.deleteMany({
      where: {
        status: IngestionStatus.COMPLETED,
        processedAt: {
          lt: cutoffDate,
        },
      },
    });
    
    logger.info('Cleaned up old ingestions', {
      count: result.count,
      daysOld,
    });
    
    return result.count;
  }
  
  /**
   * Shutdown gracefully
   */
  async shutdown() {
    logger.info('Shutting down ingestion service');
    await this.worker.close();
    await this.ingestionQueue.close();
  }
}

export const ingestionService = new IngestionService();

