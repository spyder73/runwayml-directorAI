# Production TODO

Use this as the manual VPS launch checklist. Commands and details live in `deploy/VPS_SETUP.md` and `deploy/REVERSE_PROXY.md`.

## VPS Bootstrap

- [ ] Confirm Docker and Docker Compose plugin are installed.
- [ ] Create `/opt/lifestory`.
- [ ] Clone `https://github.com/spyder73/runwayml-directorAI.git`.
- [ ] Check out the `production` branch.

## Secrets And Environment

- [ ] Create `.env.production` from `.env.production.example`.
- [ ] Generate `SESSION_SECRET`.
- [ ] Generate `CREDENTIAL_ENCRYPTION_KEY`.
- [ ] Fill `APP_URL`.
- [ ] Fill SMTP credentials.
- [ ] Fill reviewer credentials and reviewer BYOK keys.
- [ ] Review Remotion defaults and override only if the VPS can handle more load.

## Data And Runtime

- [ ] Create and secure `data/`.
- [ ] Start the app with Compose project `lifestory`.
- [ ] Confirm `lifestory-web` is running.
- [ ] Check app logs for startup errors.

## Reverse Proxy

- [ ] Point DNS A records at the VPS.
- [ ] Add AAAA records only if VPS IPv6 is configured.
- [ ] Wire the existing Caddy reverse proxy.
- [ ] Use `lifestory-web:3000` when sharing the Docker `proxy` network.
- [ ] Use `127.0.0.1:3001` only with `docker-compose.localhost.yml`.
- [ ] Keep this app off direct host `80` and `443` binds.
- [ ] Preserve SSE settings for `/api/pipeline/events`.
- [ ] Keep upload body cap at 25MB.

## Smoke Tests

- [ ] Complete the production acceptance runbook in `deploy/ACCEPTANCE_TESTING.md`.
- [ ] Verify the new domain over HTTPS.
- [ ] Verify the existing domain still works.
- [ ] Register and confirm a test user.
- [ ] Save BYOK keys through settings.
- [ ] Upload a reference image.
- [ ] Run one short generation.
- [ ] Render a final MP4.
- [ ] Confirm logs do not expose secrets.

## Backups And Recovery

- [ ] Run `deploy/backup-lifestory.sh` after first successful production render.
- [ ] Copy the newest SQLite backup off the VPS.
- [ ] Copy the newest media archive off the VPS.
- [ ] Test recovery by restoring DB and media into `data/`.
- [ ] Open a completed session after recovery.
