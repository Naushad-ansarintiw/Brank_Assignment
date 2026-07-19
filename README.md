# Brank LLM Chat + Inference Logging

Lightweight multi-turn chatbot with an auto-instrumenting SDK that ships inference metadata to an ingestion service, stored in Postgres.

## Quick start (Docker Compose)

```bash
cp .env.example .env
# put your OpenAI key in .env
docker compose up --build
```

Open **http://localhost:8080**

Services:

| Service    | Port |
|------------|------|
| Web UI     | 8080 |
| Chat API   | 4000 |
| Ingestion  | 4001 |
| Postgres   | 5432 |

## Local development

Needs Node 22+, Docker (for Postgres only), and an API key.

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run build -w @brank/llm-logger

# terminal 1
export $(grep -v '^#' .env | xargs)
npm run dev:ingestion

# terminal 2
export $(grep -v '^#' .env | xargs)
npm run dev:server

# terminal 3
npm run dev:web
```

UI at http://localhost:5173

## Architecture overview

```
React UI  --REST/SSE-->  Chat Server  --OpenAI-compatible API-->  LLM Provider
                              |                                      ^
                              | store messages                       |
                              v                                      |
                           Postgres  <--- validated logs ---  Ingestion Service
                              ^                                      ^
                              |                                      |
                              +---- SDK fire-and-forget POST --------+
```

- **`sdk/`** (`@brank/llm-logger`): Proxy around `client.chat.completions.create`. Captures latency, tokens, status, previews, conversation id. Works for streaming and non-streaming. Never blocks the chat path.
- **`ingestion/`**: `POST /v1/logs` validates with Zod and inserts into `inference_logs`.
- **`server/`**: Conversations + messages API; streams assistant tokens over SSE; aborts upstream on client disconnect. Also serves `GET /api/stats` and `GET /api/logs` for the dashboard.
- **`web/`**: List / create / resume conversations, stream tokens, Stop button. **Dashboard** tab shows latency / throughput / errors and a recent inference log table.

## Multi-provider

Set in `.env`:

```bash
LLM_PROVIDER=openai   # openai | groq | deepseek
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
# GROQ_API_KEY=...
# DEEPSEEK_API_KEY=...
```

Providers use the OpenAI SDK with a different `baseURL`.

## Schema decisions

- **`conversations` / `messages`**: app data. Messages cascade-delete with their conversation.
- **`inference_logs`**: telemetry. `conversation_id` is a plain text field, **not a FK**, so ingestion still works if app rows are missing or delayed.
- Previews are truncated (~500 chars) in the SDK so we don't store full prompts/completions by default.
- Sliding window of the last **20** messages is sent to the model — simple and enough for a short demo context.

## Tradeoffs

| Choice | Why |
|--------|-----|
| Fire-and-forget logging | Chat latency stays independent of ingestion health |
| At-most-once delivery | One retry then drop; simpler than a durable outbox |
| Raw SQL + `pg` | Schema stays visible; no ORM overhead |
| OpenAI-compatible providers only | One client path, multi-provider with little code |
| No auth | Assignment scope; fine for a local demo |

## Dashboard

Open the **Dashboard** tab in the UI (or hit the APIs directly):

- `GET /api/stats?hours=24` — totals (requests, avg/p95 latency, errors, cancelled, tokens) plus hourly buckets for throughput
- `GET /api/logs?limit=50` — recent `inference_logs` rows

The page polls every 10s. Chart is a plain SVG bar chart (no chart library).

## What I'd improve with more time

- Richer date-range filters / search on the log table
- Redis/queue between ingestion and DB writers
- Basic PII redaction before previews leave the SDK
- Auth + multi-tenant isolation
- k8s manifests / Helm chart
- Batching + sampling under high QPS

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ingestion flow, failure handling, and scaling notes.
