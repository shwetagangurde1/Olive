import dotenv from 'dotenv';
dotenv.config();
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

// CORS — allow all localhost origins in development
app.use(cors({
  origin: function(origin, callback) {
    callback(null, true);
  },
  credentials: true,
}));

// JSON parser
app.use(express.json({ limit: '2mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      db: 'connected',
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Health Check] DB Error:', err.message);
    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
    });
  }
});

// API routes
app.use('/api/ingest', ingestRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/metrics', metricsRouter);

// 404 handler
app.use((_req, res) => {
  return res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  return res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
async function start() {
  try {
    console.log('[Server] Running migrations...');
    await migrate();

    console.log('[Server] Starting metrics aggregator...');
    startMetricsAggregator();

    app.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

start();