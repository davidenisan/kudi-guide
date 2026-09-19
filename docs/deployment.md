# Hosting Kudi Guide

Start with a single always-on Ubuntu 24.04 server. My sizing recommendation for a small private beta is **4 vCPU, 16 GB RAM, and 80+ GB SSD**; this is an initial estimate, not a measured capacity guarantee. Qwen3 4B runs on CPU, so receipt latency and throughput need testing on the chosen server. The current worker processes messages sequentially. Increase CPU/GPU capacity when queue time grows.

A provider such as [Hetzner Cloud](https://www.hetzner.com/cloud/) is suitable. Choose a region close to your users, compare the current price at checkout, and include server backups and your domain in the budget. The app can move to another Docker-capable host later.

This repository includes `deploy/Dockerfile`, `compose.production.yaml`, and `deploy/Caddyfile`. They run:

- Caddy: public HTTPS endpoint, forwarding to the web app.
- Next.js: account login and dashboard, calling the API over the private Docker network.
- API: Telegram long polling, background worker, receipt extraction and account sessions.
- PostgreSQL: accounts, transactions, connections and sessions.
- Redis: durable message queue.
- Ollama: Qwen3 4B. Tesseract and Poppler are included in the API image.

Only Caddy publishes host ports. PostgreSQL, Redis, API and Ollama have no public ports. [Next.js recommends a reverse proxy for self-hosting](https://nextjs.org/docs/app/guides/self-hosting). The current Telegram receipt flow processes files temporarily and deletes them; it does not need S3 storage. The S3 environment values in Compose are unused placeholders for the legacy configuration validator.

## 1. Prepare the server and domain

1. Create the server with an SSH key and Ubuntu 24.04. Enable provider backups.
2. Point an A record, such as `app.yourdomain.com`, to the server IPv4 address. Add an AAAA record only if IPv6 is configured correctly.
3. In the provider firewall, allow TCP 80/443 publicly; allow TCP 22 from your own IP. UDP 443 is optional for HTTP/3. Keep database and model ports closed.
4. Follow [Docker's official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/) to install Docker Engine and Compose. Verify `docker compose version` works. Commands below assume your deployment user can run Docker (otherwise use `sudo`).
5. Transfer the project source, including all new files and migrations, to `/opt/kudi-guide`. A private Git repository is convenient once these changes have been committed and pushed. Do not upload `.env`, `node_modules`, `.next`, `.git` internals or local financial documents as a build context. The supplied `.dockerignore` excludes these files from the image.

## 2. Add production settings

On the server, inside `/opt/kudi-guide`:

```sh
umask 077
nano .env.production
```

Enter these four settings (replace every placeholder):

```dotenv
APP_DOMAIN=app.yourdomain.com
POSTGRES_PASSWORD=REPLACE_WITH_RANDOM_HEX
JWT_SECRET=REPLACE_WITH_ANOTHER_RANDOM_HEX
TELEGRAM_BOT_TOKEN=YOUR_EXISTING_BOTFATHER_TOKEN
```

Run `openssl rand -hex 32` separately for each random value. Use a hex database password so it can be inserted into the connection URL safely. Keep the bot token in this file, never in Git, browser variables or screenshots.

The web app uses an internal API URL automatically; no public API hostname is required. Compose sets `APP_ORIGIN` to your public HTTPS origin so login accepts your domain behind Caddy and rejects other origins. Production cookies require HTTPS. The JWT secret must remain stable for legacy account setup; regular password sessions are backed by PostgreSQL.

For the remaining commands, define this shell helper from the project root:

```sh
dc() { docker compose --env-file .env.production -f compose.production.yaml "$@"; }
dc config --quiet
dc build
```

The configuration validates without printing your secrets. The Dockerfile installs the repository's pinned pnpm version, builds both apps and includes OCR tools.

## 3. Preserve your existing accounts and transactions

Do this before starting the production API if you want to keep the current local data. A fresh deployment otherwise creates an empty database.

On the Mac, wait for queued Telegram work to finish, then stop the local API process. Do not run the local and hosted bot consumers simultaneously. Take a database dump:

```sh
umask 077
docker exec kudi-guide-postgres-5433 pg_dump -U postgres -d kudi_guide -Fc > kudi-guide.dump
```

Transfer that dump securely to the server over SSH/SCP. It contains private account and transaction data; keep it out of the repository and any public directory. On the server, start only the database and restore into the **new empty** database:

```sh
dc up -d postgres
dc exec postgres pg_isready -U kudi -d kudi_guide
dc exec -T postgres pg_restore -U kudi -d kudi_guide --no-owner --no-privileges < kudi-guide.dump
```

Wait for `pg_isready` to succeed before restoring. Stop if restoration reports an error; do not start the API against a partial restore. Do not use this restore command on a populated production database without a separate recovery plan.

The dump carries the Telegram account links, usernames/password hashes, profile names, transactions, migration history and session records. Users log in to the new domain normally; localhost cookies cannot move to the new domain. Public onboarding offers email/username and password login; an authenticated legacy account can add credentials in Settings before migration.

## 4. Start the model, then the app

```sh
dc up -d postgres redis ollama
dc exec ollama ollama pull qwen3:4b
dc exec ollama ollama list
dc up -d --build
dc ps
dc logs --tail=80 migrate api web caddy
```

The first model download takes time. Wait for Ollama to start before running `ollama pull`; retry if the container is still starting. The model stays in a named volume. [Ollama's Docker documentation](https://docs.ollama.com/docker) covers CPU and optional GPU configurations.

Compose runs database migrations before starting the API. Caddy obtains and renews HTTPS certificates once DNS points to the server and ports 80/443 are reachable. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https). No Telegram webhook or tunnel is needed with the existing polling setup. Keep exactly one API/bot consumer running.

## 5. Verify the deployed product

Open `https://app.yourdomain.com/onboarding`:

1. Log in and refresh: you should remain signed in and see the saved profile name.
2. Check Connections: a migrated Telegram link should already be present. New accounts connect once.
3. Send a small test expense to your bot and confirm it appears in the dashboard.
4. Send a transfer receipt photo and PDF; check recipient, amount, category and direct saving.
5. Send `actually 5k` to the bot; verify it updates the last expense rather than creating a duplicate.
6. Log out and confirm the old session no longer opens account data.

These Telegram checks create real records in the chosen account. Use your own clearly identified test transactions/account. If AI is unavailable, check `dc logs ollama api` and `dc exec ollama ollama list`. A successful API `/health` check alone does not establish that the model is ready.

## 6. Backups, updates and recovery

Take regular PostgreSQL backups and copy them to encrypted storage outside the server. Provider snapshots are useful but also test restoring a database dump on a separate disposable server. Example backup command from the project root:

```sh
umask 077
mkdir -p backups
dc exec -T postgres pg_dump -U kudi -d kudi_guide -Fc > "backups/kudi-guide-$(date +%F-%H%M).dump"
```

Keep `.env.production` securely backed up too. Add an external uptime check for the HTTPS login page and watch queue/error logs. Configure server monitoring for RAM, disk and CPU. Rotate Docker logs to avoid filling the disk. Do not run `docker compose down -v`: `-v` removes persistent databases/model/certificate volumes.

For code updates, back up first, transfer a reviewed revision, build it, then run:

```sh
dc build
dc up -d
```

When an update adds a migration and the `migrate` image hasn't changed, explicitly run `dc run --rm migrate` before `dc up -d`. This is a single-server deployment with brief update downtime, not zero-downtime scaling. Keep a previous image/revision for rollback; reverse database migrations require their own plan. Pin infrastructure images to tested digests before a wider rollout (the starter Compose file uses maintained version tags and Ollama's latest tag).

Before a broad public launch, add password recovery and email verification (neither is implemented), move login throttling to a shared store if scaling, and load-test the CPU inference queue. For the current small beta, one API instance matches the existing queue and Telegram design.

## What's already checked versus what still happens on the host

Local validation can check application tests, OCR/model extraction, image builds and Compose syntax. DNS, certificate issuance, provider firewall, actual server capacity, off-server backup restoration and live Telegram cutover are verified only after you provision the host. Nothing in this guide purchases hosting, publishes the app or moves your existing data automatically.

Validated locally: 72 API/OCR tests on Linux, API and web image builds, migrations into an empty isolated PostgreSQL database, non-root production startup, proxy-origin signup, rejection of a different origin, secure persistent cookies and authenticated page reload. Real local Qwen3/OCR checks also passed synthetic image, text-PDF and scanned-PDF transfers through direct saving.

To repeat the isolated container smoke check (no bot token or real database is used):

```sh
docker build -f deploy/Dockerfile --target api -t kudi-guide-deploy-check .
docker build -f deploy/Dockerfile --target web -t kudi-guide-web-deploy-check .
sh scripts/check-deployment.sh
```

The script removes only its temporary test containers/network on exit. It does not provision a host or issue a live certificate.
