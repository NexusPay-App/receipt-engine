/**
 * NexusPay Receipt Verifier SDK
 * 
 * For third parties (lenders, landlords, employers) to verify
 * financial proofs without exposing user data
 * 
 * Usage:
 * 
 * ```typescript
 * import { ReceiptVerifier } from '@nexuspay/receipt-verifier-sdk';
 * 
 * const verifier = new ReceiptVerifier({
 *   apiUrl: 'https://receipts.nexuspay.com',
 * });
 * 
 * // User shares verification link
 * const shareToken = 'eyJhbGciOiJIUzI1NiIs...';
 * 
 * // Verifier accesses shared data
 * const result = await verifier.verify(shareToken);
 * 
 * console.log(result.creditScore); // 742
 * console.log(result.verified); // true
 * ```
 */

export interface VerifierConfig {
  apiUrl: string;
  timeout?: number;
}

export interface VerificationResult {
  verified: boolean;
  shareId: string;
  accessedAt: Date;
  
  // Data (based on scope granted by user)
  profile?: {
    level: number;
    accountAge: number;
    trend: 'improving' | 'stable' | 'declining';
    confidence: number;
  };
  
  score?: {
    creditScore: number;
    scoreComponents?: {
      incomeVerification: number;
      transactionBehavior: number;
      relationshipQuality: number;
      growthPotential: number;
    };
  };
  
  receipts?: Array<{
    receiptId: string;
    tokenId: string;
    txType: string;
    category?: string;
    transactionPeriod?: string;
    verified: boolean;
  }>;
  
  proofs?: Array<{
    proofId: string;
    claimType: string;
    claimResult: boolean;
    verified: boolean;
  }>;
}

export interface ProofVerificationResult {
  valid: boolean;
  proofId: string;
  claimVerified: boolean;
  verifiedAt: Date;
  verifierSignature?: string;
  errors?: string[];
}

export class ReceiptVerifier {
  private apiUrl: string;
  private timeout: number;
  
  constructor(config: VerifierConfig) {
    this.apiUrl = config.apiUrl;
    this.timeout = config.timeout || 10000;
  }
  
  /**
   * Verify shared financial data using token
   * 
   * @param shareToken - JWT token provided by user
   * @returns Verification result with accessible data
   */
  async verify(shareToken: string): Promise<VerificationResult> {
    try {
      const response = await this.fetch(`/api/v1/shares/verify/${shareToken}`, {
        method: 'GET',
      });
      
      if (!response.success) {
        throw new Error(response.error?.message || 'Verification failed');
      }
      
      return {
        verified: true,
        shareId: response.meta.shareId,
        accessedAt: new Date(response.meta.accessedAt),
        profile: response.data.profile,
        score: response.data.score ? {
          creditScore: response.data.score,
          scoreComponents: response.data.scoreComponents,
        } : undefined,
        receipts: response.data.receipts,
        proofs: response.data.proofs,
      };
    } catch (error: any) {
      if (error.message.includes('expired')) {
        throw new Error('Share link has expired');
      }
      if (error.message.includes('revoked')) {
        throw new Error('Share link has been revoked by user');
      }
      throw error;
    }
  }
  
  /**
   * Verify a specific ZK proof
   * 
   * @param proofId - Proof ID to verify
   * @returns Proof verification result
   */
  async verifyProof(proofId: string): Promise<ProofVerificationResult> {
    const response = await this.fetch('/api/v1/proofs/verify', {
      method: 'POST',
      body: JSON.stringify({ proofId }),
    });
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Proof verification failed');
    }
    
    return response.data;
  }
  
  /**
   * Check if score meets minimum threshold
   * (Helper for quick decisions)
   */
  async meetsMinimumScore(
    shareToken: string,
    minimumScore: number
  ): Promise<boolean> {
    const result = await this.verify(shareToken);
    return (result.score?.creditScore || 0) >= minimumScore;
  }
  
  /**
   * Check if user has consistent income
   * (Helper for rental/lending decisions)
   */
  async hasConsistentIncome(
    shareToken: string,
    months: number = 6
  ): Promise<boolean> {
    const result = await this.verify(shareToken);
    
    // Check for consistency proof
    const consistencyProof = result.proofs?.find(
      p => p.claimType === 'consistency' && p.verified
    );
    
    return consistencyProof?.claimResult || false;
  }
  
  /**
   * Generate embeddable verification widget HTML
   */
  generateEmbedWidget(shareToken: string): string {
    return `
      <div id="nexuspay-verification-widget" data-token="${shareToken}">
        <div class="loading">Verifying...</div>
      </div>
      <script src="${this.apiUrl}/embed/widget.js"></script>
      <link rel="stylesheet" href="${this.apiUrl}/embed/widget.css">
    `;
  }
  
  // Private helper
  private async fetch(endpoint: string, options: any = {}): Promise<any> {
    const url = `${this.apiUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }
}

// Export for browser usage
if (typeof window !== 'undefined') {
  (window as any).NexusPayVerifier = ReceiptVerifier;
}

export default ReceiptVerifier;

