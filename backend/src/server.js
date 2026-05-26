import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { migrate, pool } from './db/client.js';
import ingestRouter from './api/ingest.js';
import conversationsRouter from './api/conversations.js';
import chatRouter from './api/chat.js';
import metricsRouter from './api/metrics.js';
import { startMetricsAggregator } from './services/metrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.use('/api/ingest', ingestRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/metrics', metricsRouter);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await migrate();
    startMetricsAggregator();
    app.listen(PORT, () => console.log(`[Server] Listening on http://localhost:${PORT}`));
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

start();
