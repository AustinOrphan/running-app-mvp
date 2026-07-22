import { createHash } from 'crypto';

export interface RedactionOptions {
  hashEmails?: boolean;
  maskIPs?: boolean;
  redactPhones?: boolean;
}

const ALWAYS_REDACT_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'jwt',
  'authorization',
  'auth',
  'api_key',
  'apikey',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'private_key',
  'privateKey',
  'credit_card',
  'creditCard',
  'cvv',
  'ssn',
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CREDIT_CARD_REGEX = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const PHONE_REGEX = /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const JWT_REGEX = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;

export function hashEmail(email: string): string {
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex');
  return hash.substring(0, 12) + '@hash';
}

export function maskIP(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
  }
  return 'xxx.xxx.xxx.xxx';
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    const last4 = digits.slice(-4);
    return `***-***-${last4}`;
  }
  return '***-***-****';
}

export function isAlwaysRedactKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return ALWAYS_REDACT_KEYS.some((pattern) => lowerKey.includes(pattern));
}

export function redactString(
  value: string,
  options: RedactionOptions = {}
): string {
  let result = value;

  if (JWT_REGEX.test(value) && value.split('.').length === 3) {
    return '[REDACTED_JWT]';
  }

  result = result.replace(CREDIT_CARD_REGEX, '[REDACTED_CC]');

  if (options.redactPhones) {
    result = result.replace(PHONE_REGEX, (match) => maskPhone(match));
  }

  if (options.maskIPs) {
    result = result.replace(IP_REGEX, (match) => maskIP(match));
  }

  return result;
}

export function redactValue(
  value: unknown,
  key: string,
  options: RedactionOptions = {}
): unknown {
  if (isAlwaysRedactKey(key)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    if (options.hashEmails && EMAIL_REGEX.test(value)) {
      return hashEmail(value);
    }

    return redactString(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      redactValue(item, `${key}[${idx}]`, options)
    );
  }

  if (value && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>, options);
  }

  return value;
}

export function redactObject(
  obj: Record<string, unknown>,
  options: RedactionOptions = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    result[key] = redactValue(value, key, options);
  }

  return result;
}

export function createRedactor(options: RedactionOptions = {}) {
  return {
    redact: (obj: Record<string, unknown>) => redactObject(obj, options),
    redactString: (str: string) => redactString(str, options),
    redactValue: (value: unknown, key: string) =>
      redactValue(value, key, options),
  };
}
