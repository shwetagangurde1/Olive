import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import Dashboard from './components/Dashboard';

export default function App() {
  const [view, setView] = useState('chat');
  const [activeConvId, setActiveConvId] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  function handleConversationCreated(id) {
    setActiveConvId(id);
    setSidebarRefresh(n => n + 1);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', background: 'var(--bg)',
      overflow: 'hidden',
    }}>

      {/* ── Top Nav ── */}
      <header style={{
        height: 48, flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 12,
        background: 'var(--bg2)',
      }}>
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="btn"
          style={{ padding: '6px 8px', display: 'none' }}
          id="sidebar-toggle"
        >☰</button>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12,
          }}>◈</div>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700, fontSize: 14,
            color: 'var(--text)',
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}>LLM OBSERVATORY</span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'chat', label: 'Chat' },
            { id: 'dashboard', label: 'Dashboard' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`nav-link ${view === id ? 'active' : ''}`}
            >{label}</button>
          ))}
        </nav>

        {/* Right status */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            api · streaming
          </span>
        </div>
      </header>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {view === 'chat' && (
          <>
            {/* Sidebar — hidden on small screens via CSS */}
            <div className={sidebarOpen ? 'sidebar-visible' : 'sidebar-hidden'} style={{ display: 'flex', height: '100%' }}>
              <Sidebar
                activeId={activeConvId}
                onSelect={id => { setActiveConvId(id); }}
                onNew={() => setActiveConvId(null)}
                refresh={sidebarRefresh}
              />
            </div>
            <ChatPanel
              conversationId={activeConvId}
              onConversationCreated={handleConversationCreated}
            />
          </>
        )}
        {view === 'dashboard' && <Dashboard />}
      </div>

      <style>{`
        @media (max-width: 640px) {
          #sidebar-toggle { display: flex !important; }
          .sidebar-hidden { display: none !important; }
        }
        @media (min-width: 641px) {
          .sidebar-hidden { display: flex !important; }
        }
      `}</style>
    </div>
  );
}