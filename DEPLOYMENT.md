# Deployment Guide

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20+ |
| pnpm | 10+ |
| Docker & Docker Compose | Latest stable |
| Turborepo | Installed via devDependencies |

---

## Local Deployment

### Step by step

```bash
# 1. Clone and enter the repo
git clone <repo-url> && cd lead-scraping

# 2. Copy env file and fill in API keys
cp .env.example .env

# 3. Start infrastructure (Postgres 16 with pgvector + Redis 7)
docker compose up -d

# 4. Install all dependencies
pnpm install

# 5. Generate Prisma client
pnpm --filter @hyperscale/database run generate

# 6. Run database migrations
pnpm db:migrate

# 7. Seed the database (source configs, budgets, initial keywords)
pnpm db:seed

# 8. Start all dev servers
pnpm dev
```

After `pnpm dev` completes startup:
- **API**: http://localhost:4000
- **Dashboard**: http://localhost:3000

### One-command local deploy

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh local
```

This runs all 8 steps above in sequence, including Prisma generation, seeding, and a health check.

---

## Production Deployment

### Option A: Fly.io

```bash
# Create apps
fly apps create hyperscale-api
fly apps create hyperscale-dashboard

# Provision managed Postgres + Redis
fly postgres create --name hyperscale-db
fly redis create --name hyperscale-redis

# Attach database
fly postgres attach hyperscale-db --app hyperscale-api

# Import secrets from Doppler
doppler secrets download --no-file | fly secrets import --app hyperscale-api
doppler secrets download --no-file | fly secrets import --app hyperscale-dashboard

# Deploy
fly deploy --app hyperscale-api
fly deploy --app hyperscale-dashboard

# Run migrations in production
fly ssh console --app hyperscale-api -C "npx prisma migrate deploy"

# Bootstrap campaigns
curl -X POST https://hyperscale-api.fly.dev/api/campaigns/bootstrap/FACEBOOK_ADS
curl -X POST https://hyperscale-api.fly.dev/api/campaigns/bootstrap/INSTAGRAM
curl -X POST https://hyperscale-api.fly.dev/api/campaigns/bootstrap/LINKEDIN
```

### Option B: Railway

```bash
# Link project
railway init

# Add Postgres + Redis plugins via Railway dashboard

# Set env vars
railway variables set $(doppler secrets download --no-file --format=shell)

# Deploy
railway up
```

### One-command production deploy

```bash
./scripts/deploy.sh prod
```

This runs the full 9-step production deployment sequence (apps, database, migrations, secrets, campaigns, health check, notification).

---

## Secret Management

| Environment | Tool | Notes |
|-------------|------|-------|
| Local | `.env` file | Copy from `.env.example`, never commit |
| Production | Doppler | Single source of truth, synced to Fly/Railway |
| CI | Doppler service tokens | Injected as env vars in CI pipeline |

---

## Environment Variables Reference

### Database & Infrastructure

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/hyperscale_leads` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### AI / LLM

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key (used by Paperclip CMO) | Yes |
| `EXA_API_KEY` | Exa web search API key | Yes |

### Enrichment Sources

| Variable | Description |
|----------|-------------|
| `APOLLO_API_KEY` | Apollo.io API key (Tier 1 enrichment) |
| `LUSHA_API_KEY` | Lusha API key (Tier 2 enrichment) |
| `GETPROSPECT_API_KEY` | GetProspect API key (Tier 3 enrichment) |
| `SNOVIO_API_KEY` | Snov.io API key (Tier 4 enrichment) |

### Email Verification

| Variable | Description |
|----------|-------------|
| `NEVERBOUNCE_API_KEY` | NeverBounce API key (primary validator) |
| `BOUNCEBAN_API_KEY` | BounceBan API key (catch-all email verification) |

### Outreach

| Variable | Description |
|----------|-------------|
| `INSTANTLY_API_KEY` | Instantly.ai API key for campaign management |

### Scraping / Automation

| Variable | Description |
|----------|-------------|
| `FB_AD_LIBRARY_TOKEN` | Facebook Ad Library API token |
| `APIFY_TOKEN` | Apify platform token (Tier 2 scraping) |
| `PHANTOMBUSTER_API_KEY` | PhantomBuster API key (LinkedIn Tier 2) |
| `PHANTOMBUSTER_LI_SEARCH_AGENT_ID` | PhantomBuster LinkedIn search agent ID |
| `PHANTOMBUSTER_LI_PROFILE_AGENT_ID` | PhantomBuster LinkedIn profile agent ID |

### Proxy

| Variable | Description |
|----------|-------------|
| `BRIGHTDATA_USERNAME` | BrightData proxy username |
| `BRIGHTDATA_PASSWORD` | BrightData proxy password |

### Telephony

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID (for session 2FA) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number for SMS/voice |

### Paperclip CMO

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_API_KEY` | Reserved for future Paperclip platform integration |

### Slack Webhooks

| Variable | Description |
|----------|-------------|
| `SLACK_WEBHOOK_ALERTS` | General alerts channel |
| `SLACK_WEBHOOK_REPLIES` | Hot lead / positive reply notifications |
| `SLACK_WEBHOOK_DAILY` | Daily digest from Paperclip |
| `SLACK_WEBHOOK_STRATEGY` | Weekly strategy report |
| `SLACK_WEBHOOK_ESCALATIONS` | Items Paperclip cannot handle autonomously |

### Security

| Variable | Description |
|----------|-------------|
| `SESSION_ENCRYPTION_KEY` | AES key for encrypting session credentials in DB |
| `ADMIN_EMAIL` | Admin email for dashboard login |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of admin password |

---

## Health Checks

### Basic Liveness

```
GET /api/health
```

Returns database and Redis connectivity status:

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

Possible `status` values: `"healthy"` or `"degraded"`.

### Full System Health

```
GET /api/health/overview
```

Returns traffic-light indicators for pipeline, budget, sources, and Paperclip, plus today's lead numbers.

### Source Health

```
GET /api/health/sources
```

Returns per-source health metrics (error rate, leads per run, tier status).

---

## Database Management

### Running Migrations

```bash
# Development (creates migration files)
pnpm db:migrate

# Production (applies pending migrations)
pnpm --filter @hyperscale/database run migrate:prod

# Or via Fly.io SSH
fly ssh console -C "npx prisma migrate deploy"
```

### Seeding Data

```bash
# Seed source configs, budgets, default campaigns
pnpm db:seed

# Seed keywords from curated list
pnpm tsx scripts/seed-keywords.ts
```

### Prisma Studio

```bash
pnpm --filter @hyperscale/database run studio
```

Opens a web UI at http://localhost:5555 for browsing and editing data.

### Backups

For production Postgres on Fly.io:

```bash
# Create a snapshot
fly postgres backup create --app hyperscale-db

# List backups
fly postgres backup list --app hyperscale-db

# Restore from backup
fly postgres backup restore <backup-id> --app hyperscale-db
```

For local development, use `pg_dump`:

```bash
pg_dump -h localhost -U postgres hyperscale_leads > backup.sql
psql -h localhost -U postgres hyperscale_leads < backup.sql
```

---

## Scaling Considerations

### Worker Concurrency

BullMQ worker concurrency is configured per queue in `apps/api/src/queues/queue.module.ts`. Key queues:

| Queue | Default Concurrency | Notes |
|-------|---------------------|-------|
| `enrich` | 5 | Rate-limited by enrichment provider APIs |
| `score` | 10 | CPU-bound LLM calls |
| `validate` | 10 | External API calls (NeverBounce, BounceBan) |
| `personalize` | 5 | LLM-heavy, most expensive step |
| `upload` | 3 | Instantly API rate limits |

Increase concurrency by setting `WORKER_CONCURRENCY_<QUEUE>` env vars or editing the queue module.

### Redis Memory

- Default: 256MB (sufficient for ~50k queued jobs)
- Monitor with `redis-cli INFO memory`
- For production, allocate at least 512MB
- Enable `maxmemory-policy allkeys-lru` if memory pressure occurs

### Postgres Connection Pooling

- Prisma defaults to 5 connections per worker
- For production with multiple API replicas, use PgBouncer or Fly's built-in connection pooler
- Set `?pgbouncer=true&connection_limit=10` on `DATABASE_URL` when using PgBouncer

### Horizontal Scaling

- **API**: Stateless — scale to N replicas behind a load balancer
- **Workers**: Each replica picks up BullMQ jobs independently; safe to scale
- **Dashboard**: Stateless Next.js — scale as needed
- **Scraper**: Scale cautiously (session pool and proxy costs are the constraint)
