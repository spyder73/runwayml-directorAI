# VPS Setup Runbook

This runbook is for the human operator after the production branch has been pushed.

## Human-only deployment boundary

The repo can provide code, config examples, commands, and troubleshooting checklists. The human operator runs every command on the VPS.

The agent does not have direct VPS shell, Docker, DNS, proxy, firewall, or certificate access. If deployment fails, copy back logs, error messages, screenshots, or command output so the agent can help diagnose the next step.

## 1. Check Docker

Run on the VPS:

```bash
docker --version
docker compose version
```

Install Docker Engine and the Compose plugin before continuing if either command is missing.

## 2. Create App Directory

```bash
sudo mkdir -p /opt/lifestory
sudo chown "$USER":"$USER" /opt/lifestory
cd /opt/lifestory
```

## 3. Clone The Repo

```bash
git clone https://github.com/spyder73/runwayml-directorAI.git .
git checkout production
```

## 4. Create Production Environment

```bash
cp .env.production.example .env.production
openssl rand -base64 32
openssl rand -base64 32
```

Paste the first generated value into `SESSION_SECRET` and the second generated value into `CREDENTIAL_ENCRYPTION_KEY`.

Then edit `.env.production` and fill:

- `APP_URL`
- SMTP settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- reviewer account credentials: `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`
- reviewer BYOK keys: `REVIEWER_OPENROUTER_API_KEY`, `REVIEWER_RUNWAYML_API_SECRET`
- Remotion settings if you need to override the conservative defaults

Keep `.env.production` on the VPS only. Do not commit it.

## 5. Prepare Persistent Data

```bash
mkdir -p data
chmod 700 data
```

The app stores SQLite data and private media under `./data`.

## 6. Start The App

Preferred shared-proxy network path:

```bash
docker network inspect proxy || docker network create proxy
docker compose -p lifestory --env-file .env.production up -d --build
docker compose -p lifestory ps
docker compose -p lifestory logs -f web
```

If the existing reverse proxy cannot join the Docker `proxy` network, use the localhost override:

```bash
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml --env-file .env.production up -d --build
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml ps
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml logs -f web
```

## 7. Connect The Existing Reverse Proxy

Use `deploy/REVERSE_PROXY.md` plus `deploy/caddy/Caddyfile.example` as the primary guide.

If proxy and app share the Docker network, route to:

```txt
lifestory-web:3000
```

If using the localhost fallback, route to:

```txt
127.0.0.1:3001
```

Do not bind this app directly to host `80` or `443`.

## 8. Verify HTTPS

```bash
curl -I https://your-new-domain.com
```

The response should be a real HTTP status from the app or its auth/proxy layer, not a connection failure.

## 9. Confirm Existing Domain Still Works

```bash
curl -I https://existing-domain.com
```

The existing service should still answer through the shared proxy.

## 10. Useful Debug Commands

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=200 web
docker logs --tail=200 lifestory-web
docker network inspect proxy
sudo ss -tulpn | grep -E ':80|:443'
```

Copy command output back into the development thread if you want help debugging.
