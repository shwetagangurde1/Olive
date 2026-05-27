import React, { useState, useEffect, useCallback } from 'react';

const API = 'http://localhost:3001';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);

  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;

  const h = Math.floor(m / 60);

  if (h < 24) return `${h}h ago`;

  return `${Math.floor(h / 24)}d ago`;
}

export default function Sidebar({
  activeId,
  onSelect,
  onNew,
  refresh,
  mobileOpen,
  setMobileOpen,
}) {
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const r = await fetch(
        `${API}/api/conversations?status=${filter}&limit=40`
      );

      const d = await r.json();

      setConversations(d.conversations || []);
    } catch {}

    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function cancel(id, e) {
    e.stopPropagation();

    if (!confirm('Cancel this conversation?')) return;

    await fetch(`${API}/api/conversations/${id}/cancel`, {
      method: 'PATCH',
    });

    load();

    if (activeId === id) onSelect(null);
  }

  return (
    <>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99,
          }}
        />
      )}

      <aside
        style={{
          width: 260,
          minWidth: 260,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--bg2)',

          position: window.innerWidth <= 768 ? 'fixed' : 'relative',
          left:
            window.innerWidth <= 768
              ? mobileOpen
                ? 0
                : -280
              : 0,
          top: 0,
          zIndex: 100,
          transition: 'left 0.3s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 14px 12px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--green)',
                  boxShadow: '0 0 6px var(--green)',
                }}
              />

              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 14,
                  color: 'var(--text)',
                  letterSpacing: '0.05em',
                }}
              >
                CONVERSATIONS
              </span>
            </div>

            {/* Close button mobile */}
            {window.innerWidth <= 768 && (
              <button
                onClick={() => setMobileOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  fontSize: 20,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            )}
          </div>

          <button
            onClick={onNew}
            className="btn btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 14 }}>+</span>
            New conversation
          </button>
        </div>

        {/* Filters */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '10px 10px 8px',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          {['active', 'cancelled', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`pill ${filter === s ? 'active' : ''}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: 'var(--text3)',
                fontSize: 11,
              }}
            >
              loading...
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>
                ◈
              </div>

              <p style={{ color: 'var(--text3)', fontSize: 11 }}>
                no conversations yet
              </p>
            </div>
          )}

          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => {
                onSelect(c.id);

                if (window.innerWidth <= 768) {
                  setMobileOpen(false);
                }
              }}
              className="sidebar-enter"
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background:
                  activeId === c.id ? 'var(--bg3)' : 'transparent',
                borderLeft:
                  activeId === c.id
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 4,
                  marginBottom: 5,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 500,
                    color:
                      activeId === c.id
                        ? 'var(--text)'
                        : 'var(--text2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {c.title || 'untitled'}
                </p>

                {c.status === 'active' && (
                  <button
                    onClick={(e) => cancel(c.id, e)}
                    title="Cancel"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text3)',
                      fontSize: 12,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  className={`badge ${
                    c.status === 'active'
                      ? 'badge-green'
                      : 'badge-red'
                  }`}
                >
                  {c.status}
                </span>

                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text3)',
                  }}
                >
                  {c.message_count ?? 0} msgs
                </span>

                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text3)',
                    marginLeft: 'auto',
                  }}
                >
                  {timeAgo(c.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}