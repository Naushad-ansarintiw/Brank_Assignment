# Architecture notes

## Ingestion flow

1. Chat server wraps the OpenAI client with `instrument(...)` from `@brank/llm-logger`, passing the ingestion URL and conversation id.
2. On each `chat.completions.create` call the SDK records `started_at`, model, provider, and an input preview.
3. After the call finishes (or the stream ends / errors / aborts), the SDK builds an `InferenceLog` and `POST`s it to `ingestion /v1/logs`.
4. Ingestion validates the payload (Zod), inserts into `inference_logs`, returns `201`.
5. Chat messages are written separately by the server into `messages` — logging is orthogonal to persistence of chat content.

```
create() called
   -> start timer / capture input preview
   -> call provider (stream or not)
   -> on settle: build log
   -> fetch(ingestion)  // async, non-blocking
```

## Logging strategy

- **Auto-instrumentation** via a JS `Proxy` on `chat.completions`. Application code does not sprinkle log calls around LLM usage.
- **Async, fire-and-forget**: `void sendLog(...)` so a slow or down ingestion service does not add chat latency or fail the user request.
- **One retry**, then drop. Prefer losing a telemetry event over stalling the product path.
- **Streaming**: the SDK wraps the async iterator, measures time-to-first-token, accumulates output for a preview, and reads usage from the final chunk (`stream_options.include_usage`).
- **Cancel**: client disconnect aborts the upstream request; the SDK classifies abort errors as `status: cancelled`.

## Failure handling assumptions

| Failure | Behavior |
|---------|----------|
| Invalid log payload | Ingestion returns `422`; SDK does not retry forever |
| Ingestion / DB down | SDK retries once, then drops; chat still works |
| LLM provider error | Surfaced to the client over SSE `error` event; log stored with `status: error` |
| User hits Stop | AbortController cancels provider stream; partial assistant text may still be saved; log `cancelled` |
| Missing conversation for a log | Still accepted — no FK on `inference_logs.conversation_id` |

Delivery is **at-most-once**. We accept rare lost logs for simplicity.

## Scaling considerations

Current design is fine for a demo / low QPS.

If traffic grows:

1. **Batch SDK flushes** (buffer N logs or flush every 100–500ms).
2. Put a **queue** (Redis Streams / SQS / Kafka) between the HTTP ingest edge and DB writers so spikes don't overwhelm Postgres.
3. **Partition / index** `inference_logs` by `created_at` for dashboard queries; consider cold storage for old rows.
4. Run multiple ingestion replicas behind a load balancer; chat server stays separately scalable.
5. Sample or drop previews under extreme load; keep counters (latency, tokens, status) always.

## Dashboard reads

The chat server exposes two read endpoints over `inference_logs` (no separate metrics service):

- `GET /api/stats?hours=24` — SQL aggregates (avg / p95 latency, error counts) and `date_trunc` buckets for throughput
- `GET /api/logs?limit=50` — recent rows for the log table

The UI polls these every 10s. This is enough for a demo; under load you'd move aggregates behind a materialized view or a metrics store.

## Demo checklist

1. `docker compose up --build` with `OPENAI_API_KEY` set.
2. Open http://localhost:8080, send a few messages, click **Stop** mid-stream.
3. Create a second chat, switch back (resume), confirm history loads.
4. Open the **Dashboard** tab — confirm cards, chart, and recent logs update.
5. Or inspect logs in SQL:

```bash
docker compose exec db psql -U brank -d brank -c \
  "SELECT provider, model, status, latency_ms, prompt_tokens, completion_tokens FROM inference_logs ORDER BY created_at DESC LIMIT 10;"
```
