import { PrismaClient, TransactionType } from '@prisma/client';
import { MerkleTree } from 'merkletreejs';
import { keccak256 } from 'ethers/lib/utils';
import CryptoJS from 'crypto-js';
import { logger } from '../utils/logger';
import { thirdwebService } from './thirdweb.service';
import { ipfsService } from './ipfs.service';
import { ReceiptMetadata, EncryptedReceiptData, MerkleProof } from '../types';
import { config } from '../config/env';

const prisma = new PrismaClient();

/**
 * Receipt Service
 * 
 * Core service for:
 * - Creating receipts from transactions
 * - Generating commitments and Merkle proofs
 * - Encrypting sensitive data
 * - Minting NFTs via Thirdweb
 * - Managing Merkle trees per user
 */
class ReceiptService {
  
  /**
   * Create a receipt from a transaction
   * 
   * @param data - Transaction and user data
   * @returns Created receipt with metadata
   */
  async createReceipt(data: {
    mainBackendUserId: string;
    transaction: {
      id: string;
      amount: string;
      currency: string;
      type: TransactionType;
      category?: string;
      sender?: any;
      receiver?: any;
      timestamp: Date;
      metadata?: any;
    };
  }): Promise<ReceiptMetadata> {
    try {
      logger.info('Creating receipt', {
        userId: data.mainBackendUserId,
        txId: data.transaction.id,
        type: data.transaction.type,
      });
      
      // 1. Get or create user in receipt engine
      let user = await prisma.user.findUnique({
        where: { mainBackendUserId: data.mainBackendUserId },
      });
      
      if (!user) {
        // Create smart wallet for user
        const smartWalletAddress = await thirdwebService.getOrCreateSmartWallet(
          data.mainBackendUserId
        );
        
        user = await prisma.user.create({
          data: {
            mainBackendUserId: data.mainBackendUserId,
            smartWalletAddress,
          },
        });
        
        logger.info('Created new user', {
          userId: user.id,
          smartWalletAddress,
        });
      }
      
      // 2. Generate commitments
      const commitments = this.generateCommitments(data.transaction);
      
      // 3. Encrypt sensitive data for IPFS
      const encryptedData = this.encryptReceiptData({
        amount: data.transaction.amount,
        currency: data.transaction.currency,
        sender: data.transaction.sender,
        receiver: data.transaction.receiver,
        timestamp: data.transaction.timestamp,
        metadata: data.transaction.metadata,
      }, user.id);
      
      // 4. Upload encrypted data to IPFS
      const ipfsHash = await ipfsService.uploadJSON(encryptedData);
      
      logger.info('Encrypted receipt uploaded to IPFS', {
        ipfsHash,
        userId: user.id,
      });
      
      // 5. Update user's Merkle tree
      const merkleData = await this.updateUserMerkleTree(
        user.id,
        commitments.transactionHash
      );
      
      // 6. Mint receipt NFT on-chain
      const mintResult = await thirdwebService.mintReceipt({
        to: user.smartWalletAddress,
        transactionHash: commitments.transactionHash,
        amountCommitment: commitments.amountCommitment,
        txType: this.txTypeToNumber(data.transaction.type),
        merkleRoot: merkleData.root,
      });
      
      logger.info('Receipt NFT minted', {
        tokenId: mintResult.tokenId,
        txHash: mintResult.transactionHash,
      });
      
      // 7. Store receipt in database
      const receipt = await prisma.receipt.create({
        data: {
          tokenId: mintResult.tokenId,
          chainId: config.thirdweb.chainId,
          contractAddress: config.contracts.receiptNFT,
          transactionHash: mintResult.transactionHash,
          blockNumber: BigInt(mintResult.blockNumber),
          
          userId: user.id,
          
          txHash: commitments.transactionHash,
          amountCommitment: commitments.amountCommitment,
          timestampCommitment: commitments.timestampCommitment,
          
          txType: data.transaction.type,
          category: data.transaction.category,
          verified: true,
          
          ipfsHash,
          encryptionKey: encryptedData.keyDerivationInfo.keyId,
          
          merkleProof: merkleData.proof,
          merkleIndex: merkleData.index,
          
          transactionDate: data.transaction.timestamp,
        },
      });
      
      // 8. Update user totals
      await this.updateUserStats(user.id);
      
      logger.info('Receipt created successfully', {
        receiptId: receipt.id,
        tokenId: receipt.tokenId,
        userId: user.id,
      });
      
      // 9. Return receipt metadata
      return {
        receiptId: receipt.id,
        tokenId: receipt.tokenId,
        userId: user.id,
        smartWalletAddress: user.smartWalletAddress,
        
        commitments: {
          transactionHash: commitments.transactionHash,
          amountCommitment: commitments.amountCommitment,
          timestampCommitment: commitments.timestampCommitment,
        },
        
        txType: receipt.txType,
        category: receipt.category || undefined,
        
        chainId: config.thirdweb.chainId,
        contractAddress: config.contracts.receiptNFT,
        transactionHash: receipt.transactionHash,
        blockNumber: BigInt(mintResult.blockNumber),
        
        ipfsHash,
        
        transactionDate: data.transaction.timestamp,
        mintedAt: receipt.createdAt,
      };
    } catch (error) {
      logger.error('Error creating receipt', { data, error });
      throw error;
    }
  }
  
  /**
   * Generate cryptographic commitments for transaction
   */
  private generateCommitments(transaction: {
    id: string;
    amount: string;
    currency: string;
    timestamp: Date;
  }): {
    transactionHash: string;
    amountCommitment: string;
    timestampCommitment: string;
  } {
    // Transaction hash (hash of all details)
    const transactionHash = keccak256(
      Buffer.from(
        JSON.stringify({
          id: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          timestamp: transaction.timestamp.toISOString(),
        })
      )
    );
    
    // Amount commitment (Pedersen-like commitment)
    // In production, use actual Pedersen commitments with random blinding factors
    const amountSalt = CryptoJS.lib.WordArray.random(32).toString();
    const amountCommitment = keccak256(
      Buffer.from(`${transaction.amount}:${transaction.currency}:${amountSalt}`)
    );
    
    // Timestamp commitment
    const timestampSalt = CryptoJS.lib.WordArray.random(32).toString();
    const timestampCommitment = keccak256(
      Buffer.from(
        `${transaction.timestamp.getTime()}:${timestampSalt}`
      )
    );
    
    return {
      transactionHash,
      amountCommitment,
      timestampCommitment,
    };
  }
  
  /**
   * Encrypt sensitive receipt data
   */
  private encryptReceiptData(
    data: Omit<EncryptedReceiptData, 'encryptionMethod' | 'keyDerivationInfo'>,
    userId: string
  ): EncryptedReceiptData {
    // Derive encryption key from master key + userId
    const keyId = keccak256(Buffer.from(`${userId}:${Date.now()}`));
    const encryptionKey = CryptoJS.PBKDF2(
      config.encryption.masterKey,
      keyId,
      {
        keySize: 256 / 32,
        iterations: 1000,
      }
    ).toString();
    
    // Encrypt data
    const encrypted = CryptoJS.AES.encrypt(
      JSON.stringify(data),
      encryptionKey
    ).toString();
    
    return {
      ...data,
      amount: encrypted, // Store encrypted payload in amount field
      encryptionMethod: 'AES-256-CBC',
      keyDerivationInfo: {
        method: 'PBKDF2',
        iterations: 1000,
        keyId,
      },
    };
  }
  
  /**
   * Decrypt receipt data
   */
  async decryptReceiptData(
    encryptedData: EncryptedReceiptData,
    userId: string
  ): Promise<any> {
    try {
      const { keyId } = encryptedData.keyDerivationInfo;
      
      // Derive same encryption key
      const encryptionKey = CryptoJS.PBKDF2(
        config.encryption.masterKey,
        keyId,
        {
          keySize: 256 / 32,
          iterations: 1000,
        }
      ).toString();
      
      // Decrypt
      const decrypted = CryptoJS.AES.decrypt(
        encryptedData.amount,
        encryptionKey
      );
      
      const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
      return JSON.parse(plaintext);
    } catch (error) {
      logger.error('Error decrypting receipt data', { error });
      throw new Error('Decryption failed');
    }
  }
  
  /**
   * Update user's Merkle tree with new receipt
   */
  private async updateUserMerkleTree(
    userId: string,
    newLeaf: string
  ): Promise<{
    root: string;
    proof: any;
    index: number;
  }> {
    // Get user's existing receipts
    const receipts = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'asc' },
    });
    
    // Get all leaves (transaction hashes)
    const leaves = receipts.map((r) => r.txHash);
    
    // Add new leaf
    leaves.push(newLeaf);
    
    // Build Merkle tree
    const tree = new MerkleTree(
      leaves.map((leaf) => Buffer.from(leaf.slice(2), 'hex')),
      keccak256,
      { sortPairs: true }
    );
    
    const root = '0x' + tree.getRoot().toString('hex');
    const newLeafIndex = leaves.length - 1;
    const proof = tree.getProof(Buffer.from(newLeaf.slice(2), 'hex'));
    
    // Update user's Merkle root
    await prisma.user.update({
      where: { id: userId },
      data: { receiptMerkleRoot: root },
    });
    
    logger.info('Updated user Merkle tree', {
      userId,
      root,
      leafCount: leaves.length,
    });
    
    return {
      root,
      proof: proof.map((p) => ({
        position: p.position,
        data: '0x' + p.data.toString('hex'),
      })),
      index: newLeafIndex,
    };
  }
  
  /**
   * Verify Merkle proof for a receipt
   */
  verifyMerkleProof(
    leaf: string,
    proof: any[],
    root: string
  ): boolean {
    try {
      const computedRoot = proof.reduce((hash, proofElement) => {
        const buffers = [
          Buffer.from(hash.slice(2), 'hex'),
          Buffer.from(proofElement.data.slice(2), 'hex'),
        ];
        
        if (proofElement.position === 'left') {
          buffers.reverse();
        }
        
        return keccak256(Buffer.concat(buffers));
      }, leaf);
      
      return computedRoot === root;
    } catch (error) {
      logger.error('Error verifying Merkle proof', { error });
      return false;
    }
  }
  
  /**
   * Update user statistics
   */
  private async updateUserStats(userId: string): Promise<void> {
    const receipts = await prisma.receipt.findMany({
      where: { userId },
      orderBy: { transactionDate: 'asc' },
    });
    
    const totalReceipts = receipts.length;
    const firstReceiptAt = receipts[0]?.transactionDate;
    const lastReceiptAt = receipts[receipts.length - 1]?.transactionDate;
    
    // Calculate level based on receipt count
    let level = 1;
    if (totalReceipts >= 1000) level = 5;
    else if (totalReceipts >= 200) level = 4;
    else if (totalReceipts >= 50) level = 3;
    else if (totalReceipts >= 10) level = 2;
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        totalReceipts,
        firstReceiptAt,
        lastReceiptAt,
        level,
      },
    });
    
    logger.info('Updated user stats', {
      userId,
      totalReceipts,
      level,
    });
  }
  
  /**
   * Get user's receipts
   */
  async getUserReceipts(userId: string, options?: {
    limit?: number;
    offset?: number;
    type?: TransactionType;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ReceiptMetadata[]> {
    const receipts = await prisma.receipt.findMany({
      where: {
        user: { mainBackendUserId: userId },
        ...(options?.type && { txType: options.type }),
        ...(options?.fromDate && {
          transactionDate: { gte: options.fromDate },
        }),
        ...(options?.toDate && {
          transactionDate: { lte: options.toDate },
        }),
      },
      orderBy: { transactionDate: 'desc' },
      take: options?.limit || 100,
      skip: options?.offset || 0,
      include: { user: true },
    });
    
    return receipts.map((r) => ({
      receiptId: r.id,
      tokenId: r.tokenId,
      userId: r.userId,
      smartWalletAddress: r.user.smartWalletAddress,
      
      commitments: {
        transactionHash: r.txHash,
        amountCommitment: r.amountCommitment,
        timestampCommitment: r.timestampCommitment,
      },
      
      txType: r.txType,
      category: r.category || undefined,
      
      chainId: r.chainId,
      contractAddress: r.contractAddress,
      transactionHash: r.transactionHash,
      blockNumber: r.blockNumber,
      
      ipfsHash: r.ipfsHash || undefined,
      
      transactionDate: r.transactionDate,
      mintedAt: r.createdAt,
    }));
  }
  
  /**
   * Get single receipt by ID
   */
  async getReceiptById(receiptId: string): Promise<ReceiptMetadata | null> {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { user: true },
    });
    
    if (!receipt) return null;
    
    return {
      receiptId: receipt.id,
      tokenId: receipt.tokenId,
      userId: receipt.userId,
      smartWalletAddress: receipt.user.smartWalletAddress,
      
      commitments: {
        transactionHash: receipt.txHash,
        amountCommitment: receipt.amountCommitment,
        timestampCommitment: receipt.timestampCommitment,
      },
      
      txType: receipt.txType,
      category: receipt.category || undefined,
      
      chainId: receipt.chainId,
      contractAddress: receipt.contractAddress,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      
      ipfsHash: receipt.ipfsHash || undefined,
      
      transactionDate: receipt.transactionDate,
      mintedAt: receipt.createdAt,
    };
  }
  
  /**
   * Convert TransactionType enum to number for contract
   */
  private txTypeToNumber(type: TransactionType): number {
    const typeMap: Record<TransactionType, number> = {
      [TransactionType.REMITTANCE]: 0,
      [TransactionType.SALARY]: 1,
      [TransactionType.BUSINESS_REVENUE]: 2,
      [TransactionType.MERCHANT_PAYMENT]: 3,
      [TransactionType.PEER_TO_PEER]: 4,
      [TransactionType.DEFI_OPERATION]: 5,
      [TransactionType.STABLECOIN_TRANSFER]: 6,
      [TransactionType.MOBILE_MONEY]: 7,
      [TransactionType.CROSS_CHAIN]: 8,
      [TransactionType.OTHER]: 9,
    };
    
    return typeMap[type] || 9;
  }
}

export const receiptService = new ReceiptService();

