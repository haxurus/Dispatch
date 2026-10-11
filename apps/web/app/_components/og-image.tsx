import { ImageResponse } from 'next/og';
import type { Locale } from '../i18n';

/*
 * Social preview (Open Graph / Twitter / Discord embeds), rendered at build
 * time with the font bundled in next/og: no network access needed.
 */

export const ogImageSize = { width: 1200, height: 630 };

export const ogImageAlt: Record<Locale, string> = {
  en: 'Dispatch, the Discord ticket bot with forms, transcripts and a web dashboard',
  it: 'Dispatch, il bot ticket per Discord con form, transcript e dashboard web'
};

const copy: Record<Locale, { kicker: string; title: string; tags: string[] }> = {
  en: {
    kicker: 'Discord ticket bot',
    title: 'Every request on your server, taken care of.',
    tags: ['Ticket panels', 'Forms', 'Claims & ratings', 'SLAs', 'Transcripts', 'Dashboard']
  },
  it: {
    kicker: 'Bot ticket per Discord',
    title: 'Ogni richiesta del tuo server, presa in carico.',
    tags: ['Pannelli ticket', 'Form', 'Claim e valutazioni', 'SLA', 'Transcript', 'Dashboard']
  }
};

const colors = { bg: '#07111c', line: '#1e3550', text: '#eaf4fb', muted: '#8fa9c0', accent: '#38bdf8' };

export function renderOgImage(locale: Locale) {
  const c = copy[locale];
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          // Satori rejects a plain colour layer inside `background`: keep it separate.
          backgroundColor: colors.bg,
          backgroundImage: 'radial-gradient(circle at 85% 10%, rgba(56, 189, 248, 0.22), transparent 55%)',
          color: colors.text
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <path
              d="M6 7.5A2.5 2.5 0 0 1 8.5 5h15A2.5 2.5 0 0 1 26 7.5v4a3 3 0 0 0 0 6v4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 21.5v-4a3 3 0 0 0 0-6v-4Z"
              fill="none"
              stroke={colors.text}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M10.5 14.5h6.6M14.3 11.6l2.9 2.9-2.9 2.9" fill="none" stroke={colors.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="21.4" cy="14.5" r="2" fill={colors.accent} />
          </svg>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Dispatch</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <span style={{ fontSize: 28, color: colors.accent, textTransform: 'uppercase', letterSpacing: 3 }}>{c.kicker}</span>
          <span style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 1000 }}>{c.title}</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {c.tags.map((tag) => (
            <span
              key={tag}
              style={{ display: 'flex', padding: '10px 18px', border: `1px solid ${colors.line}`, borderRadius: 999, fontSize: 24, color: colors.muted }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    ),
    ogImageSize
  );
}
