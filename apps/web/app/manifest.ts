import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dispatch - Discord ticket bot',
    short_name: 'Dispatch',
    description: 'Discord ticket bot with forms, transcripts and a web dashboard.',
    start_url: '/',
    display: 'standalone',
    background_color: '#07111c',
    theme_color: '#07111c',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' }
    ]
  };
}
