import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#07111c' }}>
        <svg width="132" height="132" viewBox="0 0 32 32">
          <path
            d="M6 7.5A2.5 2.5 0 0 1 8.5 5h15A2.5 2.5 0 0 1 26 7.5v4a3 3 0 0 0 0 6v4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 21.5v-4a3 3 0 0 0 0-6v-4Z"
            fill="none"
            stroke="#eaf4fb"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10.5 14.5h6.6M14.3 11.6l2.9 2.9-2.9 2.9" fill="none" stroke="#eaf4fb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="21.4" cy="14.5" r="2" fill="#38bdf8" />
        </svg>
      </div>
    ),
    size
  );
}
