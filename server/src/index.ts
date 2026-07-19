import express from 'express';
import cors from 'cors';
import { instrument } from '@brank/llm-logger';
import {
  addMessage,
  createConversation,
  getConversation,
  getStats,
  listConversations,
  listInferenceLogs,
  listMessages,
  maybeSetTitle,
} from './db';
import { resolveProvider } from './providers';

const CONTEXT_WINDOW = 20;
const INGESTION_URL = process.env.INGESTION_URL || 'http://localhost:4001';

const { name: providerName, client: rawClient, model } = resolveProvider();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: providerName, model });
});

app.get('/api/stats', async (req, res) => {
  try {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
    const stats = await getStats(hours);
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load stats' });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const rows = await listInferenceLogs(limit);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load logs' });
  }
});

app.get('/api/conversations', async (_req, res) => {
  try {
    const rows = await listConversations();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to list conversations' });
  }
});


app.post('/api/conversations', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title : 'New conversation';
    const row = await createConversation(title);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create conversation' });
  }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const convo = await getConversation(req.params.id);
    if (!convo) return res.status(404).json({ error: 'conversation not found' });
    const messages = await listMessages(req.params.id);
    res.json({ conversation: convo, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to load messages' });
  }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  const conversationId = req.params.id;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'content is required' });

  const convo = await getConversation(conversationId);
  if (!convo) return res.status(404).json({ error: 'conversation not found' });

  const userMessage = await addMessage(conversationId, 'user', content);
  await maybeSetTitle(conversationId, content);

  const history = await listMessages(conversationId);
  const window = history.slice(-CONTEXT_WINDOW).map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content as string,
  }));

  const client = instrument(rawClient, {
    endpoint: `${INGESTION_URL}/v1/logs`,
    provider: providerName,
    conversationId,
  });

  const abort = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  send('user', userMessage);

  let assistantText = '';
  try {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: window,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: abort.signal }
    );

    for await (const chunk of stream) {
      if (abort.signal.aborted) break;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        assistantText += delta;
        send('token', { content: delta });
      }
    }

    if (abort.signal.aborted) {
      if (assistantText) {
        const saved = await addMessage(conversationId, 'assistant', assistantText);
        send('done', { message: saved, cancelled: true });
      } else {
        send('done', { cancelled: true });
      }
    } else {
      const saved = await addMessage(conversationId, 'assistant', assistantText || '(empty)');
      send('done', { message: saved });
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    if (abort.signal.aborted || (err as { name?: string }).name === 'AbortError') {
      if (assistantText) {
        const saved = await addMessage(conversationId, 'assistant', assistantText);
        send('done', { message: saved, cancelled: true });
      } else {
        send('done', { cancelled: true });
      }
    } else {
      console.error(err);
      send('error', { error: err instanceof Error ? err.message : 'llm request failed' });
    }
    if (!res.writableEnded) res.end();
  }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`server listening on :${port} (${providerName}/${model})`);
});
