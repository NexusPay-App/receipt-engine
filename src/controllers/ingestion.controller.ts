import { Request, Response } from 'express';
import { z } from 'zod';
import { ingestionService } from '../services/ingestion.service';
import { logger } from '../utils/logger';
import { TransactionType } from '../types';

// Validation schemas
const ingestTransactionSchema = z.object({
  sourceSystem: z.string(),
  sourceTransactionId: z.string(),
  sourceUserId: z.string(),
  amount: z.string(),
  currency: z.string(),
  txType: z.nativeEnum(TransactionType),
  category: z.string().optional(),
  sender: z.any().optional(),
  receiver: z.any().optional(),
  timestamp: z.string().datetime().or(z.date()),
  metadata: z.any().optional(),
});

const batchIngestSchema = z.object({
  transactions: z.array(ingestTransactionSchema),
});

/**
 * Transaction Ingestion Controller
 */
export class IngestionController {
  
  /**
   * POST /api/v1/transactions/ingest
   * Ingest a single transaction
   */
  async ingestTransaction(req: Request, res: Response) {
    try {
      const data = ingestTransactionSchema.parse(req.body);
      
      const ingestionId = await ingestionService.ingestTransaction({
        ...data,
        timestamp: new Date(data.timestamp),
      });
      
      logger.info('Transaction ingested via API', {
        ingestionId,
        sourceTransactionId: data.sourceTransactionId,
      });
      
      res.status(202).json({
        success: true,
        data: {
          ingestionId,
          status: 'pending',
          message: 'Transaction queued for processing',
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in ingestTransaction', { error });
      
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
          code: 'INGESTION_ERROR',
          message: error.message || 'Failed to ingest transaction',
        },
      });
    }
  }
  
  /**
   * POST /api/v1/transactions/batch
   * Batch ingest multiple transactions
   */
  async batchIngest(req: Request, res: Response) {
    try {
      const { transactions } = batchIngestSchema.parse(req.body);
      
      const result = await ingestionService.ingestBatch(
        transactions.map((tx) => ({
          ...tx,
          timestamp: new Date(tx.timestamp),
        }))
      );
      
      logger.info('Batch ingestion completed', {
        total: transactions.length,
        success: result.success,
        failed: result.failed,
      });
      
      res.status(202).json({
        success: true,
        data: {
          total: transactions.length,
          success: result.success,
          failed: result.failed,
          ingestionIds: result.ingestionIds,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in batchIngest', { error });
      
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
          code: 'BATCH_INGESTION_ERROR',
          message: error.message || 'Failed to ingest batch',
        },
      });
    }
  }
  
  /**
   * GET /api/v1/transactions/status/:ingestionId
   * Get ingestion status
   */
  async getStatus(req: Request, res: Response) {
    try {
      const { ingestionId } = req.params;
      
      const status = await ingestionService.getIngestionStatus(ingestionId);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Ingestion record not found',
          },
        });
      }
      
      res.json({
        success: true,
        data: status,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getStatus', { error });
      
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

export const ingestionController = new IngestionController();

