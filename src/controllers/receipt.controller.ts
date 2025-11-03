import { Request, Response } from 'express';
import { z } from 'zod';
import { receiptService } from '../services/receipt.service';
import { logger } from '../utils/logger';

/**
 * Receipt Controller
 */
export class ReceiptController {
  
  /**
   * GET /api/v1/receipts/:userId
   * Get user's receipts
   */
  async getUserReceipts(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { limit, offset, type, fromDate, toDate } = req.query;
      
      const receipts = await receiptService.getUserReceipts(userId, {
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        type: type as any,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
      });
      
      res.json({
        success: true,
        data: {
          receipts,
          count: receipts.length,
        },
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getUserReceipts', { error });
      
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
   * GET /api/v1/receipts/:userId/:receiptId
   * Get single receipt
   */
  async getReceipt(req: Request, res: Response) {
    try {
      const { receiptId } = req.params;
      
      const receipt = await receiptService.getReceiptById(receiptId);
      
      if (!receipt) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Receipt not found',
          },
        });
      }
      
      res.json({
        success: true,
        data: receipt,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getReceipt', { error });
      
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

export const receiptController = new ReceiptController();

