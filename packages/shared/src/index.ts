export const TICKET_STATUSES = ['OPEN', 'WAITING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ACCESS_LEVELS = ['VIEWER', 'MODERATOR', 'ADMIN', 'OWNER'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'INTEGER',
  'NUMBER',
  'EMAIL',
  'URL',
  'DATE',
  'BOOLEAN',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'DISCORD_ID'
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export type QuestionOption = {
  label: string;
  value: string;
  description?: string | null;
};

export type FormQuestion = {
  id: string;
  label: string;
  description?: string | null;
  type: QuestionType;
  required: boolean;
  placeholder?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  minSelections?: number | null;
  maxSelections?: number | null;
  options?: QuestionOption[];
};

export type FormAnswer = {
  id: string;
  label: string;
  type: QuestionType;
  value: string | string[];
};

const ID = /^[a-z0-9_-]{1,40}$/i;
const SNOWFLAKE = /^\d{17,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clampInt = (value: unknown, min: number, max: number, fallback: number | null = null) =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;

function normalizeOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: QuestionOption[] = [];
  for (const item of value.slice(0, 25)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, 100) : '';
    const optionValue = typeof row.value === 'string' ? row.value.trim().slice(0, 100) : '';
    if (!label || !optionValue || seen.has(optionValue)) continue;
    seen.add(optionValue);
    options.push({
      label,
      value: optionValue,
      description: typeof row.description === 'string' ? row.description.trim().slice(0, 100) || null : null
    });
  }
  return options;
}

export function normalizeQuestions(value: unknown, maxQuestions = 25): FormQuestion[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, Math.max(0, Math.min(25, maxQuestions))).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, 100) : '';
    if (!label) return [];

    const legacyType = row.style === 'PARAGRAPH' ? 'LONG_TEXT' : 'SHORT_TEXT';
    const requestedType = typeof row.type === 'string' && QUESTION_TYPES.includes(row.type as QuestionType)
      ? row.type as QuestionType
      : legacyType;
    const options = normalizeOptions(row.options);
    const minLength = clampInt(row.minLength, 0, 4000);
    const maxLength = clampInt(row.maxLength, 1, 4000);
    const minSelections = clampInt(row.minSelections, 0, 25);
    const maxSelections = clampInt(row.maxSelections, 1, 25);

    return [{
      id: typeof row.id === 'string' && ID.test(row.id) ? row.id : `q${index + 1}`,
      label,
      description: typeof row.description === 'string' ? row.description.trim().slice(0, 500) || null : null,
      type: requestedType,
      required: row.required !== false,
      placeholder: typeof row.placeholder === 'string' ? row.placeholder.slice(0, 100) : null,
      minLength,
      maxLength,
      minValue: typeof row.minValue === 'number' && Number.isFinite(row.minValue) ? row.minValue : null,
      maxValue: typeof row.maxValue === 'number' && Number.isFinite(row.maxValue) ? row.maxValue : null,
      minSelections,
      maxSelections,
      options
    } satisfies FormQuestion];
  });
}

export type QuestionValidation =
  | { ok: true; value: string | string[] }
  | { ok: false; message: string };

export function validateQuestionAnswer(question: FormQuestion, raw: unknown): QuestionValidation {
  if (question.type === 'MULTI_SELECT') {
    const values = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string')
      : [];
    const clean = [...new Set(values)];
    if (!clean.length && question.required) return { ok: false, message: 'Questa risposta è obbligatoria.' };
    const allowed = new Set((question.options ?? []).map((option) => option.value));
    if (clean.some((value) => !allowed.has(value))) return { ok: false, message: 'Selezione non valida.' };
    const min = question.minSelections ?? (question.required ? 1 : 0);
    const max = question.maxSelections ?? Math.max(1, Math.min(25, allowed.size || 25));
    if (clean.length < min || clean.length > max) {
      return { ok: false, message: `Seleziona da ${min} a ${max} opzioni.` };
    }
    return { ok: true, value: clean };
  }

  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return question.required
      ? { ok: false, message: 'Questa risposta è obbligatoria.' }
      : { ok: true, value: '' };
  }

  if (question.type === 'SINGLE_SELECT') {
    const allowed = new Set((question.options ?? []).map((option) => option.value));
    return allowed.has(value)
      ? { ok: true, value }
      : { ok: false, message: 'Selezione non valida.' };
  }

  if (question.type === 'BOOLEAN') {
    return value === 'true' || value === 'false'
      ? { ok: true, value }
      : { ok: false, message: 'Scegli Sì oppure No.' };
  }

  if (question.type === 'INTEGER' || question.type === 'NUMBER') {
    if (question.type === 'INTEGER' && !/^[+-]?\d+$/.test(value)) {
      return { ok: false, message: 'Inserisci un numero intero valido.' };
    }
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed) || (question.type === 'INTEGER' && !Number.isSafeInteger(parsed))) {
      return { ok: false, message: 'Inserisci un numero valido.' };
    }
    if (question.minValue != null && parsed < question.minValue) {
      return { ok: false, message: `Il valore minimo è ${question.minValue}.` };
    }
    if (question.maxValue != null && parsed > question.maxValue) {
      return { ok: false, message: `Il valore massimo è ${question.maxValue}.` };
    }
    return { ok: true, value: String(parsed) };
  }

  if (question.type === 'EMAIL' && !EMAIL.test(value)) {
    return { ok: false, message: 'Inserisci un indirizzo email valido.' };
  }

  if (question.type === 'URL') {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch {
      return { ok: false, message: 'Inserisci un URL http/https valido.' };
    }
  }

  if (question.type === 'DATE') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, message: 'Usa il formato AAAA-MM-GG.' };
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      return { ok: false, message: 'Inserisci una data valida.' };
    }
  }

  if (question.type === 'DISCORD_ID' && !SNOWFLAKE.test(value)) {
    return { ok: false, message: 'Inserisci un ID Discord valido.' };
  }

  const minLength = question.minLength ?? 0;
  const maxLength = question.maxLength ?? 4000;
  if (value.length < minLength) return { ok: false, message: `Servono almeno ${minLength} caratteri.` };
  if (value.length > maxLength) return { ok: false, message: `Sono ammessi al massimo ${maxLength} caratteri.` };
  return { ok: true, value };
}

export function displayAnswer(answer: FormAnswer, question?: FormQuestion) {
  if (Array.isArray(answer.value)) {
    const map = new Map((question?.options ?? []).map((option) => [option.value, option.label]));
    return answer.value.map((value) => map.get(value) ?? value).join(', ') || 'Nessuna risposta';
  }
  if (answer.type === 'BOOLEAN') return answer.value === 'true' ? 'Sì' : answer.value === 'false' ? 'No' : 'Nessuna risposta';
  if (answer.type === 'SINGLE_SELECT') {
    return question?.options?.find((option) => option.value === answer.value)?.label ?? (answer.value || 'Nessuna risposta');
  }
  return answer.value || 'Nessuna risposta';
}
