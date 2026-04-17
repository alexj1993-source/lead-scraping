# Hyperscale Leads

Hyperscale Leads is an autonomous lead generation system that produces 500+ qualified leads per day from Facebook Ads, Instagram, and LinkedIn sources. Every lead passes through a multi-stage pipeline — enrichment, ICP scoring, deduplication, email validation, and AI-powered personalization — before being uploaded to outreach campaigns. An AI operator called **Paperclip CMO** monitors the entire system around the clock, triaging alerts, optimizing keywords, managing budgets, and escalating only when human judgment is truly required. A real-time Next.js dashboard gives you full visibility and control from any device.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                            SOURCES (3-tier per channel)                        │
│                                                                                │
│   Facebook Ads          Instagram           LinkedIn                           │
│   ┌──────────┐         ┌──────────┐        ┌──────────┐                        │
│   │T1: FB API│         │T1: Apify │        │T1: Phantom│                       │
│   │T2: Apify │         │T2: Bright│        │T2: Bright │                       │
│   │T3: Playwright      │T3: Playwright     │T3: Playwright                     │
│   └────┬─────┘         └────┬─────┘        └────┬─────┘                        │
└────────┼────────────────────┼───────────────────┼──────────────────────────────┘
         │                    │                   │
         └────────────┬───────┴───────────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     PIPELINE  (BullMQ queues)                        │
│                                                                      │
│  RAW → Enrich → Score → Dedup → Validate → Personalize → Upload     │
│         │         │                           │                      │
│         │     Exa verify                  Exa context                │
│         │     (borderline)                (for copy)                 │
│         ▼                                                            │
│  Waterfall: Apollo → Lusha → GetProspect → Snov.io → Exa fallback   │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        ┌──────────┐ ┌──────────┐   ┌─────────────┐
        │ Instantly │ │ Paperclip│   │  Dashboard   │
        │ Campaigns │ │   CMO    │   │  (Next.js)   │
        └──────────┘ └──────────┘   └─────────────┘
              │            │                │
              ▼            ▼                ▼
         Reply sync   Autonomous       Real-time
         + classify   operations       health view
```

---

## Quick Start (5 minutes)

```bash
# 1. Clone the repo
git clone <repo-url> && cd lead-scraping

# 2. Copy environment file and fill in API keys
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY and one enrichment key

# 3. Start Postgres (pgvector) + Redis
docker compose up -d

# 4. Install dependencies
pnpm install

# 5. Run migrations and seed
pnpm db:migrate && pnpm db:seed

# 6. Start dev servers (API on :4000, Dashboard on :3000)
pnpm dev
```

### Phase 0 Quickstart

Before enabling scrapers, validate the pipeline end-to-end with existing leads:

```bash
pnpm run phase0:import --file=./existing-leads.csv
```

This imports your CSV, runs every lead through the full pipeline (enrich → score → dedup → validate → personalize → upload), and generates a quality report at `PHASE_0_REPORT.md`. See [PHASE_0_REPORT.md](./PHASE_0_REPORT.md) for the report template.

---

## Project Structure

```
lead-scraping/
├── apps/
│   ├── api/               NestJS backend (REST + BullMQ workers)
│   │   └── src/
│   │       ├── leads/          Lead CRUD + pipeline entry
│   │       ├── enrichment/     Waterfall enrichment processor
│   │       ├── scoring/        ICP scoring with Exa verification
│   │       ├── dedup/          Fuzzy + exact deduplication
│   │       ├── validation/     NeverBounce + BounceBan
│   │       ├── personalization/ AI copy generation
│   │       ├── upload/         Instantly campaign upload
│   │       ├── reply/          Reply sync + classification
│   │       ├── keyword/        Keyword management + scoring
│   │       ├── source/         Source config + tier switching
│   │       ├── campaign/       Instantly campaign management
│   │       ├── session/        Scraper session management
│   │       ├── budget/         Budget tracking + caps
│   │       ├── alert/          Alert creation + dispatch
│   │       ├── stats/          Daily stats rollup
│   │       ├── health/         Health endpoints
│   │       ├── query/          Natural language query API
│   │       ├── paperclip-api/  Paperclip action log REST API
│   │       ├── remediation/    Auto-remediation module
│   │       ├── orchestrator/   Cron scheduler for all cycles
│   │       └── queues/         BullMQ queue registration
│   ├── dashboard/         Next.js 15 dashboard (App Router)
│   │   └── src/
│   │       ├── app/            Routes: /, /leads, /paperclip, /sources, etc.
│   │       ├── components/     QueryBar, CommandPalette, Sidebar, UI kit
│   │       └── lib/            API client
│   └── scraper/           Playwright-based Tier 3 scraper workers
├── packages/
│   ├── adapters/          Source adapters (Facebook, Instagram, LinkedIn)
│   ├── config/            ICP criteria, budgets, banned phrases, tier thresholds
│   ├── database/          Prisma schema, migrations, seed
│   ├── exa/               Exa web search client + cache + budget
│   ├── paperclip/         Paperclip CMO AI agent (cycles, authority, actions)
│   ├── remediation/       Auto-remediation engine + strategies
│   ├── sessions/          Session vault, health checks, TOTP, reauth
│   └── types/             Shared TypeScript types
├── scripts/
│   ├── deploy.sh          One-command deployment (local or prod)
│   ├── phase0-import.ts   Phase 0 pipeline validation script
│   ├── seed-keywords.ts   Keyword seeding script
│   └── sample-leads.csv   Sample data for testing
├── docker-compose.yml     Postgres (pgvector) + Redis
├── turbo.json             Turborepo pipeline config
└── pnpm-workspace.yaml    Monorepo workspace definition
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces + Turborepo |
| Backend | NestJS 11, BullMQ 5, Prisma 6 |
| Frontend | Next.js 15, React 19, TanStack Query, Tailwind CSS 4 |
| Database | PostgreSQL 16 (pgvector, pg_trgm) |
| Queue | Redis 7 + BullMQ |
| AI | Anthropic Claude (via Paperclip CMO), Exa web search |
| Scraping | Playwright, Apify, PhantomBuster, BrightData proxies |
| Enrichment | Apollo, Lusha, GetProspect, Snov.io (waterfall) |
| Validation | NeverBounce + BounceBan (dual, catch-all verification) |
| Outreach | Instantly |
| Telephony | Twilio (for session 2FA) |

---

## Key Design Principles

1. **Phase 0 first** — Validate the entire pipeline with existing leads before turning on scrapers. Never ship a pipeline you haven't proven end-to-end.
2. **Managed services over in-house** — Prefer Tier 1 APIs (Apollo, Apify) and Tier 2 managed scraping (BrightData) over Tier 3 in-house Playwright. Fall back gracefully.
3. **Auto-remediate before alerting** — The remediation engine attempts automated fixes (retry, tier switch, reauth) before escalating to a human.
4. **Paperclip owns operations** — The AI operator handles alert triage, keyword optimization, DLQ processing, and budget monitoring autonomously. Humans handle strategy and replies.
5. **Every lead has a terminal state** — A lead always reaches one of: `UPLOADED`, `SCORED_FAIL`, `DEDUPED_DUPLICATE`, `VALIDATED_INVALID`, `ESCALATED`, or `ERROR`. Nothing gets lost.

---

## Documentation

| Document | Description |
|----------|-------------|
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Local and production deployment, env vars, scaling |
| [RUNBOOK.md](./RUNBOOK.md) | Operational runbook for alerts, incidents, and maintenance |
| [PAPERCLIP_GUIDE.md](./PAPERCLIP_GUIDE.md) | Paperclip CMO authority matrix, overrides, troubleshooting |
| [DASHBOARD_GUIDE.md](./DASHBOARD_GUIDE.md) | Dashboard walkthrough, page-by-page guide, shortcuts |
| [PHASE_0_REPORT.md](./PHASE_0_REPORT.md) | Phase 0 quality report template |

---

## License

Proprietary. All rights reserved.
