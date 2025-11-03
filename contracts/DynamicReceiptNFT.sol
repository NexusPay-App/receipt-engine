// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@thirdweb-dev/contracts/base/ERC721Base.sol";
import "@thirdweb-dev/contracts/extension/PermissionsEnumerable.sol";

/**
 * @title DynamicReceiptNFT
 * @notice Soulbound NFT representing transaction receipts with evolving metadata
 * @dev Implements ERC-5192 (Minimal Soulbound NFT) + dynamic metadata evolution
 * 
 * Key Features:
 * - Non-transferable (Soulbound) - receipts bound to user identity
 * - Dynamic metadata - updates as user accumulates more receipts
 * - Level system - visual evolution based on transaction history
 * - Privacy-preserving - only commitments stored on-chain
 * - Verifiable - cryptographic proofs without revealing details
 */
contract DynamicReceiptNFT is ERC721Base, PermissionsEnumerable {
    
    // ============ State Variables ============
    
    /// @notice Minter role for authorized receipt generation
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    /// @notice Updater role for metadata evolution
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    
    /// @notice Receipt commitment structure
    struct ReceiptCommitment {
        bytes32 transactionHash;      // Hash of transaction details
        bytes32 amountCommitment;     // Pedersen commitment to amount
        uint256 timestamp;            // Block timestamp
        uint8 txType;                 // Transaction type (remittance, salary, etc.)
        bytes32 merkleRoot;           // Root of user's receipt Merkle tree
        bool verified;                // Verification status
    }
    
    /// @notice User profile metadata (aggregated stats)
    struct UserProfile {
        uint256 totalReceipts;        // Total receipt count
        uint256 firstReceiptTime;     // First receipt timestamp
        uint256 lastReceiptTime;      // Most recent receipt timestamp
        uint8 level;                  // Current level (1-5)
        uint16 creditScore;           // Computed credit score (0-850)
        bytes32 profileMerkleRoot;    // Aggregated profile Merkle root
    }
    
    /// @notice Level thresholds for evolution
    uint256[5] public LEVEL_THRESHOLDS = [1, 10, 50, 200, 1000];
    
    /// @notice Mapping from token ID to receipt commitment
    mapping(uint256 => ReceiptCommitment) public receipts;
    
    /// @notice Mapping from user address to profile
    mapping(address => UserProfile) public profiles;
    
    /// @notice Mapping from user to list of their receipt token IDs
    mapping(address => uint256[]) public userReceipts;
    
    /// @notice Counter for token IDs
    uint256 private _nextTokenId;
    
    // ============ Events ============
    
    event ReceiptMinted(
        address indexed user,
        uint256 indexed tokenId,
        bytes32 transactionHash,
        uint256 timestamp,
        uint8 txType
    );
    
    event ProfileUpdated(
        address indexed user,
        uint8 newLevel,
        uint256 totalReceipts,
        uint16 creditScore
    );
    
    event ReceiptVerified(
        uint256 indexed tokenId,
        bytes32 merkleRoot
    );
    
    /// @notice ERC-5192 event - emitted when token is locked (non-transferable)
    event Locked(uint256 tokenId);
    
    // ============ Constructor ============
    
    constructor(
        string memory _name,
        string memory _symbol,
        address _royaltyRecipient,
        uint128 _royaltyBps
    )
        ERC721Base(
            _name,
            _symbol,
            _royaltyRecipient,
            _royaltyBps
        )
    {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(MINTER_ROLE, msg.sender);
        _setupRole(UPDATER_ROLE, msg.sender);
        _nextTokenId = 1;
    }
    
    // ============ Minting Functions ============
    
    /**
     * @notice Mint a new receipt NFT (soulbound to user)
     * @param to User receiving the receipt
     * @param transactionHash Hash of the transaction
     * @param amountCommitment Commitment to transaction amount
     * @param txType Transaction type
     * @param merkleRoot User's current Merkle root
     */
    function mintReceipt(
        address to,
        bytes32 transactionHash,
        bytes32 amountCommitment,
        uint8 txType,
        bytes32 merkleRoot
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        
        // Mint the NFT
        _safeMint(to, tokenId);
        
        // Store receipt commitment
        receipts[tokenId] = ReceiptCommitment({
            transactionHash: transactionHash,
            amountCommitment: amountCommitment,
            timestamp: block.timestamp,
            txType: txType,
            merkleRoot: merkleRoot,
            verified: true
        });
        
        // Update user profile
        _updateUserProfile(to, tokenId);
        
        // Add to user's receipt list
        userReceipts[to].push(tokenId);
        
        emit ReceiptMinted(to, tokenId, transactionHash, block.timestamp, txType);
        emit Locked(tokenId); // ERC-5192: Token is locked at mint
        
        return tokenId;
    }
    
    /**
     * @notice Batch mint multiple receipts (gas optimization)
     * @param to User receiving the receipts
     * @param transactions Array of transaction data
     */
    function batchMintReceipts(
        address to,
        ReceiptData[] calldata transactions
    ) external onlyRole(MINTER_ROLE) returns (uint256[] memory) {
        uint256[] memory tokenIds = new uint256[](transactions.length);
        
        for (uint256 i = 0; i < transactions.length; i++) {
            uint256 tokenId = _nextTokenId++;
            
            _safeMint(to, tokenId);
            
            receipts[tokenId] = ReceiptCommitment({
                transactionHash: transactions[i].transactionHash,
                amountCommitment: transactions[i].amountCommitment,
                timestamp: block.timestamp,
                txType: transactions[i].txType,
                merkleRoot: transactions[i].merkleRoot,
                verified: true
            });
            
            userReceipts[to].push(tokenId);
            tokenIds[i] = tokenId;
            
            emit ReceiptMinted(to, tokenId, transactions[i].transactionHash, block.timestamp, transactions[i].txType);
            emit Locked(tokenId);
        }
        
        // Update profile once after batch
        _updateUserProfile(to, 0);
        
        return tokenIds;
    }
    
    // ============ Profile Management ============
    
    /**
     * @notice Update user profile and level based on receipt accumulation
     * @param user User address
     * @param tokenId Latest receipt token ID
     */
    function _updateUserProfile(address user, uint256 tokenId) internal {
        UserProfile storage profile = profiles[user];
        
        if (profile.firstReceiptTime == 0) {
            profile.firstReceiptTime = block.timestamp;
        }
        
        profile.totalReceipts = userReceipts[user].length;
        profile.lastReceiptTime = block.timestamp;
        
        // Calculate new level
        uint8 newLevel = _calculateLevel(profile.totalReceipts);
        bool leveledUp = newLevel > profile.level;
        profile.level = newLevel;
        
        emit ProfileUpdated(user, profile.level, profile.totalReceipts, profile.creditScore);
        
        // If leveled up, trigger metadata update off-chain
        if (leveledUp) {
            // Off-chain indexer listens for this event and updates IPFS metadata
        }
    }
    
    /**
     * @notice Update user's credit score (called by authorized updater)
     * @param user User address
     * @param newScore New credit score
     * @param profileMerkleRoot New profile Merkle root
     */
    function updateCreditScore(
        address user,
        uint16 newScore,
        bytes32 profileMerkleRoot
    ) external onlyRole(UPDATER_ROLE) {
        require(newScore <= 850, "Invalid score");
        
        UserProfile storage profile = profiles[user];
        profile.creditScore = newScore;
        profile.profileMerkleRoot = profileMerkleRoot;
        
        emit ProfileUpdated(user, profile.level, profile.totalReceipts, newScore);
    }
    
    /**
     * @notice Calculate user level based on receipt count
     */
    function _calculateLevel(uint256 receiptCount) internal view returns (uint8) {
        for (uint8 i = 4; i >= 0; i--) {
            if (receiptCount >= LEVEL_THRESHOLDS[i]) {
                return i + 1;
            }
        }
        return 1;
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get all receipt IDs for a user
     */
    function getUserReceipts(address user) external view returns (uint256[] memory) {
        return userReceipts[user];
    }
    
    /**
     * @notice Get user profile
     */
    function getUserProfile(address user) external view returns (UserProfile memory) {
        return profiles[user];
    }
    
    /**
     * @notice Get receipt commitment
     */
    function getReceipt(uint256 tokenId) external view returns (ReceiptCommitment memory) {
        require(_exists(tokenId), "Token does not exist");
        return receipts[tokenId];
    }
    
    /**
     * @notice Check if user has minimum receipts
     */
    function hasMinimumReceipts(address user, uint256 minimum) external view returns (bool) {
        return userReceipts[user].length >= minimum;
    }
    
    /**
     * @notice Get dynamic token URI (changes based on level)
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        
        address owner = ownerOf(tokenId);
        UserProfile memory profile = profiles[owner];
        
        // Return level-specific metadata URI
        // Format: ipfs://QmXxxx.../metadata/{level}/{tokenId}.json
        return string(
            abi.encodePacked(
                _baseURI(),
                "metadata/",
                Strings.toString(profile.level),
                "/",
                Strings.toString(tokenId),
                ".json"
            )
        );
    }
    
    // ============ ERC-5192 Soulbound Implementation ============
    
    /**
     * @notice Check if token is locked (always true - soulbound)
     */
    function locked(uint256 tokenId) external view returns (bool) {
        require(_exists(tokenId), "Token does not exist");
        return true;
    }
    
    /**
     * @notice Override transfer functions to prevent transfers (soulbound)
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override {
        require(from == address(0), "Soulbound: Transfer not allowed");
        super._beforeTokenTransfer(from, to, tokenId);
    }
    
    /**
     * @notice Disable approvals (soulbound tokens cannot be approved)
     */
    function approve(address, uint256) public virtual override {
        revert("Soulbound: Approval not allowed");
    }
    
    /**
     * @notice Disable setApprovalForAll (soulbound tokens cannot be approved)
     */
    function setApprovalForAll(address, bool) public virtual override {
        revert("Soulbound: Approval not allowed");
    }
    
    // ============ Supporting Structs ============
    
    struct ReceiptData {
        bytes32 transactionHash;
        bytes32 amountCommitment;
        uint8 txType;
        bytes32 merkleRoot;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update level thresholds (admin only)
     */
    function updateLevelThresholds(uint256[5] calldata newThresholds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        LEVEL_THRESHOLDS = newThresholds;
    }
    
    /**
     * @notice Emergency burn (only in case of fraud/error)
     */
    function emergencyBurn(uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _burn(tokenId);
    }
}

