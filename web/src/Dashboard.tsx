import { useCallback, useEffect, useState } from 'react';
import {
  InferenceLog,
  StatsBucket,
  StatsResponse,
  fetchLogs,
  fetchStats,
} from './api';

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function truncate(text: string | null, max = 80) {
  if (!text) return '—';
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function Chart({ buckets }: { buckets: StatsBucket[] }) {
  if (buckets.length === 0) {
    return <div className="chart-empty">No requests in this window yet.</div>;
  }

  const max = Math.max(...buckets.map((b) => b.requests), 1);
  const width = Math.max(buckets.length * 28, 320);
  const height = 140;
  const barW = 18;
  const gap = 10;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      {buckets.map((b, i) => {
        const h = (b.requests / max) * (height - 24);
        const x = i * (barW + gap) + 8;
        const y = height - h - 4;
        const errH = b.requests ? (b.errors / b.requests) * h : 0;
        return (
          <g key={b.bucket}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill="#3b82f6" />
            {errH > 0 && (
              <rect x={x} y={y} width={barW} height={errH} rx={3} fill="#ef4444" />
            )}
            <title>
              {formatTime(b.bucket)} — {b.requests} req, {b.errors} err, avg{' '}
              {b.avg_latency_ms}ms
            </title>
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [logs, setLogs] = useState<InferenceLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([fetchStats(24), fetchLogs(50)]);
      setStats(s);
      setLogs(l);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const t = stats?.totals;
  const errorRate =
    t && t.requests > 0 ? ((t.errors / t.requests) * 100).toFixed(1) : '0.0';

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Inference dashboard</h2>
        <span className="muted">Last 24h · refreshes every 10s</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-label">Requests</div>
          <div className="stat-value">{t?.requests ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg latency</div>
          <div className="stat-value">{t ? `${t.avg_latency_ms}ms` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">P95 latency</div>
          <div className="stat-value">{t ? `${t.p95_latency_ms}ms` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Error rate</div>
          <div className="stat-value">{t ? `${errorRate}%` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cancelled</div>
          <div className="stat-value">{t?.cancelled ?? '—'}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Throughput</h3>
        <Chart buckets={stats?.buckets ?? []} />
      </div>

      <div className="panel">
        <h3>Recent logs</h3>
        <div className="table-wrap">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Provider / model</th>
                <th>Status</th>
                <th>Latency</th>
                <th>TTFT</th>
                <th>Tokens</th>
                <th>Input</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No logs yet. Send a chat message to generate one.
                  </td>
                </tr>
              )}
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.created_at)}</td>
                  <td>
                    {log.provider} / {log.model}
                  </td>
                  <td>
                    <span className={`badge ${log.status}`}>{log.status}</span>
                  </td>
                  <td>{log.latency_ms != null ? `${log.latency_ms}ms` : '—'}</td>
                  <td>
                    {log.time_to_first_token_ms != null
                      ? `${log.time_to_first_token_ms}ms`
                      : '—'}
                  </td>
                  <td>{log.total_tokens ?? '—'}</td>
                  <td className="preview" title={log.input_preview ?? ''}>
                    {truncate(log.input_preview)}
                  </td>
                  <td className="preview" title={log.output_preview ?? ''}>
                    {truncate(log.output_preview)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
