import { Request, Response } from 'express';
import { z } from 'zod';
import { zkProofService } from '../services/zkproof.service';
import { logger } from '../utils/logger';
import { ProofType } from '../types';

const generateProofSchema = z.object({
  userId: z.string(),
  proofType: z.nativeEnum(ProofType),
  claimType: z.string(),
  parameters: z.record(z.any()),
  expiryDuration: z.number().optional(),
});

const verifyProofSchema = z.object({
  proofId: z.string(),
});

/**
 * Proof Generation & Verification Controller
 */
export class ProofController {
  
  /**
   * POST /api/v1/proofs/generate
   * Generate a ZK proof
   */
  async generateProof(req: Request, res: Response) {
    try {
      const data = generateProofSchema.parse(req.body);
      
      const proof = await zkProofService.generateProof(data);
      
      logger.info('Proof generated via API', {
        proofId: proof.proofId,
        claimType: proof.claimType,
      });
      
      res.status(201).json({
        success: true,
        data: proof,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in generateProof', { error });
      
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
          code: 'PROOF_GENERATION_ERROR',
          message: error.message || 'Failed to generate proof',
        },
      });
    }
  }
  
  /**
   * POST /api/v1/proofs/verify
   * Verify a ZK proof
   */
  async verifyProof(req: Request, res: Response) {
    try {
      const { proofId } = verifyProofSchema.parse(req.body);
      
      const proof = await zkProofService.getProof(proofId);
      
      if (!proof) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Proof not found',
          },
        });
      }
      
      const result = await zkProofService.verifyProof({ proof });
      
      logger.info('Proof verified via API', {
        proofId,
        valid: result.valid,
      });
      
      res.json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in verifyProof', { error });
      
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
          code: 'VERIFICATION_ERROR',
          message: error.message || 'Failed to verify proof',
        },
      });
    }
  }
  
  /**
   * GET /api/v1/proofs/:proofId
   * Get proof by ID
   */
  async getProof(req: Request, res: Response) {
    try {
      const { proofId } = req.params;
      
      const proof = await zkProofService.getProof(proofId);
      
      if (!proof) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Proof not found',
          },
        });
      }
      
      res.json({
        success: true,
        data: proof,
        meta: {
          timestamp: new Date(),
          version: 'v1',
        },
      });
    } catch (error: any) {
      logger.error('Error in getProof', { error });
      
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

export const proofController = new ProofController();

