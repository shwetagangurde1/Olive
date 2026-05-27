import { Router } from 'express';
import { query } from '../db/client.js';
import { emit, EventTypes } from '../services/eventBus.js';

const router = Router();

// GET /api/conversations - list conversations
router.get('/', async (req, res) => {
  const { status = 'active', limit = 50, offset = 0 } = req.query;
  try {
    const result = await query(`
      SELECT c.*,
        COUNT(m.id) as message_count,
        MAX(m.created_at) as last_message_at
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE ($1 = 'all' OR c.status = $1)
      GROUP BY c.id
      ORDER BY COALESCE(MAX(m.created_at), c.created_at) DESC
      LIMIT $2 OFFSET $3
    `, [status, limit, offset]);
    res.json({ conversations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id - get conversation with messages
router.get('/:id', async (req, res) => {
  try {
    const [conv, msgs] = await Promise.all([
      query('SELECT * FROM conversations WHERE id = $1', [req.params.id]),
      query('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY turn_index ASC', [req.params.id]),
    ]);
    if (!conv.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ conversation: conv.rows[0], messages: msgs.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations - create conversation
router.post('/', async (req, res) => {
  const { title, provider = 'anthropic', model = 'openai/gpt-oss-20b:free', system_prompt, metadata } = req.body;
  try {
    const result = await query(`
      INSERT INTO conversations (title, provider, model, system_prompt, metadata)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [title, provider, model, system_prompt, JSON.stringify(metadata || {})]);

    const conversation = result.rows[0];
    emit(EventTypes.CONVERSATION_CREATED, conversation, conversation.id, 'conversation').catch(console.error);
    res.status(201).json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/conversations/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  try {
    const result = await query(`
      UPDATE conversations
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING *
    `, [req.params.id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Not found or already cancelled' });
    const conversation = result.rows[0];
    emit(EventTypes.CONVERSATION_CANCELLED, conversation, conversation.id, 'conversation').catch(console.error);
    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:id/messages - save a message
router.post('/:id/messages', async (req, res) => {
  const { role, content, turn_index } = req.body;
  if (!role || !content) return res.status(400).json({ error: 'role and content required' });

  try {
    // Determine turn_index if not provided
    let idx = turn_index;
    if (idx === undefined) {
      const last = await query(
        'SELECT COALESCE(MAX(turn_index), -1) as last FROM messages WHERE conversation_id = $1',
        [req.params.id]
      );
      idx = last.rows[0].last + 1;
    }

    const result = await query(`
      INSERT INTO messages (conversation_id, role, content, turn_index)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [req.params.id, role, content, idx]);

    const message = result.rows[0];
    emit(EventTypes.MESSAGE_SAVED, message, req.params.id, 'conversation').catch(console.error);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
