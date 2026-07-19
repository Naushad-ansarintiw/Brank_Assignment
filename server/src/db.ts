import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://brank:brank@localhost:5432/brank',
});

export async function listConversations() {
  const { rows } = await pool.query(
    `SELECT id, title, created_at FROM conversations ORDER BY created_at DESC`
  );
  return rows;
}

export async function createConversation(title = 'New conversation') {
  const { rows } = await pool.query(
    `INSERT INTO conversations (title) VALUES ($1) RETURNING id, title, created_at`,
    [title]
  );
  return rows[0];
}

export async function getConversation(id: string) {
  const { rows } = await pool.query(
    `SELECT id, title, created_at FROM conversations WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listMessages(conversationId: string) {
  const { rows } = await pool.query(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
}

export async function addMessage(conversationId: string, role: string, content: string) {
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING id, conversation_id, role, content, created_at`,
    [conversationId, role, content]
  );
  return rows[0];
}

export async function maybeSetTitle(conversationId: string, firstUserMessage: string) {
  const title = firstUserMessage.slice(0, 60).trim() || 'New conversation';
  await pool.query(
    `UPDATE conversations SET title = $2
     WHERE id = $1 AND title = 'New conversation'`,
    [conversationId, title]
  );
}

export async function getStats(hours = 24) {
  const trunc = hours <= 1 ? 'minute' : 'hour';

  const totals = await pool.query(
    `SELECT
       COUNT(*)::int AS requests,
       COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
       COALESCE(
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int,
         0
       ) AS p95_latency_ms,
       COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COALESCE(SUM(total_tokens), 0)::int AS total_tokens
     FROM inference_logs
     WHERE created_at >= now() - ($1::text || ' hours')::interval`,
    [String(hours)]
  );

  const buckets = await pool.query(
    `SELECT
       date_trunc($2, created_at) AS bucket,
       COUNT(*)::int AS requests,
       COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
       COUNT(*) FILTER (WHERE status = 'error')::int AS errors
     FROM inference_logs
     WHERE created_at >= now() - ($1::text || ' hours')::interval
     GROUP BY 1
     ORDER BY 1 ASC`,
    [String(hours), trunc]
  );

  return { totals: totals.rows[0], buckets: buckets.rows };
}

export async function listInferenceLogs(limit = 50) {
  const { rows } = await pool.query(
    `SELECT
       id, request_id, conversation_id, provider, model, status, error_message,
       latency_ms, time_to_first_token_ms, prompt_tokens, completion_tokens, total_tokens,
       input_preview, output_preview, started_at, finished_at, created_at
     FROM inference_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
