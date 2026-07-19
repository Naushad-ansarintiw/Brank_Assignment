import express from 'express';
import { z } from 'zod';
import { pool } from './db';

const logSchema = z.object({
  request_id: z.string().min(1),
  conversation_id: z.string().optional().nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(['ok', 'error', 'cancelled']),
  error_message: z.string().optional().nullable(),
  latency_ms: z.number().int().optional().nullable(),
  time_to_first_token_ms: z.number().int().optional().nullable(),
  prompt_tokens: z.number().int().optional().nullable(),
  completion_tokens: z.number().int().optional().nullable(),
  total_tokens: z.number().int().optional().nullable(),
  input_preview: z.string().optional().nullable(),
  output_preview: z.string().optional().nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
});

const payloadSchema = z.union([logSchema, z.array(logSchema).min(1)]);

const INSERT = `
  INSERT INTO inference_logs (
    request_id, conversation_id, provider, model, status, error_message,
    latency_ms, time_to_first_token_ms, prompt_tokens, completion_tokens, total_tokens,
    input_preview, output_preview, started_at, finished_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
  )
`;

async function insertLog(log: z.infer<typeof logSchema>) {
  await pool.query(INSERT, [
    log.request_id,
    log.conversation_id ?? null,
    log.provider,
    log.model,
    log.status,
    log.error_message ?? null,
    log.latency_ms ?? null,
    log.time_to_first_token_ms ?? null,
    log.prompt_tokens ?? null,
    log.completion_tokens ?? null,
    log.total_tokens ?? null,
    log.input_preview ?? null,
    log.output_preview ?? null,
    log.started_at,
    log.finished_at,
  ]);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/v1/logs', async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'invalid payload', details: parsed.error.flatten() });
  }

  const logs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  try {
    for (const log of logs) {
      await insertLog(log);
    }
    return res.status(201).json({ accepted: logs.length });
  } catch (err) {
    console.error('ingest failed', err);
    return res.status(500).json({ error: 'failed to store logs' });
  }
});

const port = Number(process.env.INGESTION_PORT || 4001);
app.listen(port, () => {
  console.log(`ingestion listening on :${port}`);
});
