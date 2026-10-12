import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_PUBLIC_LOCALE, LOCALE_COOKIE, LOCALE_HEADER } from './app/site';

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

const ONE_YEAR = 60 * 60 * 24 * 365;

function publicLocale(pathname: string): 'it' | 'en' | null {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en';
  if (pathname === '/it' || pathname.startsWith('/it/')) return 'it';
  return null;
}

/** Remembered choice (cookie), otherwise the browser language, English by default. */
function visitorLocale(request: NextRequest): 'it' | 'en' {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (saved === 'it' || saved === 'en') return saved;
  return preferredLocale(request.headers.get('accept-language'));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // `/` is the x-default entry point: a server redirect, so crawlers without
  // Accept-Language or cookies land on the English home instead of an empty JS page.
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = `/${visitorLocale(request)}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set('Vary', 'Accept-Language, Cookie');
    return response;
  }

  // Public pages carry their language in the URL and remember it for the
  // dashboard and the super console, which have no /en and /it mirrors.
  const fromPath = publicLocale(pathname);
  const locale = fromPath ?? visitorLocale(request);
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  const response = NextResponse.next({ request: { headers } });
  if (fromPath && request.cookies.get(LOCALE_COOKIE)?.value !== fromPath) {
    response.cookies.set(LOCALE_COOKIE, fromPath, {
      path: '/',
      maxAge: ONE_YEAR,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production'
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/|backend/|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|manifest.webmanifest).*)']
};
