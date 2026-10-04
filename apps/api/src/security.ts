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
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

export function protectJson(value: unknown): Record<string, string> {
  return { __dispatch_encrypted__: encryptText(JSON.stringify(value))! };
}

export function unprotectJson(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const marker = (value as Record<string, unknown>).__dispatch_encrypted__;
  if (typeof marker !== 'string') return value;
  return JSON.parse(decryptText(marker)!);
}
