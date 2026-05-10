# Reverse Proxy VPS Handoff

These are manual VPS steps. The repo prepares compose and proxy examples, but the operator must run the server commands, update DNS, and reload the public proxy.

## DNS

- Add an A record for `your-new-domain.com` and `www.your-new-domain.com` pointing to the VPS IPv4.
- Add an AAAA record only if the VPS has working IPv6.
- Wait for propagation before requesting or renewing TLS certificates.

## Inspect The Current Proxy

Run these on the VPS to see what already owns public HTTP and HTTPS:

```bash
docker ps
sudo ss -tulpn | grep -E ':80|:443'
```

Do not start a second public reverse proxy on `80` or `443`. This app should sit behind the existing shared proxy.

## Preferred Docker Network Path

Use the shared Docker proxy network when Caddy or nginx can reach app containers directly:

```bash
docker network inspect proxy || docker network create proxy
copy .env.production.example .env.production
docker compose up -d --build
```

The production compose file exposes app port `3000` only to Docker networks and gives the app container the stable name `lifestory-web`.

For Caddy, adapt `deploy/caddy/Caddyfile.example` into the existing Caddyfile and reload Caddy. Keep the SSE route separate so `/api/pipeline/events` streams with `flush_interval -1` and a one-hour read timeout.

## Localhost Fallback Path

If the existing reverse proxy cannot join the Docker `proxy` network, use the localhost-only compose override:

```bash
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
```

Then point the public proxy upstream at:

```txt
http://127.0.0.1:3001
```

The fallback binding is `127.0.0.1:3001:3000`, so the app is still not directly public.

## Caddy Notes

- Use the existing Caddy process/container if one is already serving the VPS.
- Copy the site block from `deploy/caddy/Caddyfile.example`.
- Keep `request_body max_size 25MB` so uploads match app limits.
- Caddy core does not ship a standard rate-limit directive. Add coarse proxy rate limits with your existing Caddy rate-limit module, an upstream firewall, or another edge layer if available. The app also enforces auth, upload, generation, and render rate limits internally.

## nginx Notes

- Use `deploy/nginx/lifestory.conf.example` only if nginx is the shared proxy.
- Keep `client_max_body_size 25m`.
- Keep `proxy_buffering off` for `/api/pipeline/events`.
- Put `limit_req_zone` directives in the nginx `http {}` context.

## Smoke Checks

After proxy reload:

```bash
curl -I https://your-new-domain.com
curl -N https://your-new-domain.com/api/pipeline/events
docker logs --tail=100 lifestory-web
```

The SSE endpoint may return `401` without a session cookie; that is okay. The important proxy check is that it reaches the app and does not buffer or time out immediately.
