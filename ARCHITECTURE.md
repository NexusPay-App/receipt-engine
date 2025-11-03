# Receipt Engine Architecture

## 🏗️ System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          NexusPay Receipt Engine                         │
│                   Tokenized Transaction Receipts System                  │
└─────────────────────────────────────────────────────────────────────────┘

                                    ▼

┌────────────────────┐         ┌────────────────────┐
│   Main Backend     │────────▶│  Receipt Engine    │
│  (Port 3000)       │         │   (Port 3001)      │
│                    │  HTTP   │                    │
│ • Mobile Money     │         │ • Ingestion        │
│ • Crypto Payments  │         │ • Minting          │
│ • Remittances      │         │ • Scoring          │
│ • Business Txs     │         │ • Proofs           │
└────────────────────┘         └────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
            ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
            │  PostgreSQL   │   │  Redis Queue  │   │  IPFS/Web3    │
            │   Database    │   │               │   │   Storage     │
            └───────────────┘   └───────────────┘   └───────────────┘
                    │
                    ▼
            ┌───────────────────────────────────────────────────┐
            │          Base L2 Blockchain                        │
            │                                                    │
            │  ┌──────────────────┐    ┌──────────────────┐   │
            │  │  Dynamic Receipt │    │  Smart Wallet    │   │
            │  │   NFT Contract   │◀───│    Factory       │   │
            │  │  (Soulbound)     │    │  (Thirdweb)      │   │
            │  └──────────────────┘    └──────────────────┘   │
            └───────────────────────────────────────────────────┘
```

## 🔄 Transaction Flow

### 1. Transaction Occurs

```
User performs transaction in main backend:
├── Mobile money (M-Pesa, Airtel)
├── Crypto payment (Stellar, Base)
├── Cross-chain transfer
├── Merchant payment
├── Remittance
└── Business revenue
```

### 2. Ingestion

```typescript
Main Backend → Receipt Engine /api/v1/transactions/ingest
{
  sourceSystem: "nexuspay-main",
  sourceTransactionId: "tx-12345",
  sourceUserId: "user-abc",
  amount: "100.00",
  currency: "USD",
  txType: "MOBILE_MONEY",
  timestamp: "2025-10-31T12:00:00Z"
}

↓

Transaction Ingestion Service
├── Validate transaction
├── Check for duplicates
├── Create ingestion record (status: PENDING)
└── Add to BullMQ queue
```

### 3. Processing

```
Worker picks up job from queue:

├── Update status to PROCESSING
│
├── Get or create user
│   ├── Check database for user
│   └── If new: Create smart wallet via Thirdweb
│       └── Deterministic address based on userId
│
├── Generate commitments
│   ├── Hash transaction details
│   ├── Create amount commitment (Pedersen-like)
│   └── Create timestamp commitment
│
├── Encrypt sensitive data
│   ├── Derive encryption key from master + userId
│   ├── Encrypt full transaction details (AES-256)
│   └── Store keyDerivationInfo
│
├── Upload to IPFS
│   ├── Encrypt data payload
│   ├── Upload to Web3.Storage
│   └── Get IPFS CID
│
├── Update Merkle tree
│   ├── Get user's existing receipts
│   ├── Add new receipt hash as leaf
│   ├── Rebuild Merkle tree
│   └── Calculate new root
│
├── Mint NFT (gasless via Thirdweb)
│   ├── Call DynamicReceiptNFT.mintReceipt()
│   ├── Pass: to, txHash, amountCommitment, txType, merkleRoot
│   ├── Contract emits ReceiptMinted event
│   ├── Contract emits Locked event (ERC-5192)
│   └── Return tokenId and transaction hash
│
├── Store in database
│   ├── Save receipt with on-chain reference
│   ├── Link to user
│   ├── Store commitments and Merkle proof
│   └── Update user totals
│
└── Update profile
    ├── Increment receipt count
    ├── Update level (1→5 based on count)
    ├── Recalculate credit score
    └── Update Merkle root
```

### 4. Dynamic NFT Evolution

```
NFT metadata evolves based on receipt accumulation:

Level 1 (1 receipt):
└── metadata/1/{tokenId}.json
    ├── Basic identity established
    ├── Bronze badge artwork
    └── Limited verification capabilities

Level 2 (10+ receipts):
└── metadata/2/{tokenId}.json
    ├── Emerging pattern detected
    ├── Silver badge artwork
    └── Income verification unlocked

Level 3 (50+ receipts):
└── metadata/3/{tokenId}.json
    ├── Established history
    ├── Gold badge artwork
    └── Full proof generation enabled

Level 4 (200+ receipts):
└── metadata/4/{tokenId}.json
    ├── Strong creditworthiness
    ├── Platinum badge artwork
    └── Institutional lending access

Level 5 (1000+ receipts):
└── metadata/5/{tokenId}.json
    ├── Financial champion
    ├── Diamond badge artwork
    └── Premium financial products
```

## 📊 Credit Score Calculation

### Algorithm

```typescript
Credit Score (0-850) = weighted sum of four components:

1. Income Verification (40%):
   ├── Consistency: Consecutive months with transactions
   ├── Sufficiency: Total receipt count vs. benchmarks
   ├── Growth: Upward trajectory
   └── Diversity: Variety of transaction types

2. Transaction Behavior (30%):
   ├── Volume: Total number of receipts
   ├── Partners: Unique transaction sources
   ├── Patterns: Regularity and predictability
   └── Longevity: Account age in months

3. Relationship Quality (20%):
   ├── Repeat transactions: Same sources over time
   ├── Source reliability: Payment consistency
   ├── Economic network: Connections to verified entities
   └── Trust signals: Interactions with reputable parties

4. Growth Potential (10%):
   ├── Trajectory: Recent vs. historical activity
   ├── Opportunity: Expanding transaction network
   ├── Mobility: Improving financial position
   └── Forward-looking: Predicted future performance
```

### Example Calculation

```typescript
User with 127 receipts over 8 months:

1. Income Verification:
   - 8 consecutive months: 66.7/100
   - 127 receipts: 63.5/100
   - 5 unique types: 50/100
   → Component: (66.7×0.5 + 63.5×0.3 + 50×0.2) = 62.4
   → Score: 530/850

2. Transaction Behavior:
   - Volume: 63.5/100
   - 8 months active: 33.3/100
   - Regular pattern: 75/100
   → Component: (63.5×0.4 + 33.3×0.3 + 75×0.3) = 60.4
   → Score: 513/850

3. Relationship Quality:
   - 5/8 months with repeat txs: 62.5/100
   → Score: 531/850

4. Growth Potential:
   - 20% increase in recent period: 70/100
   → Score: 595/850

Final Score:
(530×0.4) + (513×0.3) + (531×0.2) + (595×0.1) = 540

User Credit Score: 540/850 (Fair - Building History)
```

## 🔐 Privacy Architecture

### Three-Layer Privacy Model

```
Layer 1: Full Encryption (Default)
├── All data encrypted at rest
├── AES-256-GCM encryption
├── Per-user derived keys
└── IPFS storage

Layer 2: Commitments (On-Chain)
├── Transaction hash (Keccak256)
├── Amount commitment (Pedersen-like)
├── Timestamp commitment
└── Merkle root

Layer 3: Zero-Knowledge Proofs
├── Prove statements without revealing data
├── "Income > $X for Y months" → TRUE/FALSE
├── No raw data disclosed
└── Cryptographically verifiable
```

### ZK Proof Generation

```
User requests proof: "Income > $500/month for 6 months"

1. Profile Service groups receipts by month
2. ZK Prover Service builds circuit inputs:
   ├── Public inputs: threshold ($500), months (6), result
   ├── Private inputs: actual amounts, Merkle proofs
3. Generate Groth16 proof using Circom + SnarkJS
4. Store proof in database
5. Return proof + public inputs

Verifier receives:
├── Proof (pi_a, pi_b, pi_c)
├── Public signals
└── Claim result: TRUE

Verifier can check:
✓ Proof is valid (cryptographically)
✓ Claim matches public inputs
✗ Cannot see actual amounts
✗ Cannot see transaction details
```

## 🌐 API Architecture

### RESTful Endpoints

```
/api/v1/
├── transactions/
│   ├── POST /ingest          - Ingest single transaction
│   ├── POST /batch           - Batch ingest
│   └── GET  /status/:id      - Check ingestion status
│
├── receipts/
│   ├── GET  /:userId         - List user receipts
│   └── GET  /:userId/:id     - Get single receipt
│
├── profile/
│   ├── GET  /:userId         - Full profile
│   ├── GET  /:userId/score   - Credit score
│   └── GET  /:userId/level   - Level progress
│
├── proofs/
│   ├── POST /generate        - Generate ZK proof
│   ├── POST /verify          - Verify proof
│   └── GET  /:id             - Get proof details
│
├── shares/
│   ├── POST   /create        - Create shareable link
│   ├── GET    /verify/:token - Access shared data
│   ├── DELETE /:id           - Revoke share
│   ├── GET    /user/:userId  - List user shares
│   └── GET    /:id/logs      - View access logs
│
└── health                    - Health check
```

### Authentication

```
Two authentication methods:

1. API Key (Main Backend ↔ Receipt Engine):
   Headers: { 'X-API-Key': 'shared-secret' }
   
2. JWT Bearer Token (User → Receipt Engine):
   Headers: { 'Authorization': 'Bearer <token>' }
```

## 📦 Database Schema Highlights

```sql
-- Users (minimal, identity-focused)
users
├── id (UUID)
├── smartWalletAddress (Ethereum address)
├── mainBackendUserId (reference)
├── level (1-5)
├── creditScore (0-850)
├── receiptMerkleRoot
└── timestamps

-- Receipts (on-chain + off-chain reference)
receipts
├── id (UUID)
├── tokenId (NFT token ID)
├── userId → users
├── txHash, amountCommitment, timestampCommitment
├── txType, category
├── ipfsHash (encrypted data)
├── merkleProof, merkleIndex
└── timestamps

-- Profile Aggregates (for ZK proofs)
profile_aggregates
├── userId → users
├── periodType (MONTHLY, etc.)
├── periodStart, periodEnd
├── totalTransactions, totalValue
├── uniqueSources, repeatSources
├── transactionFrequency
├── consistencyScore
└── aggregateCommitment

-- Proofs (ZK proof storage)
proofs
├── id (UUID)
├── userId → users
├── proofType (THRESHOLD, PATTERN, etc.)
├── claimType, claimParameters
├── proofData (ZK proof blob)
├── publicInputs
├── claimResult (boolean)
└── verified, expiresAt

-- Shares (selective disclosure)
shares
├── id (UUID)
├── userId → users
├── shareToken (JWT)
├── scope (JSON - what's shared)
├── recipientType (LENDER, LANDLORD, etc.)
├── active, viewCount, maxViews
└── expiresAt, revokedAt
```

## 🎨 Dynamic NFT Metadata Structure

```json
{
  "name": "NexusPay Receipt #1234",
  "description": "Financial Identity Level 3 - Established History",
  "image": "ipfs://QmXxxx.../level-3.png",
  "animation_url": "ipfs://QmYyyy.../level-3.mp4",
  
  "attributes": [
    { "trait_type": "Level", "value": 3, "max_value": 5 },
    { "trait_type": "Total Receipts", "value": 127, "display_type": "number" },
    { "trait_type": "Credit Score", "value": 742, "max_value": 850 },
    { "trait_type": "Account Age", "value": "8 months" },
    { "trait_type": "Income Stability", "value": 85, "max_value": 100 },
    { "trait_type": "Transaction Partners", "value": 23 }
  ],
  
  "properties": {
    "verified": true,
    "soulbound": true,
    "last_updated": "2025-10-31T12:00:00Z",
    "merkle_root": "0xabc123...",
    "chain_id": 84532
  }
}
```

## 🔧 Technology Stack

### Backend
- **Runtime**: Node.js 18+ / TypeScript 5
- **Framework**: Express.js
- **Database**: PostgreSQL 15 + Prisma ORM
- **Queue**: BullMQ + Redis
- **Validation**: Zod

### Blockchain
- **Smart Contracts**: Solidity 0.8.20
- **Network**: Base L2 (Sepolia testnet)
- **Account Abstraction**: Thirdweb SDK
- **Standard**: ERC-721 + ERC-5192 (Soulbound)

### Storage
- **Encrypted Data**: IPFS via Web3.Storage
- **Metadata**: IPFS (evolving per level)
- **Cache**: Redis

### Cryptography
- **Commitments**: Keccak256, Pedersen-like
- **Merkle Trees**: merkletreejs
- **Encryption**: AES-256-GCM (crypto-js)
- **ZK Proofs**: Circom + SnarkJS (Groth16)
- **Hash**: Poseidon (ZK-friendly)

### Infrastructure
- **Containerization**: Docker
- **Orchestration**: Kubernetes (optional)
- **Logging**: Winston
- **Monitoring**: Prometheus + Grafana (recommended)

## 🚀 Scalability Considerations

### Horizontal Scaling
- **Stateless design**: All state in database/Redis
- **Queue-based processing**: Async job handling
- **Load balancing**: Multiple instances behind LB

### Performance Optimizations
- **Batch minting**: Group receipts for gas efficiency
- **Caching**: Redis for hot data (profiles, scores)
- **Database indexing**: On userId, tokenId, transactionDate
- **Lazy proof generation**: Only when needed

### Future Enhancements
- **Sharding**: User-based database sharding
- **Read replicas**: Separate read/write databases
- **Microservices**: Split proof generation to separate service
- **Edge caching**: CDN for metadata and dashboard

This architecture ensures scalability, privacy, and true ownership of financial identity through dynamic NFT receipts!

