import { ThirdwebSDK, SmartWallet } from '@thirdweb-dev/sdk';
import { ethers } from 'ethers';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { MintReceiptTransaction } from '../types';

/**
 * Thirdweb Account Abstraction Service
 * 
 * Handles all smart wallet operations including:
 * - Creating smart wallets for users (gasless)
 * - Minting receipt NFTs (gasless)
 * - Batch operations
 * - Session keys for delegated signing
 */
class ThirdwebService {
  private sdk: ThirdwebSDK;
  private receiptContract: any;
  private smartWalletFactory: any;
  
  constructor() {
    // Initialize Thirdweb SDK with secret key (backend operations)
    this.sdk = ThirdwebSDK.fromPrivateKey(
      config.thirdweb.secretKey,
      config.thirdweb.network,
      {
        secretKey: config.thirdweb.secretKey,
        clientId: config.thirdweb.clientId,
      }
    );
    
    logger.info('Thirdweb Service initialized', {
      network: config.thirdweb.network,
      chainId: config.thirdweb.chainId,
    });
  }
  
  /**
   * Initialize contracts
   */
  async initialize() {
    try {
      // Get receipt NFT contract
      this.receiptContract = await this.sdk.getContract(
        config.contracts.receiptNFT
      );
      
      // Get smart wallet factory
      this.smartWalletFactory = await this.sdk.getContract(
        config.thirdweb.smartWalletFactory
      );
      
      logger.info('Thirdweb contracts loaded', {
        receiptContract: config.contracts.receiptNFT,
        factory: config.thirdweb.smartWalletFactory,
      });
    } catch (error) {
      logger.error('Failed to initialize Thirdweb contracts', error);
      throw error;
    }
  }
  
  /**
   * Create or get smart wallet for user
   * 
   * @param userId - User ID from main backend
   * @param personalWalletAddress - Optional: user's existing wallet address
   * @returns Smart wallet address
   */
  async getOrCreateSmartWallet(
    userId: string,
    personalWalletAddress?: string
  ): Promise<string> {
    try {
      // Deterministic wallet creation based on userId
      const salt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(userId));
      
      // Predict smart wallet address
      const predictedAddress = await this.smartWalletFactory.call(
        'getAddress',
        [salt]
      );
      
      // Check if wallet already deployed
      const code = await this.sdk.getProvider().getCode(predictedAddress);
      const isDeployed = code !== '0x';
      
      if (!isDeployed) {
        // Deploy smart wallet (gasless for user)
        logger.info('Deploying new smart wallet', { userId, predictedAddress });
        
        const tx = await this.smartWalletFactory.call('createAccount', [
          personalWalletAddress || ethers.constants.AddressZero,
          salt,
        ]);
        
        logger.info('Smart wallet deployed', {
          userId,
          address: predictedAddress,
          txHash: tx.receipt.transactionHash,
        });
      }
      
      return predictedAddress;
    } catch (error) {
      logger.error('Error creating smart wallet', { userId, error });
      throw error;
    }
  }
  
  /**
   * Mint a receipt NFT (gasless for user)
   * 
   * @param transaction - Receipt transaction data
   * @returns Token ID and transaction hash
   */
  async mintReceipt(transaction: MintReceiptTransaction): Promise<{
    tokenId: string;
    transactionHash: string;
    blockNumber: number;
  }> {
    try {
      logger.info('Minting receipt NFT', {
        to: transaction.to,
        txHash: transaction.transactionHash,
      });
      
      // Prepare transaction
      const tx = await this.receiptContract.call('mintReceipt', [
        transaction.to,
        transaction.transactionHash,
        transaction.amountCommitment,
        transaction.txType,
        transaction.merkleRoot,
      ]);
      
      // Parse events to get token ID
      const event = tx.receipt.events.find(
        (e: any) => e.event === 'ReceiptMinted'
      );
      
      const tokenId = event?.args?.tokenId?.toString();
      
      logger.info('Receipt NFT minted', {
        tokenId,
        to: transaction.to,
        txHash: tx.receipt.transactionHash,
        blockNumber: tx.receipt.blockNumber,
      });
      
      return {
        tokenId,
        transactionHash: tx.receipt.transactionHash,
        blockNumber: tx.receipt.blockNumber,
      };
    } catch (error) {
      logger.error('Error minting receipt', { transaction, error });
      throw error;
    }
  }
  
  /**
   * Batch mint multiple receipts (gas optimization)
   * 
   * @param smartWalletAddress - User's smart wallet
   * @param receipts - Array of receipt data
   * @returns Array of minted token IDs
   */
  async batchMintReceipts(
    smartWalletAddress: string,
    receipts: Array<{
      transactionHash: string;
      amountCommitment: string;
      txType: number;
      merkleRoot: string;
    }>
  ): Promise<{
    tokenIds: string[];
    transactionHash: string;
    blockNumber: number;
  }> {
    try {
      logger.info('Batch minting receipts', {
        to: smartWalletAddress,
        count: receipts.length,
      });
      
      // Prepare batch transaction
      const receiptData = receipts.map((r) => ({
        transactionHash: r.transactionHash,
        amountCommitment: r.amountCommitment,
        txType: r.txType,
        merkleRoot: r.merkleRoot,
      }));
      
      const tx = await this.receiptContract.call('batchMintReceipts', [
        smartWalletAddress,
        receiptData,
      ]);
      
      // Parse events to get all token IDs
      const mintEvents = tx.receipt.events.filter(
        (e: any) => e.event === 'ReceiptMinted'
      );
      
      const tokenIds = mintEvents.map(
        (e: any) => e.args.tokenId.toString()
      );
      
      logger.info('Batch receipts minted', {
        tokenIds,
        count: tokenIds.length,
        txHash: tx.receipt.transactionHash,
      });
      
      return {
        tokenIds,
        transactionHash: tx.receipt.transactionHash,
        blockNumber: tx.receipt.blockNumber,
      };
    } catch (error) {
      logger.error('Error batch minting receipts', { receipts, error });
      throw error;
    }
  }
  
  /**
   * Update user's credit score on-chain
   * 
   * @param smartWalletAddress - User's smart wallet
   * @param creditScore - New credit score
   * @param profileMerkleRoot - Updated profile Merkle root
   */
  async updateCreditScore(
    smartWalletAddress: string,
    creditScore: number,
    profileMerkleRoot: string
  ): Promise<{ transactionHash: string }> {
    try {
      logger.info('Updating credit score on-chain', {
        user: smartWalletAddress,
        score: creditScore,
      });
      
      const tx = await this.receiptContract.call('updateCreditScore', [
        smartWalletAddress,
        creditScore,
        profileMerkleRoot,
      ]);
      
      logger.info('Credit score updated', {
        user: smartWalletAddress,
        score: creditScore,
        txHash: tx.receipt.transactionHash,
      });
      
      return {
        transactionHash: tx.receipt.transactionHash,
      };
    } catch (error) {
      logger.error('Error updating credit score', {
        smartWalletAddress,
        creditScore,
        error,
      });
      throw error;
    }
  }
  
  /**
   * Get user's receipts from contract
   */
  async getUserReceipts(smartWalletAddress: string): Promise<string[]> {
    try {
      const tokenIds = await this.receiptContract.call('getUserReceipts', [
        smartWalletAddress,
      ]);
      
      return tokenIds.map((id: any) => id.toString());
    } catch (error) {
      logger.error('Error fetching user receipts', {
        smartWalletAddress,
        error,
      });
      throw error;
    }
  }
  
  /**
   * Get user profile from contract
   */
  async getUserProfile(smartWalletAddress: string): Promise<{
    totalReceipts: number;
    firstReceiptTime: Date;
    lastReceiptTime: Date;
    level: number;
    creditScore: number;
    profileMerkleRoot: string;
  }> {
    try {
      const profile = await this.receiptContract.call('getUserProfile', [
        smartWalletAddress,
      ]);
      
      return {
        totalReceipts: profile.totalReceipts.toNumber(),
        firstReceiptTime: new Date(profile.firstReceiptTime.toNumber() * 1000),
        lastReceiptTime: new Date(profile.lastReceiptTime.toNumber() * 1000),
        level: profile.level,
        creditScore: profile.creditScore,
        profileMerkleRoot: profile.profileMerkleRoot,
      };
    } catch (error) {
      logger.error('Error fetching user profile', {
        smartWalletAddress,
        error,
      });
      throw error;
    }
  }
  
  /**
   * Get receipt commitment from contract
   */
  async getReceipt(tokenId: string): Promise<any> {
    try {
      const receipt = await this.receiptContract.call('getReceipt', [tokenId]);
      
      return {
        transactionHash: receipt.transactionHash,
        amountCommitment: receipt.amountCommitment,
        timestamp: new Date(receipt.timestamp.toNumber() * 1000),
        txType: receipt.txType,
        merkleRoot: receipt.merkleRoot,
        verified: receipt.verified,
      };
    } catch (error) {
      logger.error('Error fetching receipt', { tokenId, error });
      throw error;
    }
  }
  
  /**
   * Get token URI (dynamic NFT metadata)
   */
  async getTokenURI(tokenId: string): Promise<string> {
    try {
      const uri = await this.receiptContract.call('tokenURI', [tokenId]);
      return uri;
    } catch (error) {
      logger.error('Error fetching token URI', { tokenId, error });
      throw error;
    }
  }
  
  /**
   * Create session key for user (delegated signing)
   * Allows backend to sign on behalf of user for gasless UX
   */
  async createSessionKey(
    smartWalletAddress: string,
    sessionKeyAddress: string,
    permissions: {
      approvedTargets: string[];
      nativeTokenLimitPerTransaction: string;
      startDate: Date;
      expirationDate: Date;
    }
  ): Promise<{ transactionHash: string }> {
    try {
      logger.info('Creating session key', {
        smartWallet: smartWalletAddress,
        sessionKey: sessionKeyAddress,
      });
      
      // This would interact with Thirdweb's session key functionality
      // Implementation depends on their latest SDK
      
      // Placeholder for actual implementation
      throw new Error('Session key creation not yet implemented');
    } catch (error) {
      logger.error('Error creating session key', error);
      throw error;
    }
  }
  
  /**
   * Check if smart wallet has minimum receipts
   */
  async hasMinimumReceipts(
    smartWalletAddress: string,
    minimum: number
  ): Promise<boolean> {
    try {
      const hasMin = await this.receiptContract.call('hasMinimumReceipts', [
        smartWalletAddress,
        minimum,
      ]);
      
      return hasMin;
    } catch (error) {
      logger.error('Error checking minimum receipts', {
        smartWalletAddress,
        minimum,
        error,
      });
      throw error;
    }
  }
}

export const thirdwebService = new ThirdwebService();

