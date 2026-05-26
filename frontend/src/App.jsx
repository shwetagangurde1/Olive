import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:3001";

const COLORS = {
  bg: "var(--color-background-primary)",
  bgSecondary: "var(--color-background-secondary)",
  bgTertiary: "var(--color-background-tertiary)",
  text: "var(--color-text-primary)",
  textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)",
  border: "var(--color-border-tertiary)",
  borderSecondary: "var(--color-border-secondary)",
  info: "var(--color-background-info)",
  infoText: "var(--color-text-info)",
  success: "var(--color-background-success)",
  successText: "var(--color-text-success)",
  danger: "var(--color-background-danger)",
  dangerText: "var(--color-text-danger)",
};

// ─── tiny helpers ──────────────────────────────────────────
function Badge({ color = "info", children }) {
  return (
    <span style={{
      background: COLORS[color], color: COLORS[`${color}Text`] || COLORS.text,
      fontSize: 11, padding: "2px 8px", borderRadius: "var(--border-radius-md)",
      fontWeight: 500, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer",
      border: `0.5px solid ${active ? "var(--color-border-secondary)" : COLORS.border}`,
      background: active ? COLORS.bgSecondary : "transparent",
      color: active ? COLORS.text : COLORS.textSecondary, fontWeight: active ? 500 : 400,
    }}>{children}</button>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: COLORS.bgSecondary, borderRadius: "var(--border-radius-md)", padding: "12px 14px" }}>
      <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: "0 0 4px" }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 500, margin: 0, color: COLORS.text }}>{value ?? "—"}</p>
      {sub && <p style={{ fontSize: 11, color: COLORS.textTertiary, margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

// ─── Sidebar conversation list ──────────────────────────────
function Sidebar({ activeId, onSelect, onNew, refresh }) {
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState("active");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/conversations?status=${filter}&limit=40`);
      const d = await r.json();
      setConversations(d.conversations || []);
    } catch { /* offline */ }
  }, [filter]);

  useEffect(() => { load(); }, [load, refresh]);

  async function cancel(id, e) {
    e.stopPropagation();
    if (!confirm("Cancel this conversation?")) return;
    await fetch(`${API}/api/conversations/${id}/cancel`, { method: "PATCH" });
    load();
    if (activeId === id) onSelect(null);
  }

  return (
    <div style={{
      width: 240, borderRight: `0.5px solid ${COLORS.border}`, display: "flex",
      flexDirection: "column", height: "100%", background: COLORS.bgTertiary,
    }}>
      <div style={{ padding: "16px 12px 8px", borderBottom: `0.5px solid ${COLORS.border}` }}>
        <button onClick={onNew} style={{
          width: "100%", padding: "8px 0", borderRadius: "var(--border-radius-md)",
          border: `0.5px solid ${COLORS.borderSecondary}`, background: COLORS.bg,
          color: COLORS.text, cursor: "pointer", fontSize: 13, fontWeight: 500,
        }}>+ New conversation</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: `0.5px solid ${COLORS.border}` }}>
        {["active", "cancelled", "all"].map(s => (
          <Pill key={s} active={filter === s} onClick={() => setFilter(s)}>{s}</Pill>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {conversations.length === 0 && (
          <p style={{ textAlign: "center", color: COLORS.textTertiary, fontSize: 13, padding: "24px 12px" }}>No conversations</p>
        )}
        {conversations.map(c => (
          <div key={c.id} onClick={() => onSelect(c.id)}
            style={{
              padding: "10px 12px", cursor: "pointer",
              borderBottom: `0.5px solid ${COLORS.border}`,
              background: activeId === c.id ? COLORS.bgSecondary : "transparent",
              position: "relative",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {c.title || "New conversation"}
              </p>
              {c.status === "active" && (
                <button onClick={e => cancel(c.id, e)} title="Cancel" style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: COLORS.textTertiary, fontSize: 11, padding: "1px 4px", flexShrink: 0,
                }}>✕</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
              <Badge color={c.status === "active" ? "success" : "danger"}>{c.status}</Badge>
              <span style={{ fontSize: 11, color: COLORS.textTertiary }}>{c.message_count} msgs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chat panel ─────────────────────────────────────────────
function ChatPanel({ conversationId, onConversationCreated }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [latestMeta, setLatestMeta] = useState(null);
  const [convStatus, setConvStatus] = useState("active");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!conversationId) { setMessages([]); setLatestMeta(null); return; }
    fetch(`${API}/api/conversations/${conversationId}`)
      .then(r => r.json())
      .then(d => {
        setMessages(d.messages || []);
        setConvStatus(d.conversation?.status || "active");
      }).catch(() => {});
  }, [conversationId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamBuffer]);

  async function send() {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput("");

    let convId = conversationId;
    if (!convId) {
      const r = await fetch(`${API}/api/conversations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const d = await r.json();
      convId = d.conversation.id;
      onConversationCreated(convId);
    }

    const userMsg = { role: "user", content: text, id: `tmp-${Date.now()}` };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamBuffer("");
    setLatestMeta(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convId, message: text, model }),
        signal: ctrl.signal,
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "delta") { assembled += evt.text; setStreamBuffer(assembled); }
          if (evt.type === "done") {
            setLatestMeta({ latency: evt.latency_ms, ttft: evt.ttft_ms, usage: evt.usage, log_id: evt.log_id });
            setMessages(prev => [...prev, { role: "assistant", content: assembled, id: `tmp-${Date.now()}` }]);
            setStreamBuffer("");
          }
          if (evt.type === "error") {
            setMessages(prev => [...prev, { role: "assistant", content: `⚠ ${evt.message}`, id: `err-${Date.now()}` }]);
            setStreamBuffer("");
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") console.error(e);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stopStream() { abortRef.current?.abort(); setStreaming(false); setStreamBuffer(""); }

  const disabled = convStatus !== "active";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: `0.5px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 15, color: COLORS.text, flex: 1 }}>
          {conversationId ? `Chat · ${conversationId.slice(0, 8)}…` : "New chat"}
        </span>
        {disabled && <Badge color="danger">cancelled</Badge>}
        <select value={model} onChange={e => setModel(e.target.value)} style={{ fontSize: 12 }}>
          <option value="claude-sonnet-4-20250514">Sonnet 4</option>
          <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          <option value="claude-opus-4-20250514">Opus 4</option>
        </select>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {messages.length === 0 && !streamBuffer && (
          <div style={{ textAlign: "center", color: COLORS.textTertiary, marginTop: 60 }}>
            <p style={{ fontSize: 14 }}>Start a conversation below.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "78%", padding: "10px 14px",
              background: m.role === "user" ? COLORS.info : COLORS.bgSecondary,
              borderRadius: "var(--border-radius-lg)",
              border: `0.5px solid ${COLORS.border}`,
              fontSize: 14, lineHeight: 1.6, color: COLORS.text, whiteSpace: "pre-wrap",
            }}>{m.content}</div>
            <span style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 3, paddingInline: 4 }}>{m.role}</span>
          </div>
        ))}
        {streamBuffer && (
          <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{
              maxWidth: "78%", padding: "10px 14px",
              background: COLORS.bgSecondary, borderRadius: "var(--border-radius-lg)",
              border: `0.5px solid ${COLORS.border}`,
              fontSize: 14, lineHeight: 1.6, color: COLORS.text, whiteSpace: "pre-wrap",
            }}>
              {streamBuffer}<span style={{ display: "inline-block", width: 2, height: 14, background: COLORS.text, marginLeft: 2, animation: "blink 1s step-end infinite", verticalAlign: "text-bottom" }} />
            </div>
            <span style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 3, paddingInline: 4 }}>assistant · streaming</span>
          </div>
        )}
        {latestMeta && (
          <div style={{ fontSize: 11, color: COLORS.textTertiary, marginBottom: 8, display: "flex", gap: 12 }}>
            <span>⏱ {latestMeta.latency}ms</span>
            {latestMeta.ttft && <span>TTFT: {latestMeta.ttft}ms</span>}
            <span>Tokens: {latestMeta.usage?.total}</span>
            <span style={{ color: COLORS.textTertiary, fontSize: 10 }}>log: {latestMeta.log_id?.slice(0, 8)}…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 20px", borderTop: `0.5px solid ${COLORS.border}`, display: "flex", gap: 8 }}>
        <textarea
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={disabled ? "Conversation cancelled" : "Message… (Enter to send)"}
          disabled={disabled}
          rows={2}
          style={{ flex: 1, resize: "none", fontSize: 14, padding: "8px 12px", borderRadius: "var(--border-radius-md)", border: `0.5px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text }}
        />
        {streaming
          ? <button onClick={stopStream} style={{ padding: "0 16px", borderRadius: "var(--border-radius-md)", border: `0.5px solid ${COLORS.border}`, background: COLORS.danger, color: COLORS.dangerText, cursor: "pointer", fontSize: 13 }}>Stop</button>
          : <button onClick={send} disabled={disabled || !input.trim()} style={{ padding: "0 16px", borderRadius: "var(--border-radius-md)", border: `0.5px solid ${COLORS.border}`, background: COLORS.bg, color: COLORS.text, cursor: "pointer", fontSize: 13 }}>Send</button>
        }
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

// ─── Dashboard / Logs panel ──────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/metrics/dashboard`).then(r => r.json()).catch(() => null),
      fetch(`${API}/api/chat/logs?limit=30`).then(r => r.json()).catch(() => ({ logs: [] })),
    ]).then(([s, l]) => {
      setStats(s);
      setLogs(l.logs || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: 40, color: COLORS.textTertiary, fontSize: 14 }}>Loading metrics…</div>;

  const o = stats?.overall || {};

  function fmt(n) { return n != null ? Number(n).toFixed(0) : "—"; }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
      <p style={{ fontWeight: 500, fontSize: 16, margin: "0 0 16px", color: COLORS.text }}>Last 24 hours</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
        <StatCard label="Total requests" value={fmt(o.total_requests)} />
        <StatCard label="Errors" value={fmt(o.errors)} sub={o.total_requests ? `${((o.errors / o.total_requests) * 100).toFixed(1)}% error rate` : null} />
        <StatCard label="Avg latency" value={o.avg_latency ? `${fmt(o.avg_latency)}ms` : "—"} />
        <StatCard label="p95 latency" value={o.p95_latency ? `${fmt(o.p95_latency)}ms` : "—"} />
        <StatCard label="Total tokens" value={o.total_tokens ? Number(o.total_tokens).toLocaleString() : "—"} />
        <StatCard label="Conversations" value={fmt(o.conversations)} />
      </div>

      {stats?.byProvider?.length > 0 && (
        <>
          <p style={{ fontWeight: 500, fontSize: 14, margin: "0 0 10px", color: COLORS.text }}>By model</p>
          <div style={{ marginBottom: 28 }}>
            {stats.byProvider.map(p => (
              <div key={`${p.provider}-${p.model}`} style={{
                display: "flex", gap: 12, padding: "8px 12px", marginBottom: 4,
                background: COLORS.bgSecondary, borderRadius: "var(--border-radius-md)",
                fontSize: 13, alignItems: "center",
              }}>
                <Badge color="info">{p.provider}</Badge>
                <span style={{ flex: 1, color: COLORS.text }}>{p.model}</span>
                <span style={{ color: COLORS.textSecondary }}>{fmt(p.requests)} reqs</span>
                <span style={{ color: COLORS.textSecondary }}>{fmt(p.avg_latency)}ms avg</span>
                <span style={{ color: COLORS.textSecondary }}>{Number(p.tokens).toLocaleString()} tok</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ fontWeight: 500, fontSize: 14, margin: "0 0 10px", color: COLORS.text }}>Recent inference logs</p>
      <div style={{ border: `0.5px solid ${COLORS.border}`, borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 80px 100px", gap: 0 }}>
          {["Model", "Latency", "Tokens", "Status", "Streaming", "Time"].map(h => (
            <div key={h} style={{ padding: "8px 10px", fontSize: 11, fontWeight: 500, color: COLORS.textSecondary, borderBottom: `0.5px solid ${COLORS.border}`, background: COLORS.bgSecondary }}>{h}</div>
          ))}
          {logs.length === 0 && (
            <div style={{ gridColumn: "1/-1", padding: "20px", color: COLORS.textTertiary, fontSize: 13, textAlign: "center" }}>No logs yet</div>
          )}
          {logs.map((l, i) => (
            <>
              <div key={`${l.id}-0`} style={{ padding: "7px 10px", fontSize: 12, color: COLORS.text, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>{l.model}</div>
              <div key={`${l.id}-1`} style={{ padding: "7px 10px", fontSize: 12, color: COLORS.textSecondary, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>{l.latency_ms != null ? `${l.latency_ms}ms` : "—"}</div>
              <div key={`${l.id}-2`} style={{ padding: "7px 10px", fontSize: 12, color: COLORS.textSecondary, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>{l.total_tokens ?? "—"}</div>
              <div key={`${l.id}-3`} style={{ padding: "7px 10px", fontSize: 12, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>
                <Badge color={l.status === "success" ? "success" : l.status === "error" ? "danger" : "info"}>{l.status}</Badge>
              </div>
              <div key={`${l.id}-4`} style={{ padding: "7px 10px", fontSize: 12, color: COLORS.textSecondary, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>{l.is_streaming ? "Yes" : "No"}</div>
              <div key={`${l.id}-5`} style={{ padding: "7px 10px", fontSize: 11, color: COLORS.textTertiary, borderBottom: `0.5px solid ${COLORS.border}`, background: i % 2 ? COLORS.bgSecondary : COLORS.bg }}>{new Date(l.created_at).toLocaleTimeString()}</div>
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── App shell ──────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("chat");
  const [activeConvId, setActiveConvId] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  function handleConversationCreated(id) {
    setActiveConvId(id);
    setSidebarRefresh(n => n + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: COLORS.bg, fontFamily: "var(--font-sans)" }}>
      {/* Top nav */}
      <div style={{ height: 48, borderBottom: `0.5px solid ${COLORS.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 16, background: COLORS.bg, flexShrink: 0 }}>
        <span style={{ fontWeight: 500, fontSize: 15, color: COLORS.text }}>LLM Observatory</span>
        <div style={{ display: "flex", gap: 4 }}>
          {["chat", "dashboard"].map(v => (
            <Pill key={v} active={view === v} onClick={() => setView(v)}>{v === "chat" ? "Chat" : "Dashboard"}</Pill>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.textTertiary }}>Claude Sonnet · Streaming</span>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {view === "chat" && (
          <>
            <Sidebar
              activeId={activeConvId}
              onSelect={setActiveConvId}
              onNew={() => { setActiveConvId(null); }}
              refresh={sidebarRefresh}
            />
            <ChatPanel
              conversationId={activeConvId}
              onConversationCreated={handleConversationCreated}
            />
          </>
        )}
        {view === "dashboard" && <Dashboard />}
      </div>
    </div>
  );
}
