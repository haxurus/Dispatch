import crypto from 'node:crypto';
import fs from 'node:fs';

const PREFIX = 'enc:v1:';

function keyFromEnv() {
  const file = process.env.DATA_ENCRYPTION_KEY_FILE?.trim();
  const raw = file ? fs.readFileSync(file, 'utf8').trim() : process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('Missing DATA_ENCRYPTION_KEY or DATA_ENCRYPTION_KEY_FILE');

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
  return key;
}

const key = keyFromEnv();

export function encryptText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}


export function decryptText(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const tag = Buffer.from(tagB64, 'base64url');
  if (tag.length !== 16) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** Same envelope as the API (apps/api/src/security.ts): the API decrypts it. */
export function protectJson(value: unknown): Record<string, string> {
  return { __dispatch_encrypted__: encryptText(JSON.stringify(value))! };
}

// Error texts and log lines may quote connection strings or tokens: never
// post or show them (status notices, super console logs).
const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}/g, '[token]'],
  [/\b(postgres(?:ql)?|redis|https?):\/\/[^\s'"]+/gi, '$1://[redacted]'],
  [/(Bearer|Bot)\s+[A-Za-z0-9._-]{16,}/g, '$1 [redacted]']
];
export const redactText = (value: string) => REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
