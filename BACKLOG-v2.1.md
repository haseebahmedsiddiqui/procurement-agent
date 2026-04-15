# Procurement Agent v2.1 Backlog

Items for the next iteration, prioritized by impact.

## High Priority

- [ ] **DNS rebinding protection**: Runtime DNS resolution check before HTTP fetch to prevent SSRF via DNS rebinding (current SSRF check validates hostname string only, not resolved IP)
- [ ] **Persistent metrics**: Move in-memory vendor metrics + AI cost tracking to MongoDB so they survive server restarts
- [ ] **User authentication**: Add login/sessions for multi-user access (currently single-operator assumed)
- [ ] **Playwright stealth plugin**: Integrate `playwright-extra` + stealth plugin for McMaster and other aggressive anti-bot vendors
- [ ] **Auto-retry failed vendors**: When a circuit breaker closes (half_open probe succeeds), automatically re-search items that were skipped during the open period

## Medium Priority

- [ ] **Webhook notifications**: Send alerts (Slack, email) when a circuit breaker opens or a vendor goes degraded
- [ ] **Scheduled RFQ processing**: Cron-based re-run of recent RFQs to track price changes over time
- [ ] **Price history charts**: Per-item price trend visualization using stored Price collection data
- [ ] **Bulk vendor import**: Import vendor configs from JSON/CSV for fleet-wide deployment
- [ ] **Export templates**: Custom Excel export templates (company logo, column order, etc.)
- [ ] **Rate limit dashboard**: Show per-vendor rate limit status and queue depth in the health dashboard

## Low Priority / Nice-to-Have

- [ ] **Multi-currency support**: Handle EUR, GBP alongside USD with exchange rate conversion
- [ ] **Mobile-optimized UI**: Full responsive design for tablet use during inspections
- [ ] **Vendor reliability scoring**: Auto-computed vendor trust score based on historical success rate, price consistency, and delivery accuracy
- [ ] **OCR support**: Parse scanned/PDF RFQs using Claude vision instead of Excel-only
- [ ] **Dictionary suggestions**: When a search finds a confirmed match, auto-suggest adding it to the dictionary
- [ ] **Playwright recording**: Record vendor scrape sessions for debugging failed adapters

## Tech Debt

- [ ] **E2E tests**: Add Playwright-based E2E tests for the full UI flow (upload → search → export)
- [ ] **MSW mocks**: Add Mock Service Worker for vendor API testing in CI without real network
- [ ] **Type-safe API routes**: Move to tRPC or similar for type-safe client-server communication
- [ ] **MongoDB transactions**: Use transactions for multi-document operations (confirm match → update dictionary + price)
- [ ] **Error boundaries**: Add React error boundaries around each page section for graceful degradation
