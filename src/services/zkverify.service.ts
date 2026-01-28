import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

type ProofPayload = {
  proofType: string;
  proof?: any;
  publicSignals?: string[];
  verificationKey?: any;
  metadata?: Record<string, any>;
};

class ZkVerifyService {
  private client: AxiosInstance;
  private enabled: boolean;

  constructor() {
    this.enabled = config.zkVerify.enabled;

    this.client = axios.create({
      baseURL: config.zkVerify.nodeUrl,
      timeout: config.zkVerify.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(config.zkVerify.apiKey ? { Authorization: `Bearer ${config.zkVerify.apiKey}` } : {}),
        'X-Network': config.zkVerify.network,
      },
    });
  }

  isEnabled() {
    return this.enabled;
  }

  async submitProof(payload: ProofPayload) {
    // NO MOCK MODE - Testnet only
    if (!this.enabled) {
      throw new Error('zkVerify is disabled. Set ZKVERIFY_ENABLED=true in .env for testnet integration');
    }

    if (!config.zkVerify.nodeUrl || !config.zkVerify.apiKey) {
      throw new Error('zkVerify credentials missing. Please set ZKVERIFY_NODE_URL and ZKVERIFY_API_KEY in .env');
    }

    try {
      const response = await this.client.post('/v1/proofs/submit', payload);
      return {
        success: true,
        verificationId: response.data?.verificationId,
        txHash: response.data?.txHash,
        status: response.data?.status || 'submitted',
      };
    } catch (error: any) {
      logger.error('zkVerify submitProof failed', {
        error: error?.message,
        proofType: payload.proofType,
      });
      throw new Error(`zkVerify submission failed: ${error?.message || 'unknown error'}`);
    }
  }

  async getStatus(verificationId: string) {
    // NO MOCK MODE - Testnet only
    if (!this.enabled) {
      throw new Error('zkVerify is disabled. Set ZKVERIFY_ENABLED=true in .env for testnet integration');
    }

    try {
      const response = await this.client.get(`/v1/proofs/status/${verificationId}`);
      return {
        success: true,
        status: response.data?.status,
        verificationId,
      };
    } catch (error: any) {
      logger.error('zkVerify getStatus failed', {
        error: error?.message,
        verificationId,
      });
      throw new Error(`zkVerify status failed: ${error?.message || 'unknown error'}`);
    }
  }

  /**
   * Alias for getStatus (used by poller service)
   */
  async getVerificationStatus(verificationId: string) {
    return this.getStatus(verificationId);
  }
}

export const zkVerifyService = new ZkVerifyService();

