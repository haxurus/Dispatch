const apiOrigin = process.env.INTERNAL_API_URL || 'http://api:3001';
const csp = ["default-src 'self'","base-uri 'self'","frame-ancestors 'none'","object-src 'none'","form-action 'self' https://discord.com","script-src 'self' 'unsafe-inline'","style-src 'self' 'unsafe-inline'","img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net","connect-src 'self'","font-src 'self' data:"].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async rewrites() { return [{ source: '/backend/:path*', destination: `${apiOrigin}/:path*` }]; },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' }
  ] }]; }
};
export default nextConfig;
