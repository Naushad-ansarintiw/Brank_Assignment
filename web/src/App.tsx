import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  Conversation,
  Message,
  createConversation,
  listConversations,
  loadMessages,
  sendMessage,
} from './api';
import Dashboard from './Dashboard';

export default function App() {
  const [view, setView] = useState<'chat' | 'dashboard'>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async () => {
    const rows = await listConversations();
    setConversations(rows);
  }, []);

  useEffect(() => {
    refreshList().catch((e) => setError(e.message));
  }, [refreshList]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  async function openConversation(id: string) {
    if (streaming) return;
    setView('chat');
    setError(null);
    setActiveId(id);
    const data = await loadMessages(id);
    setMessages(data.messages);
  }

  async function onNewChat() {
    if (streaming) return;
    setView('chat');
    setError(null);
    const convo = await createConversation();
    setConversations((prev) => [convo, ...prev]);
    setActiveId(convo.id);
    setMessages([]);
  }

  function onStop() {
    abortRef.current?.abort();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setError(null);
    let conversationId = activeId;
    if (!conversationId) {
      const convo = await createConversation();
      setConversations((prev) => [convo, ...prev]);
      conversationId = convo.id;
      setActiveId(convo.id);
      setMessages([]);
    }

    setInput('');
    setStreaming(true);

    const tempAssistant: Message = {
      id: 'streaming',
      conversation_id: conversationId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistant]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await sendMessage(
        conversationId,
        text,
        {
          onUser: (msg) => {
            setMessages((prev) => {
              const withoutTemp = prev.filter((m) => m.id !== 'streaming');
              return [...withoutTemp, msg, { ...tempAssistant }];
            });
          },
          onToken: (chunk) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === 'streaming' ? { ...m, content: m.content + chunk } : m
              )
            );
          },
          onDone: (payload) => {
            if (payload.message) {
              setMessages((prev) =>
                prev.map((m) => (m.id === 'streaming' ? payload.message! : m))
              );
            } else {
              setMessages((prev) => prev.filter((m) => m.id !== 'streaming'));
            }
            refreshList().catch(() => undefined);
          },
          onError: (err) => {
            setError(err);
            setMessages((prev) => prev.filter((m) => m.id !== 'streaming' || m.content));
          },
        },
        controller.signal
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === 'streaming'
              ? { ...m, id: `local-${Date.now()}`, content: m.content || '(cancelled)' }
              : m
          )
        );
        refreshList().catch(() => undefined);
      } else {
        setError(err instanceof Error ? err.message : 'request failed');
        setMessages((prev) => prev.filter((m) => m.id !== 'streaming' || m.content));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Brank Chat</h1>
          <button type="button" onClick={onNewChat} disabled={streaming}>
            New chat
          </button>
        </div>
        <div className="nav-tabs">
          <button
            type="button"
            className={view === 'chat' ? 'active' : ''}
            onClick={() => setView('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={view === 'dashboard' ? 'active' : ''}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
        </div>
        {view === 'chat' && (
          <ul className="convo-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === activeId ? 'active' : ''}
                  onClick={() => openConversation(c.id)}
                  disabled={streaming}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {view === 'dashboard' ? (
        <Dashboard />
      ) : (
        <main className="chat">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty">Start a conversation. Context is kept across turns.</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                <div className="role">{m.role}</div>
                <div className="content">{m.content || (m.id === 'streaming' ? '…' : '')}</div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error && <div className="error">{error}</div>}

          <form className="composer" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message…"
              disabled={streaming}
            />
            {streaming ? (
              <button type="button" className="stop" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()}>
                Send
              </button>
            )}
          </form>
        </main>
      )}
    </div>
  );
}
