# Receipt Engine Integration Guide

## Overview
This guide shows how to integrate the Receipt Engine with your main NexusPay backend.

## Architecture

```
Main Backend (Port 3000)          Receipt Engine (Port 3001)
─────────────────────              ──────────────────────────
│                   │              │                        │
│  Transaction      │──────────────▶  Ingestion Queue      │
│  Completion       │   Webhook    │                        │
│                   │              │  ↓                     │
│                   │              │  Receipt Minting       │
│                   │              │                        │
│  User Queries     │◀─────────────│  Profile & Score      │
│                   │   REST API   │                        │
│                   │              │  ZK Proofs             │
└───────────────────┘              └────────────────────────┘
```

## Step 1: Install Bridge Module in Main Backend

Add to your main backend:

```bash
cd /path/to/backendMirror
npm install axios jsonwebtoken
```

Create `src/services/receiptEngine.ts`:

```typescript
import axios from 'axios';

const RECEIPT_ENGINE_URL = process.env.RECEIPT_ENGINE_URL || 'http://localhost:3001';
const API_KEY = process.env.RECEIPT_ENGINE_API_KEY || 'your-shared-secret';

export class ReceiptEngineBridge {
  
  /**
   * Notify receipt engine of completed transaction
   */
  async notifyTransaction(data: {
    userId: string;
    transactionId: string;
    amount: string;
    currency: string;
    type: 'REMITTANCE' | 'SALARY' | 'BUSINESS_REVENUE' | 'MERCHANT_PAYMENT' | 'PEER_TO_PEER' | 'MOBILE_MONEY' | 'STABLECOIN_TRANSFER' | 'CROSS_CHAIN' | 'DEFI_OPERATION' | 'OTHER';
    sender?: any;
    receiver?: any;
    metadata?: any;
  }): Promise<{ ingestionId: string }> {
    try {
      const response = await axios.post(
        `${RECEIPT_ENGINE_URL}/api/v1/transactions/ingest`,
        {
          sourceSystem: 'nexuspay-main',
          sourceTransactionId: data.transactionId,
          sourceUserId: data.userId,
          amount: data.amount,
          currency: data.currency,
          txType: data.type,
          sender: data.sender,
          receiver: data.receiver,
          timestamp: new Date().toISOString(),
          metadata: data.metadata,
        },
        {
          headers: {
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );
      
      return response.data.data;
    } catch (error) {
      console.error('Failed to notify receipt engine:', error);
      // Don't fail main transaction if receipt engine is down
      return { ingestionId: 'failed' };
    }
  }
  
  /**
   * Get user's financial profile
   */
  async getUserProfile(userId: string) {
    const response = await axios.get(
      `${RECEIPT_ENGINE_URL}/api/v1/profile/${userId}`,
      {
        headers: { 'X-API-Key': API_KEY },
      }
    );
    
    return response.data.data;
  }
  
  /**
   * Get user's credit score
   */
  async getCreditScore(userId: string) {
    const response = await axios.get(
      `${RECEIPT_ENGINE_URL}/api/v1/profile/${userId}/score`,
      {
        headers: { 'X-API-Key': API_KEY },
      }
    );
    
    return response.data.data;
  }
  
  /**
   * Get user's receipts
   */
  async getUserReceipts(userId: string, options?: {
    limit?: number;
    offset?: number;
    type?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    if (options?.type) params.append('type', options.type);
    if (options?.fromDate) params.append('fromDate', options.fromDate.toISOString());
    if (options?.toDate) params.append('toDate', options.toDate.toISOString());
    
    const response = await axios.get(
      `${RECEIPT_ENGINE_URL}/api/v1/receipts/${userId}?${params.toString()}`,
      {
        headers: { 'X-API-Key': API_KEY },
      }
    );
    
    return response.data.data;
  }
}

export const receiptEngine = new ReceiptEngineBridge();
```

## Step 2: Integrate Into Transaction Handlers

### Mobile Money Transactions (M-Pesa)

In `src/controllers/mpesaController.ts`:

```typescript
import { receiptEngine } from '../services/receiptEngine';

// After successful transaction
async callback(req: Request, res: Response) {
  // ... existing M-Pesa callback logic ...
  
  // Notify receipt engine
  await receiptEngine.notifyTransaction({
    userId: user.id,
    transactionId: transaction.id,
    amount: transaction.amount.toString(),
    currency: 'KES',
    type: 'MOBILE_MONEY',
    sender: { phoneNumber: transaction.senderPhone },
    receiver: { phoneNumber: transaction.receiverPhone },
    metadata: {
      provider: 'mpesa',
      transactionCode: mpesaResponse.TransactionID,
    },
  });
  
  // ... rest of callback logic ...
}
```

### Stellar/Crypto Transactions

In `src/controllers/stellarController.ts`:

```typescript
import { receiptEngine } from '../services/receiptEngine';

async sendPayment(req: Request, res: Response) {
  // ... existing Stellar payment logic ...
  
  // After successful payment
  await receiptEngine.notifyTransaction({
    userId: user.id,
    transactionId: transaction.hash,
    amount: amount.toString(),
    currency: asset.code,
    type: 'STABLECOIN_TRANSFER',
    sender: { stellarAddress: sourceAccount },
    receiver: { stellarAddress: destinationAccount },
    metadata: {
      network: 'stellar',
      assetIssuer: asset.issuer,
    },
  });
  
  // ... rest of logic ...
}
```

### Remittance Transactions

```typescript
async processRemittance(req: Request, res: Response) {
  // ... existing remittance logic ...
  
  await receiptEngine.notifyTransaction({
    userId: user.id,
    transactionId: remittance.id,
    amount: remittance.amount.toString(),
    currency: remittance.currency,
    type: 'REMITTANCE',
    sender: { country: remittance.senderCountry },
    receiver: { country: remittance.receiverCountry },
    metadata: {
      corridor: `${remittance.senderCountry}-${remittance.receiverCountry}`,
      provider: remittance.provider,
    },
  });
}
```

## Step 3: Expose Receipt Data to Frontend

Add new endpoints to your main backend:

```typescript
// src/routes/receipts.ts
import { Router } from 'express';
import { receiptEngine } from '../services/receiptEngine';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Get user's financial profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const profile = await receiptEngine.getUserProfile(req.user.id);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get user's credit score
router.get('/score', authMiddleware, async (req, res) => {
  try {
    const score = await receiptEngine.getCreditScore(req.user.id);
    res.json(score);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch score' });
  }
});

// Get user's receipts
router.get('/receipts', authMiddleware, async (req, res) => {
  try {
    const receipts = await receiptEngine.getUserReceipts(req.user.id, {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    });
    res.json(receipts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

export default router;
```

Register in `src/app.ts`:

```typescript
import receiptRoutes from './routes/receipts';

app.use('/api/receipts', receiptRoutes);
```

## Step 4: Environment Configuration

### Main Backend `.env`

Add:

```bash
RECEIPT_ENGINE_URL=http://localhost:3001
RECEIPT_ENGINE_API_KEY=your-shared-secret-key-here
```

### Receipt Engine `.env`

Configure:

```bash
PORT=3001
NODE_ENV=production

# Thirdweb (get from https://thirdweb.com/dashboard)
THIRDWEB_SECRET_KEY=your_secret_key
THIRDWEB_CLIENT_ID=your_client_id
THIRDWEB_NETWORK=base-sepolia
THIRDWEB_CHAIN_ID=84532
THIRDWEB_SMART_WALLET_FACTORY=0x... # Deploy smart wallet factory

# Main Backend Integration
MAIN_BACKEND_URL=http://localhost:3000
MAIN_BACKEND_API_KEY=your-shared-secret-key-here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/receipt_engine

# Redis
REDIS_URL=redis://localhost:6379

# IPFS
WEB3_STORAGE_API_KEY=your_web3_storage_key

# Encryption
MASTER_ENCRYPTION_KEY=$(openssl rand -hex 64)

# Smart Contracts (deploy DynamicReceiptNFT.sol first)
RECEIPT_NFT_CONTRACT=0x...

# Security
JWT_SECRET=$(openssl rand -hex 32)
```

## Step 5: Deploy Smart Contracts

### Deploy Receipt NFT Contract

```bash
cd receipt-engine
npx thirdweb deploy contracts/DynamicReceiptNFT.sol --network base-sepolia
```

Follow the Thirdweb dashboard to complete deployment.

Copy contract address to `.env` as `RECEIPT_NFT_CONTRACT`.

## Step 6: Initialize Database

```bash
cd receipt-engine
npx prisma generate
npx prisma migrate deploy
```

## Step 7: Start Services

### Start Receipt Engine

```bash
cd receipt-engine
npm install
npm run build
npm start
```

### Verify It's Running

```bash
curl http://localhost:3001/api/v1/health
```

Should return:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-31T...",
    "version": "v1"
  }
}
```

## Step 8: Test Integration

### Test Transaction Ingestion

From your main backend, trigger a test transaction:

```bash
curl -X POST http://localhost:3001/api/v1/transactions/ingest \
  -H "X-API-Key: your-shared-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceSystem": "nexuspay-main",
    "sourceTransactionId": "test-tx-001",
    "sourceUserId": "user-123",
    "amount": "100.00",
    "currency": "USD",
    "txType": "PEER_TO_PEER",
    "timestamp": "2025-10-31T12:00:00Z"
  }'
```

### Check Receipt Status

```bash
curl http://localhost:3001/api/v1/profile/user-123 \
  -H "X-API-Key: your-shared-secret-key-here"
```

## Frontend Integration Example

Create a Receipt Dashboard component:

```typescript
// components/ReceiptDashboard.tsx
import { useEffect, useState } from 'react';
import axios from 'axios';

export function ReceiptDashboard() {
  const [profile, setProfile] = useState(null);
  const [receipts, setReceipts] = useState([]);
  
  useEffect(() => {
    async function fetchData() {
      // Via your main backend proxy
      const profileRes = await axios.get('/api/receipts/profile');
      setProfile(profileRes.data);
      
      const receiptsRes = await axios.get('/api/receipts/receipts');
      setReceipts(receiptsRes.data.receipts);
    }
    
    fetchData();
  }, []);
  
  if (!profile) return <div>Loading...</div>;
  
  return (
    <div className="receipt-dashboard">
      <div className="score-card">
        <h2>Your Credit Score</h2>
        <div className="score">{profile.creditScore}</div>
        <div className="level">Level {profile.level}</div>
        <div className="trend">{profile.trend}</div>
      </div>
      
      <div className="receipts-list">
        <h3>Transaction History</h3>
        {receipts.map((receipt) => (
          <div key={receipt.receiptId} className="receipt-item">
            <div>Type: {receipt.txType}</div>
            <div>Date: {new Date(receipt.transactionDate).toLocaleDateString()}</div>
            <div>NFT Token: #{receipt.tokenId}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Production Deployment

### Docker Deployment

Create `receipt-engine/Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t nexuspay-receipt-engine .
docker run -p 3001:3001 --env-file .env nexuspay-receipt-engine
```

### Docker Compose (with main backend)

```yaml
version: '3.8'

services:
  main-backend:
    build: ./backendMirror
    ports:
      - "3000:3000"
    environment:
      RECEIPT_ENGINE_URL: http://receipt-engine:3001
    depends_on:
      - receipt-engine
      - postgres
      - redis
  
  receipt-engine:
    build: ./receipt-engine
    ports:
      - "3001:3001"
    environment:
      MAIN_BACKEND_URL: http://main-backend:3000
      DATABASE_URL: postgresql://postgres:password@postgres:5432/receipt_engine
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
  
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: receipt_engine
      POSTGRES_PASSWORD: password
    volumes:
      - postgres-data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
```

Run:

```bash
docker-compose up -d
```

## Monitoring

Check logs:

```bash
# Receipt engine logs
tail -f receipt-engine/logs/combined.log

# Check queue status
redis-cli
> KEYS receipt-engine:*
```

## Troubleshooting

### Receipt Engine Not Connecting

1. Check API key matches in both `.env` files
2. Verify network connectivity: `curl http://localhost:3001/api/v1/health`
3. Check logs for errors

### Receipts Not Minting

1. Verify Thirdweb credentials are correct
2. Check smart contract address is deployed
3. Ensure wallet has gas (if not using gasless)
4. Check queue: `redis-cli LLEN receipt-engine:transaction-ingestion`

### Profile Not Updating

1. Check ingestion status endpoint
2. Verify database migrations ran
3. Check for errors in logs

## Support

For issues, check:
- Receipt Engine logs: `receipt-engine/logs/`
- Main Backend integration logs
- Thirdweb dashboard for on-chain activity

