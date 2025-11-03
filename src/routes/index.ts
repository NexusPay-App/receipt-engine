import { Router } from 'express';
import { ingestionController } from '../controllers/ingestion.controller';
import { receiptController } from '../controllers/receipt.controller';
import { profileController } from '../controllers/profile.controller';
import { proofController } from '../controllers/proof.controller';
import { shareController } from '../controllers/share.controller';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';

const router = Router();

// ============ Transaction Ingestion Routes ============
router.post(
  '/transactions/ingest',
  authMiddleware,
  rateLimitMiddleware,
  ingestionController.ingestTransaction.bind(ingestionController)
);

router.post(
  '/transactions/batch',
  authMiddleware,
  rateLimitMiddleware,
  ingestionController.batchIngest.bind(ingestionController)
);

router.get(
  '/transactions/status/:ingestionId',
  authMiddleware,
  ingestionController.getStatus.bind(ingestionController)
);

// ============ Receipt Routes ============
router.get(
  '/receipts/:userId',
  authMiddleware,
  receiptController.getUserReceipts.bind(receiptController)
);

router.get(
  '/receipts/:userId/:receiptId',
  authMiddleware,
  receiptController.getReceipt.bind(receiptController)
);

// ============ Profile & Score Routes ============
router.get(
  '/profile/:userId',
  authMiddleware,
  profileController.getProfile.bind(profileController)
);

router.get(
  '/profile/:userId/score',
  authMiddleware,
  profileController.getScore.bind(profileController)
);

router.get(
  '/profile/:userId/level',
  authMiddleware,
  profileController.getLevel.bind(profileController)
);

// ============ Proof Routes ============
router.post(
  '/proofs/generate',
  authMiddleware,
  rateLimitMiddleware,
  proofController.generateProof.bind(proofController)
);

router.post(
  '/proofs/verify',
  rateLimitMiddleware,
  proofController.verifyProof.bind(proofController)
);

router.get(
  '/proofs/:proofId',
  authMiddleware,
  proofController.getProof.bind(proofController)
);

// ============ Share Routes ============
router.post(
  '/shares/create',
  authMiddleware,
  rateLimitMiddleware,
  shareController.createShare.bind(shareController)
);

router.get(
  '/shares/verify/:token',
  rateLimitMiddleware,
  shareController.verifyShare.bind(shareController)
);

router.delete(
  '/shares/:shareId',
  authMiddleware,
  shareController.revokeShare.bind(shareController)
);

router.get(
  '/shares/user/:userId',
  authMiddleware,
  shareController.getUserShares.bind(shareController)
);

router.get(
  '/shares/:shareId/logs',
  authMiddleware,
  shareController.getShareLogs.bind(shareController)
);

// ============ Health Check ============
router.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date(),
      version: 'v1',
    },
  });
});

export default router;

