import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_PUBLIC_LOCALE, LOCALE_HEADER } from './app/site';

/** Best supported language from Accept-Language (q-weighted), English by default. */
function preferredLocale(header: string | null): 'it' | 'en' {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      return { lang: tag.split(/[-_]/)[0], q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q);
  const match = ranked.find((entry) => entry.lang === 'it' || entry.lang === 'en');
  return (match?.lang as 'it' | 'en' | undefined) ?? DEFAULT_PUBLIC_LOCALE;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // `/` is the x-default entry point: a server redirect, so crawlers without
  // Accept-Language land on the English home instead of an empty JS page.
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request.headers.get('accept-language'))}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set('Vary', 'Accept-Language');
    return response;
  }

  // <html lang> for the root layout: the dashboard and super console are Italian-only.
  const locale = pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'it';
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|backend/|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|manifest.webmanifest).*)']
};
