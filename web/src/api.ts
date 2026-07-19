export interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('failed to list conversations');
  return res.json();
}

export async function createConversation(): Promise<Conversation> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('failed to create conversation');
  return res.json();
}

export async function loadMessages(
  id: string
): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await fetch(`/api/conversations/${id}/messages`);
  if (!res.ok) throw new Error('failed to load messages');
  return res.json();
}

export interface StatsTotals {
  requests: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  errors: number;
  cancelled: number;
  total_tokens: number;
}

export interface StatsBucket {
  bucket: string;
  requests: number;
  avg_latency_ms: number;
  errors: number;
}

export interface StatsResponse {
  totals: StatsTotals;
  buckets: StatsBucket[];
}

export interface InferenceLog {
  id: string;
  request_id: string;
  conversation_id: string | null;
  provider: string;
  model: string;
  status: 'ok' | 'error' | 'cancelled';
  error_message: string | null;
  latency_ms: number | null;
  time_to_first_token_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  input_preview: string | null;
  output_preview: string | null;
  started_at: string;
  finished_at: string;
  created_at: string;
}

export async function fetchStats(hours = 24): Promise<StatsResponse> {
  const res = await fetch(`/api/stats?hours=${hours}`);
  if (!res.ok) throw new Error('failed to load stats');
  return res.json();
}

export async function fetchLogs(limit = 50): Promise<InferenceLog[]> {
  const res = await fetch(`/api/logs?limit=${limit}`);
  if (!res.ok) throw new Error('failed to load logs');
  return res.json();
}

export type StreamHandlers = {
  onUser: (msg: Message) => void;
  onToken: (content: string) => void;
  onDone: (payload: { message?: Message; cancelled?: boolean }) => void;
  onError: (error: string) => void;
};

export function sendMessage(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  return fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(text || 'request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === 'user') handlers.onUser(payload);
        else if (event === 'token') handlers.onToken(payload.content);
        else if (event === 'done') handlers.onDone(payload);
        else if (event === 'error') handlers.onError(payload.error || 'error');
      }
    }
  });
}
