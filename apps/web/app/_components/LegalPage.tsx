import { SiteFooter, SiteHeader } from './SiteChrome';
import type { Locale } from '../i18n';
import { CONTACT_EMAIL, REPO_URL } from '../site';

type Section = { title: string; body: Array<string | string[]> };
type Doc = { id: string; kicker: string; title: string; intro: string; sections: Section[] };

const UPDATED = { it: '13 ottobre 2026', en: '13 October 2026' };

const copy: Record<Locale, { kicker: string; title: string; intro: string; updated: string; toc: string; home: string; pricing: string; docs: Doc[] }> = {
  en: {
    kicker: 'Legal',
    title: 'Privacy policy and terms of service',
    intro: 'This page explains what data Dispatch processes, why, for how long and what rights you have, and the terms for using the hosted bot and dashboard at dispatch.haxurus.com.',
    updated: 'Last updated',
    toc: 'On this page',
    pricing: 'Pricing',
    home: 'Home',
    docs: [
      {
        id: 'privacy',
        kicker: 'Privacy',
        title: 'Privacy policy',
        intro: 'Dispatch is a Discord ticket and forms bot. It lets the members of a Discord server open support requests and fill in forms, and lets the server’s staff handle them.',
        sections: [
          { title: 'Who is responsible', body: [
            `The hosted Dispatch service is operated by Haxurus ("we"). Contact: ${CONTACT_EMAIL}.`,
            'The administrators of each Discord server decide whether to add Dispatch and how to configure it; we process the data to provide the service to them. If you are a member of a server that uses Dispatch, you can also contact that server’s administrators.'
          ] },
          { title: 'Data we process', body: [
            'From the Discord servers where the bot is installed:',
            [
              'server, channel and role identifiers and names, and the server’s Dispatch configuration (categories, panels, forms, staff roles);',
              'for every ticket: the user who opened it, the staff members who claimed, handled or closed it, its category, status, priority, timestamps and the answers to the category’s questions;',
              'the messages of a ticket channel and of its private staff thread, only when a transcript is generated (at close or on request), so that the conversation can be archived;',
              'form answers, staff notes, close reasons, ratings and their optional comments, and blacklist reasons;',
              'technical records needed for anti-spam: ticket-opening attempts and their timestamps.'
            ],
            'Dispatch does not read messages outside ticket channels and staff threads, and only notes the time of the last activity while a ticket is open.',
            'When you sign in to the dashboard with Discord: your Discord user ID, username, avatar and the list of servers you belong to (scopes identify and guilds), plus a log of the changes you make in the panel with a one-way hash of your IP address.',
            'Dispatch does not collect members’ online status or activities (games, music, custom status).',
            'Technical data: our web server and Cloudflare, which protects and delivers the site, process IP addresses and request data to deliver pages and prevent abuse.'
          ] },
          { title: 'Why we process it', body: [
            [
              'to open, route and manage tickets and forms, and to post transcripts, logs and leaderboards to the channels chosen by the administrators;',
              'to let authorised people sign in to the dashboard and manage their servers;',
              'to keep the service secure, prevent abuse and enforce these terms.'
            ],
            'Under the GDPR the legal basis is the legitimate interest of server administrators and of the operator in providing support to their communities and running a secure service (Art. 6(1)(f)), and the performance of the service requested by dashboard users (Art. 6(1)(b)).'
          ] },
          { title: 'How long we keep it', body: [
            [
              'Tickets, transcripts and staff notes: for the retention periods chosen by the server’s administrators in the dashboard, up to the maximum of the server’s plan; without a retention period they are kept for that maximum.',
              'Form answers: until the server’s administrators delete them from the dashboard, or while the bot is in the server.',
              'When the bot is removed from a server, all of that server’s data is deleted 30 days later, unless the bot is added again in the meantime.',
              'Dashboard sessions: 8 hours.',
              'Database backups: up to 14 days, encrypted.'
            ]
          ] },
          { title: 'How we protect it', body: [
            'Transcripts, form answers, staff notes, close reasons, rating comments, blacklist reasons and session data are encrypted at rest with AES-256-GCM. The bot asks for no Administrator permission, and the bot, the API and the website each have their own database permissions. The code is open source, so these measures can be verified on GitHub.'
          ] },
          { title: 'Sharing', body: [
            'We do not sell data and we do not use it for advertising or profiling. Data is shared only with the providers needed to run the service: Discord (the platform the bot works on), Cloudflare (network delivery and protection) and our hosting provider. Transcripts and logs are posted only in the channels configured by each server’s administrators, and to the ticket’s author when the server enables it.'
          ] },
          { title: 'Cookies', body: [
            'We use only strictly necessary cookies: a session cookie when you sign in, a short-lived cookie that protects the Discord sign-in, and a cookie that remembers your language for one year. There are no analytics or advertising cookies.'
          ] },
          { title: 'Your rights', body: [
            `You can ask to access, correct or delete your data, to restrict or object to its processing and to receive a copy of it, by writing to ${CONTACT_EMAIL}. You have the right to lodge a complaint with your data protection authority (in Italy, the Garante per la protezione dei dati personali).`,
            'Dispatch is meant for Discord users who meet Discord’s minimum age requirements.'
          ] },
          { title: 'Changes', body: [
            'We will update this page when the way we process data changes, and the date at the top will change accordingly.'
          ] }
        ]
      },
      {
        id: 'terms',
        kicker: 'Terms',
        title: 'Terms of service',
        intro: 'By adding Dispatch to a Discord server or using its dashboard you agree to these terms.',
        sections: [
          { title: 'The service', body: [
            `Dispatch is a Discord bot and web dashboard for tickets, forms and support teams. The hosted service is provided by Haxurus, with a Free plan available to every server and optional paid plans. The source code is published under the AGPL-3.0 licence at ${REPO_URL}; these terms govern the hosted service, not your use of the code.`
          ] },
          { title: 'Your responsibilities', body: [
            [
              'You must comply with Discord’s Terms of Service, Community Guidelines and Developer Policy.',
              'If you add Dispatch to a server, you must be authorised to manage it and you are responsible for how you configure it, including the retention of tickets and transcripts and informing your members where required.',
              'Do not use Dispatch to harass people, to collect data for purposes other than supporting your community, or to ask members for passwords, payment details or other sensitive data through tickets or forms.',
              'Do not attempt to disrupt, overload or reverse-engineer the hosted service or bypass its limits and security measures.'
            ]
          ] },
          { title: 'Limits', body: [
            'To keep the shared service fair, each server has limits on categories, panels, forms, response templates, dashboard roles, blacklist entries and on how long closed tickets and transcripts can be kept. Most limits depend on the server’s plan and are listed on the pricing page; they are shown in the dashboard when reached.'
          ] },
          { title: 'Plans and payments', body: [
            'The Free plan is available to everyone. Paid plans (Plus, Pro, Brand) are activated by the operator after the server owner requests them. Online payments are not available yet: the price and the payment are agreed directly with you before activation, and any refund is agreed case by case, without prejudice to your statutory rights.',
            'A paid plan applies to one server for the agreed period. When it expires, the server returns to the Free plan: features outside it stop working and its limits apply again, including the maximum retention, so older closed tickets and transcripts are deleted by the regular retention. Your configuration is not deleted, except dashboard roles above the Free limit and the custom bot nickname and banner, which are reset.'
          ] },
          { title: 'Availability', body: [
            'We work to keep Dispatch available and reliable, but the service is provided “as is” and “as available”, without guaranteed uptime. Discord outages, missing bot permissions or maintenance can delay or prevent tickets, transcripts and logs.'
          ] },
          { title: 'Suspension and termination', body: [
            'You can stop using Dispatch at any time by removing the bot from your server. We may block a server or user, or make the bot leave a server, if these terms or Discord’s rules are breached or to protect the service and its users.'
          ] },
          { title: 'Liability', body: [
            'To the extent permitted by law, the operator is not liable for indirect damages or for the loss of data, tickets or transcripts. Nothing in these terms limits liability that cannot be limited by law, including your rights as a consumer.'
          ] },
          { title: 'Changes and governing law', body: [
            'We may update these terms; the date at the top of this page shows the latest version, and continuing to use the service means you accept it. These terms are governed by Italian law, without prejudice to the mandatory consumer protection rules of your country of residence.',
            `Questions: ${CONTACT_EMAIL}.`
          ] }
        ]
      }
    ]
  },
  it: {
    kicker: 'Note legali',
    title: 'Privacy policy e termini di servizio',
    intro: 'Questa pagina spiega quali dati tratta Dispatch, perché, per quanto tempo e quali diritti hai, e le condizioni per usare il bot e la dashboard ospitati su dispatch.haxurus.com.',
    updated: 'Ultimo aggiornamento',
    toc: 'In questa pagina',
    pricing: 'Prezzi',
    home: 'Home',
    docs: [
      {
        id: 'privacy',
        kicker: 'Privacy',
        title: 'Privacy policy',
        intro: 'Dispatch è un bot Discord per ticket e form. Permette ai membri di un server Discord di aprire richieste di supporto e compilare moduli, e allo staff del server di gestirle.',
        sections: [
          { title: 'Chi è responsabile', body: [
            `Il servizio ospitato di Dispatch è gestito da Haxurus ("noi"). Contatto: ${CONTACT_EMAIL}.`,
            'Gli amministratori di ciascun server Discord decidono se aggiungere Dispatch e come configurarlo; noi trattiamo i dati per fornire loro il servizio. Se sei membro di un server che usa Dispatch puoi rivolgerti anche agli amministratori di quel server.'
          ] },
          { title: 'Quali dati trattiamo', body: [
            'Dai server Discord in cui il bot è installato:',
            [
              'identificativi e nomi di server, canali e ruoli, e la configurazione di Dispatch del server (categorie, pannelli, form, ruoli staff);',
              'per ogni ticket: chi l’ha aperto, i membri dello staff che l’hanno preso in carico, gestito o chiuso, categoria, stato, priorità, orari e le risposte alle domande della categoria;',
              'i messaggi del canale del ticket e del suo thread staff privato, solo quando viene generato un transcript (alla chiusura o su richiesta), per archiviare la conversazione;',
              'risposte ai form, note dello staff, motivi di chiusura, valutazioni con l’eventuale commento e motivi della blacklist;',
              'registrazioni tecniche necessarie all’anti-spam: tentativi di apertura dei ticket e relativi orari.'
            ],
            'Dispatch non legge i messaggi al di fuori dei canali dei ticket e dei thread staff, e mentre un ticket è aperto registra solo l’orario dell’ultima attività.',
            'Quando accedi alla dashboard con Discord: il tuo ID utente, username, avatar e l’elenco dei server di cui fai parte (scope identify e guilds), più un registro delle modifiche che fai nel pannello con un hash non reversibile del tuo indirizzo IP.',
            'Dispatch non raccoglie lo stato online né le attività dei membri (giochi, musica, stato personalizzato).',
            'Dati tecnici: il nostro server web e Cloudflare, che protegge e distribuisce il sito, trattano indirizzi IP e dati delle richieste per mostrare le pagine e prevenire abusi.'
          ] },
          { title: 'Perché li trattiamo', body: [
            [
              'per aprire, smistare e gestire ticket e form, e pubblicare transcript, log e classifiche nei canali scelti dagli amministratori;',
              'per consentire alle persone autorizzate di accedere alla dashboard e gestire i propri server;',
              'per mantenere il servizio sicuro, prevenire abusi e far rispettare questi termini.'
            ],
            'Ai sensi del GDPR la base giuridica è il legittimo interesse degli amministratori dei server e del gestore a offrire supporto alle proprie community e un servizio sicuro (art. 6.1.f), e l’esecuzione del servizio richiesto da chi usa la dashboard (art. 6.1.b).'
          ] },
          { title: 'Per quanto tempo li conserviamo', body: [
            [
              'Ticket, transcript e note dello staff: per i periodi di conservazione scelti dagli amministratori nella dashboard, entro il massimo previsto dal piano del server; senza un periodo impostato restano per quel massimo.',
              'Risposte ai form: finché gli amministratori del server non le eliminano dalla dashboard, o finché il bot è nel server.',
              'Quando il bot viene rimosso da un server, tutti i dati di quel server vengono cancellati dopo 30 giorni, a meno che il bot non venga aggiunto di nuovo nel frattempo.',
              'Sessioni della dashboard: 8 ore.',
              'Backup del database: fino a 14 giorni, cifrati.'
            ]
          ] },
          { title: 'Come li proteggiamo', body: [
            'Transcript, risposte ai form, note dello staff, motivi di chiusura, commenti alle valutazioni, motivi della blacklist e dati di sessione sono cifrati con AES-256-GCM. Il bot non chiede il permesso Administrator, e bot, API e sito hanno permessi separati sul database. Il codice è open source, quindi queste misure sono verificabili su GitHub.'
          ] },
          { title: 'Condivisione', body: [
            'Non vendiamo i dati e non li usiamo per pubblicità o profilazione. Li condividiamo solo con i fornitori necessari al servizio: Discord (la piattaforma su cui opera il bot), Cloudflare (distribuzione e protezione di rete) e il nostro fornitore di hosting. Transcript e log vengono pubblicati solo nei canali configurati dagli amministratori di ciascun server, e all’autore del ticket se il server lo abilita.'
          ] },
          { title: 'Cookie', body: [
            'Usiamo solo cookie tecnici necessari: un cookie di sessione quando accedi, un cookie di breve durata che protegge l’accesso con Discord e un cookie che ricorda la lingua per un anno. Non ci sono cookie di statistica o pubblicità.'
          ] },
          { title: 'I tuoi diritti', body: [
            `Puoi chiedere di accedere ai tuoi dati, rettificarli o cancellarli, limitarne od opporti al trattamento e riceverne una copia scrivendo a ${CONTACT_EMAIL}. Hai il diritto di presentare reclamo all’autorità di controllo (in Italia, il Garante per la protezione dei dati personali).`,
            'Dispatch è destinato agli utenti Discord che rispettano l’età minima richiesta da Discord.'
          ] },
          { title: 'Modifiche', body: [
            'Aggiorneremo questa pagina quando cambierà il modo in cui trattiamo i dati, e la data in alto cambierà di conseguenza.'
          ] }
        ]
      },
      {
        id: 'terms',
        kicker: 'Termini',
        title: 'Termini di servizio',
        intro: 'Aggiungendo Dispatch a un server Discord o usando la sua dashboard accetti questi termini.',
        sections: [
          { title: 'Il servizio', body: [
            `Dispatch è un bot Discord con dashboard web per ticket, form e team di supporto. Il servizio ospitato è fornito da Haxurus, con un piano Free disponibile per ogni server e piani a pagamento facoltativi. Il codice sorgente è pubblicato con licenza AGPL-3.0 su ${REPO_URL}; questi termini regolano il servizio ospitato, non l’uso del codice.`
          ] },
          { title: 'Le tue responsabilità', body: [
            [
              'Devi rispettare i Termini di servizio, le Linee guida della community e la Developer Policy di Discord.',
              'Se aggiungi Dispatch a un server devi essere autorizzato a gestirlo e sei responsabile di come lo configuri, inclusa la conservazione di ticket e transcript e l’informativa ai membri quando è richiesta.',
              'Non usare Dispatch per molestare persone, per raccogliere dati per scopi diversi dal supporto alla tua community, o per chiedere ai membri password, dati di pagamento o altri dati sensibili tramite ticket o form.',
              'Non tentare di interrompere, sovraccaricare o decodificare il servizio ospitato, né di aggirarne limiti e misure di sicurezza.'
            ]
          ] },
          { title: 'Limiti', body: [
            'Per mantenere equo il servizio condiviso, ogni server ha dei limiti su categorie, pannelli, form, risposte rapide, ruoli della dashboard, voci della blacklist e sulla durata di conservazione di ticket chiusi e transcript. La maggior parte dei limiti dipende dal piano del server ed è indicata nella pagina dei prezzi; quando vengono raggiunti la dashboard lo segnala.'
          ] },
          { title: 'Piani e pagamenti', body: [
            'Il piano Free è disponibile per tutti. I piani a pagamento (Plus, Pro, Brand) vengono attivati dal gestore su richiesta del proprietario del server. I pagamenti online non sono ancora disponibili: prezzo e pagamento vengono concordati direttamente con te prima dell’attivazione, e gli eventuali rimborsi caso per caso, fatti salvi i diritti previsti dalla legge.',
            'Un piano a pagamento vale per un server per il periodo concordato. Alla scadenza il server torna al piano Free: le funzioni non incluse smettono di funzionare e si applicano di nuovo i suoi limiti, compresa la conservazione massima, quindi ticket chiusi e transcript più vecchi vengono cancellati dalla normale pulizia. La configurazione non viene cancellata, tranne i ruoli della dashboard oltre il limite del Free e il nickname e il banner personalizzati del bot, che vengono reimpostati.'
          ] },
          { title: 'Disponibilità', body: [
            'Lavoriamo per mantenere Dispatch disponibile e affidabile, ma il servizio è fornito “così com’è” e “come disponibile”, senza garanzie di continuità. Disservizi di Discord, permessi mancanti del bot o manutenzioni possono ritardare o impedire ticket, transcript e log.'
          ] },
          { title: 'Sospensione e cessazione', body: [
            'Puoi smettere di usare Dispatch in qualsiasi momento rimuovendo il bot dal tuo server. Possiamo bloccare un server o un utente, o far uscire il bot da un server, in caso di violazione di questi termini o delle regole di Discord, o per proteggere il servizio e i suoi utenti.'
          ] },
          { title: 'Responsabilità', body: [
            'Nei limiti consentiti dalla legge, il gestore non risponde di danni indiretti né della perdita di dati, ticket o transcript. Nulla in questi termini limita responsabilità che per legge non possono essere limitate, inclusi i tuoi diritti di consumatore.'
          ] },
          { title: 'Modifiche e legge applicabile', body: [
            'Possiamo aggiornare questi termini; la data in alto indica la versione in vigore e continuare a usare il servizio significa accettarla. Questi termini sono regolati dalla legge italiana, fatte salve le norme inderogabili a tutela dei consumatori del Paese di residenza.',
            `Domande: ${CONTACT_EMAIL}.`
          ] }
        ]
      }
    ]
  }
};

const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function Paragraphs({ body }: { body: Section['body'] }) {
  return <>{body.map((item, index) => Array.isArray(item)
    ? <ul key={index}>{item.map((line) => <li key={line}>{line}</li>)}</ul>
    : <p key={index}>{item}</p>)}</>;
}

export default function LegalPage({ locale }: { locale: Locale }) {
  const c = copy[locale];
  return (
    <main className="public-site" lang={locale}>
      <SiteHeader
        locale={locale}
        itHref="/it/legal"
        enHref="/en/legal"
        links={[
          { href: `/${locale}`, label: c.home },
          { href: `/${locale}/pricing`, label: c.pricing }
        ]}
      />
      <section className="page legal-page">
        <div className="site-container legal-layout">
          <aside className="legal-toc">
            <span className="kicker">{c.toc}</span>
            {c.docs.map((doc) => (
              <nav key={doc.id} aria-label={doc.title}>
                <a className="legal-toc-doc" href={`#${doc.id}`}>{doc.title}</a>
                {doc.sections.map((section) => <a key={section.title} href={`#${doc.id}-${slug(section.title)}`}>{section.title}</a>)}
              </nav>
            ))}
          </aside>
          <div className="legal-content">
            <header className="legal-head">
              <span className="kicker">{c.kicker}</span>
              <h1>{c.title}</h1>
              <p>{c.intro}</p>
              <p className="legal-updated mono">{c.updated}: {UPDATED[locale]}</p>
            </header>
            {c.docs.map((doc) => (
              <article className="legal-doc" id={doc.id} key={doc.id}>
                <span className="kicker">{doc.kicker}</span>
                <h2>{doc.title}</h2>
                <p className="legal-intro">{doc.intro}</p>
                {doc.sections.map((section) => (
                  <section key={section.title} id={`${doc.id}-${slug(section.title)}`}>
                    <h3>{section.title}</h3>
                    <Paragraphs body={section.body} />
                  </section>
                ))}
              </article>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter locale={locale} />
    </main>
  );
}
