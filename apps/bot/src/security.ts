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
