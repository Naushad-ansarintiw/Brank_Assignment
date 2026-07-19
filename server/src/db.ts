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
