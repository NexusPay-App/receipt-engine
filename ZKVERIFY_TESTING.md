# zkVerify Testing Guide

This document provides instructions for testing the zkVerify integration in the receipt-engine.

## Prerequisites

- Node.js 16+ installed
- PostgreSQL database
- zkVerify testnet credentials (or mock mode enabled)

## Setup

1. **Configure Environment**

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
# zkVerify Configuration (Testnet)
ZKVERIFY_ENABLED=false  # Set to 'true' for real zkVerify testing
ZKVERIFY_NODE_URL=https://api.zkverify.io
ZKVERIFY_API_KEY=your_testnet_api_key
ZKVERIFY_NETWORK=testnet
ZKVERIFY_TIMEOUT_MS=30000
```

2. **Install Dependencies**

```bash
npm install
npm install --save-dev @types/jest jest ts-jest
```

3. **Run Database Migration**

```bash
npx prisma migrate dev --name add_zkverify_fields
npx prisma generate
```

## Running Tests

### Unit Tests

Test zkVerify service in isolation:

```bash
npm test -- zkverify.test.ts
```

### Integration Tests

Test full proof generation and verification flow:

```bash
npm test -- zkverify-integration.test.ts
```

### All Tests

Run complete test suite:

```bash
npm test
```

## Manual Testing

### 1. Generate a Credit Score Range Proof

```bash
curl -X POST http://localhost:3001/api/v1/proofs/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "userId": "user123",
    "proofType": "THRESHOLD",
    "claimType": "credit_score_range",
    "parameters": {
      "minScore": 600,
      "maxScore": 750
    }
  }'
```

Response should include:
- `proofId`
- `verificationId` (if zkVerify is enabled)
- `verificationStatus` (pending/verified/failed)

### 2. Check zkVerify Proof Status

```bash
curl -X GET http://localhost:3001/api/v1/proofs/status/YOUR_VERIFICATION_ID \
  -H "Authorization: Bearer YOUR_JWT"
```

### 3. View Proof Metrics

```bash
curl -X GET http://localhost:3001/api/v1/metrics/proof-volume?startDate=2026-01-01&endDate=2026-12-31
```

### 4. Get Milestone Report

```bash
curl -X GET http://localhost:3001/api/v1/metrics/milestone-report?milestone=2
```

## Testing Proof Types

### Credit Score Range
Proves score is between min and max without revealing exact score.

```json
{
  "claimType": "credit_score_range",
  "parameters": { "minScore": 600, "maxScore": 750 }
}
```

### Repayment History
Proves no late payments in last N months.

```json
{
  "claimType": "repayment_history",
  "parameters": { "months": 6 }
}
```

### Activity Longevity
Proves account active for >= M months with >= K transactions.

```json
{
  "claimType": "activity_longevity",
  "parameters": { "minMonths": 6, "minTransactions": 50 }
}
```

### Volume Threshold
Proves cumulative transaction volume >= threshold.

```json
{
  "claimType": "volume_threshold",
  "parameters": { "minVolume": 10000 }
}
```

## Mock Mode Testing

When `ZKVERIFY_ENABLED=false`, the system operates in mock mode:

- Proof submissions return mock `verificationId`
- Status checks return `verified` immediately
- No actual network calls to zkVerify
- Useful for development and CI/CD

## Background Polling

The poller runs every 60 seconds to update pending proof statuses:

**Check Poller Status:**

```bash
curl -X GET http://localhost:3001/api/v1/admin/zkverify/poller-status
```

**Trigger Manual Poll:**

```bash
curl -X POST http://localhost:3001/api/v1/admin/zkverify/poll-now \
  -H "Authorization: Bearer ADMIN_JWT"
```

## Troubleshooting

### Proof Generation Fails

- Check that circuits are compiled (`npm run compile-circuits`)
- Verify database connection
- Check logs for detailed error messages

### zkVerify Submission Fails

- Verify `ZKVERIFY_API_KEY` is set
- Check network connectivity to zkVerify testnet
- Review zkVerify API rate limits

### Poller Not Updating Statuses

- Confirm `ZKVERIFY_ENABLED=true`
- Check poller is running in application logs
- Verify proofs have `verificationId` set

## Next Steps

1. Compile Circom circuits for production
2. Generate and deploy verification keys
3. Configure zkVerify mainnet credentials
4. Set up monitoring and alerting for proof submission failures
5. Implement retry logic for failed submissions
