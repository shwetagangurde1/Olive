import { Router } from 'express';
import OpenAI from 'openai';

import { query } from '../db/client.js';
import { emit, EventTypes } from '../services/eventBus.js';
import { safePreview } from '../services/piiRedactor.js';

const router = Router();

/*
  OpenRouter Client
*/
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.SITE_URL || 'http://localhost:5174',
    'X-Title': 'LLM Observatory',
  },
});

/*
  POST /api/chat/stream
  - Uses REAL OpenRouter streaming
  - Tracks latency_ms and ttft_ms accurately
  - Sends complete `done` event with usage + timing
*/
router.post('/stream', async (req, res) => {
  const {
    conversation_id,
    message,
    provider = 'openrouter',
    model = 'mistralai/mistral-small-3.2-24b-instruct:free',
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message required' });
  }

  /*
    Load conversation history (last 20 messages for context)
  */
  let history = [];
  if (conversation_id) {
    const msgRes = await query(
      `SELECT role, content
       FROM messages
       WHERE conversation_id = $1
       ORDER BY turn_index ASC
       LIMIT 20`,
      [conversation_id]
    );
    history = msgRes.rows.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  /*
    SSE Headers
  */
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const requestStartedAt = new Date();
  const startMs = Date.now();

  let fullContent = '';
  let logId = null;
  let ttftMs = null;
  let usage = null;

  try {
    /*
      Create pending log entry
    */
    const pendingLog = await query(
      `INSERT INTO inference_logs (
        conversation_id, provider, model,
        request_started_at, status, is_streaming, input_preview
      ) VALUES ($1,$2,$3,$4,'pending',true,$5)
      RETURNING id`,
      [
        conversation_id,
        provider,
        model,
        requestStartedAt,
        safePreview(message),
      ]
    );

    logId = pendingLog.rows[0].id;

    // Send log ID to client immediately
    res.write(
      `data: ${JSON.stringify({ type: 'meta', log_id: logId })}\n\n`
    );

    /*
      Real streaming request to OpenRouter
    */
    const stream = await client.chat.completions.create({
      model,
      messages: [
        ...history,
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
    });

    /*
      Stream chunks to client as SSE deltas
    */
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;

      if (delta) {
        // Record time-to-first-token
        if (ttftMs === null) {
          ttftMs = Date.now() - startMs;
        }

        fullContent += delta;

        res.write(
          `data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`
        );
      }

      // Capture usage from the final chunk (stream_options)
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    const latencyMs = Date.now() - startMs;

    /*
      Save messages to DB
    */
    if (conversation_id) {
      const lastIdx = await query(
        `SELECT COALESCE(MAX(turn_index), -1) as last
         FROM messages WHERE conversation_id = $1`,
        [conversation_id]
      );
      const nextIdx = lastIdx.rows[0].last + 1;

      await query(
        `INSERT INTO messages (conversation_id, role, content, turn_index)
         VALUES ($1,'user',$2,$3)`,
        [conversation_id, message, nextIdx]
      );
      await query(
        `INSERT INTO messages (conversation_id, role, content, turn_index)
         VALUES ($1,'assistant',$2,$3)`,
        [conversation_id, fullContent, nextIdx + 1]
      );
    }

    /*
      Update inference log with final stats
    */
    await query(
      `UPDATE inference_logs SET
        request_ended_at = NOW(),
        latency_ms = $1,
        time_to_first_token_ms = $2,
        prompt_tokens = $3,
        completion_tokens = $4,
        total_tokens = $5,
        output_preview = $6,
        status = 'success'
       WHERE id = $7`,
      [
        latencyMs,
        ttftMs,
        usage?.prompt_tokens ?? null,
        usage?.completion_tokens ?? null,
        usage?.total_tokens ?? null,
        safePreview(fullContent),
        logId,
      ]
    );

    emit(
      EventTypes.INFERENCE_COMPLETE,
      {
        log_id: logId,
        provider,
        model,
        status: 'success',
        latency_ms: latencyMs,
        total_tokens: usage?.total_tokens,
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
      },
      conversation_id,
      'conversation'
    ).catch(console.error);

    /*
      Send done event with full metadata
    */
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        log_id: logId,
        latency_ms: latencyMs,
        ttft_ms: ttftMs,
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            }
          : null,
      })}\n\n`
    );

    res.end();
  } catch (err) {
    console.error('[Chat Error]', err);

    if (logId) {
      await query(
        `UPDATE inference_logs SET status='error', error_message=$1 WHERE id=$2`,
        [err.message, logId]
      ).catch(() => {});
    }

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        message: err.message || 'Unknown error from AI provider',
      })}\n\n`
    );
    res.end();
  }
});

/*
  GET /api/chat/logs
*/
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const result = await query(
      `SELECT * FROM inference_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;