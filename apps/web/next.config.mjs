const apiOrigin = process.env.INTERNAL_API_URL || 'http://api:3001';
const csp = ["default-src 'self'","base-uri 'self'","frame-ancestors 'none'","object-src 'none'","form-action 'self' https://discord.com","script-src 'self' 'unsafe-inline'","style-src 'self' 'unsafe-inline'","img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net","connect-src 'self'","font-src 'self' data:"].join('; ');
const noindex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The installation gate is gone: old links to the "still in development" page land on the home.
  async redirects() { return [{ source: '/:locale(en|it)/development', destination: '/:locale', permanent: true }]; },
  async rewrites() { return [{ source: '/backend/:path*', destination: `${apiOrigin}/:path*` }]; },
  async headers() { return [
    { source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }
    ] },
    // Link previews and favicons are fetched by other sites (Discord, X, search engines).
    { source: '/:locale(en|it)/opengraph-image', headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }] },
    { source: '/:file(icon.png|apple-icon.png|manifest.webmanifest)', headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }] },
    { source: '/super', headers: noindex },
    { source: '/dashboard', headers: noindex },
    { source: '/dashboard/:path*', headers: noindex }
  ]; }
};
export default nextConfig;
