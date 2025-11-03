import { create, IPFSHTTPClient } from 'ipfs-http-client';
import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config/env';

/**
 * IPFS Service
 * 
 * Handles uploading encrypted receipt data to IPFS
 * Uses Web3.Storage for production reliability
 */
class IPFSService {
  private ipfs?: IPFSHTTPClient;
  private useWeb3Storage: boolean;
  
  constructor() {
    this.useWeb3Storage = !!config.ipfs.web3StorageKey;
    
    if (!this.useWeb3Storage && config.ipfs.apiUrl) {
      // Connect to local IPFS node
      this.ipfs = create({ url: config.ipfs.apiUrl });
      logger.info('Connected to IPFS node', { url: config.ipfs.apiUrl });
    } else if (this.useWeb3Storage) {
      logger.info('Using Web3.Storage for IPFS');
    }
  }
  
  /**
   * Upload JSON data to IPFS
   */
  async uploadJSON(data: any): Promise<string> {
    try {
      if (this.useWeb3Storage) {
        return await this.uploadToWeb3Storage(data);
      } else if (this.ipfs) {
        return await this.uploadToIPFS(data);
      } else {
        throw new Error('No IPFS backend configured');
      }
    } catch (error) {
      logger.error('Error uploading to IPFS', { error });
      throw error;
    }
  }
  
  /**
   * Upload to local IPFS node
   */
  private async uploadToIPFS(data: any): Promise<string> {
    if (!this.ipfs) {
      throw new Error('IPFS client not initialized');
    }
    
    const buffer = Buffer.from(JSON.stringify(data));
    const result = await this.ipfs.add(buffer);
    
    logger.info('Uploaded to IPFS', { cid: result.cid.toString() });
    
    return result.cid.toString();
  }
  
  /**
   * Upload to Web3.Storage
   */
  private async uploadToWeb3Storage(data: any): Promise<string> {
    const response = await axios.post(
      'https://api.web3.storage/upload',
      Buffer.from(JSON.stringify(data)),
      {
        headers: {
          Authorization: `Bearer ${config.ipfs.web3StorageKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const cid = response.data.cid;
    logger.info('Uploaded to Web3.Storage', { cid });
    
    return cid;
  }
  
  /**
   * Retrieve data from IPFS
   */
  async retrieve(cid: string): Promise<any> {
    try {
      const url = `${config.ipfs.gatewayUrl}${cid}`;
      const response = await axios.get(url);
      
      return response.data;
    } catch (error) {
      logger.error('Error retrieving from IPFS', { cid, error });
      throw error;
    }
  }
  
  /**
   * Get IPFS gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    return `${config.ipfs.gatewayUrl}${cid}`;
  }
}

export const ipfsService = new IPFSService();

