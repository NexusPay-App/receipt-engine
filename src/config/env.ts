import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Thirdweb
  thirdweb: {
    secretKey: process.env.THIRDWEB_SECRET_KEY || '',
    clientId: process.env.THIRDWEB_CLIENT_ID || '',
    network: process.env.THIRDWEB_NETWORK || 'base-sepolia',
    chainId: parseInt(process.env.THIRDWEB_CHAIN_ID || '84532', 10),
    smartWalletFactory: process.env.THIRDWEB_SMART_WALLET_FACTORY || '',
  },
  
  // Main Backend Integration
  mainBackend: {
    url: process.env.MAIN_BACKEND_URL || 'http://localhost:3000',
    apiKey: process.env.MAIN_BACKEND_API_KEY || '',
    webhookSecret: process.env.BRIDGE_WEBHOOK_SECRET || '',
  },
  
  // Database
  database: {
    url: process.env.DATABASE_URL || '',
  },
  
  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    prefix: process.env.REDIS_PREFIX || 'receipt-engine:',
  },
  
  // IPFS
  ipfs: {
    gatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io/ipfs/',
    apiUrl: process.env.IPFS_API_URL || 'http://127.0.0.1:5001',
    web3StorageKey: process.env.WEB3_STORAGE_API_KEY || '',
  },
  
  // Encryption
  encryption: {
    masterKey: process.env.MASTER_ENCRYPTION_KEY || '',
  },
  
  // Smart Contracts
  contracts: {
    receiptNFT: process.env.RECEIPT_NFT_CONTRACT || '',
    profileRegistry: process.env.PROFILE_REGISTRY_CONTRACT || '',
  },
  
  // Security
  security: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    rateLimitWindowMs: parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || '900000',
      10
    ),
  },
  
  // ZK Proving
  zkProver: {
    bonsaiApiKey: process.env.BONSAI_API_KEY || '',
    bonsaiApiUrl: process.env.BONSAI_API_URL || '',
  },
  
  // Monitoring
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN || '',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

// Validate required config
export function validateConfig() {
  const required = [
    'THIRDWEB_SECRET_KEY',
    'THIRDWEB_CLIENT_ID',
    'DATABASE_URL',
    'MASTER_ENCRYPTION_KEY',
    'RECEIPT_NFT_CONTRACT',
  ];
  
  const missing = required.filter((key) => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

