# Deploy di produzione

Dispatch segue il modello di Sentinel: le immagini vengono costruite su GitHub Actions, pubblicate su GHCR e installate sulla VPS tramite digest SHA-256 immutabili, attraverso un account SSH ristretto. Sulla VPS non si esegue nessuna build e nessun `git pull` come root. I segreti applicativi restano sulla VPS e non transitano mai da GitHub.

```text
push main ─> Ticket protection tests ─> build runtime + migrate (SBOM, provenance) ─> GHCR
          ─> SSH dispatch-deploy (forced command) ─> sudo dispatch-deploy deploy APP@sha256 MIGRATE@sha256
             ─> backup DB ─> pull per digest ─> migrate ─> secure-db (grant) ─> api/bot/web/edge ─> healthcheck
             ─> rollback automatico applicativo se i healthcheck falliscono
```

Esempio di riferimento in questa guida: dominio `dispatch.haxurus.com`, VPS Debian 13 con Docker CE, Nginx Proxy Manager (NPM) sulla rete esterna `proxy_net`, Cloudflare in modalità proxy con SSL Full (strict).

## 1. Prerequisiti

### Applicazione Discord

Nel Developer Portal, applicazione `Dispatch`:

- **Bot > Privileged Gateway Intents**: Server Members ON, Message Content ON (necessario per transcript completi), Presence OFF.
- **OAuth2 > Redirects**: `https://dispatch.haxurus.com/backend/auth/discord/callback`. Gli scope usati dal pannello sono `identify` e `guilds`. Il link di installazione generato da `/backend/bot/invite` (scope `bot applications.commands`, permessi elencati sotto, bitfield `268561424`) non usa `redirect_uri`: non serve registrare redirect aggiuntivi, il redirect esistente resta invariato.
- **Installazione**: Guild Install con i soli permessi View Channels, Manage Channels, Manage Roles, Send Messages, Manage Messages, Embed Links, Attach Files, Read Message History. Non concedere Administrator, Manage Server, Manage Webhooks, Mention Everyone, Kick/Ban o Manage Nicknames.
- Annotare l'**Application ID**, che serve per `DISCORD_CLIENT_ID`. Bot Token e Client Secret si scrivono **solo** nei file secret sulla VPS (sezione 3).

### DNS e Cloudflare

- Record `A` `dispatch` verso l'IPv4 della VPS, **Proxied**, TTL Auto. Nessun `AAAA` diretto.
- SSL/TLS **Full (strict)**: NPM deve servire un certificato valido per `dispatch.haxurus.com`.

### VPS

- Docker CE con plugin Compose, `openssl`, `sudo`/`visudo`.
- Rete Docker esterna `proxy_net` già esistente, condivisa con NPM.
- `user007` resta fuori dal gruppo `docker`: tutti i comandi usano `sudo`.

### Accesso a GHCR

La VPS scarica `ghcr.io/haxurus/dispatch@sha256:...`. Le soluzioni sono due:

- impostare il package GHCR `dispatch` come **public** (il repository è già pubblico e le immagini non contengono segreti); oppure
- tenerlo privato ed eseguire una sola volta, come root, `sudo docker login ghcr.io -u haxurus` con un token *classic* che ha solo lo scope `read:packages`.

Senza una delle due, il primo `docker pull` del deploy fallisce.

## 2. Installazione sulla VPS

### Chiave di deploy dedicata

Su una macchina fidata, mai sulla VPS e senza riusare la chiave admin:

```bash
ssh-keygen -t ed25519 -a 64 -f ~/.ssh/dispatch_deploy -C "dispatch-deploy"
```

La chiave privata `dispatch_deploy` andrà nel secret GitHub `VPS_DEPLOY_KEY`. La pubblica `dispatch_deploy.pub` va copiata sulla VPS e deve contenere **una sola riga**: l'installer rifiuta file con più chiavi.

### AllowUsers

Se `sshd` usa `AllowUsers` (VPS01 ha `AllowUsers user007`), aggiungere l'utente di deploy **prima** dell'installer, che altrimenti si interrompe:

```text
AllowUsers user007 dispatch-deploy
```

```bash
sudo sshd -t && sudo systemctl reload ssh
```

Prima di chiudere la sessione corrente, verificare da un secondo terminale che `user007` riesca ancora ad accedere.

### Installer

Da un checkout del repository sulla VPS, con il tag o il commit da installare:

```bash
sudo sh ops/install-vps.sh /percorso/dispatch_deploy.pub
```

L'installer:

- crea l'utente di sistema `dispatch-deploy`. Home `/var/lib/dispatch-deploy`, `.ssh` e `authorized_keys` sono di proprietà di root, così l'account non può togliere il forced command;
- scrive `authorized_keys` con `restrict,command="/usr/local/libexec/dispatch-deploy-entrypoint"`;
- installa `/etc/sudoers.d/dispatch-deploy`, che permette solo `/usr/local/sbin/dispatch-deploy`, senza `setenv`;
- crea `/srv/docker/dispatch/` (root, 700) con `docker-compose.yml`, `runtime/nginx.conf`, `runtime/harden-users.sh`, `secrets/`, `backups/` e `.env`. `.env` viene creato dal template solo se manca;
- genera i segreti mancanti e crea vuoti `discord_token` e `discord_client_secret`;
- installa e abilita `dispatch-firewall.service`, che blocca dai bridge di egress di api e bot l'accesso all'host e alle reti private/LAN;
- verifica che `proxy_net` esista.

Al primo install la chiave pubblica è obbligatoria; nelle esecuzioni successive si può omettere e resta quella installata.

> **Importante:** il deploy da GitHub aggiorna solo le **immagini**. Compose, `nginx.conf`, `harden-users.sh`, wrapper e firewall sulla VPS sono copie fatte dall'installer. Quando un commit modifica `deploy/`, `ops/` o `security/`, rieseguire l'installer dal checkout aggiornato **prima** del deploy di quel commit.

## 3. Configurazione

### `.env`

```bash
sudoedit /srv/docker/dispatch/.env
```

```env
DISCORD_CLIENT_ID=<Application ID>
PUBLIC_BASE_URL=https://dispatch.haxurus.com/backend
WEB_URL=https://dispatch.haxurus.com
POSTGRES_ADMIN_USER=dispatch_owner
POSTGRES_DB=dispatch
LOG_LEVEL=info
SUPER_ADMIN_USER_ID=<Discord user ID del proprietario dell'istanza>
INVITE_ALLOWED_USER_IDS=<ID Discord separati da virgola, opzionale>
```

- `SUPER_ADMIN_USER_ID` (opzionale, supporta anche `SUPER_ADMIN_USER_ID_FILE`): un solo Discord user ID (17-20 cifre). Abilita la super console su `/super` e le API `/api/super/*`; se vuoto nessuno vi accede. Un valore non valido blocca l'avvio dell'API.
- `INVITE_ALLOWED_USER_IDS` (opzionale, supporta `_FILE`): account, oltre al super admin, autorizzati ad aggiungere il bot ospitato tramite `/backend/bot/invite`. Gli altri utenti vengono reindirizzati a `/it/development` (o `/en/development`). Un utente bloccato dalla super console non può installare il bot anche se è in lista.

`WEB_URL` deve coincidere esattamente con l'origine del browser: le richieste di modifica con un `Origin` diverso vengono rifiutate (CSRF).

### Segreti

In `/srv/docker/dispatch/secrets/` (directory root, 700):

| File | Origine | Usato da |
|---|---|---|
| `discord_token` | **manuale** | bot |
| `discord_client_secret` | **manuale** | api |
| `session_secret` | generato | api |
| `data_encryption_key` | generato (32 byte base64, AES-256-GCM) | api, bot |
| `bot_internal_api_key` | generato | api, bot |
| `postgres_admin_password` | generato (root 600) | postgres, migrate, secure-db |
| `api_db_password` | generato | api, secure-db |
| `bot_db_password` | generato | bot, secure-db |
| `redis_password` | generato | redis, bot |

```bash
sudoedit /srv/docker/dispatch/secrets/discord_token
sudoedit /srv/docker/dispatch/secrets/discord_client_secret
```

Incollare solo il valore, senza virgolette. I file restano `root:1000` 640 (gid 1000 = utente `node` e gruppo `redis` nei container). Non incollare mai questi valori in chat, issue o log.

> **Non perdere `data_encryption_key`.** Form, transcript, note, template, motivi di chiusura e blacklist sono cifrati con questa chiave: senza, i dati e i backup non si possono più leggere. Conservarne una copia offline, separata dai backup del database.

### Nginx Proxy Manager

Proxy Host:

- Domain: `dispatch.haxurus.com`
- Scheme `http`, Forward Hostname `dispatch-edge`, Forward Port `8080`
- SSL: certificato valido, Force SSL, HSTS attivo
- Websockets non necessari

L'edge Dispatch ricava l'IP reale del client da `CF-Connecting-IP`, ma accetta questo header **solo** da indirizzi privati Docker, cioè da NPM. L'IP serve a rate limit e audit. Se l'origin resta raggiungibile senza passare da Cloudflare, chi la contatta direttamente può falsificare quell'header ed eludere il rate limit per IP. Si consiglia di limitare l'ingresso 80/443 ai range IP di Cloudflare (o di usare Authenticated Origin Pulls).

Controllo da NPM verso Dispatch, dopo il primo deploy:

```bash
sudo docker exec npm curl -sI http://dispatch-edge:8080/backend/health
```

## 4. GitHub

### Environment `production`

Settings > Environments > `production`:

- **Deployment branches: solo `main`.** È questo il controllo reale: il workflow ha `workflow_dispatch` e, senza questa regola, chi ha accesso in scrittura potrebbe deployare un altro branch. Il controllo `github.ref` nei workflow è solo una difesa aggiuntiva.
- **Required reviewers** consigliati.
- Secrets **dell'environment**, non del repository:
  - `VPS_DEPLOY_KEY`: chiave privata `dispatch_deploy`
  - `VPS_KNOWN_HOSTS`: host key ed25519 della VPS, verificata a mano confrontando il fingerprint (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` sulla VPS). Non affidarsi solo a un `ssh-keyscan` non verificato.
  - `VPS_HOST`
  - `VPS_PORT` (facoltativo, default 22)

### Abilitazione

Variable `ENABLE_VPS_DEPLOY=true`, da impostare **solo** dopo aver verificato SSH, segreti, `.env`, accesso GHCR e NPM.

Verifica dell'accesso ristretto dalla macchina con la chiave:

```bash
ssh -i ~/.ssh/dispatch_deploy -o IdentitiesOnly=yes dispatch-deploy@<VPS_HOST> status
```

Il risultato atteso è `No release recorded yet.`. Qualsiasi altro comando viene rifiutato con `command not allowed`.

## 5. Deploy

Ogni push su `main` esegue:

1. `Ticket protection tests`: PostgreSQL temporaneo, migration reali, policy dei privilegi DB, Discord simulato.
2. Build delle immagini `runtime` e `migrate`, con SBOM e provenance, push su GHCR ed esportazione dei digest.
3. Solo se `ENABLE_VPS_DEPLOY == 'true'` e il ref è `main`: SSH verso `deploy <app@sha256> <migrate@sha256>`.

Sulla VPS, `dispatch-deploy deploy`:

1. valida i due riferimenti (`ghcr.io/haxurus/dispatch@sha256:<64 hex>`);
2. se esiste una release corrente, fa il backup `pg_dump -Fc` in `backups/predeploy-<UTC>.dump` (600). Se il backup fallisce, il deploy si interrompe. I dump più vecchi di 14 giorni vengono rimossi solo dopo un backup riuscito;
3. esegue il pull delle immagini per digest;
4. esegue `docker compose up`. L'ordine è postgres → `migrate` (`prisma migrate deploy` come owner) → `secure-db` (utenti `dispatch_api`/`dispatch_bot` e grant) → api, bot e redis → web → edge;
5. attende fino a 150 s che api, bot, web ed edge risultino healthy;
6. se va a buon fine, aggiorna `.release` e `.previous-release` e rimuove i container one-shot;
7. se fallisce, salva i log dei servizi in `/srv/docker/dispatch/logs/deploy-failed-<UTC>.log` (root, 700; mantenuti 30 giorni) e riavvia la release precedente. Nell'output SSH, e quindi nei log GitHub Actions di un repository pubblico, compare solo il percorso del file e mai il contenuto dei log.

Il primo deploy non ha una release precedente: niente backup e niente rollback automatico.

### Stato

```bash
sudo /usr/local/sbin/dispatch-deploy status
```

Per usare `docker compose` direttamente servono le variabili delle immagini. Esempio:

```bash
sudo sh -c 'cd /srv/docker/dispatch && . ./.release && DISPATCH_APP_IMAGE=$APP_IMAGE DISPATCH_MIGRATE_IMAGE=$MIGRATE_IMAGE docker compose -p dispatch --env-file .env -f docker-compose.yml logs --tail=100 api bot'
```

## 6. Rollback e ripristino

### Rollback applicativo

Workflow **Rollback production** (manuale, solo da `main`), oppure:

```bash
sudo /usr/local/sbin/dispatch-deploy rollback
```

Avvia la coppia di immagini in `.previous-release` e, se va a buon fine, **scambia** `.release` e `.previous-release`. Ne seguono due conseguenze:

- un secondo rollback consecutivo torna alla release da cui si era partiti, cioè un roll-forward;
- dopo un rollback **automatico** (deploy fallito) `.previous-release` non cambia: un rollback manuale a quel punto porta alla release *precedente* a quella in esecuzione. Controllare sempre `status` prima di procedere.

Il rollback **non** ripristina il database. Le migration già applicate restano, e la versione precedente deve essere compatibile con lo schema nuovo. Per questo le migration devono restare additive e retrocompatibili.

### Migration fallita

Se `migrate` fallisce a metà, Prisma registra la migration come fallita e ogni successivo `migrate deploy` si blocca (P3009). In questo caso anche il rollback automatico non riparte, perché api e bot dipendono dal completamento di `migrate`. La procedura è:

1. leggere il log in `/srv/docker/dispatch/logs/`;
2. ripristinare il backup pre-deploy (sotto) oppure correggere a mano lo schema;
3. segnare la migration come annullata:

```bash
sudo sh -c 'cd /srv/docker/dispatch && . ./.release && DISPATCH_APP_IMAGE=$APP_IMAGE DISPATCH_MIGRATE_IMAGE=$MIGRATE_IMAGE docker compose -p dispatch --env-file .env -f docker-compose.yml run --rm migrate sh -c '"'"'export DATABASE_URL="postgresql://${POSTGRES_ADMIN_USER:-dispatch_owner}:$(cat /run/secrets/postgres_admin_password)@postgres:5432/${POSTGRES_DB:-dispatch}?schema=public"; ./node_modules/.bin/prisma migrate resolve --rolled-back <NOME_MIGRATION> --schema packages/db/prisma/schema.prisma'"'"''
```

### Ripristino di un backup

`/srv/docker/dispatch` è accessibile solo a root: ogni comando entra nella directory dentro `sudo sh -c`.

```bash
sudo ls -l /srv/docker/dispatch/backups/
# 1. fermare i servizi applicativi (postgres resta attivo)
sudo sh -c 'cd /srv/docker/dispatch && . ./.release && DISPATCH_APP_IMAGE=$APP_IMAGE DISPATCH_MIGRATE_IMAGE=$MIGRATE_IMAGE docker compose -p dispatch --env-file .env -f docker-compose.yml stop edge web api bot'
# 2. ripristinare
sudo sh -c 'cd /srv/docker/dispatch && . ./.release && DISPATCH_APP_IMAGE=$APP_IMAGE DISPATCH_MIGRATE_IMAGE=$MIGRATE_IMAGE docker compose -p dispatch --env-file .env -f docker-compose.yml exec -T postgres sh -c '"'"'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"'"'"' < backups/predeploy-<STAMP>.dump'
# 3. riavviare la release desiderata
sudo /usr/local/sbin/dispatch-deploy rollback   # oppure un nuovo deploy
```

I backup restano sulla stessa VPS. Copiarli periodicamente fuori dall'host, cifrati e separati da `data_encryption_key`.

## 7. Isolamento a runtime

| Servizio | Reti | Segreti |
|---|---|---|
| postgres | api_db, bot_db, migrate_db | postgres_admin_password |
| redis (uid 999) | bot_queue | redis_password |
| migrate / secure-db | migrate_db | owner (+ password app per secure-db) |
| api | backend, api_db, bot_rpc, api_egress | discord_client_secret, session_secret, data_encryption_key, bot_internal_api_key, api_db_password |
| bot | bot_db, bot_queue, bot_rpc, bot_egress | discord_token, bot_internal_api_key, data_encryption_key, bot_db_password, redis_password |
| web | frontend, backend | nessuno |
| edge (nginx, uid 101) | frontend, proxy_net | nessuno |

- Tutte le reti tranne `api_egress`, `bot_egress` e `proxy_net` sono `internal`. Nessuna porta è pubblicata sull'host.
- Il token Discord è presente solo nel bot. L'API parla col bot tramite RPC autenticata su `bot_rpc`.
- I container applicativi sono read-only, non-root, con `cap_drop: ALL`, `no-new-privileges` e limiti di pid e memoria. Nessun container monta `docker.sock`.
- `dispatch_bot` non può leggere `PanelSession`, `TicketNote` e `_prisma_migrations`.
- Il firewall di egress copre solo IPv4. Le reti Dispatch non abilitano IPv6: non attivarlo senza aggiungere regole `ip6tables` equivalenti.
- Il firewall blocca host e reti private, ma non l'egress verso Internet pubblico.

## 8. Collaudo dopo il primo deploy

Login e logout, lista server, RBAC (incluso il rifiuto di `@everyone` come ruolo di accesso), pubblicazione del menu, apertura del ticket con modulo, permessi del canale (i thread sono disabilitati nei ticket), claim, unclaim, stati, priorità, chiusura con transcript, feedback, riapertura dentro e fuori finestra, anti-spam, blacklist, SLA/escalation e retention con valori brevi. Dettagli funzionali e note operative su prenotazioni `CREATING` e retention sono in [TICKET_PROTECTIONS.md](TICKET_PROTECTIONS.md).

Super console (con `SUPER_ADMIN_USER_ID` impostato): il link "Super console" compare solo per quell'account; `/super` mostra metriche e server collegati; "Blocca ed espelli" fa uscire il bot e lo fa riuscire se viene riaggiunto; ogni azione compare nell'audit super-admin. Un account non autorizzato che apre `/backend/bot/invite` finisce su `/it/development`.

Comandi utili:

```bash
sudo /usr/local/sbin/dispatch-deploy status
sudo systemctl status dispatch-firewall.service --no-pager
sudo iptables -L DOCKER-USER -n -v --line-numbers
sudo docker exec npm curl -sI http://dispatch-edge:8080/backend/health
```
