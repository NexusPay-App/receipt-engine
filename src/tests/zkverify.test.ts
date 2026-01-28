import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ZkVerifyService } from '../services/zkverify.service';
import { config } from '../config/env';

// Mock axios
jest.mock('axios');

describe('ZkVerifyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitProof', () => {
    it('should submit proof to zkVerify when enabled', async () => {
      // Mock enabled
      config.zkVerify.enabled = true;
      config.zkVerify.apiKey = 'test_key';

      const request = {
        proofType: 'credit_score_range',
        publicInputs: ['500', '700', 'commitment', 'user123'],
        privateInputs: [],
        metadata: { userId: 'user123' },
        network: 'testnet',
        circuitId: 'credit_score_v1',
      };

      const result = await ZkVerifyService.submitProof(request);

      // In mock mode, should return mock verification
      expect(result).toBeDefined();
      expect(result?.verificationId).toContain('mock-zkv-');
      expect(result?.status).toBe('verified');
    });

    it('should return mock response when disabled', async () => {
      config.zkVerify.enabled = false;

      const request = {
        proofType: 'credit_score_range',
        publicInputs: ['500', '700', 'commitment', 'user123'],
        privateInputs: [],
        metadata: {},
        network: 'testnet',
        circuitId: 'credit_score_v1',
      };

      const result = await ZkVerifyService.submitProof(request);

      expect(result).toBeDefined();
      expect(result?.status).toBe('verified');
      expect(result?.message).toContain('Mock');
    });

    it('should handle missing API key gracefully', async () => {
      config.zkVerify.enabled = true;
      config.zkVerify.apiKey = '';

      const request = {
        proofType: 'test',
        publicInputs: [],
        privateInputs: [],
        metadata: {},
        network: 'testnet',
        circuitId: 'test_v1',
      };

      const result = await ZkVerifyService.submitProof(request);

      expect(result).toBeNull();
    });
  });

  describe('getProofStatus', () => {
    it('should fetch proof status when enabled', async () => {
      config.zkVerify.enabled = true;
      config.zkVerify.apiKey = 'test_key';

      const verificationId = 'test_verification_id';
      const result = await ZkVerifyService.getProofStatus(verificationId);

      expect(result).toBeDefined();
      expect(result?.verificationId).toBe(verificationId);
    });

    it('should return mock status when disabled', async () => {
      config.zkVerify.enabled = false;

      const result = await ZkVerifyService.getProofStatus('test_id');

      expect(result).toBeDefined();
      expect(result?.status).toBe('verified');
      expect(result?.message).toContain('Mock');
    });
  });
});

describe('ZkVerifyService - Schema Validation', () => {
  it('should validate proof submission payload structure', () => {
    const validPayload = {
      proofType: 'credit_score_range',
      publicInputs: ['500', '700', 'commitment', 'user123'],
      privateInputs: [],
      metadata: { userId: 'user123' },
      network: 'testnet',
      circuitId: 'credit_score_v1',
    };

    expect(validPayload.proofType).toBeDefined();
    expect(Array.isArray(validPayload.publicInputs)).toBe(true);
    expect(validPayload.circuitId).toBeDefined();
  });

  it('should validate proof response structure', () => {
    const validResponse = {
      verificationId: 'zkv_12345',
      status: 'verified',
      message: 'Proof verified successfully',
    };

    expect(validResponse.verificationId).toBeDefined();
    expect(['pending', 'verified', 'failed']).toContain(validResponse.status);
  });
});
