pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * Volume Threshold Proof
 * Proves: Cumulative transaction volume >= threshold
 * 
 * Private inputs:
 * - cumulativeVolume: Total transaction volume
 * - volumeSalt: Random salt
 * 
 * Public inputs:
 * - minVolume: Minimum volume threshold
 * - volumeCommitment: Hash of volume data
 * - userId: User identifier
 */

template VolumeThreshold() {
    // Private inputs
    signal input cumulativeVolume;
    signal input volumeSalt;
    
    // Public inputs
    signal input minVolume;
    signal input volumeCommitment;
    signal input userId;
    
    // Output
    signal output valid;
    
    // Verify commitment
    component hasher = Poseidon(2);
    hasher.inputs[0] <== cumulativeVolume;
    hasher.inputs[1] <== volumeSalt;
    volumeCommitment === hasher.out;
    
    // Check volume >= minVolume
    component gte = GreaterEqThan(64);
    gte.in[0] <== cumulativeVolume;
    gte.in[1] <== minVolume;
    gte.out === 1;
    
    // Check volume is positive
    component gtZero = GreaterThan(64);
    gtZero.in[0] <== cumulativeVolume;
    gtZero.in[1] <== 0;
    gtZero.out === 1;
    
    valid <== 1;
}

component main {public [minVolume, volumeCommitment, userId]} = VolumeThreshold();
