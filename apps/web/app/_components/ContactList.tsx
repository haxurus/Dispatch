import { Icon, type IconName } from './Brand';
import type { Locale } from '../i18n';
import { FALLBACK_CONTACTS, hasContacts, type Contacts } from './plans';

const DISCORD_INVITE = /^https:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\//i;

/** Operator contacts set in the super console, or the hosted instance defaults when none is set. */
export default function ContactList({ contacts, locale }: { contacts: Contacts | null; locale: Locale }) {
  const source = hasContacts(contacts) ? contacts : FALLBACK_CONTACTS;
  const items: Array<{ icon: IconName; label: string; value: string; href: string | null }> = [];
  if (source.email) items.push({ icon: 'message', label: 'Email', value: source.email, href: `mailto:${source.email}` });
  if (source.discord) {
    const link = /^https:\/\//i.test(source.discord);
    items.push({ icon: 'users', label: 'Discord', value: link ? source.discord.replace(/^https:\/\//i, '') : source.discord, href: link ? source.discord : null });
  }
  if (source.url && /^https:\/\//i.test(source.url)) {
    const server = DISCORD_INVITE.test(source.url);
    items.push({
      icon: server ? 'users' : 'globe',
      label: server ? (locale === 'it' ? 'Server Discord' : 'Discord server') : (locale === 'it' ? 'Sito' : 'Website'),
      value: source.url.replace(/^https:\/\/(?:www\.)?/i, ''),
      href: source.url
    });
  }
  if (!items.length) return null;

  return (
    <ul className="contact-list">
      {items.map((item) => (
        <li key={item.label}>
          <span className="feature-icon"><Icon name={item.icon} size={17} /></span>
          <div>
            <span>{item.label}</span>
            {item.href
              ? <a href={item.href} target={item.href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer">{item.value}</a>
              : <strong className="mono">{item.value}</strong>}
          </div>
        </li>
      ))}
    </ul>
  );
}
