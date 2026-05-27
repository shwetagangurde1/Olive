import React, { useState, useEffect } from 'react';

const API = 'http://localhost:3001';

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--bg3)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {accent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'var(--accent)',
        }} />
      )}
      <p style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: accent ? 'var(--accent2)' : 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{value ?? '—'}</p>
      {sub && <p style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{sub}</p>}
    </div>
  );
}

function LogRow({ log, idx }) {
  const statusColor = log.status === 'success' ? 'badge-green' : log.status === 'error' ? 'badge-red' : 'badge-amber';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 70px 70px 80px 60px 90px',
      gap: 0,
      background: idx % 2 === 0 ? 'transparent' : 'var(--bg3)',
      borderBottom: '1px solid var(--border)',
    }}>
      {[
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)' }}>{log.model?.replace('claude-', '')}</span>,
        <span style={{ color: log.latency_ms > 3000 ? 'var(--amber)' : 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.latency_ms != null ? `${log.latency_ms}ms` : '—'}</span>,
        <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.total_tokens ?? '—'}</span>,
        <span><span className={`badge ${statusColor}`}>{log.status}</span></span>,
        <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{log.is_streaming ? 'yes' : 'no'}</span>,
        <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{new Date(log.created_at).toLocaleTimeString()}</span>,
      ].map((cell, i) => (
        <div key={i} style={{ padding: '8px 10px', display: 'flex', alignItems: 'center' }}>{cell}</div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        fetch(`${API}/api/metrics/dashboard`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/chat/logs?limit=30`).then(r => r.json()).catch(() => ({ logs: [] })),
      ]);
      setStats(s);
      setLogs(l.logs || []);
      setLastRefresh(Date.now());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const o = stats?.overall || {};
  function fmt(n) { return n != null ? Number(n).toFixed(0) : '—'; }
  const errorRate = o.total_requests && o.errors ? ((o.errors / o.total_requests) * 100).toFixed(1) : null;

  return (
   <div
  style={{
    flex: 1,
    overflowY: 'auto',
    padding: window.innerWidth <= 768 ? '16px' : '24px 28px',
    minWidth: 0,
  }}
>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--text)', letterSpacing: '0.03em' }}>
            OBSERVABILITY
          </h2>
          <p style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>last 24 hours</p>
        </div>
        <button onClick={load} className="btn" style={{ gap: 6 }}>
          <span style={{ fontSize: 12 }}>↻</span>
          refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          loading metrics…
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}>
            <StatCard label="Total requests" value={fmt(o.total_requests)} accent />
            <StatCard label="Errors" value={fmt(o.errors)} sub={errorRate ? `${errorRate}% error rate` : null} />
            <StatCard label="Avg latency" value={o.avg_latency ? `${fmt(o.avg_latency)}ms` : '—'} />
            <StatCard label="p95 latency" value={o.p95_latency ? `${fmt(o.p95_latency)}ms` : '—'} />
            <StatCard label="Total tokens" value={o.total_tokens ? Number(o.total_tokens).toLocaleString() : '—'} />
            <StatCard label="Conversations" value={fmt(o.conversations)} />
          </div>

          {/* By model */}
          {stats?.byProvider?.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
              }}>by model</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.byProvider.map(p => (
                  <div key={`${p.provider}-${p.model}`} style={{
                    display: 'flex', gap: 12, padding: '10px 14px',
                    background: 'var(--bg3)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    fontSize: 12, alignItems: 'center',
                    flexWrap: 'wrap', gap: 10,
                  }}>
                    <span className="badge badge-purple">{p.provider}</span>
                    <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', flex: 1, minWidth: 120 }}>{p.model?.replace('claude-', '')}</span>
                    <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmt(p.requests)} reqs</span>
                    <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmt(p.avg_latency)}ms avg</span>
                    <span style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{Number(p.tokens || 0).toLocaleString()} tok</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs table */}
          <div>
            <h3 style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
            }}>recent inference logs</h3>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 70px 70px 80px 60px 90px',
                background: 'var(--bg3)',
                borderBottom: '1px solid var(--border2)',
              }}>
                {['Model', 'Latency', 'Tokens', 'Status', 'Stream', 'Time'].map(h => (
                  <div key={h} style={{
                    padding: '8px 10px', fontSize: 10, fontWeight: 500,
                    color: 'var(--text3)', fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                  }}>{h}</div>
                ))}
              </div>
              {logs.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  no logs yet — start a conversation to see data here
                </div>
              ) : (
                logs.map((l, i) => <LogRow key={l.id} log={l} idx={i} />)
              )}
            </div>
            <p style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
              auto-refreshes every 30s · last updated {new Date(lastRefresh).toLocaleTimeString()}
            </p>
          </div>
        </>
      )}
    </div>
  );
}