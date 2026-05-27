import React, { useState, useEffect, useRef } from 'react';

const API = 'http://localhost:3001';

// Fallback models if the API fetch fails
const FALLBACK_MODELS = [
  { value: 'google/gemini-2.0-flash-exp:free',          label: 'gemini-2.0-flash-free' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free',    label: 'llama-3.3-70b-free' },
  { value: 'deepseek/deepseek-r1-0528:free',            label: 'deepseek-r1-free' },
  { value: 'qwen/qwen3-235b-a22b:free',                 label: 'qwen3-235b-free' },
  { value: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'hermes-3-405b-free' },
];

function useAvailableFreeModels() {
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
    })
      .then((r) => r.json())
      .then((data) => {
        const free = (data.data || [])
          .filter(
            (m) =>
              m.id.endsWith(':free') &&
              Number(m.pricing?.prompt) === 0 &&
              Number(m.pricing?.completion) === 0
          )
          .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
          .slice(0, 12)
          .map((m) => ({
            value: m.id,
            label: m.id
              .replace('openrouter/', '')
              .replace(':free', '-free')
              .split('/')
              .pop(),
          }));

        if (free.length > 0) {
          setModels(free);
        }
      })
      .catch(() => {
        // Use fallback silently
      })
      .finally(() => setLoading(false));
  }, []);

  return { models, loading };
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div
      className="msg-enter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: isUser ? 'var(--accent-bg)' : 'var(--bg4)',
            border: `1px solid ${isUser ? 'var(--accent)' : 'var(--border2)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: isUser ? 'var(--accent2)' : 'var(--text3)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {isUser ? 'U' : 'AI'}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          {message.role}
        </span>
      </div>
      <div
        style={{
          maxWidth: 'min(78%, 600px)',
          padding: '10px 14px',
          background: isUser ? 'var(--accent-bg)' : 'var(--bg3)',
          borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          border: `1px solid ${isUser ? 'var(--accent)' : 'var(--border)'}`,
          fontSize: 13,
          lineHeight: 1.7,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

function StreamingBubble({ text }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div
          style={{
            width: 20, height: 20, borderRadius: 4,
            background: 'var(--bg4)', border: '1px solid var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--accent2)',
          }}
        >
          AI
        </div>
        <span style={{ fontSize: 10, color: 'var(--accent2)', fontFamily: 'var(--font-mono)', animation: 'pulse 1.5s infinite' }}>
          streaming…
        </span>
      </div>
      <div
        style={{
          maxWidth: 'min(78%, 600px)', padding: '10px 14px',
          background: 'var(--bg3)', borderRadius: '12px 12px 12px 4px',
          border: '1px solid var(--accent)', fontSize: 13, lineHeight: 1.7,
          color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {text}
        <span
          style={{
            display: 'inline-block', width: 2, height: 13,
            background: 'var(--accent)', marginLeft: 2,
            animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom',
          }}
        />
      </div>
    </div>
  );
}

function MetaBar({ meta }) {
  if (!meta) return null;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0 12px', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
      {meta.latency != null  && <span>⏱ {meta.latency}ms</span>}
      {meta.ttft != null     && <span>⚡ ttft {meta.ttft}ms</span>}
      {meta.usage?.total_tokens != null && <span>🔢 {meta.usage.total_tokens} tokens</span>}
      {meta.log_id           && <span style={{ opacity: 0.5 }}>log:{String(meta.log_id).slice(0, 8)}</span>}
    </div>
  );
}

export default function ChatPanel({ conversationId, onConversationCreated }) {
  const { models, loading: modelsLoading } = useAvailableFreeModels();

  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState('');
  const [streaming,    setStreaming]     = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [latestMeta,   setLatestMeta]   = useState(null);
  const [convStatus,   setConvStatus]   = useState('active');
  const [model,        setModel]        = useState('');
  const [modelError,   setModelError]   = useState(null);

  // Once models are loaded, set default
  useEffect(() => {
    if (models.length > 0 && !model) {
      setModel(models[0].value);
    }
  }, [models]);

  const bottomRef   = useRef(null);
  const abortRef    = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLatestMeta(null);
      setConvStatus('active');
      return;
    }
    fetch(`${API}/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages || []);
        setConvStatus(d.conversation?.status || 'active');
      })
      .catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamBuffer]);

  async function send() {
    if (!input.trim() || streaming || !model) return;

    const text = input.trim();
    setInput('');
    setModelError(null);
    textareaRef.current?.focus();

    let convId = conversationId;

    if (!convId) {
      const r = await fetch(`${API}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const d = await r.json();
      convId = d.conversation.id;
      onConversationCreated(convId);
    }

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, id: `tmp-${Date.now()}` },
    ]);

    setStreaming(true);
    setStreamBuffer('');
    setLatestMeta(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId, message: text, model }),
        signal: ctrl.signal,
      });

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assembled = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === 'delta') {
            assembled += evt.text;
            setStreamBuffer(assembled);
          }

          if (evt.type === 'done') {
            setLatestMeta({ latency: evt.latency_ms, ttft: evt.ttft_ms, usage: evt.usage, log_id: evt.log_id });
            setMessages((prev) => [...prev, { role: 'assistant', content: assembled, id: `tmp-${Date.now()}` }]);
            setStreamBuffer('');
          }

          if (evt.type === 'error') {
            const msg = evt.message || '';
            // If this model has no endpoints, try to flag it
            if (msg.includes('No endpoints') || msg.includes('404')) {
              setModelError(`Model "${models.find(m => m.value === model)?.label || model}" is currently offline. Please select a different model.`);
            }
            setMessages((prev) => [...prev, { role: 'assistant', content: `⚠ ${msg}`, id: `err-${Date.now()}` }]);
            setStreamBuffer('');
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠ Network error: ${e.message}`, id: `err-${Date.now()}` }]);
        setStreamBuffer('');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stopStream() {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamBuffer('');
  }

  const disabled = convStatus !== 'active';
  const currentModelLabel = models.find((m) => m.value === model)?.label || model;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', minWidth: 0 }}>

      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg2)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', display: 'block' }}>
            {conversationId ? `session:${conversationId.slice(0, 12)}…` : 'new session'}
          </span>
        </div>

        {disabled  && <span className="badge badge-red">cancelled</span>}
        {streaming && <span className="badge badge-purple" style={{ animation: 'pulse 1.5s infinite' }}>streaming</span>}

        {/* Dynamic model selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {modelsLoading && (
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              fetching models…
            </span>
          )}
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); setModelError(null); }}
            disabled={modelsLoading}
            style={{
              background: 'var(--bg3)', border: `1px solid ${modelError ? 'var(--red, #f87171)' : 'var(--border)'}`,
              color: 'var(--text2)', fontSize: 11, padding: '4px 8px',
              borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              maxWidth: 200,
            }}
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Model error banner */}
      {modelError && (
        <div style={{
          padding: '8px 20px', background: 'rgba(248,113,113,0.1)',
          borderBottom: '1px solid rgba(248,113,113,0.3)',
          fontSize: 11, color: '#f87171', fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>⚠ {modelError}</span>
          <button onClick={() => setModelError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
        {messages.length === 0 && !streaming && (
          <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)', marginTop: 60, opacity: 0.5 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
            <p>start a conversation</p>
            {!modelsLoading && <p style={{ fontSize: 10, marginTop: 4 }}>model: {currentModelLabel}</p>}
          </div>
        )}

        {messages.map((m, i) => <MessageBubble key={m.id || i} message={m} />)}
        {streamBuffer && <StreamingBubble text={streamBuffer} />}
        {latestMeta && !streaming && <MetaBar meta={latestMeta} />}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        {disabled && (
          <p style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 8, textAlign: 'center' }}>
            conversation cancelled — start a new one
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={disabled || modelsLoading}
            placeholder={modelsLoading ? 'loading models…' : disabled ? 'conversation cancelled' : 'message… (Enter to send)'}
            rows={2}
            className="input"
            style={{ flex: 1 }}
          />
          {streaming ? (
            <button onClick={stopStream} className="btn btn-danger" style={{ flexShrink: 0, height: 60 }}>stop</button>
          ) : (
            <button onClick={send} disabled={!input.trim() || disabled || modelsLoading} className="btn btn-primary" style={{ flexShrink: 0, height: 60 }}>send</button>
          )}
        </div>
      </div>
    </div>
  );
}