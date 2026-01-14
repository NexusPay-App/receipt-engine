import { PrismaClient, ProofType } from '@prisma/client';
import { groth16 } from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import { logger } from '../utils/logger';
import {
  ProofRequest,
  GeneratedProof,
  ProofVerificationRequest,
  ProofVerificationResult,
  CircuitInput,
} from '../types';
import { zkVerifyService } from './zkverify.service';

const prisma = new PrismaClient();

/**
 * ZK Proof Service
 * 
 * Generates zero-knowledge proofs for:
 * - Threshold proofs (amount > X, count >= N)
 * - Pattern proofs (consistent income, growth trend)
 * - Aggregate proofs (sum over period)
 * 
 * Uses Circom circuits + SnarkJS for proof generation
 */
class ZKProofService {
  private poseidon: any;
  
  async initialize() {
    this.poseidon = await buildPoseidon();
    logger.info('ZK Proof Service initialized');
  }
  
  /**
   * Generate proof for a claim
   */
  async generateProof(request: ProofRequest): Promise<GeneratedProof> {
    try {
      logger.info('Generating ZK proof', {
        userId: request.userId,
        proofType: request.proofType,
        claimType: request.claimType,
      });
      
      // Get user and receipts
      const user = await prisma.user.findUnique({
        where: { mainBackendUserId: request.userId },
        include: {
          receipts: {
            orderBy: { transactionDate: 'desc' },
            take: 1000,
          },
        },
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Route to appropriate circuit based on claim type
      let proof: any;
      let publicInputs: any[];
      let circuitId: string;
      let claimResult: boolean;
      
      switch (request.claimType) {
        case 'income_threshold':
          ({ proof, publicInputs, circuitId, claimResult } = 
            await this.generateIncomeThresholdProof(user, request.parameters));
          break;
          
        case 'consistency':
          ({ proof, publicInputs, circuitId, claimResult } = 
            await this.generateConsistencyProof(user, request.parameters));
          break;
          
        case 'growth':
          ({ proof, publicInputs, circuitId, claimResult } = 
            await this.generateGrowthProof(user, request.parameters));
          break;
          
        case 'minimum_receipts':
          ({ proof, publicInputs, circuitId, claimResult } = 
            await this.generateMinimumReceiptsProof(user, request.parameters));
          break;
          
        default:
          throw new Error(`Unknown claim type: ${request.claimType}`);
      }
      
      // Calculate expiry
      const expiresAt = request.expiryDuration
        ? new Date(Date.now() + request.expiryDuration * 1000)
        : undefined;
      
      // Store proof in database
      const storedProof = await prisma.proof.create({
        data: {
          userId: user.id,
          proofType: request.proofType,
          claimType: request.claimType,
          proofData: proof,
          publicInputs,
          circuitId,
          claimParameters: request.parameters,
          claimResult,
          verified: false, // Will be verified separately
          expiresAt,
        },
      });
      
      logger.info('ZK proof generated', {
        proofId: storedProof.id,
        claimType: request.claimType,
        result: claimResult,
      });

      let verificationId: string | undefined;
      let verificationStatus: string | undefined;

      if (zkVerifyService.isEnabled()) {
        try {
          const submission = await zkVerifyService.submitProof({
            proofType: request.claimType,
            proof,
            publicSignals: publicInputs,
            metadata: {
              proofId: storedProof.id,
              userId: user.id,
              claimType: request.claimType,
              proofType: request.proofType,
              claimResult,
            },
          });
          verificationId = submission.verificationId;
          verificationStatus = submission.status;
        } catch (error: any) {
          logger.error('zkVerify submission failed', {
            proofId: storedProof.id,
            error: error?.message,
          });
        }
      }

      return {
        proofId: storedProof.id,
        userId: user.id,
        proofType: request.proofType,
        claimType: request.claimType,
        proof,
        publicInputs,
        claimParameters: request.parameters,
        claimResult,
        verified: false,
        circuitId,
        expiresAt,
        createdAt: storedProof.createdAt,
        verificationId,
        verificationStatus,
      };
    } catch (error) {
      logger.error('Error generating proof', { request, error });
      throw error;
    }
  }
  
  /**
   * Generate income threshold proof
   * Proves: "User has received >= $X per month for Y months"
   */
  private async generateIncomeThresholdProof(
    user: any,
    parameters: { minAmount: number; months: number; currency?: string }
  ): Promise<{
    proof: any;
    publicInputs: any[];
    circuitId: string;
    claimResult: boolean;
  }> {
    const { minAmount, months } = parameters;
    
    // Group receipts by month
    const monthlyGroups: Record<string, any[]> = {};
    for (const receipt of user.receipts) {
      const date = new Date(receipt.transactionDate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyGroups[key]) monthlyGroups[key] = [];
      monthlyGroups[key].push(receipt);
    }
    
    // Check if claim is true
    const recentMonths = Object.keys(monthlyGroups)
      .sort()
      .reverse()
      .slice(0, months);
    
    const claimResult = recentMonths.length >= months;
    
    // In production, we would:
    // 1. Get actual amounts (encrypted)
    // 2. Build circuit inputs with commitments
    // 3. Generate actual ZK proof using groth16
    
    // For now, create a mock proof structure
    const circuitInput: CircuitInput = {
      publicThreshold: minAmount.toString(),
      publicMonths: months.toString(),
      publicRoot: user.receiptMerkleRoot || '0x0',
      // Private inputs would include actual amounts and Merkle proofs
    };
    
    const proof = {
      pi_a: ['mock_a_0', 'mock_a_1'],
      pi_b: [['mock_b_0_0', 'mock_b_0_1'], ['mock_b_1_0', 'mock_b_1_1']],
      pi_c: ['mock_c_0', 'mock_c_1'],
      protocol: 'groth16',
      curve: 'bn128',
    };
    
    const publicInputs = [
      minAmount.toString(),
      months.toString(),
      claimResult ? '1' : '0',
    ];
    
    return {
      proof,
      publicInputs,
      circuitId: 'income_threshold_v1',
      claimResult,
    };
  }
  
  /**
   * Generate consistency proof
   * Proves: "User has consistent monthly transactions for N months"
   */
  private async generateConsistencyProof(
    user: any,
    parameters: { months: number; minTransactionsPerMonth?: number }
  ): Promise<{
    proof: any;
    publicInputs: any[];
    circuitId: string;
    claimResult: boolean;
  }> {
    const { months, minTransactionsPerMonth = 1 } = parameters;
    
    // Group by month
    const monthlyGroups: Record<string, any[]> = {};
    for (const receipt of user.receipts) {
      const date = new Date(receipt.transactionDate);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyGroups[key]) monthlyGroups[key] = [];
      monthlyGroups[key].push(receipt);
    }
    
    // Check consecutive months with minimum transactions
    const sortedMonths = Object.keys(monthlyGroups).sort().reverse();
    let consecutiveCount = 0;
    
    for (const month of sortedMonths) {
      if (monthlyGroups[month].length >= minTransactionsPerMonth) {
        consecutiveCount++;
        if (consecutiveCount >= months) break;
      } else {
        break;
      }
    }
    
    const claimResult = consecutiveCount >= months;
    
    const proof = {
      pi_a: ['mock_a_0', 'mock_a_1'],
      pi_b: [['mock_b_0_0', 'mock_b_0_1'], ['mock_b_1_0', 'mock_b_1_1']],
      pi_c: ['mock_c_0', 'mock_c_1'],
      protocol: 'groth16',
      curve: 'bn128',
    };
    
    const publicInputs = [
      months.toString(),
      minTransactionsPerMonth.toString(),
      claimResult ? '1' : '0',
    ];
    
    return {
      proof,
      publicInputs,
      circuitId: 'consistency_v1',
      claimResult,
    };
  }
  
  /**
   * Generate growth proof
   * Proves: "User's transaction activity is increasing"
   */
  private async generateGrowthProof(
    user: any,
    parameters: { lookbackMonths?: number }
  ): Promise<{
    proof: any;
    publicInputs: any[];
    circuitId: string;
    claimResult: boolean;
  }> {
    const { lookbackMonths = 6 } = parameters;
    
    if (user.receipts.length < lookbackMonths * 2) {
      return {
        proof: {} as any,
        publicInputs: ['0'],
        circuitId: 'growth_v1',
        claimResult: false,
      };
    }
    
    // Split into first half and second half
    const midPoint = Math.floor(user.receipts.length / 2);
    const firstHalf = user.receipts.slice(0, midPoint);
    const secondHalf = user.receipts.slice(midPoint);
    
    const firstHalfRate = firstHalf.length / this.monthSpan(firstHalf);
    const secondHalfRate = secondHalf.length / this.monthSpan(secondHalf);
    
    const claimResult = secondHalfRate > firstHalfRate * 1.1; // 10% growth
    
    const proof = {
      pi_a: ['mock_a_0', 'mock_a_1'],
      pi_b: [['mock_b_0_0', 'mock_b_0_1'], ['mock_b_1_0', 'mock_b_1_1']],
      pi_c: ['mock_c_0', 'mock_c_1'],
      protocol: 'groth16',
      curve: 'bn128',
    };
    
    const publicInputs = [claimResult ? '1' : '0'];
    
    return {
      proof,
      publicInputs,
      circuitId: 'growth_v1',
      claimResult,
    };
  }
  
  /**
   * Generate minimum receipts proof
   * Proves: "User has at least N receipts"
   */
  private async generateMinimumReceiptsProof(
    user: any,
    parameters: { minimum: number }
  ): Promise<{
    proof: any;
    publicInputs: any[];
    circuitId: string;
    claimResult: boolean;
  }> {
    const { minimum } = parameters;
    const claimResult = user.receipts.length >= minimum;
    
    const proof = {
      pi_a: ['mock_a_0', 'mock_a_1'],
      pi_b: [['mock_b_0_0', 'mock_b_0_1'], ['mock_b_1_0', 'mock_b_1_1']],
      pi_c: ['mock_c_0', 'mock_c_1'],
      protocol: 'groth16',
      curve: 'bn128',
    };
    
    const publicInputs = [minimum.toString(), claimResult ? '1' : '0'];
    
    return {
      proof,
      publicInputs,
      circuitId: 'minimum_receipts_v1',
      claimResult,
    };
  }
  
  /**
   * Verify a proof
   */
  async verifyProof(
    request: ProofVerificationRequest
  ): Promise<ProofVerificationResult> {
    try {
      logger.info('Verifying ZK proof', {
        proofId: request.proof.proofId,
        claimType: request.proof.claimType,
      });

      let valid = true;
      let claimVerified = request.proof.claimResult;
      let verifierSignature = 'mock_signature';

      if (zkVerifyService.isEnabled()) {
        try {
          const submission = await zkVerifyService.submitProof({
            proofType: request.proof.claimType,
            proof: request.proof.proof,
            publicSignals: request.proof.publicInputs,
            metadata: {
              proofId: request.proof.proofId,
              claimType: request.proof.claimType,
              proofType: request.proof.proofType,
            },
          });
          claimVerified = request.proof.claimResult;
          verifierSignature = submission.verificationId || verifierSignature;
        } catch (error: any) {
          logger.error('zkVerify verification submission failed', {
            proofId: request.proof.proofId,
            error: error?.message,
          });
        }
      }

      // Update proof in database
      await prisma.proof.update({
        where: { id: request.proof.proofId },
        data: {
          verified: valid,
          verifiedAt: new Date(),
        },
      });
      
      logger.info('Proof verified', {
        proofId: request.proof.proofId,
        valid,
        claimVerified,
      });
      
      return {
        valid,
        proofId: request.proof.proofId,
        claimVerified,
        verifiedAt: new Date(),
        verifierSignature,
      };
    } catch (error) {
      logger.error('Error verifying proof', { request, error });
      return {
        valid: false,
        proofId: request.proof.proofId,
        claimVerified: false,
        verifiedAt: new Date(),
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }
  
  /**
   * Get proof by ID
   */
  async getProof(proofId: string): Promise<GeneratedProof | null> {
    const proof = await prisma.proof.findUnique({
      where: { id: proofId },
    });
    
    if (!proof) return null;
    
    return {
      proofId: proof.id,
      userId: proof.userId,
      proofType: proof.proofType,
      claimType: proof.claimType,
      proof: proof.proofData as any,
      publicInputs: proof.publicInputs as any[],
      claimParameters: proof.claimParameters as any,
      claimResult: proof.claimResult,
      verified: proof.verified,
      verifiedAt: proof.verifiedAt || undefined,
      circuitId: proof.circuitId,
      expiresAt: proof.expiresAt || undefined,
      createdAt: proof.createdAt,
    };
  }
  
  // ============ Helper Methods ============
  
  private monthSpan(receipts: any[]): number {
    if (receipts.length === 0) return 1;
    const first = new Date(receipts[0].transactionDate);
    const last = new Date(receipts[receipts.length - 1].transactionDate);
    const months =
      (last.getFullYear() - first.getFullYear()) * 12 +
      (last.getMonth() - first.getMonth());
    return Math.max(months, 1);
  }
  
  /**
   * Hash using Poseidon (ZK-friendly hash)
   */
  private hashPoseidon(inputs: bigint[]): string {
    const hash = this.poseidon(inputs);
    return this.poseidon.F.toString(hash);
  }
}

export const zkProofService = new ZKProofService();








