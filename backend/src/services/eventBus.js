import { query } from '../db/client.js';

// In-memory event emitter for same-process subscribers
// In production: replace with Redis Pub/Sub, Kafka, or RabbitMQ
const subscribers = new Map();

export const EventTypes = {
  INFERENCE_STARTED: 'inference.started',
  INFERENCE_COMPLETE: 'inference.complete',
  INFERENCE_ERROR: 'inference.error',
  INFERENCE_CANCELLED: 'inference.cancelled',
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_CANCELLED: 'conversation.cancelled',
  MESSAGE_SAVED: 'message.saved',
  LOG_INGESTED: 'log.ingested',
};

export async function emit(eventType, payload, aggregateId = null, aggregateType = null) {
  // 1. Persist to DB (durable event log)
  try {
    await query(
      `INSERT INTO events (event_type, aggregate_id, aggregate_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [eventType, aggregateId, aggregateType, JSON.stringify(payload)]
    );
  } catch (err) {
    console.error('[EventBus] Failed to persist event:', err.message);
  }

  // 2. Notify in-process subscribers
  const handlers = subscribers.get(eventType) || [];
  for (const handler of handlers) {
    try {
      await handler(payload, aggregateId);
    } catch (err) {
      console.error(`[EventBus] Handler error for ${eventType}:`, err.message);
    }
  }
}

export function on(eventType, handler) {
  if (!subscribers.has(eventType)) subscribers.set(eventType, []);
  subscribers.get(eventType).push(handler);
}

export function off(eventType, handler) {
  const handlers = subscribers.get(eventType) || [];
  subscribers.set(eventType, handlers.filter(h => h !== handler));
}
