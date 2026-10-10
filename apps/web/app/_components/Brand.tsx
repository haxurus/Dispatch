import type { ReactNode } from 'react';

/** Dispatch mark: a ticket stub with an outgoing arrow and an accent dot. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M6 7.5A2.5 2.5 0 0 1 8.5 5h15A2.5 2.5 0 0 1 26 7.5v4a3 3 0 0 0 0 6v4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 21.5v-4a3 3 0 0 0 0-6v-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.5 14.5h6.6M14.3 11.6l2.9 2.9-2.9 2.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.4" cy="14.5" r="2" fill="var(--accent)" />
    </svg>
  );
}

export function Brand({ href, label = 'Dispatch - Home', className = '' }: { href: string; label?: string; className?: string }) {
  return (
    <a className={`brand ${className}`.trim()} href={href} aria-label={label}>
      <BrandMark />
      <span>Dispatch</span>
    </a>
  );
}

const paths = {
  ticket: <><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5Z" /><path d="M14.5 6v2M14.5 11v2M14.5 16v2" /></>,
  panel: <><rect x="4" y="4.5" width="16" height="15" rx="2" /><path d="M4 9h16M8 13h8M8 16.5h5" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.8c0-.4.3-.8.8-.8h4.4c.5 0 .8.4.8.8v.7M8.5 10h7M8.5 13.5h7M8.5 17h4" /></>,
  userCheck: <><circle cx="9.5" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.9-5 6-5 1.5 0 2.8.4 3.8 1.2" /><path d="m14.5 17.5 2 2 4-4.5" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 1.8" /></>,
  file: <><path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" /><path d="M13 3.5V8.5h5M9 13h6M9 16.5h6" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16.5V11M12 16.5V6.5M17 16.5v-3.5" /></>,
  ban: <><circle cx="12" cy="12" r="8" /><path d="m6.4 6.4 11.2 11.2" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M15.5 7.5l2 2M13.5 9.5l1.5 1.5" /></>,
  server: <><rect x="4" y="4.5" width="16" height="6" rx="1.5" /><rect x="4" y="13.5" width="16" height="6" rx="1.5" /><path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5M11 16.5h5" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  shield: <path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.4c1.6.6 2.7 2.2 3 4.6" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  inbox: <><path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z" /><path d="M4 13.5h4.5l1 2h5l1-2H20" /></>,
  message: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l9-11h-6l0-7Z" />,
  terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4" /></>,
  arrowLeft: <path d="M15 5 8 12l7 7" />,
  arrowRight: <path d="M9 5l7 7-7 7" />,
  external: <><path d="M14 4.5h5.5V10M19.5 4.5 11 13" /><path d="M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9" /><path d="M18 3.5v4h-4M6 20.5v-4h4" /></>,
  logout: <><path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" /><path d="M10.5 12h9M16.5 8.5 20 12l-3.5 3.5" /></>,
  home: <><path d="M4.5 11 12 4.5l7.5 6.5" /><path d="M6.5 9.5v10h11v-10" /></>,
  globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8Z" /></>
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
