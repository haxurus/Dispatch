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

Se `sshd` usa `AllowUsers`, aggiungere l'utente di deploy **prima** dell'installer, che altrimenti si interrompe. Su VPS01 la riga è in `/etc/ssh/sshd_config.d/00-hardening.conf` e contiene già `user007` e gli utenti di deploy degli altri progetti (es. `sentinel-deploy`, `muse-deploy`): **aggiungere** `dispatch-deploy` in fondo alla riga esistente, senza sostituirla.

```bash
sudo sshd -T | grep '^allowusers'
sudoedit /etc/ssh/sshd_config.d/00-hardening.conf
sudo sshd -t && sudo systemctl reload ssh && sudo sshd -T | grep '^allowusers'
```

Prima di chiudere la sessione corrente, verificare da un secondo terminale che `user007` riesca ancora ad accedere.

### Installer

Da un clone temporaneo del repository sulla VPS (come Sentinel), allineato a `main`:

```bash
git clone --branch main https://github.com/haxurus/Dispatch.git /tmp/Dispatch
cd /tmp/Dispatch
sudo ./ops/install-vps.sh ~/dispatch_deploy.pub
```

Per aggiornare in seguito i file infrastrutturali: `cd /tmp/Dispatch && git pull --ff-only && sudo ./ops/install-vps.sh` (senza chiave resta quella installata).

L'installer:

- crea l'utente di sistema `dispatch-deploy`. Home `/var/lib/dispatch-deploy`, `.ssh` e `authorized_keys` sono di proprietà di root, così l'account non può togliere il forced command;
- scrive `authorized_keys` con `restrict,command="/usr/local/libexec/dispatch-deploy-entrypoint"`;
- installa `/etc/sudoers.d/dispatch-deploy`, che permette solo `/usr/local/sbin/dispatch-deploy`, senza `setenv`;
- crea `/srv/docker/dispatch/` (root, 700) con `docker-compose.yml`, `runtime/nginx.conf`, `runtime/harden-users.sh`, `secrets/`, `backups/` e `.env`. `.env` viene creato dal template solo se manca;
- genera i segreti mancanti e crea vuoti `discord_token` e `discord_client_secret`;
- installa e abilita `dispatch-firewall.service`, che blocca dai bridge di egress di api e bot l'accesso all'host e alle reti private/LAN;
- verifica che `proxy_net` esista e che `flock` sia disponibile.

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

Variable **di repository** (non di environment: la condizione `if:` del job non vede le variabili di environment) `ENABLE_VPS_DEPLOY=true`, da impostare **solo** dopo aver verificato SSH, segreti, `.env`, accesso GHCR e NPM.

Verifica dell'accesso ristretto dalla macchina con la chiave:

```bash
ssh -i ~/.ssh/dispatch_deploy -o IdentitiesOnly=yes dispatch-deploy@<VPS_HOST> status
```

Il risultato atteso è `No release recorded yet.`. Qualsiasi altro comando viene rifiutato con `command not allowed`.

## 5. Deploy

Ogni push su `main` esegue:

1. `Ticket protection tests`: PostgreSQL temporaneo, migration reali, policy dei privilegi DB, Discord simulato; in parallelo `CI` (validazione compose, sintassi script, build).
2. Build delle immagini `runtime` e `migrate`, con SBOM e provenance, push su GHCR ed esportazione dei digest.
3. Solo se `ENABLE_VPS_DEPLOY == 'true'` e il ref è `main`: SSH verso `deploy <app@sha256> <migrate@sha256>`.

Sulla VPS, `dispatch-deploy deploy`:

1. prende un lock (`/run/dispatch-deploy.lock`): un deploy manuale non può sovrapporsi a uno da GitHub;
2. valida i due riferimenti (`ghcr.io/haxurus/dispatch@sha256:<64 hex>`) e controlla lo spazio su `/var/lib/docker`: sotto 5 GiB elimina le immagini Dispatch non più necessarie, sotto 3 GiB si ferma (un disco pieno ha già fermato PostgreSQL su VPS01);
3. se esiste una release corrente, fa il backup `pg_dump -Fc` in `backups/predeploy-<UTC>.dump` (600). Se il backup fallisce, il deploy si interrompe. I dump più vecchi di 14 giorni vengono rimossi solo dopo un backup riuscito;
4. esegue il pull delle immagini per digest;
5. esegue `docker compose up`. L'ordine è postgres → `migrate` (`prisma migrate deploy` come owner) → `secure-db` (utenti `dispatch_api`/`dispatch_bot` e grant) → api, bot e redis → web → edge;
6. attende fino a 150 s che api, bot, web ed edge risultino healthy;
7. se va a buon fine, aggiorna `.release` e `.previous-release`, rimuove i container one-shot ed elimina le immagini Dispatch diverse dalla release corrente e precedente;
8. se fallisce, salva i log dei servizi in `/srv/docker/dispatch/logs/deploy-failed-<UTC>.log` (root, 700; mantenuti 30 giorni) e riavvia la release precedente. Nell'output SSH, e quindi nei log GitHub Actions di un repository pubblico, compare solo il percorso del file e mai il contenuto dei log.

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

## 9. Sequenza completa dei comandi

Riepilogo operativo nello stesso ordine usato per Sentinel. `<VPS_IP>` è l'IPv4 di VPS01; i comandi "locali" vanno eseguiti in Git Bash (o in un terminale con OpenSSH e `gh` autenticato come `haxurus`).

### A. Prima di iniziare

1. Unire su `main` le PR aperte, in ordine (prima quella delle funzioni, poi quelle basate su di essa), e attendere che **Build and deploy** sia verde: il job `deploy` risulterà *skipped* finché `ENABLE_VPS_DEPLOY` non è attivo, ma le immagini saranno già su GHCR.
2. Discord Developer Portal: intents, redirect OAuth `https://dispatch.haxurus.com/backend/auth/discord/callback`, Application ID annotato (sezione 1).
3. Cloudflare: record `A` `dispatch` → `<VPS_IP>`, Proxied.
4. GHCR: rendere pubblico il package da `https://github.com/users/haxurus/packages/container/dispatch/settings` (oppure il `docker login` del punto C.6).

### B. Macchina locale: chiave di deploy

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/dispatch_deploy -C "dispatch-github-actions"
scp ~/.ssh/dispatch_deploy.pub user007@<VPS_IP>:~/
```

### C. VPS (come `user007`)

```bash
# 1. AllowUsers: aggiungere dispatch-deploy in fondo alla riga esistente
sudo sshd -T | grep '^allowusers'
sudoedit /etc/ssh/sshd_config.d/00-hardening.conf
sudo sshd -t && sudo systemctl reload ssh && sudo sshd -T | grep '^allowusers'
# (verificare da un secondo terminale che user007 entri ancora)

# 2. Installer da clone temporaneo
git clone --branch main https://github.com/haxurus/Dispatch.git /tmp/Dispatch
cd /tmp/Dispatch
sudo ./ops/install-vps.sh ~/dispatch_deploy.pub

# 3. Configurazione
sudoedit /srv/docker/dispatch/.env
sudoedit /srv/docker/dispatch/secrets/discord_token
sudoedit /srv/docker/dispatch/secrets/discord_client_secret
sudo find /srv/docker/dispatch/secrets -maxdepth 1 -type f -printf '%m %u:%g %p\n'

# 4. Copia offline della chiave di cifratura (conservarla fuori dalla VPS)
sudo cat /srv/docker/dispatch/secrets/data_encryption_key

# 5. Firewall e host key (fingerprint da confrontare al punto D.3)
sudo systemctl status dispatch-firewall.service --no-pager
sudo iptables -L DOCKER-USER -n -v --line-numbers
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
printf '%s %s\n' "<VPS_IP>" "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"

# 6. Solo se il package GHCR resta privato (token classic con il solo scope read:packages)
sudo docker login ghcr.io -u haxurus
```

7. Nginx Proxy Manager (tunnel SSH verso `127.0.0.1:81`): Proxy Host `dispatch.haxurus.com` → `http` `dispatch-edge` `8080`, certificato Origin `*.haxurus.com`, Force SSL, HSTS.

### D. GitHub (macchina locale)

```bash
# 1. Environment production limitato a main
gh api -X PUT repos/haxurus/Dispatch/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/haxurus/Dispatch/environments/production/deployment-branch-policies -f name=main

# 2. Secrets dell'environment
gh secret set VPS_DEPLOY_KEY --env production -R haxurus/Dispatch < ~/.ssh/dispatch_deploy
gh secret set VPS_HOST --env production -R haxurus/Dispatch --body "<VPS_IP>"
gh secret set VPS_PORT --env production -R haxurus/Dispatch --body 22

# 3. known_hosts: incollare la riga stampata al punto C.5, dopo aver verificato che
#    il fingerprint di `ssh-keyscan -t ed25519 <VPS_IP> | ssh-keygen -lf -` coincida
gh secret set VPS_KNOWN_HOSTS --env production -R haxurus/Dispatch

# 4. Verifica del percorso SSH ristretto (atteso: "No release recorded yet.")
ssh -i ~/.ssh/dispatch_deploy -o IdentitiesOnly=yes dispatch-deploy@<VPS_IP> status

# 5. Abilitazione (variabile di REPOSITORY) e primo deploy
gh variable set ENABLE_VPS_DEPLOY --body true -R haxurus/Dispatch
gh workflow run "Build and deploy" -R haxurus/Dispatch --ref main
gh run watch -R haxurus/Dispatch
```

### E. Verifica

```bash
# VPS
sudo /usr/local/sbin/dispatch-deploy status
sudo docker exec npm curl -sI http://dispatch-edge:8080/backend/health
# Locale
curl -sI https://dispatch.haxurus.com/backend/health
```

Poi il collaudo della sezione 8, accedendo da `https://dispatch.haxurus.com/it`.

### F. Operazioni successive

- Nuova versione: merge su `main` → deploy automatico.
- Rollback: `gh workflow run "Rollback production" -R haxurus/Dispatch --ref main` oppure `sudo /usr/local/sbin/dispatch-deploy rollback` (vedi sezione 6 per la semantica).
- Modifiche a `deploy/`, `ops/` o `security/` (es. nuovi grant in `harden-users.sh`): `cd /tmp/Dispatch && git pull --ff-only && sudo ./ops/install-vps.sh` **prima** del merge che le usa.
