import { query } from '../db/client.js';
import { on, EventTypes } from './eventBus.js';

// Subscribe to inference events to upsert hourly metrics
export function startMetricsAggregator() {
  on(EventTypes.INFERENCE_COMPLETE, async (payload) => {
    await upsertHourlyMetrics(payload);
  });
  on(EventTypes.INFERENCE_ERROR, async (payload) => {
    await upsertHourlyMetrics(payload);
  });
  console.log('[Metrics] Aggregator started');
}

async function upsertHourlyMetrics({ provider, model, latency_ms, status, total_tokens, prompt_tokens, completion_tokens }) {
  const hour = new Date();
  hour.setMinutes(0, 0, 0);

  const isSuccess = status === 'success' ? 1 : 0;
  const isError = status === 'error' ? 1 : 0;
  const latency = latency_ms || 0;

  try {
    await query(`
      INSERT INTO metrics_hourly (
        hour, provider, model,
        total_requests, successful_requests, failed_requests,
        avg_latency_ms, total_tokens, total_prompt_tokens, total_completion_tokens
      ) VALUES ($1,$2,$3, 1,$4,$5, $6,$7,$8,$9)
      ON CONFLICT (hour, provider, model) DO UPDATE SET
        total_requests = metrics_hourly.total_requests + 1,
        successful_requests = metrics_hourly.successful_requests + $4,
        failed_requests = metrics_hourly.failed_requests + $5,
        avg_latency_ms = (metrics_hourly.avg_latency_ms * metrics_hourly.total_requests + $6) / (metrics_hourly.total_requests + 1),
        total_tokens = metrics_hourly.total_tokens + $7,
        total_prompt_tokens = metrics_hourly.total_prompt_tokens + $8,
        total_completion_tokens = metrics_hourly.total_completion_tokens + $9
    `, [
      hour.toISOString(), provider, model,
      isSuccess, isError,
      latency,
      total_tokens || 0, prompt_tokens || 0, completion_tokens || 0
    ]);
  } catch (err) {
    console.error('[Metrics] Upsert error:', err.message);
  }
}

export async function getMetrics(hours = 24) {
  const res = await query(`
    SELECT * FROM metrics_hourly
    WHERE hour >= NOW() - ($1 || ' hours')::INTERVAL
    ORDER BY hour DESC, total_requests DESC
  `, [hours]);
  return res.rows;
}

export async function getDashboardStats() {
  const [overall, byProvider, latencyPercentiles, errorRate] = await Promise.all([
    query(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
        AVG(latency_ms) as avg_latency,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50_latency,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99_latency,
        SUM(total_tokens) as total_tokens,
        COUNT(DISTINCT conversation_id) as conversations
      FROM inference_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `),
    query(`
      SELECT provider, model, COUNT(*) as requests,
             AVG(latency_ms) as avg_latency,
             SUM(total_tokens) as tokens
      FROM inference_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY provider, model ORDER BY requests DESC
    `),
    query(`
      SELECT
        DATE_TRUNC('hour', created_at) as hour,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95,
        COUNT(*) as requests
      FROM inference_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours' AND latency_ms IS NOT NULL
      GROUP BY hour ORDER BY hour
    `),
    query(`
      SELECT
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as total,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors
      FROM inference_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hour ORDER BY hour
    `),
  ]);

  return {
    overall: overall.rows[0],
    byProvider: byProvider.rows,
    latencyTimeSeries: latencyPercentiles.rows,
    errorRateTimeSeries: errorRate.rows,
  };
}
