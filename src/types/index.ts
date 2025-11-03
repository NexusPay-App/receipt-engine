// Type definitions for Receipt Engine

export enum TransactionType {
  REMITTANCE = 'REMITTANCE',
  SALARY = 'SALARY',
  BUSINESS_REVENUE = 'BUSINESS_REVENUE',
  MERCHANT_PAYMENT = 'MERCHANT_PAYMENT',
  PEER_TO_PEER = 'PEER_TO_PEER',
  DEFI_OPERATION = 'DEFI_OPERATION',
  STABLECOIN_TRANSFER = 'STABLECOIN_TRANSFER',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CROSS_CHAIN = 'CROSS_CHAIN',
  OTHER = 'OTHER',
}

export enum ProofType {
  THRESHOLD = 'THRESHOLD',
  PATTERN = 'PATTERN',
  AGGREGATE = 'AGGREGATE',
  IDENTITY = 'IDENTITY',
  COMPOSITE = 'COMPOSITE',
}

export enum RecipientType {
  LENDER = 'LENDER',
  LANDLORD = 'LANDLORD',
  EMPLOYER = 'EMPLOYER',
  GOVERNMENT = 'GOVERNMENT',
  BUSINESS = 'BUSINESS',
  INDIVIDUAL = 'INDIVIDUAL',
  OTHER = 'OTHER',
}

// ============ Transaction Ingestion ============

export interface IncomingTransaction {
  // Source identification
  sourceSystem: string;
  sourceTransactionId: string;
  sourceUserId: string; // From main backend
  
  // Transaction details
  amount: string;
  currency: string;
  txType: TransactionType;
  category?: string;
  
  // Parties
  sender?: {
    id?: string;
    type?: string;
    metadata?: Record<string, any>;
  };
  receiver?: {
    id?: string;
    type?: string;
    metadata?: Record<string, any>;
  };
  
  // Timestamps
  timestamp: Date;
  
  // Additional metadata
  metadata?: {
    provider?: string;
    channel?: string;
    description?: string;
    tags?: string[];
    [key: string]: any;
  };
}

// ============ Receipt ============

export interface ReceiptCommitment {
  transactionHash: string;
  amountCommitment: string;
  timestampCommitment: string;
}

export interface ReceiptMetadata {
  receiptId: string;
  tokenId: string;
  userId: string;
  smartWalletAddress: string;
  
  // Commitments
  commitments: ReceiptCommitment;
  
  // Type & category
  txType: TransactionType;
  category?: string;
  
  // On-chain
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: bigint;
  
  // Off-chain
  ipfsHash?: string;
  
  // Timestamps
  transactionDate: Date;
  mintedAt: Date;
}

export interface EncryptedReceiptData {
  // Full transaction details (encrypted)
  amount: string;
  currency: string;
  sender: any;
  receiver: any;
  timestamp: Date;
  metadata: any;
  
  // Encryption info
  encryptionMethod: string;
  keyDerivationInfo: any;
}

// ============ Profile & Score ============

export interface UserProfile {
  userId: string;
  smartWalletAddress: string;
  did?: string;
  
  // Level & score
  level: number;
  creditScore: number;
  totalReceipts: number;
  
  // Time ranges
  accountAge: number; // days
  firstReceiptDate?: Date;
  lastReceiptDate?: Date;
  
  // Merkle state
  receiptMerkleRoot?: string;
  profileMerkleRoot?: string;
  
  // Score components (detailed breakdown)
  scoreComponents: {
    incomeVerification: number;    // 40%
    transactionBehavior: number;   // 30%
    relationshipQuality: number;   // 20%
    growthPotential: number;       // 10%
  };
  
  // Trends
  trend: 'improving' | 'stable' | 'declining';
  confidence: number; // 0-100
}

export interface ProfileAggregate {
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  periodStart: Date;
  periodEnd: Date;
  
  // Volume
  totalTransactions: number;
  totalValue: number;
  averageValue: number;
  medianValue?: number;
  stdDeviation?: number;
  
  // Sources
  uniqueSources: number;
  repeatSources: number;
  topSourceCategory?: string;
  
  // Behavior
  transactionFrequency: number;
  consistencyScore: number;
  growthRate?: number;
  
  // For ZK proofs
  aggregateCommitment?: string;
}

// ============ Proofs ============

export interface ProofRequest {
  userId: string;
  proofType: ProofType;
  claimType: string;
  parameters: Record<string, any>;
  expiryDuration?: number; // seconds
}

export interface GeneratedProof {
  proofId: string;
  userId: string;
  proofType: ProofType;
  claimType: string;
  
  // The actual ZK proof
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  
  // Public inputs for verification
  publicInputs: any[];
  
  // Claim details
  claimParameters: Record<string, any>;
  claimResult: boolean;
  
  // Verification
  verified: boolean;
  verifiedAt?: Date;
  
  // Metadata
  circuitId: string;
  expiresAt?: Date;
  createdAt: Date;
}

export interface ProofVerificationRequest {
  proof: GeneratedProof;
  expectedClaim?: any;
}

export interface ProofVerificationResult {
  valid: boolean;
  proofId: string;
  claimVerified: boolean;
  verifiedAt: Date;
  verifierSignature?: string;
  errors?: string[];
}

// ============ Sharing & Access Control ============

export interface ShareRequest {
  userId: string;
  scope: {
    includeProfile?: boolean;
    includeScore?: boolean;
    includeReceipts?: boolean;
    
    // Selective disclosure
    incomeRange?: boolean;
    exactAmounts?: boolean;
    transactionDates?: boolean;
    sourceDetails?: boolean;
    
    // Time window
    fromDate?: Date;
    toDate?: Date;
    
    // Specific proofs
    proofTypes?: ProofType[];
  };
  
  // Recipient
  recipientName?: string;
  recipientType: RecipientType;
  recipientDid?: string;
  purpose?: string;
  
  // Access control
  expiresIn: number; // seconds
  maxViews?: number;
}

export interface ShareToken {
  shareId: string;
  token: string; // JWT
  userId: string;
  scope: any;
  recipientType: RecipientType;
  expiresAt: Date;
  viewsRemaining?: number;
  active: boolean;
}

export interface ShareAccessResult {
  shareId: string;
  data: {
    profile?: Partial<UserProfile>;
    score?: number;
    receipts?: Partial<ReceiptMetadata>[];
    proofs?: GeneratedProof[];
    aggregates?: ProfileAggregate[];
  };
  accessedAt: Date;
}

// ============ Thirdweb Smart Wallet ============

export interface SmartWalletConfig {
  factoryAddress: string;
  accountAddress?: string;
  gasless: boolean;
  personalWalletAddress?: string;
}

export interface MintReceiptTransaction {
  to: string; // user smart wallet
  transactionHash: string;
  amountCommitment: string;
  txType: number; // enum value
  merkleRoot: string;
}

// ============ Merkle Tree ============

export interface MerkleTreeData {
  root: string;
  leaves: string[];
  depth: number;
  leafCount: number;
}

export interface MerkleProof {
  leaf: string;
  index: number;
  proof: string[];
  root: string;
}

// ============ ZK Circuits ============

export interface CircuitInput {
  // Public inputs
  publicThreshold?: string;
  publicMonths?: string;
  publicRoot?: string;
  
  // Private inputs
  amounts?: string[];
  timestamps?: string[];
  salts?: string[];
  merkleProofs?: any[];
  
  [key: string]: any;
}

export interface CircuitOutput {
  proof: any;
  publicSignals: any[];
}

// ============ System ============

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: Date;
  services: {
    database: boolean;
    redis: boolean;
    ipfs: boolean;
    blockchain: boolean;
    zkProver: boolean;
  };
  metrics: {
    receiptsToday: number;
    proofsToday: number;
    activeShares: number;
    avgResponseTime: number;
  };
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: Date;
    requestId: string;
    version: string;
  };
}

