import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { zkVerifyService } from './zkverify.service';
import { config } from '../config/env';

const prisma = new PrismaClient();

/**
 * zkVerify Polling Service
 * Background job to poll pending zkVerify verifications
 * and update database with results
 */
class ZkVerifyPollerService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 60000; // 1 minute
  private readonly MAX_PENDING_AGE_MS = 3600000; // 1 hour
  private isPolling = false;

  /**
   * Start the polling service
   */
  start() {
    if (this.pollingInterval) {
      logger.warn('zkVerify poller already running');
      return;
    }

    if (!config.zkVerify.enabled) {
      logger.info('zkVerify disabled, skipping poller start');
      return;
    }

    logger.info('Starting zkVerify status poller');

    // Poll immediately, then at interval
    this.poll();
    this.pollingInterval = setInterval(() => {
      this.poll();
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling service
   */
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      logger.info('zkVerify status poller stopped');
    }
  }

  /**
   * Poll pending verifications
   */
  private async poll() {
    if (this.isPolling) {
      logger.debug('Polling already in progress, skipping');
      return;
    }

    this.isPolling = true;

    try {
      // Find proofs pending verification
      const pendingProofs = await prisma.proof.findMany({
        where: {
          submittedToZkVerify: true,
          verificationStatus: {
            in: ['pending', null],
          },
          verificationId: {
            not: null,
          },
          zkVerifySubmittedAt: {
            gte: new Date(Date.now() - this.MAX_PENDING_AGE_MS),
          },
        },
        take: 50, // Batch size
      });

      if (pendingProofs.length === 0) {
        logger.debug('No pending proofs to poll');
        return;
      }

      logger.info(`Polling ${pendingProofs.length} pending proofs`);

      // Poll each proof status
      const results = await Promise.allSettled(
        pendingProofs.map(proof => this.updateProofStatus(proof))
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      logger.info(`Polling complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (error) {
      logger.error('Error in zkVerify polling', { error });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Update status for a single proof
   */
  private async updateProofStatus(proof: any) {
    try {
      if (!proof.verificationId) {
        return;
      }

      // Fetch status from zkVerify
      const status = await zkVerifyService.getVerificationStatus(proof.verificationId);

      if (!status) {
        logger.warn(`No status for verificationId: ${proof.verificationId}`);
        return;
      }

      // Update database if status changed
      if (status.status !== proof.verificationStatus) {
        await prisma.proof.update({
          where: { id: proof.id },
          data: {
            verificationStatus: status.status,
            verified: status.status === 'verified',
            verifiedAt: status.status === 'verified' ? new Date() : undefined,
            zkVerifyTxHash: status.txHash || proof.zkVerifyTxHash,
            zkVerifyBlockNumber: status.blockNumber ? BigInt(status.blockNumber) : proof.zkVerifyBlockNumber,
            attestationProof: status.attestationProof || proof.attestationProof,
            updatedAt: new Date(),
          },
        });

        logger.info(`Updated proof ${proof.id} status: ${status.status}`);
      }
    } catch (error) {
      logger.error(`Error updating proof ${proof.id}`, { error });
      throw error;
    }
  }

  /**
   * Manual poll trigger (for testing/admin)
   */
  async pollNow() {
    logger.info('Manual poll triggered');
    await this.poll();
  }

  /**
   * Get polling status
   */
  getStatus() {
    return {
      running: this.pollingInterval !== null,
      enabled: config.zkVerify.enabled,
      pollIntervalMs: this.POLL_INTERVAL_MS,
      isCurrentlyPolling: this.isPolling,
    };
  }
}

export const zkVerifyPollerService = new ZkVerifyPollerService();
