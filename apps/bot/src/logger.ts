import pino from 'pino';
import { createLogBuffer } from '@dispatch/shared';
import { redactText } from './security.js';

/*
 * The bot's logger: stdout for Docker, plus the latest lines in memory
 * (redacted) for the super console's Logs tab, read through the internal API.
 */

export const logBuffer = createLogBuffer(2_000, redactText);

const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;
export const logger = pino({ level }, pino.multistream([
  { level, stream: process.stdout },
  { level, stream: logBuffer }
]));
