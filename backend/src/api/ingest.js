import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/client.js';
import { emit, EventTypes } from '../services/eventBus.js';
import { safePreview, redact } from '../services/piiRedactor.js';

const router = Router();

// Validation schema for inference log payloads
const InferenceLogSchema = z.object({
  session_id: z.string().optional(),
  conversation_id: z.string().uuid().optional(),
  message_id: z.string().uuid().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  request_started_at: z.string().datetime(),
  request_ended_at: z.string().datetime().optional(),
  latency_ms: z.number().int().nonneg().optional(),
  time_to_first_token_ms: z.number().int().nonneg().optional(),
  prompt_tokens: z.number().int().nonneg().optional(),
  completion_tokens: z.number().int().nonneg().optional(),
  total_tokens: z.number().int().nonneg().optional(),
  input_text: z.string().optional(),   // raw; we'll redact+preview
  output_text: z.string().optional(),
  status: z.enum(['pending', 'success', 'error', 'cancelled']).default('success'),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  http_status: z.number().int().optional(),
  is_streaming: z.boolean().default(false),
  stream_chunks: z.number().int().optional(),
  estimated_cost_microcents: z.number().int().optional(),
  sdk_metadata: z.record(z.unknown()).optional(),
});

// POST /api/ingest/log - ingest a single inference log
router.post('/log', async (req, res) => {
  const parse = InferenceLogSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
  }

  const data = parse.data;

  // PII redaction on input/output
  const inputResult = data.input_text ? redact(data.input_text) : { redacted: null, hasPii: false };
  const outputResult = data.output_text ? redact(data.output_text) : { redacted: null, hasPii: false };

  const inputPreview = safePreview(data.input_text);
  const outputPreview = safePreview(data.output_text);

  try {
    const result = await query(`
      INSERT INTO inference_logs (
        session_id, conversation_id, message_id,
        provider, model,
        request_started_at, request_ended_at, latency_ms, time_to_first_token_ms,
        prompt_tokens, completion_tokens, total_tokens,
        input_preview, output_preview,
        status, error_code, error_message, http_status,
        is_streaming, stream_chunks,
        estimated_cost_microcents,
        sdk_metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      ) RETURNING id
    `, [
      data.session_id, data.conversation_id, data.message_id,
      data.provider, data.model,
      data.request_started_at, data.request_ended_at, data.latency_ms, data.time_to_first_token_ms,
      data.prompt_tokens, data.completion_tokens, data.total_tokens,
      inputPreview, outputPreview,
      data.status, data.error_code, data.error_message, data.http_status,
      data.is_streaming, data.stream_chunks,
      data.estimated_cost_microcents,
      JSON.stringify(data.sdk_metadata || {}),
    ]);

    const logId = result.rows[0].id;

    // Fire event asynchronously
    const eventType = data.status === 'error' ? EventTypes.INFERENCE_ERROR : EventTypes.INFERENCE_COMPLETE;
    emit(eventType, {
      log_id: logId,
      provider: data.provider,
      model: data.model,
      latency_ms: data.latency_ms,
      status: data.status,
      total_tokens: data.total_tokens,
      prompt_tokens: data.prompt_tokens,
      completion_tokens: data.completion_tokens,
    }, data.conversation_id, 'conversation').catch(console.error);

    res.status(201).json({ id: logId, status: 'ingested' });
  } catch (err) {
    console.error('[Ingest] Error:', err.message);
    res.status(500).json({ error: 'Ingestion failed' });
  }
});

// POST /api/ingest/batch - batch ingest multiple logs
router.post('/batch', async (req, res) => {
  const { logs } = req.body;
  if (!Array.isArray(logs) || logs.length === 0) {
    return res.status(400).json({ error: 'logs must be a non-empty array' });
  }
  if (logs.length > 100) {
    return res.status(400).json({ error: 'Max 100 logs per batch' });
  }

  const results = await Promise.allSettled(
    logs.map(log =>
      fetch(`http://localhost:${process.env.PORT || 3001}/api/ingest/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  res.json({ total: logs.length, succeeded, failed: logs.length - succeeded });
});

export default router;
