// Basic backend input sanitization utilities for LinkedIn Genie
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /javascript:/gi,
  /data:text\/html/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<(object|embed)\b[^<]*(?:(?!<\/<\1>)<[^<]*)*<\/<\1>/gi,
  /style\s*=\s*["'][^"']*expression\s*\([^"']*["']/gi,
];

export function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  let sanitized = input;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized;
}
