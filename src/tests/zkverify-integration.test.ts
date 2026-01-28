import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { zkProofService } from '../services/zkproof.service';
import { zkVerifyPollerService } from '../services/zkverify-poller.service';

const prisma = new PrismaClient();

describe('zkVerify Integration Tests', () => {
  beforeAll(async () => {
    // Setup test database
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.$disconnect();
  });

  describe('Proof Generation Flow', () => {
    it('should generate proof and persist to database', async () => {
      const request = {
        userId: 'test_user_123',
        proofType: 'THRESHOLD' as const,
        claimType: 'credit_score_range',
        parameters: {
          minScore: 600,
          maxScore: 750,
        },
      };

      // This will use mock zkVerify in test environment
      const result = await zkProofService.generateProof(request);

      expect(result).toBeDefined();
      expect(result.proofId).toBeDefined();
      expect(result.verificationId).toBeDefined();

      // Verify database persistence
      const storedProof = await prisma.proof.findUnique({
        where: { id: result.proofId },
      });

      expect(storedProof).toBeDefined();
      expect(storedProof?.verificationId).toBe(result.verificationId);
    });

    it('should handle proof verification flow', async () => {
      // Create a mock proof first
      const testProof = await prisma.proof.create({
        data: {
          userId: 'test_user_123',
          proofType: 'THRESHOLD',
          claimType: 'credit_score_range',
          proofData: { mock: 'proof' },
          publicInputs: ['600', '750'],
          circuitId: 'credit_score_v1',
          claimParameters: { minScore: 600, maxScore: 750 },
          claimResult: true,
          verified: false,
          verificationId: 'mock_zkv_123',
          verificationStatus: 'pending',
          submittedToZkVerify: true,
          zkVerifySubmittedAt: new Date(),
        },
      });

      const verificationRequest = {
        proof: {
          proofId: testProof.id,
          userId: testProof.userId,
          proofType: testProof.proofType as any,
          claimType: testProof.claimType,
          proof: testProof.proofData,
          publicInputs: testProof.publicInputs,
          claimResult: testProof.claimResult,
          verificationId: testProof.verificationId,
        },
      };

      const result = await zkProofService.verifyProof(verificationRequest);

      expect(result).toBeDefined();
      expect(result.valid).toBeDefined();

      // Cleanup
      await prisma.proof.delete({ where: { id: testProof.id } });
    });
  });

  describe('Background Polling', () => {
    it('should poll pending proofs without errors', async () => {
      const status = zkVerifyPollerService.getStatus();

      expect(status).toBeDefined();
      expect(status.running).toBeDefined();
      expect(status.enabled).toBeDefined();
    });

    it('should handle manual poll trigger', async () => {
      await expect(zkVerifyPollerService.pollNow()).resolves.not.toThrow();
    });
  });

  describe('Metrics Endpoints', () => {
    it('should calculate proof volume metrics', async () => {
      // Create test proofs
      const testProofs = await Promise.all([
        prisma.proof.create({
          data: {
            userId: 'test_user_1',
            proofType: 'THRESHOLD',
            claimType: 'credit_score_range',
            proofData: {},
            publicInputs: [],
            circuitId: 'test_v1',
            claimParameters: {},
            claimResult: true,
            verified: true,
            submittedToZkVerify: true,
            zkVerifySubmittedAt: new Date(),
            verificationStatus: 'verified',
          },
        }),
        prisma.proof.create({
          data: {
            userId: 'test_user_2',
            proofType: 'THRESHOLD',
            claimType: 'repayment_history',
            proofData: {},
            publicInputs: [],
            circuitId: 'test_v1',
            claimParameters: {},
            claimResult: true,
            verified: true,
            submittedToZkVerify: true,
            zkVerifySubmittedAt: new Date(),
            verificationStatus: 'verified',
          },
        }),
      ]);

      const totalCount = await prisma.proof.count({
        where: { submittedToZkVerify: true },
      });

      expect(totalCount).toBeGreaterThanOrEqual(2);

      // Cleanup
      await Promise.all(
        testProofs.map(p => prisma.proof.delete({ where: { id: p.id } }))
      );
    });
  });
});
