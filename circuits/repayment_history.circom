pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Repayment History Proof
 * Proves: User has no defaults/late payments in last N months
 * 
 * Private inputs:
 * - latePayments[12]: Array of late payment counts per month (last 12 months)
 * - historySalt: Random salt for commitment
 * 
 * Public inputs:
 * - months: Number of months to check (e.g., 6 or 12)
 * - historyCommitment: Hash of repayment history
 * - userId: User identifier
 */

template RepaymentHistory() {
    // Private inputs
    signal input latePayments[12];
    signal input historySalt;
    
    // Public inputs
    signal input months;
    signal input historyCommitment;
    signal input userId;
    
    // Output
    signal output valid;
    
    // Verify commitment (hash first N months + salt)
    component hasher = Poseidon(13); // 12 months + 1 salt
    for (var i = 0; i < 12; i++) {
        hasher.inputs[i] <== latePayments[i];
    }
    hasher.inputs[12] <== historySalt;
    historyCommitment === hasher.out;
    
    // Check no late payments in first N months
    component checkers[12];
    signal accumulator[13];
    accumulator[0] <== 0;
    
    for (var i = 0; i < 12; i++) {
        checkers[i] = IsZero();
        checkers[i].in <== latePayments[i];
        
        // If i < months, must be zero (no late payments)
        // Otherwise, don't care
        component inRange = LessThan(8);
        inRange.in[0] <== i;
        inRange.in[1] <== months;
        
        // If in range and not zero, fail
        signal mustBeZero <== inRange.out;
        signal isZero <== checkers[i].out;
        signal product <== mustBeZero * (1 - isZero);
        accumulator[i + 1] <== accumulator[i] + product;
    }
    
    // All checked months must have zero late payments
    accumulator[12] === 0;
    
    valid <== 1;
}

component main {public [months, historyCommitment, userId]} = RepaymentHistory();
