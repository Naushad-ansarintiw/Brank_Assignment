export type InferenceStatus = 'ok' | 'error' | 'cancelled';

export interface InferenceLog {
  request_id: string;
  conversation_id?: string;
  provider: string;
  model: string;
  status: InferenceStatus;
  error_message?: string;
  latency_ms?: number;
  time_to_first_token_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_preview?: string;
  output_preview?: string;
  started_at: string;
  finished_at: string;
}

export interface InstrumentOptions {
  endpoint: string;
  provider: string;
  conversationId?: string;
  previewChars?: number;
}

function preview(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function extractInput(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  return messages
    .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n');
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; code?: string };
  return (
    e.name === 'AbortError' ||
    e.code === 'ABORT_ERR' ||
    (typeof e.message === 'string' && e.message.toLowerCase().includes('abort'))
  );
}

async function sendLog(endpoint: string, log: InferenceLog): Promise<void> {
  const body = JSON.stringify(log);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (res.ok || res.status === 422) return;
    } catch {
      // retry once
    }
  }
}

function buildBase(
  opts: InstrumentOptions,
  model: string,
  startedAt: Date,
  input: string
): Omit<InferenceLog, 'status' | 'finished_at'> {
  const max = opts.previewChars ?? 500;
  return {
    request_id: crypto.randomUUID(),
    conversation_id: opts.conversationId,
    provider: opts.provider,
    model,
    input_preview: preview(input, max),
    started_at: startedAt.toISOString(),
  };
}

export function instrument<T extends object>(client: T, opts: InstrumentOptions): T {
  const max = opts.previewChars ?? 500;

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'chat') return typeof value === 'function' ? value.bind(target) : value;

      return new Proxy(value as object, {
        get(chatTarget, chatProp, chatReceiver) {
          const chatValue = Reflect.get(chatTarget, chatProp, chatReceiver);
          if (chatProp !== 'completions') {
            return typeof chatValue === 'function' ? chatValue.bind(chatTarget) : chatValue;
          }

          return new Proxy(chatValue as object, {
            get(compTarget, compProp, compReceiver) {
              const create = Reflect.get(compTarget, compProp, compReceiver);
              if (compProp !== 'create' || typeof create !== 'function') {
                return typeof create === 'function' ? create.bind(compTarget) : create;
              }

              return async function instrumentedCreate(params: any, options?: any) {
                const startedAt = new Date();
                const model = params?.model ?? 'unknown';
                const input = extractInput(params?.messages);
                const base = buildBase(opts, model, startedAt, input);

                if (params?.stream) {
                  if (!params.stream_options) {
                    params.stream_options = { include_usage: true };
                  } else if (params.stream_options.include_usage === undefined) {
                    params.stream_options.include_usage = true;
                  }

                  let stream: any;
                  try {
                    stream = await create.call(compTarget, params, options);
                  } catch (err) {
                    const finishedAt = new Date();
                    const status: InferenceStatus = isAbortError(err) ? 'cancelled' : 'error';
                    void sendLog(opts.endpoint, {
                      ...base,
                      status,
                      error_message: err instanceof Error ? err.message : String(err),
                      latency_ms: finishedAt.getTime() - startedAt.getTime(),
                      finished_at: finishedAt.toISOString(),
                    });
                    throw err;
                  }

                  return wrapStream(stream, base, opts.endpoint, max, startedAt);
                }

                try {
                  const result = await create.call(compTarget, params, options);
                  const finishedAt = new Date();
                  const content = result?.choices?.[0]?.message?.content ?? '';
                  const usage = result?.usage;
                  void sendLog(opts.endpoint, {
                    ...base,
                    status: 'ok',
                    latency_ms: finishedAt.getTime() - startedAt.getTime(),
                    prompt_tokens: usage?.prompt_tokens,
                    completion_tokens: usage?.completion_tokens,
                    total_tokens: usage?.total_tokens,
                    output_preview: preview(content, max),
                    finished_at: finishedAt.toISOString(),
                  });
                  return result;
                } catch (err) {
                  const finishedAt = new Date();
                  const status: InferenceStatus = isAbortError(err) ? 'cancelled' : 'error';
                  void sendLog(opts.endpoint, {
                    ...base,
                    status,
                    error_message: err instanceof Error ? err.message : String(err),
                    latency_ms: finishedAt.getTime() - startedAt.getTime(),
                    finished_at: finishedAt.toISOString(),
                  });
                  throw err;
                }
              };
            },
          });
        },
      });
    },
  }) as T;
}

function wrapStream(
  stream: AsyncIterable<any>,
  base: Omit<InferenceLog, 'status' | 'finished_at'>,
  endpoint: string,
  max: number,
  startedAt: Date
) {
  let output = '';
  let ttft: number | undefined;
  let usage: any;
  let settled = false;

  const finish = (status: InferenceStatus, error_message?: string) => {
    if (settled) return;
    settled = true;
    const finishedAt = new Date();
    void sendLog(endpoint, {
      ...base,
      status,
      error_message,
      latency_ms: finishedAt.getTime() - startedAt.getTime(),
      time_to_first_token_ms: ttft,
      prompt_tokens: usage?.prompt_tokens,
      completion_tokens: usage?.completion_tokens,
      total_tokens: usage?.total_tokens,
      output_preview: preview(output, max),
      finished_at: finishedAt.toISOString(),
    });
  };

  async function* generator() {
    try {
      for await (const chunk of stream) {
        if (ttft === undefined) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) ttft = Date.now() - startedAt.getTime();
        }
        const piece = chunk?.choices?.[0]?.delta?.content;
        if (piece) output += piece;
        if (chunk?.usage) usage = chunk.usage;
        yield chunk;
      }
      finish('ok');
    } catch (err) {
      const status: InferenceStatus = isAbortError(err) ? 'cancelled' : 'error';
      finish(status, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  const iterable = generator();
  return Object.assign(iterable, {
    [Symbol.asyncIterator]() {
      return iterable;
    },
  });
}
