# Production Acceptance Testing

Run this after the app is deployed on the VPS and the reverse proxy is serving the new domain.

## Local Automated Checks

Run from the repo before deployment:

```bash
npm test
npm run build
```

## Docker Checks

Run on the VPS from `/opt/lifestory`:

```bash
docker compose -p lifestory --env-file .env.production build
docker compose -p lifestory --env-file .env.production up -d
docker compose -p lifestory logs -f web
```

## Auth flow

- [ ] Register a new user.
- [ ] Receive confirmation email.
- [ ] Confirm email.
- [ ] Log in.
- [ ] Log out.
- [ ] Log back in.

## BYOK flow

- [ ] Open settings.
- [ ] Save OpenRouter key.
- [ ] Save Runway key.
- [ ] Confirm settings page shows saved state but never raw keys.

## Authorization flow

- [ ] Create session as User A.
- [ ] Log in as User B.
- [ ] Confirm User B cannot open User A session URL.
- [ ] Confirm User B cannot stream User A media URL.

## Media flow

- [ ] Upload reference image.
- [ ] Confirm it is not publicly accessible from `/public`.
- [ ] Confirm `/api/media/<id>` works only while authenticated as owner.
- [ ] Confirm video/audio preview supports seeking.

## Generation flow

- [ ] Create short Memory session.
- [ ] Generate at least one sketch.
- [ ] Approve treatment/outline.
- [ ] Generate frames.
- [ ] Generate narration and video clips.
- [ ] Render final MP4.
- [ ] Download final MP4.

## Remotion flow

- [ ] Confirm final render progress appears.
- [ ] Confirm only one final render can run at a time.
- [ ] Confirm final video exists under private media storage.
- [ ] Confirm logs do not show API keys.

## VPS coexistence

- [ ] New domain serves this app over HTTPS.
- [ ] Existing Docker service/domain still serves over HTTPS.
- [ ] Only shared proxy binds host `80/443`.

Useful checks:

```bash
curl -I https://your-new-domain.com
curl -I https://existing-domain.com
sudo ss -tulpn | grep -E ':80|:443'
docker ps
```
