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
    if (!this.enabled) {
      return {
        success: true,
        verificationId: `mock-${Date.now()}`,
        status: 'mock',
      };
    }

    if (!config.zkVerify.nodeUrl || !config.zkVerify.apiKey) {
      throw new Error('zkVerify is enabled but node URL or API key is missing');
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
    if (!this.enabled) {
      return { success: true, status: 'mock', verificationId };
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
}

export const zkVerifyService = new ZkVerifyService();

