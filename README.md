# Procurement Agent v2.0

AI-powered maritime procurement price comparison platform. Upload an RFQ spreadsheet, auto-detect categories, search up to 9 vendor websites, and export a comparison Excel with best prices.

## Architecture

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API routes + Mongoose ODM
- **AI**: Claude API (Sonnet for reasoning, Haiku for extraction)
- **Scraping**: Playwright (Chromium) with stealth + plain HTTP fallback
- **Database**: MongoDB 7 + Redis 7 (job queue)
- **Testing**: Vitest 4

## Vendors (9 total)

| Category | Vendors |
|----------|---------|
| Stationery | Amazon, Staples, Office Depot, OfficeBasics |
| Deck & Engine | Grainger, McMaster-Carr |
| Galley & Kitchen | Webstaurant Store, Equippers |
| All Categories | Amazon (cross-category) |

### Vendor-Specific Notes

- **McMaster-Carr**: Most aggressive anti-bot. Always uses Playwright with stealth. Expect CAPTCHAs. Login helps reliability.
- **Amazon**: Multi-step login (email, password, OTP). Use Playwright path for authenticated sessions.
- **Grainger**: Blocks automated traffic occasionally. HTTP works most of the time; Playwright fallback handles blocks.
- **Staples**: May show block pages. Both HTTP and Playwright paths handle detection.
- **OfficeBasics**: Requires login for pricing. Playwright-only vendor.
- **Office Depot**: Occasionally redirects to bot-check pages. HTTP primary with Playwright fallback.
- **Webstaurant/Equippers**: Generally reliable via HTTP. Playwright fallback for edge cases.

## Quick Start

### Prerequisites

- Node.js 22+
- Docker & Docker Compose (for MongoDB + Redis)
- Anthropic API key

### Development

```bash
# Start MongoDB + Redis
docker compose up -d

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your ANTHROPIC_API_KEY and MONGODB_URI

# Seed the database (categories + vendors)
npm run seed

# Start dev server
npm run dev
```

Open http://localhost:3000

### Production (Docker)

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Build and start everything
docker compose -f docker-compose.prod.yml up --build -d
```

### Run Tests

```bash
npm test            # Run once
npm run test:watch  # Watch mode
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection for job queue |
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key for AI features |
| `BROWSER_MAX_CONTEXTS` | No | `3` | Max concurrent Playwright browser contexts |
| `VENDOR_MAX_CONCURRENCY` | No | `4` | Max concurrent vendor search runs |
| `NODE_ENV` | No | `development` | `production` disables debug logging |

## Project Structure

```
src/
  app/                    # Next.js App Router pages + API routes
    api/
      dictionary/         # Product dictionary CRUD
      export/             # Excel export
      history/            # RFQ history
      metrics/            # Vendor + AI cost metrics
      normalize/          # AI item normalization
      prices/             # Price lookup
      search/             # Multi-vendor search (streaming)
      upload/             # RFQ upload + parse
      vendors/            # Vendor CRUD + auth + health
    dictionary/           # Dictionary UI page
    history/              # History UI page
    settings/             # Settings + health dashboard
  components/             # React components
    rfq/                  # RFQ-specific (store picker, results table)
    ui/                   # shadcn/ui primitives
    vendors/              # Vendor cards, health dashboard
  lib/
    ai/                   # Claude API clients + cost tracker
    auth/                 # Browser pool, session store, login detectors
    db/                   # Mongoose models + seed data
    parsers/              # RFQ Excel parser
    security/             # URL validation (SSRF protection)
    vendors/              # Adapter registry, search engine, circuit breaker
      adapters/           # Per-vendor adapters (amazon, staples, etc.)
tests/                    # Vitest unit tests
scripts/                  # Utility scripts (backup, restore, seed)
```

## How to Add a New Vendor

1. **Add vendor to seed data** in `src/lib/db/seed/vendors.ts`:
   ```ts
   {
     name: "New Vendor",
     slug: "new-vendor",
     category: "stationery",  // or deck_engine, galley_kitchen
     baseUrl: "https://newvendor.com",
     searchUrlPattern: "https://newvendor.com/search?q={{query}}",
     preferredStrategy: "http",  // or "playwright"
     needsJsRendering: false,
     rateLimitMs: 2000,
     // ...
   }
   ```

2. **Create an adapter** in `src/lib/vendors/adapters/new-vendor.ts`:
   ```ts
   import { BaseVendorAdapter, type SearchInput } from "../base-adapter";

   export class NewVendorAdapter extends BaseVendorAdapter {
     protected async fetchHttp(input: SearchInput): Promise<string | null> {
       // HTTP fetch with vendor-specific headers/logic
     }
     protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
       // Playwright fetch with vendor-specific selectors
     }
   }
   ```

3. **Register the adapter** in `src/lib/vendors/registry.ts`:
   ```ts
   import { NewVendorAdapter } from "./adapters/new-vendor";
   // Add to the ADAPTER_MAP
   "new-vendor": NewVendorAdapter,
   ```

4. **Add login detector** (if auth required) in `src/lib/auth/login-detectors.ts`

5. **Run seed** to update the database: `npm run seed`

6. **Test**: the new vendor should appear in the store picker and Settings page.

Alternatively, users can add custom vendors through the Settings UI — these use the GenericAdapter (HTTP + LLM extraction, no custom logic needed).

## Backup & Restore

```bash
# Daily backup (MongoDB + dictionary + vendor config + sessions)
npm run backup

# Restore from a specific backup
npm run restore ./backups/20260409_020000
```

Backups are stored in `./backups/` with automatic pruning of backups older than 14 days.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload + parse RFQ Excel |
| POST | `/api/normalize` | AI-normalize items + generate search queries |
| POST | `/api/search` | Stream multi-vendor search results |
| POST | `/api/export` | Generate comparison Excel |
| GET | `/api/history` | List past RFQs |
| GET/DELETE | `/api/history/[id]` | Get/delete specific RFQ |
| GET | `/api/dictionary` | List product dictionary |
| POST | `/api/dictionary/confirm` | Confirm/reject match |
| DELETE | `/api/dictionary/[id]` | Delete dictionary entry |
| GET/POST | `/api/vendors` | List/create vendors |
| GET | `/api/vendors/health` | Circuit breaker statuses |
| POST | `/api/vendors/health` | Reset circuit breaker |
| GET | `/api/metrics` | Vendor metrics + AI costs |
| GET | `/api/prices` | Price cache lookup |
