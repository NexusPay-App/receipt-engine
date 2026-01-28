pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Activity Longevity Proof
 * Proves: User has been active for >= M months with >= K transactions
 * 
 * Private inputs:
 * - firstActivityTimestamp: Unix timestamp of first activity
 * - totalTransactions: Total number of transactions
 * - activitySalt: Random salt
 * 
 * Public inputs:
 * - currentTimestamp: Current time
 * - minMonths: Minimum months active
 * - minTransactions: Minimum transaction count
 * - activityCommitment: Hash of activity data
 * - userId: User identifier
 */

template ActivityLongevity() {
    // Private inputs
    signal input firstActivityTimestamp;
    signal input totalTransactions;
    signal input activitySalt;
    
    // Public inputs
    signal input currentTimestamp;
    signal input minMonths;
    signal input minTransactions;
    signal input activityCommitment;
    signal input userId;
    
    // Output
    signal output valid;
    
    // Verify commitment
    component hasher = Poseidon(3);
    hasher.inputs[0] <== firstActivityTimestamp;
    hasher.inputs[1] <== totalTransactions;
    hasher.inputs[2] <== activitySalt;
    activityCommitment === hasher.out;
    
    // Calculate months active (approximate: seconds / (30 * 24 * 3600))
    signal timeActive <== currentTimestamp - firstActivityTimestamp;
    signal monthsActive <== timeActive \ 2592000; // 30 days in seconds
    
    // Check months >= minMonths
    component gteMonths = GreaterEqThan(32);
    gteMonths.in[0] <== monthsActive;
    gteMonths.in[1] <== minMonths;
    gteMonths.out === 1;
    
    // Check transactions >= minTransactions
    component gteTxs = GreaterEqThan(32);
    gteTxs.in[0] <== totalTransactions;
    gteTxs.in[1] <== minTransactions;
    gteTxs.out === 1;
    
    // Sanity checks
    component validTime = LessThan(64);
    validTime.in[0] <== firstActivityTimestamp;
    validTime.in[1] <== currentTimestamp;
    validTime.out === 1;
    
    valid <== 1;
}

component main {public [currentTimestamp, minMonths, minTransactions, activityCommitment, userId]} = ActivityLongevity();
