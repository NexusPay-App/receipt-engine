# Receipt Engine Deployment Guide

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Thirdweb account
- Web3.Storage account (for IPFS)
- Base Sepolia testnet ETH (for deployment)

### 1. Clone and Install

```bash
cd /path/to/receipt-engine
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Generate encryption key
openssl rand -hex 64

# Generate JWT secret
openssl rand -hex 32
```

### 3. Setup Database

```bash
# Create database
createdb receipt_engine

# Run migrations
npx prisma generate
npx prisma migrate deploy
```

### 4. Deploy Smart Contracts

```bash
# Install Thirdweb CLI
npm install -g thirdweb

# Deploy Receipt NFT Contract
npx thirdweb deploy contracts/DynamicReceiptNFT.sol \
  --network base-sepolia \
  --name "NexusPay Receipt NFT" \
  --symbol "RECEIPT"
```

Copy the deployed contract address to `.env` as `RECEIPT_NFT_CONTRACT`.

### 5. Deploy Smart Wallet Factory

Via Thirdweb Dashboard:
1. Go to https://thirdweb.com/dashboard
2. Navigate to Contracts → Deploy
3. Select "Account Factory"
4. Deploy to Base Sepolia
5. Copy factory address to `.env` as `THIRDWEB_SMART_WALLET_FACTORY`

### 6. Start Services

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### 7. Verify Deployment

```bash
curl http://localhost:3001/api/v1/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "version": "v1"
  }
}
```

## 🐳 Docker Deployment

### Build Image

```bash
docker build -t nexuspay-receipt-engine:latest .
```

### Run Container

```bash
docker run -d \
  --name receipt-engine \
  -p 3001:3001 \
  --env-file .env \
  -e DATABASE_URL=postgresql://user:pass@host:5432/receipt_engine \
  -e REDIS_URL=redis://redis:6379 \
  nexuspay-receipt-engine:latest
```

### Docker Compose

```bash
docker-compose up -d
```

## ☸️ Kubernetes Deployment

### 1. Create Namespace

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: receipt-engine
```

```bash
kubectl apply -f k8s/namespace.yaml
```

### 2. Create Secrets

```bash
kubectl create secret generic receipt-engine-secrets \
  --from-env-file=.env \
  -n receipt-engine
```

### 3. Deploy Application

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: receipt-engine
  namespace: receipt-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: receipt-engine
  template:
    metadata:
      labels:
        app: receipt-engine
    spec:
      containers:
      - name: receipt-engine
        image: nexuspay-receipt-engine:latest
        ports:
        - containerPort: 3001
        envFrom:
        - secretRef:
            name: receipt-engine-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/health
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: receipt-engine
  namespace: receipt-engine
spec:
  selector:
    app: receipt-engine
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3001
  type: LoadBalancer
```

```bash
kubectl apply -f k8s/deployment.yaml
```

## 🌐 Production Checklist

### Security

- [ ] Change all default secrets
- [ ] Enable HTTPS/TLS
- [ ] Configure CORS properly
- [ ] Set up firewall rules
- [ ] Enable rate limiting
- [ ] Implement API key rotation
- [ ] Set up DDoS protection
- [ ] Configure security headers (Helmet)
- [ ] Enable audit logging
- [ ] Set up intrusion detection

### Performance

- [ ] Configure Redis caching
- [ ] Set up database connection pooling
- [ ] Enable compression (gzip)
- [ ] Configure CDN for static assets
- [ ] Optimize database queries
- [ ] Set up horizontal scaling
- [ ] Configure load balancing
- [ ] Enable database replication
- [ ] Set up read replicas

### Monitoring

- [ ] Set up error tracking (Sentry)
- [ ] Configure logging (ELK/Datadog)
- [ ] Set up uptime monitoring
- [ ] Configure alerting (PagerDuty/Slack)
- [ ] Enable metrics collection
- [ ] Set up APM (Application Performance Monitoring)
- [ ] Configure blockchain monitoring
- [ ] Set up queue monitoring (BullMQ Board)

### Backup & Recovery

- [ ] Configure database backups
- [ ] Set up automated snapshots
- [ ] Test restore procedures
- [ ] Document recovery steps
- [ ] Configure IPFS pinning service
- [ ] Set up disaster recovery plan
- [ ] Enable point-in-time recovery

### Compliance

- [ ] Document data handling
- [ ] Set up data retention policies
- [ ] Configure GDPR compliance
- [ ] Enable audit trails
- [ ] Document security practices
- [ ] Set up compliance reporting
- [ ] Configure data encryption

## 📊 Monitoring & Logs

### View Logs

```bash
# Application logs
tail -f logs/combined.log

# Error logs
tail -f logs/error.log

# Docker logs
docker logs -f receipt-engine

# Kubernetes logs
kubectl logs -f deployment/receipt-engine -n receipt-engine
```

### Monitor Queue

```bash
# Redis CLI
redis-cli

# Check queue length
> LLEN receipt-engine:transaction-ingestion

# View queue jobs
> LRANGE receipt-engine:transaction-ingestion 0 10
```

### Database Monitoring

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Long running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY duration DESC;

-- Database size
SELECT pg_size_pretty(pg_database_size('receipt_engine'));
```

## 🔧 Troubleshooting

### Issue: Receipts Not Minting

**Symptoms:** Transactions ingested but no NFTs minted

**Check:**
1. Thirdweb credentials valid
2. Smart contract deployed and address correct
3. Wallet has gas (if not gasless)
4. Queue processing

```bash
# Check queue
redis-cli LLEN receipt-engine:transaction-ingestion

# Check logs
tail -f logs/error.log | grep -i "mint"

# Test Thirdweb connection
curl -X POST http://localhost:3001/api/v1/health
```

### Issue: High Memory Usage

**Solution:**

```bash
# Adjust Node.js memory limit
NODE_OPTIONS="--max-old-space-size=2048" npm start

# Or in Dockerfile
ENV NODE_OPTIONS="--max-old-space-size=2048"
```

### Issue: Database Connection Errors

**Solution:**

```bash
# Check PostgreSQL status
systemctl status postgresql

# Check connections
psql -U user -d receipt_engine -c "SELECT count(*) FROM pg_stat_activity;"

# Increase connection pool
# In .env:
DATABASE_URL="postgresql://user:pass@host:5432/receipt_engine?connection_limit=50"
```

### Issue: Redis Connection Timeout

**Solution:**

```bash
# Check Redis
redis-cli ping

# Restart Redis
systemctl restart redis

# Check Redis config
redis-cli CONFIG GET timeout
```

## 🔄 Updates & Migrations

### Update Application

```bash
# Pull latest code
git pull origin main

# Install dependencies
npm install

# Build
npm run build

# Run migrations
npx prisma migrate deploy

# Restart
pm2 restart receipt-engine
```

### Database Migrations

```bash
# Create migration
npx prisma migrate dev --name add_new_field

# Apply migrations
npx prisma migrate deploy

# Reset database (WARNING: deletes all data)
npx prisma migrate reset
```

### Rollback

```bash
# Revert to previous version
git checkout v1.0.0

# Rollback database
# (restore from backup)
psql receipt_engine < backup.sql

# Restart
pm2 restart receipt-engine
```

## 📈 Scaling

### Horizontal Scaling

Add more instances:

```bash
# Docker Compose
docker-compose up --scale receipt-engine=3

# Kubernetes
kubectl scale deployment receipt-engine --replicas=5 -n receipt-engine
```

### Database Scaling

Set up read replicas:

```sql
-- On primary
CREATE PUBLICATION receipt_engine_pub FOR ALL TABLES;

-- On replica
CREATE SUBSCRIPTION receipt_engine_sub 
CONNECTION 'host=primary port=5432 dbname=receipt_engine' 
PUBLICATION receipt_engine_pub;
```

## 🛡️ Security Hardening

### Enable Firewall

```bash
# Allow only necessary ports
ufw allow 3001/tcp
ufw enable
```

### SSL/TLS

Use nginx reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name receipts.nexuspay.com;
    
    ssl_certificate /etc/letsencrypt/live/receipts.nexuspay.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/receipts.nexuspay.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Rate Limiting

Configure in `.env`:

```bash
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
```

## 📞 Support

For issues:
- Check logs: `logs/error.log`
- Review health endpoint: `/api/v1/health`
- Monitor queue: `redis-cli`
- Check database: `psql receipt_engine`
- Review blockchain transactions: Thirdweb Dashboard

## 🎉 Production Ready!

Your Receipt Engine is now deployed and ready to mint dynamic NFT receipts for every transaction!

