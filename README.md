# LLM Observatory

A production-grade inference logging, ingestion, and monitoring system for LLM applications.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)               │
│  Chat UI · Conversation Manager · Dashboard / Metrics    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP + SSE (streaming)
┌────────────────────────▼────────────────────────────────┐
│                  Backend (Node.js / Express)             │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Chat API   │  │ Ingest API   │  │  Metrics API  │  │
│  │ /api/chat   │  │ /api/ingest  │  │ /api/metrics  │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │           │
│  ┌──────▼────────────────▼───────────────────▼──────┐   │
│  │              Event Bus (in-process)               │   │
│  │  emit() → persist to DB events table → notify    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │  PII Redactor    │  │  Metrics Aggregator          │  │
│  │  (regex-based)   │  │  (hourly upserts)            │  │
│  └──────────────────┘  └─────────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │ pg driver
┌────────────────────────▼────────────────────────────────┐
│                  PostgreSQL 16                           │
│  conversations · messages · inference_logs              │
│  events · metrics_hourly                                │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Docker Compose (one command)

```bash
git clone <repo>
cd llm-observatory
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build
```

App available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Health check: http://localhost:3001/health

### Local Development

**Prerequisites**: Node 20+, PostgreSQL 16

```bash
# Backend
cd backend
cp ../.env.example .env   # fill in values
npm install
npm run dev               # starts on :3001, auto-migrates schema

# Frontend (new terminal)
cd frontend
npm install
npm run dev               # starts on :5173
```

## Schema Design

### Core Tables

**`conversations`** — top-level session entity
- `status`: `active | cancelled | archived` — enables conversation lifecycle management
- `provider` + `model`: stored per conversation so history is accurate if you switch models
- `metadata JSONB`: open-ended field for future extensibility (tags, user IDs, etc.)

**`messages`** — individual chat turns
- `turn_index INTEGER`: explicit ordering, not reliant on timestamp ordering (avoids clock skew issues)
- `content_redacted TEXT` + `has_pii BOOLEAN`: dual storage — raw content for debugging, redacted for safe display
- Role enum: `user | assistant | system | tool` — future-proofs tool-use and system messages

**`inference_logs`** — one row per LLM API call
- Decoupled from `messages`: a single message may trigger multiple retried calls; one call may produce one message
- `latency_ms`, `time_to_first_token_ms`: both tracked for streaming — TTFT is the metric users feel
- `estimated_cost_microcents BIGINT`: integer storage avoids float precision issues; divide by 1M for USD
- `input_preview` / `output_preview`: truncated (200 chars), PII-redacted previews — never store full content in logs
- `is_streaming` + `stream_chunks`: separate streaming metadata for throughput analysis
- `raw_request` / `raw_response JSONB`: optional full payload storage (disable in prod if storage is a concern)

**`events`** — durable event log
- Append-only event sourcing table
- `processed BOOLEAN`: allows replaying or reprocessing events (e.g., backfilling metrics)
- `aggregate_id UUID` + `aggregate_type TEXT`: generic, works for any entity type

**`metrics_hourly`** — pre-aggregated metrics
- Composite primary key `(hour, provider, model)`: fast dashboard queries
- Updated via upsert on every inference event — no expensive realtime aggregation at query time
- Tradeoff: slight inaccuracy during the current hour vs expensive window functions on `inference_logs`

### Key Design Decisions

| Decision | Rationale |
|---|---|
| PostgreSQL over NoSQL | ACID guarantees for financial data (cost), JOIN support, JSONB for flexibility |
| Separate `inference_logs` from `messages` | One message can have N retried calls; cleaner separation of concerns |
| Integer microcents for cost | Avoids float arithmetic errors; `$0.000001` = 1 microcent |
| `turn_index` explicit ordering | Clock skew on distributed nodes breaks `ORDER BY created_at` |
| Dual content fields (raw + redacted) | Debugging needs raw; compliance/display needs redacted |
| `events` table as event bus | Durable, replayable — beats ephemeral pub/sub for audit trails |

## Ingestion Flow

```
SDK / Frontend
     │
     ▼ POST /api/ingest/log (or /api/chat/stream auto-logs)
Validation (Zod schema)
     │
     ▼
PII Redaction → generate safe input_preview / output_preview
     │
     ▼
INSERT into inference_logs (pending → success/error)
     │
     ▼
emit() → persist to events table + notify in-process subscribers
     │
     ├── Metrics Aggregator → UPSERT metrics_hourly
     └── (extensible: add more subscribers)
```

For streaming: a `pending` log row is created before the stream starts. It's updated to `success` with full token counts and latency once the stream completes. This ensures no logs are lost if the client disconnects mid-stream.

## Logging Strategy

- **Auto-logging**: The `/api/chat/stream` endpoint logs every inference automatically. No SDK instrumentation needed for the built-in chatbot.
- **SDK ingest**: External apps POST to `/api/ingest/log` or `/api/ingest/batch`. Validation rejects malformed payloads with descriptive errors.
- **Previews only**: Full prompt/completion text is never stored in logs — only 200-char redacted previews. Full text lives only in `messages.content`.
- **PII redaction**: Applied at ingestion time. Regex patterns cover email, phone, SSN, credit cards, IPs, API keys, JWTs. Production upgrade: replace with Presidio or AWS Comprehend.
- **Near-real-time**: Logs are written synchronously; event emission is fire-and-forget. P99 ingestion overhead is <5ms.

## Scaling Considerations

| Component | Current | Production Path |
|---|---|---|
| Event bus | In-process Map | Redis Pub/Sub or Kafka |
| DB pool | pg Pool (max 20) | PgBouncer connection pooler |
| Metrics agg | In-process subscriber | Dedicated worker process |
| Schema migration | On-startup idempotent | Flyway or db-migrate |
| PII redaction | Regex | NLP model (Presidio) |
| Log storage | Postgres | Partition `inference_logs` by month |
| Read replicas | None | Separate read replica for dashboard queries |

**PostgreSQL partitioning** for `inference_logs`: At ~1M rows/day, partition by month:
```sql
ALTER TABLE inference_logs PARTITION BY RANGE (created_at);
CREATE TABLE inference_logs_2025_06 PARTITION OF inference_logs
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
```

**Horizontal scaling**: The backend is stateless (all state in Postgres). Docker Compose scales with `docker compose up --scale backend=3`. Kubernetes HPA config is included.

## Failure Handling

| Failure | Behavior |
|---|---|
| DB down at startup | Server exits with error (fail fast) |
| DB error during ingest | 500 returned; log not written; event not emitted |
| Stream error mid-response | Log updated to `error` status; SSE error event sent to client |
| Event bus handler throws | Error logged; other handlers still run; event already persisted |
| Client disconnects mid-stream | AbortController fires; stream closed; log marked with partial data |
| Duplicate ingest | No deduplication currently (see improvements) |

## What I Would Improve With More Time

1. **Deduplication**: Add `idempotency_key` to `inference_logs` for safe retries
2. **Real event streaming**: Replace in-process EventEmitter with Redis Streams or Kafka for multi-instance deployments
3. **Richer PII redaction**: Integrate Microsoft Presidio (NLP-based, higher recall)
4. **Multi-provider support**: Add OpenAI, Gemini, DeepSeek adapters behind a common provider interface
5. **Latency percentile tracking**: Pre-compute p50/p95/p99 in `metrics_hourly` using reservoir sampling
6. **Alerting**: Webhook or Slack notification when error rate > threshold or latency spikes
7. **Auth**: JWT-based user auth; scope conversations and logs per user
8. **Log retention policies**: Auto-archive or delete old `inference_logs` (GDPR compliance)
9. **OpenTelemetry integration**: Export traces to Jaeger/Tempo for distributed tracing
10. **Grafana dashboard**: Connect to Postgres for richer time-series visualization
11. **Rate limiting**: Per-IP or per-key limits on the ingest endpoint
12. **Test suite**: Unit tests for PII redactor, Zod schemas; integration tests for ingest pipeline

## API Reference

### Chat
- `POST /api/chat/stream` — SSE streaming chat. Body: `{ conversation_id?, message, model? }`

### Conversations
- `GET /api/conversations` — list (query: `status`, `limit`, `offset`)
- `GET /api/conversations/:id` — get with messages
- `POST /api/conversations` — create
- `PATCH /api/conversations/:id/cancel` — cancel
- `POST /api/conversations/:id/messages` — save message

### Ingestion
- `POST /api/ingest/log` — ingest single inference log
- `POST /api/ingest/batch` — ingest up to 100 logs

### Metrics
- `GET /api/metrics/dashboard` — 24h stats, by-provider breakdown, latency time series
- `GET /api/metrics/hourly?hours=24` — raw hourly metrics

## Kubernetes Deployment

```bash
# Build and push images
docker build -t llm-observatory-backend:latest ./backend
docker build -t llm-observatory-frontend:latest ./frontend

# Apply manifests
kubectl apply -f k8s/manifests.yaml

# Set secret
kubectl create secret generic llm-secrets \
  -n llm-observatory \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=DATABASE_URL=postgresql://...
```

## License

MIT
