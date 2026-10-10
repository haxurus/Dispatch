'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/*
 * Searchable, accessible combobox for Discord channels and roles (and any
 * other id/name list: ticket categories, forms...). Single or multiple
 * selection; the value shape is the same as the native <select> it replaces
 * ('' for no selection in single mode, string[] in multiple mode).
 */

export type PickerChannel = { id: string; name: string; type: number; parentId?: string | null; position?: number };
export type PickerRole = { id: string; name: string; color?: number; position?: number; managed?: boolean };
export type PickerItem = { id: string; name: string; hint?: string | null };

/** Discord channel types used by the dashboard. */
export const CHANNEL_TYPES = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  forum: 15
} as const;

type Source =
  | { kind: 'channel'; channels: PickerChannel[]; channelTypes?: readonly number[] }
  | { kind: 'role'; roles: PickerRole[]; guildId: string; excludeManaged?: boolean }
  | { kind: 'item'; items: PickerItem[] };

type Selection =
  | { multiple: true; value: string[]; onChange: (value: string[]) => void; max?: number }
  | { multiple?: false; value: string; onChange: (value: string) => void };

type Common = {
  label: string;
  /** Input placeholder; in single mode also shown when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Short help text under the field. */
  hint?: string;
};

export type ResourcePickerProps = Common & Source & Selection;

type Option = {
  id: string;
  label: string;
  prefix: string;
  meta: string | null;
  color: string | null;
  search: string;
};

const RENDER_LIMIT = 50;

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const roleColor = (color: number | undefined) =>
  color ? `#${color.toString(16).padStart(6, '0')}` : null;

function channelPrefix(type: number) {
  if (type === CHANNEL_TYPES.category) return '';
  if (type === CHANNEL_TYPES.voice || type === 13) return '🔊 ';
  return '#';
}

function buildOptions(source: Source): Option[] {
  if (source.kind === 'channel') {
    const categories = new Map(
      source.channels.filter((channel) => channel.type === CHANNEL_TYPES.category).map((channel) => [channel.id, channel])
    );
    const allowed = source.channelTypes ? new Set(source.channelTypes) : null;
    // Discord order: grouped by parent category, then by position.
    const sortKey = (channel: PickerChannel): [number, number] => {
      if (channel.type === CHANNEL_TYPES.category) return [channel.position ?? 0, -1];
      const parent = channel.parentId ? categories.get(channel.parentId) : undefined;
      return [parent ? parent.position ?? 0 : -1, channel.position ?? 0];
    };
    return source.channels
      .filter((channel) => !allowed || allowed.has(channel.type))
      .map((channel) => ({ channel, key: sortKey(channel) }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
      .map(({ channel }) => {
        const parent = channel.parentId ? categories.get(channel.parentId)?.name ?? null : null;
        return {
          id: channel.id,
          label: channel.name,
          prefix: channelPrefix(channel.type),
          meta: channel.type === CHANNEL_TYPES.category ? 'Categoria' : parent,
          color: null,
          search: normalizeSearch(`${channel.name} ${channel.id} ${parent ?? ''}`)
        };
      });
  }
  if (source.kind === 'role') {
    return source.roles
      .filter((role) => role.id !== source.guildId && !(source.excludeManaged && role.managed))
      .map((role) => ({
        id: role.id,
        label: role.name,
        prefix: '@',
        meta: role.managed ? 'Gestito da integrazione' : null,
        color: roleColor(role.color),
        search: normalizeSearch(`${role.name} ${role.id}`)
      }));
  }
  return source.items.map((item) => ({
    id: item.id,
    label: item.name,
    prefix: '',
    meta: item.hint ?? null,
    color: null,
    search: normalizeSearch(`${item.name} ${item.id} ${item.hint ?? ''}`)
  }));
}

export default function ResourcePicker(props: ResourcePickerProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const labelId = `${uid}-label`;
  const listId = `${uid}-list`;
  const hintId = `${uid}-hint`;
  const optionId = (index: number) => `${uid}-opt-${index}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const { label, placeholder, disabled = false, required = false, hint } = props;
  const multiple = props.multiple === true;
  const selected = useMemo(
    () => (props.multiple === true ? props.value : props.value ? [props.value] : []),
    [props.multiple, props.value]
  );
  const max = props.multiple === true ? props.max : 1;

  // Rebuilt only when the source data changes.
  const sourceKey = props.kind === 'channel' ? props.channels
    : props.kind === 'role' ? props.roles
      : props.items;
  const options = useMemo(
    () => buildOptions(props as Source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.kind, sourceKey,
      props.kind === 'channel' ? props.channelTypes?.join(',') : '',
      props.kind === 'role' ? `${props.guildId}:${props.excludeManaged ? 1 : 0}` : '']
  );
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    return needle ? options.filter((option) => option.search.includes(needle)) : options;
  }, [options, query]);
  const visible = filtered.slice(0, RENDER_LIMIT);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const isSelected = (id: string) => selected.includes(id);
  const atMax = multiple && max !== undefined && selected.length >= max;

  const choose = (id: string) => {
    if (props.multiple === true) {
      if (isSelected(id)) props.onChange(props.value.filter((value) => value !== id));
      else if (!atMax) props.onChange([...props.value, id]);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    props.onChange(id);
    setQuery('');
    setOpen(false);
  };

  const remove = (id: string) => {
    if (props.multiple === true) props.onChange(props.value.filter((value) => value !== id));
    else props.onChange('');
    inputRef.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        setActive((current) => Math.min(current + 1, Math.max(0, visible.length - 1)));
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        setActive((current) => Math.max(current - 1, 0));
        return;
      case 'Home':
        if (open) { event.preventDefault(); setActive(0); }
        return;
      case 'End':
        if (open) { event.preventDefault(); setActive(Math.max(0, visible.length - 1)); }
        return;
      case 'Enter': {
        if (!open) return;
        // Never submit the surrounding form while the list is open.
        event.preventDefault();
        const option = visible[active];
        if (option) choose(option.id);
        return;
      }
      case 'Escape':
        if (open || query) {
          event.preventDefault();
          setOpen(false);
          setQuery('');
        }
        return;
      case 'Backspace':
        if (!query && selected.length) {
          event.preventDefault();
          remove(selected[selected.length - 1]!);
        }
        return;
      case 'Tab':
        setOpen(false);
        setQuery('');
        return;
      default:
    }
  };

  const chipFor = (id: string) => {
    const option = byId.get(id);
    return {
      id,
      label: option ? option.label : 'Non disponibile',
      prefix: option?.prefix ?? '',
      color: option?.color ?? null,
      title: option ? `${option.prefix}${option.label} · ${id}` : `Elemento non più disponibile · ${id}`,
      missing: !option
    };
  };

  const inputPlaceholder = selected.length
    ? (multiple ? (atMax ? '' : 'Aggiungi…') : 'Cambia…')
    : placeholder ?? 'Cerca per nome o ID…';
  const activeId = open && visible[active] ? optionId(active) : undefined;
  const describedBy = hint ? hintId : undefined;

  return (
    <div className={`picker${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}`} ref={rootRef}>
      <label className="picker-label" id={labelId} htmlFor={inputId}>{label}</label>
      <div
        className="picker-control"
        onMouseDown={(event) => {
          // Clicking the empty area of the control focuses the input.
          if (event.target === event.currentTarget) {
            event.preventDefault();
            inputRef.current?.focus();
            openList();
          }
        }}
      >
        {selected.map((id) => {
          const chip = chipFor(id);
          return (
            <span className={`picker-chip${chip.missing ? ' is-missing' : ''}${multiple ? '' : ' is-single'}`} key={id} title={chip.title}>
              {chip.color && <i className="role-dot" style={{ background: chip.color }} aria-hidden="true" />}
              <span>{chip.prefix}{chip.label}</span>
              {multiple && (
                <button
                  type="button"
                  className="picker-chip-remove"
                  aria-label={`Rimuovi ${chip.prefix}${chip.label}`}
                  disabled={disabled}
                  onClick={() => remove(id)}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          disabled={disabled}
          value={query}
          placeholder={inputPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        {!multiple && selected.length > 0 && !required && (
          <button
            type="button"
            className="picker-clear"
            aria-label="Rimuovi selezione"
            disabled={disabled}
            onClick={() => remove(selected[0]!)}
          >
            ×
          </button>
        )}
        {required && (
          // Native constraint validation for the surrounding <form>.
          <input
            className="picker-required"
            tabIndex={-1}
            aria-hidden="true"
            required
            disabled={disabled}
            value={selected.length ? 'ok' : ''}
            onChange={() => undefined}
            onFocus={() => inputRef.current?.focus()}
          />
        )}
      </div>
      {hint && <span className="picker-hint" id={hintId}>{hint}</span>}
      <ul
        className="picker-list"
        id={listId}
        ref={listRef}
        role="listbox"
        aria-labelledby={labelId}
        aria-multiselectable={multiple || undefined}
        hidden={!open}
      >
        {visible.map((option, index) => {
          const chosen = isSelected(option.id);
          const blocked = !chosen && atMax;
          return (
            <li
              key={option.id}
              id={optionId(index)}
              data-index={index}
              role="option"
              aria-selected={chosen}
              aria-disabled={blocked || undefined}
              className={`picker-option${index === active ? ' is-active' : ''}${chosen ? ' is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => { if (!blocked) choose(option.id); }}
            >
              {option.color !== null && <i className="role-dot" style={{ background: option.color }} aria-hidden="true" />}
              <span className="picker-option-label">{option.prefix}{option.label}</span>
              {option.meta && <span className="picker-option-meta">{option.meta}</span>}
              <span className="picker-option-id mono">{option.id}</span>
            </li>
          );
        })}
        {!visible.length && (
          <li className="picker-empty" role="presentation">
            {options.length ? 'Nessun risultato.' : 'Nessun elemento disponibile.'}
          </li>
        )}
        {filtered.length > visible.length && (
          <li className="picker-more" role="presentation">
            Altri {filtered.length - visible.length} risultati: continua a scrivere per filtrare.
          </li>
        )}
      </ul>
    </div>
  );
}
