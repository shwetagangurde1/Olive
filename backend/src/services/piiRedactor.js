// Lightweight regex-based PII redactor
// In production: replace with a proper NLP-based solution (Presidio, AWS Comprehend, etc.)

const PII_PATTERNS = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { name: 'phone_us', pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, replacement: '[PHONE]' },
  { name: 'ssn', pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: '[SSN]' },
  { name: 'credit_card', pattern: /\b(?:\d[ -]?){13,16}\b/g, replacement: '[CARD]' },
  { name: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
  { name: 'api_key', pattern: /\b(sk-|pk-|api[_-]?key[=:\s]+)[a-zA-Z0-9\-_]{16,}/gi, replacement: '[API_KEY]' },
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[JWT]' },
];

/**
 * Redacts PII from a string. Returns { redacted, hasPii, findings }
 */
export function redact(text) {
  if (!text || typeof text !== 'string') return { redacted: text, hasPii: false, findings: [] };

  let redacted = text;
  const findings = [];

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches) {
      findings.push({ type: name, count: matches.length });
      redacted = redacted.replace(pattern, replacement);
    }
  }

  return { redacted, hasPii: findings.length > 0, findings };
}

/**
 * Creates a safe preview (truncated + redacted)
 */
export function safePreview(text, maxLen = 200) {
  if (!text) return '';
  const { redacted } = redact(text);
  return redacted.length > maxLen ? redacted.slice(0, maxLen) + '…' : redacted;
}
