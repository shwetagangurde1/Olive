import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/client.js';
import { emit, EventTypes } from '../services/eventBus.js';
import { safePreview } from '../services/piiRedactor.js';

const router = Router();

// Cost per 1M tokens in microcents (1 USD = 100 microcents * 10000)
const COST_TABLE = {
  'anthropic': {
    'claude-sonnet-4-20250514': { input: 300, output: 1500 },
    'claude-haiku-4-5-20251001': { input: 25, output: 125 },
    'claude-opus-4-20250514': { input: 1500, output: 7500 },
  }
};

function estimateCost(provider, model, promptTokens, completionTokens) {
  const costs = COST_TABLE[provider]?.[model];
  if (!costs) return null;
  return Math.round(
    (promptTokens / 1_000_000) * costs.input * 1_000_000 +
    (completionTokens / 1_000_000) * costs.output * 1_000_000
  );
}

// POST /api/chat/stream - streaming chat with SSE
router.post('/stream', async (req, res) => {
  const { conversation_id, message, provider = 'anthropic', model = 'claude-sonnet-4-20250514' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Load conversation history
  let systemPrompt = 'You are a helpful AI assistant.';
  let history = [];

  if (conversation_id) {
    const [convRes, msgRes] = await Promise.all([
      query('SELECT * FROM conversations WHERE id = $1', [conversation_id]),
      query('SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY turn_index ASC LIMIT 20', [conversation_id]),
    ]);
    if (convRes.rows[0]?.system_prompt) systemPrompt = convRes.rows[0].system_prompt;
    history = msgRes.rows.map(m => ({ role: m.role, content: m.content }));
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const requestStartedAt = new Date();
  let firstTokenAt = null;
  let fullContent = '';
  let chunkCount = 0;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let logId = null;

  // Create pending log entry immediately
  try {
    const pendingLog = await query(`
      INSERT INTO inference_logs (
        conversation_id, provider, model, request_started_at,
        status, is_streaming, input_preview
      ) VALUES ($1,$2,$3,$4,'pending',true,$5) RETURNING id
    `, [conversation_id, provider, model, requestStartedAt.toISOString(), safePreview(message)]);
    logId = pendingLog.rows[0].id;
  } catch (e) { /* non-fatal */ }

  // Send log ID to client for correlation
  res.write(`data: ${JSON.stringify({ type: 'meta', log_id: logId })}\n\n`);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const messages = [...history, { role: 'user', content: message }];

    const stream = await client.messages.stream({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        if (!firstTokenAt) firstTokenAt = Date.now();
        fullContent += chunk.delta.text;
        chunkCount++;
        res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk.delta.text })}\n\n`);
      }
      if (chunk.type === 'message_delta' && chunk.usage) {
        usage.output_tokens = chunk.usage.output_tokens;
      }
      if (chunk.type === 'message_start' && chunk.message?.usage) {
        usage.input_tokens = chunk.message.usage.input_tokens;
      }
    }

    const requestEndedAt = new Date();
    const latencyMs = requestEndedAt - requestStartedAt;
    const ttftMs = firstTokenAt ? firstTokenAt - requestStartedAt.getTime() : null;
    const totalTokens = usage.input_tokens + usage.output_tokens;
    const cost = estimateCost(provider, model, usage.input_tokens, usage.output_tokens);

    // Update log entry
    if (logId) {
      await query(`
        UPDATE inference_logs SET
          request_ended_at=$1, latency_ms=$2, time_to_first_token_ms=$3,
          prompt_tokens=$4, completion_tokens=$5, total_tokens=$6,
          output_preview=$7, status='success', stream_chunks=$8,
          estimated_cost_microcents=$9
        WHERE id=$10
      `, [requestEndedAt, latencyMs, ttftMs, usage.input_tokens, usage.output_tokens, totalTokens,
          safePreview(fullContent), chunkCount, cost, logId]);
    }

    // Save messages to DB if conversation exists
    if (conversation_id) {
      const lastIdx = await query(
        'SELECT COALESCE(MAX(turn_index), -1) as last FROM messages WHERE conversation_id = $1',
        [conversation_id]
      );
      const nextIdx = lastIdx.rows[0].last + 1;
      const [userMsg] = await Promise.all([
        query('INSERT INTO messages (conversation_id, role, content, turn_index) VALUES ($1,$2,$3,$4) RETURNING id',
          [conversation_id, 'user', message, nextIdx]),
      ]);
      await query('INSERT INTO messages (conversation_id, role, content, turn_index) VALUES ($1,$2,$3,$4)',
        [conversation_id, 'assistant', fullContent, nextIdx + 1]);

      // Auto-title conversation from first user message
      await query(`UPDATE conversations SET title = COALESCE(title, $1) WHERE id = $2`,
        [message.slice(0, 60), conversation_id]);
    }

    emit(EventTypes.INFERENCE_COMPLETE, {
      log_id: logId, provider, model, latency_ms: latencyMs,
      status: 'success', total_tokens: totalTokens,
      prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
    }, conversation_id, 'conversation').catch(console.error);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      latency_ms: latencyMs,
      ttft_ms: ttftMs,
      usage: { input: usage.input_tokens, output: usage.output_tokens, total: totalTokens },
      log_id: logId,
    })}\n\n`);
    res.end();

  } catch (err) {
    console.error('[Chat] Stream error:', err.message);

    if (logId) {
      await query(`UPDATE inference_logs SET status='error', error_message=$1 WHERE id=$2`,
        [err.message, logId]).catch(() => {});
    }

    emit(EventTypes.INFERENCE_ERROR, { log_id: logId, provider, model, status: 'error', error: err.message },
      conversation_id, 'conversation').catch(console.error);

    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// GET /api/chat/logs - recent inference logs
router.get('/logs', async (req, res) => {
  const { limit = 50, conversation_id } = req.query;
  try {
    const result = await query(`
      SELECT * FROM inference_logs
      ${conversation_id ? 'WHERE conversation_id = $2' : ''}
      ORDER BY created_at DESC LIMIT $1
    `, conversation_id ? [limit, conversation_id] : [limit]);
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
