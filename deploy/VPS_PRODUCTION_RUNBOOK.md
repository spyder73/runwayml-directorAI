# VPS Production Runbook

This is the single start-to-finish handoff for deploying Lifestory on a VPS.
The older focused files stay in `deploy/` for reference, but this file is the
one to keep open while you work.

Run every command on the VPS unless a section explicitly says otherwise.

## 0. Values To Decide First

Fill these in before you start:

```txt
DOMAIN=your-domain.com
APP_DIR=/opt/lifestory
REPO=https://github.com/spyder73/runwayml-directorAI.git
BRANCH=production
PUBLIC_URL=https://your-domain.com
BACKUP_DIR=/opt/backups/lifestory
```

Recommended accounts and keys:

```txt
SMTP mailbox: no-reply@your-domain.com
Reviewer login: reviewer@your-domain.com
OpenRouter API key: from your OpenRouter account
Runway API secret: from your Runway account
```

Do not use your Porkbun account password, GitHub password, SSH password, or
personal email password for any app credential.

## 1. DNS On Porkbun

In Porkbun, open your domain DNS settings.

Add or verify:

```txt
Type  Host  Answer
A     @     your-vps-ipv4
A     www   your-vps-ipv4
```

Only add `AAAA` records if the VPS has working IPv6.

If you want the app on a subdomain, use this instead:

```txt
Type  Host       Answer
A     lifestory  your-vps-ipv4
```

Then your `APP_URL` will be:

```txt
https://lifestory.your-domain.com
```

Wait for DNS to resolve before expecting Caddy/TLS to work:

```bash
dig +short your-domain.com
dig +short www.your-domain.com
```

## 2. Porkbun SMTP Mailbox

Free email forwarding is not enough because the app must send verification
emails. Create a real hosted mailbox in Porkbun Email Hosting.

In Porkbun:

1. Open Domain Management.
2. Click the email/envelope option for your domain.
3. Enable Porkbun Email Hosting or the hosted email trial.
4. Create a mailbox such as `no-reply@your-domain.com`.
5. Create a strong mailbox password and save it in your password manager.

Use these values later in `.env.production`:

```env
SMTP_HOST=smtp.porkbun.com
SMTP_PORT=587
SMTP_USER=no-reply@your-domain.com
SMTP_PASS=the-mailbox-password-you-created
SMTP_FROM="Lifestory <no-reply@your-domain.com>"
SMTP_EHLO_DOMAIN=your-domain.com
```

Use port `587` first. The app will use STARTTLS automatically when the server
offers it.

## 3. Install Server Packages

If Docker is already installed, you can skip to the checks at the end of this
section.

For Ubuntu or Debian VPS hosts:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg sqlite3 tar
```

Install Docker using Docker's convenience installer:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm get-docker.sh
```

Allow your user to run Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"
```

Log out of SSH and log back in so the group change applies.

Confirm Docker and Compose are available:

```bash
docker --version
docker compose version
```

## 4. Basic Firewall

If you use `ufw`, make sure SSH is allowed before enabling it:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

Enable only after confirming SSH is allowed:

```bash
sudo ufw enable
sudo ufw status verbose
```

Do not open the app container port publicly. Public traffic should enter through
the existing reverse proxy on ports `80` and `443`.

## 5. Clone The Production Branch

Create the app directory:

```bash
sudo mkdir -p /opt/lifestory
sudo chown "$USER":"$USER" /opt/lifestory
cd /opt/lifestory
```

Clone the production branch:

```bash
git clone -b production https://github.com/spyder73/runwayml-directorAI.git .
```

Confirm you are in the right repo and branch:

```bash
git remote -v
git branch --show-current
git log -1 --oneline
```

The remote should be:

```txt
https://github.com/spyder73/runwayml-directorAI.git
```

## 6. Generate Production Secrets

Create the production env file:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate the two core app secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Put the first value into:

```env
SESSION_SECRET=
```

Put the second value into:

```env
CREDENTIAL_ENCRYPTION_KEY=
```

Important:

- `SESSION_SECRET` protects login sessions. Changing it logs users out.
- `CREDENTIAL_ENCRYPTION_KEY` encrypts stored BYOK API keys. Preserve it. If
  you lose or change it after users save keys, those saved keys cannot be
  decrypted.

Generate the reviewer account password:

```bash
openssl rand -hex 24
```

Save it in your password manager and use it as `REVIEWER_PASSWORD`.

## 7. Fill `.env.production`

Open the env file:

```bash
nano .env.production
```

Use this shape:

```env
NODE_ENV=production
APP_URL=https://your-domain.com
SESSION_SECRET=paste-first-openssl-rand-base64-32-value
CREDENTIAL_ENCRYPTION_KEY=paste-second-openssl-rand-base64-32-value

MEDIA_STORAGE_DIR=/app/data/media

SMTP_HOST=smtp.porkbun.com
SMTP_PORT=587
SMTP_USER=no-reply@your-domain.com
SMTP_PASS=paste-porkbun-mailbox-password
SMTP_FROM="Lifestory <no-reply@your-domain.com>"
SMTP_EHLO_DOMAIN=your-domain.com

REVIEWER_EMAIL=reviewer@your-domain.com
REVIEWER_PASSWORD=paste-openssl-rand-hex-24-value
REVIEWER_OPENROUTER_API_KEY=sk-or-v1-your-openrouter-key
REVIEWER_RUNWAYML_API_SECRET=your-runway-api-secret

RUNWAY_VIDEO_MODEL=gen4_turbo

REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
REMOTION_RENDER_QUALITY=fast
REMOTION_CONCURRENCY=50%
REMOTION_TIMEOUT_MS=900000
REMOTION_X264_PRESET=veryfast
REMOTION_BUNDLE_CACHE=true
```

Notes:

- `APP_URL` must exactly match the public HTTPS URL users open in the browser.
- `SMTP_PASS` is the Porkbun mailbox password, not your Porkbun account password.
- `REVIEWER_EMAIL` is an app login that is automatically seeded and confirmed.
- `REVIEWER_PASSWORD` is only for logging into this app as the reviewer user.
- `REVIEWER_OPENROUTER_API_KEY` and `REVIEWER_RUNWAYML_API_SECRET` are optional
  but useful for acceptance testing. If you leave them blank, log in as the
  reviewer and add keys in settings later.
- Keep `.env.production` on the VPS only. Never commit it.

Quick sanity check:

```bash
grep -n "your-domain\\|paste-\\|your-openrouter\\|your-runway" .env.production
```

This command should print nothing once you have replaced every placeholder.

## 8. Prepare Persistent Data

Create the persistent data directory:

```bash
mkdir -p data
chmod 700 data
```

The app stores SQLite and private media here:

```txt
/opt/lifestory/data/lifestory.sqlite
/opt/lifestory/data/media/
```

Back up this directory. Do not delete it during redeploys.

## 9. Choose A Reverse Proxy Mode

Use exactly one of these modes.

Preferred mode:

```txt
Existing Caddy/nginx joins Docker network `proxy`.
Public proxy routes to lifestory-web:3000.
```

Fallback mode:

```txt
App binds only to 127.0.0.1:3001.
Public proxy routes to 127.0.0.1:3001.
```

Use preferred mode if your existing reverse proxy runs in Docker and can join a
shared Docker network. Use fallback mode if your proxy cannot join that network
or runs directly on the host.

## 10. Start With Preferred Proxy Network

Create the shared Docker network:

```bash
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
```

If your existing Caddy container is not on that network, connect it. Replace
`caddy` with the real container name:

```bash
docker ps
docker network connect proxy caddy
```

If it is already connected, Docker may say the endpoint already exists. That is
fine.

Validate Compose config:

```bash
docker compose -p lifestory --env-file .env.production config
```

Build and start the app:

```bash
docker compose -p lifestory --env-file .env.production up -d --build
```

Check status and logs:

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=200 web
```

The app container should be named:

```txt
lifestory-web
```

## 11. Fallback: Start On Localhost Port 3001

Only use this if the shared Docker network path is not practical.

Build and start with the localhost override:

```bash
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml --env-file .env.production up -d --build
```

Check status and logs:

```bash
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml ps
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml logs --tail=200 web
```

This binds:

```txt
127.0.0.1:3001 -> container port 3000
```

It is still private to the VPS. The public reverse proxy must serve it.

## 12. Caddy Configuration

If the reverse proxy is Caddy, add a site block like this.

Preferred Docker network upstream:

```caddyfile
your-domain.com, www.your-domain.com {
  request_body {
    max_size 25MB
  }

  reverse_proxy /api/pipeline/events* lifestory-web:3000 {
    flush_interval -1
    transport http {
      read_timeout 1h
    }
  }

  reverse_proxy lifestory-web:3000 {
    transport http {
      read_timeout 15m
    }
  }
}
```

Localhost fallback upstream:

```caddyfile
your-domain.com, www.your-domain.com {
  request_body {
    max_size 25MB
  }

  reverse_proxy /api/pipeline/events* 127.0.0.1:3001 {
    flush_interval -1
    transport http {
      read_timeout 1h
    }
  }

  reverse_proxy 127.0.0.1:3001 {
    transport http {
      read_timeout 15m
    }
  }
}
```

If Caddy runs directly on the host:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

If Caddy runs in Docker, replace `caddy` with the real container name:

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
docker logs --tail=100 caddy
```

Keep the `/api/pipeline/events` route separate. It is the app's server-sent
events stream, and it should not be buffered.

## 13. nginx Configuration

If the existing proxy is nginx instead of Caddy, adapt
`deploy/nginx/lifestory.conf.example`.

Required behavior:

```txt
client_max_body_size 25m
proxy_buffering off for /api/pipeline/events
proxy_read_timeout 1h for /api/pipeline/events
```

Validate and reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

## 14. First HTTPS Checks

Confirm public routing:

```bash
curl -I https://your-domain.com
curl -I https://www.your-domain.com
```

Confirm the app container is healthy enough to answer logs:

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=200 web
```

Check that only the shared proxy owns public ports:

```bash
sudo ss -tulpn | grep -E ':80|:443'
docker ps
```

The app should not bind directly to public `0.0.0.0:80` or `0.0.0.0:443`.

## 15. Email Verification Smoke Test

Open the app URL in a browser:

```txt
https://your-domain.com
```

Register a new test user with an email address you can receive.

Expected result:

1. The app creates the account.
2. Porkbun SMTP sends a verification email.
3. The verification link opens `/verify-email`.
4. The user can log in after verification.

If email does not arrive, inspect logs:

```bash
docker compose -p lifestory logs --tail=300 web
```

Common SMTP issues:

```txt
Wrong SMTP_PASS: reset the Porkbun mailbox password.
Wrong SMTP_USER: use the full mailbox address.
Wrong SMTP_FROM: use the same mailbox or a sender allowed by Porkbun.
DNS not ready: wait and retry.
Spam folder: check it during the first test.
```

## 16. Reviewer Account Test

The reviewer account is created automatically on app startup when these are set:

```env
REVIEWER_EMAIL=
REVIEWER_PASSWORD=
```

Log in at the app with:

```txt
Email: reviewer@your-domain.com
Password: the generated REVIEWER_PASSWORD
```

The account is already email-confirmed.

If you set reviewer BYOK keys in `.env.production`, the reviewer account should
already have encrypted credentials stored. If you left them blank, open settings
inside the app and add:

```txt
OpenRouter API key
Runway API secret
```

## 17. Production Acceptance Checklist

Run through this in the browser:

- Register a new user.
- Receive a confirmation email.
- Confirm the email.
- Log out.
- Log back in.
- Open settings.
- Save BYOK OpenRouter and Runway keys.
- Confirm settings shows saved state but does not reveal raw keys.
- Upload a reference image.
- Start a short Memory session.
- Generate at least one sketch.
- Approve treatment and outline.
- Generate frames.
- Generate narration and video clips.
- Render the final MP4.
- Download the final MP4.
- Confirm the existing VPS domain still works if the VPS already hosted another
  service.

Useful command checks during acceptance:

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=300 web
curl -I https://your-domain.com
sudo ss -tulpn | grep -E ':80|:443'
```

Check logs for accidental secret output:

```bash
docker compose -p lifestory logs --tail=1000 web | grep -Ei 'sk-|api[_-]?key|secret|password'
```

Review any matches carefully. Do not paste real secrets into public tickets or
chat logs.

## 18. Backups

Run a backup after the first successful production render:

```bash
cd /opt/lifestory
bash deploy/backup-lifestory.sh
ls -lh /opt/backups/lifestory
```

Copy the newest DB and media backups off the VPS:

```bash
scp user@your-vps:/opt/backups/lifestory/lifestory-YYYY-MM-DD-HHMM.sqlite .
scp user@your-vps:/opt/backups/lifestory/media-YYYY-MM-DD-HHMM.tar.gz .
```

Install a daily cron backup:

```bash
sudo crontab -e
```

Add:

```cron
17 3 * * * cd /opt/lifestory && APP_DIR=/opt/lifestory BACKUP_DIR=/opt/backups/lifestory bash deploy/backup-lifestory.sh >> /var/log/lifestory-backup.log 2>&1
```

Confirm cron logs after the next run:

```bash
sudo tail -100 /var/log/lifestory-backup.log
ls -lh /opt/backups/lifestory
```

Optional retention check before deleting old backups:

```bash
find /opt/backups/lifestory -type f -mtime +14 -print
```

If the printed list is safe to remove:

```bash
find /opt/backups/lifestory -type f -mtime +14 -delete
```

## 19. Recovery Drill

Use a staging copy first if possible.

Stop the app:

```bash
cd /opt/lifestory
docker compose -p lifestory stop web
```

Restore database and media:

```bash
cp /opt/backups/lifestory/lifestory-YYYY-MM-DD-HHMM.sqlite /opt/lifestory/data/lifestory.sqlite
rm -rf /opt/lifestory/data/media
mkdir -p /opt/lifestory/data/media
tar -xzf /opt/backups/lifestory/media-YYYY-MM-DD-HHMM.tar.gz -C /opt/lifestory/data
chmod 700 /opt/lifestory/data
```

Start the app:

```bash
docker compose -p lifestory up -d web
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=100 web
```

Then log in and open a completed session to confirm the database and private
media still agree with each other.

## 20. Updating Production Later

From the VPS:

```bash
cd /opt/lifestory
git fetch origin
git checkout production
git pull --ff-only origin production
docker compose -p lifestory --env-file .env.production up -d --build
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=200 web
```

If you use the localhost fallback, use the same override files every time:

```bash
docker compose -p lifestory -f docker-compose.yml -f docker-compose.localhost.yml --env-file .env.production up -d --build
```

## 21. Rollback

Find the last good commit:

```bash
cd /opt/lifestory
git log --oneline -10
```

Check it out and rebuild:

```bash
git checkout LAST_GOOD_COMMIT_SHA
docker compose -p lifestory --env-file .env.production up -d --build
docker compose -p lifestory logs --tail=200 web
```

After the incident, return to the production branch:

```bash
git checkout production
git pull --ff-only origin production
```

## 22. Troubleshooting Commands

App status:

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs -f web
docker logs --tail=200 lifestory-web
```

Docker network:

```bash
docker network inspect proxy
docker inspect lifestory-web --format '{{json .NetworkSettings.Networks}}'
```

Ports:

```bash
sudo ss -tulpn | grep -E ':80|:443|:3001'
```

DNS:

```bash
dig +short your-domain.com
dig +short www.your-domain.com
```

HTTPS:

```bash
curl -I https://your-domain.com
curl -vI https://your-domain.com
```

Disk usage:

```bash
df -h
du -sh /opt/lifestory/data
du -sh /opt/backups/lifestory
```

## 23. Manual Setup Checklist

- [ ] DNS A records point at the VPS.
- [ ] Porkbun hosted mailbox exists for `no-reply@your-domain.com`.
- [ ] Docker and Compose are installed.
- [ ] Repo is cloned to `/opt/lifestory`.
- [ ] Branch is `production`.
- [ ] `.env.production` exists and is `chmod 600`.
- [ ] `SESSION_SECRET` is generated.
- [ ] `CREDENTIAL_ENCRYPTION_KEY` is generated and saved safely.
- [ ] `APP_URL` is the exact HTTPS app URL.
- [ ] Porkbun SMTP values are filled.
- [ ] Reviewer email and generated reviewer password are filled.
- [ ] OpenRouter and Runway keys are filled or will be added in settings.
- [ ] `data/` exists and is `chmod 700`.
- [ ] Docker `proxy` network exists, or localhost fallback is selected.
- [ ] App starts with Compose project `lifestory`.
- [ ] Existing Caddy/nginx routes the app domain to the correct upstream.
- [ ] HTTPS responds.
- [ ] Email verification works.
- [ ] Reviewer login works.
- [ ] BYOK settings work.
- [ ] A short generation completes.
- [ ] Final MP4 render completes.
- [ ] Backup script runs successfully.
- [ ] New DB and media backups are copied off the VPS.
