pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Credit Score Range Proof
 * Proves: User's credit score is within a specified range [minScore, maxScore]
 * Without revealing the exact score
 * 
 * Private inputs:
 * - actualScore: User's actual credit score (0-850)
 * - scoreSalt: Random salt for commitment
 * 
 * Public inputs:
 * - minScore: Minimum score threshold
 * - maxScore: Maximum score threshold
 * - scoreCommitment: Poseidon(actualScore, scoreSalt)
 * - userId: User identifier hash
 */

template CreditScoreRange() {
    // Private inputs
    signal input actualScore;
    signal input scoreSalt;
    
    // Public inputs
    signal input minScore;
    signal input maxScore;
    signal input scoreCommitment;
    signal input userId;
    
    // Output
    signal output valid;
    
    // Verify commitment
    component hasher = Poseidon(2);
    hasher.inputs[0] <== actualScore;
    hasher.inputs[1] <== scoreSalt;
    scoreCommitment === hasher.out;
    
    // Check actualScore >= minScore
    component gte = GreaterEqThan(16);
    gte.in[0] <== actualScore;
    gte.in[1] <== minScore;
    gte.out === 1;
    
    // Check actualScore <= maxScore
    component lte = LessEqThan(16);
    lte.in[0] <== actualScore;
    lte.in[1] <== maxScore;
    lte.out === 1;
    
    // Check score is valid (0-850)
    component validMin = GreaterEqThan(16);
    validMin.in[0] <== actualScore;
    validMin.in[1] <== 0;
    validMin.out === 1;
    
    component validMax = LessEqThan(16);
    validMax.in[0] <== actualScore;
    validMax.in[1] <== 850;
    validMax.out === 1;
    
    valid <== 1;
}

component main {public [minScore, maxScore, scoreCommitment, userId]} = CreditScoreRange();
