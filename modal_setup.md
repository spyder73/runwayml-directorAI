# Modal Final Render Setup

This app keeps local Remotion rendering unless `FINAL_RENDER_BACKEND=modal` is set. Do not flip production to Modal until the Modal app deploy succeeds and you have a short test render ready.

## 1. Create or Log Into Modal

From the `runwayml-directorAI` repo root:

```bash
python3 -m venv .venv-modal
source .venv-modal/bin/activate
pip install "modal>=1.1,<2"
modal setup
modal token info
```

If you are setting up a headless VPS or CI environment, create or paste credentials instead:

```bash
modal token new
# or:
modal token set --token-id "ak-..." --token-secret "as-..."
modal token info
```

Relevant Modal docs:
- https://modal.com/docs/guide/modal-user-account-setup
- https://modal.com/docs/reference/cli/setup
- https://modal.com/docs/reference/cli/token

## 2. Deploy the Renderer

Run this from the repo root so Modal can package `package.json`, `package-lock.json`, `tsconfig.json`, and `src/remotion`.

```bash
source .venv-modal/bin/activate
modal deploy python/modal_renderer/app.py
```

If your Modal workspace uses environments, deploy to the same environment you will configure in production:

```bash
MODAL_ENVIRONMENT=main modal deploy -e main python/modal_renderer/app.py
```

Confirm the app exists:

```bash
modal app list
modal app logs lifestory-remotion-renderer
```

Relevant Modal docs:
- https://modal.com/docs/reference/cli/deploy
- https://modal.com/docs/guide/managing-deployments
- https://modal.com/docs/guide/trigger-deployed-functions

## 3. Configure Production Env

In `.env.production`, keep these values unless you intentionally renamed the Modal app or function:

```env
FINAL_RENDER_BACKEND=modal

MODAL_TOKEN_ID=ak-your-token-id
MODAL_TOKEN_SECRET=as-your-token-secret
MODAL_ENVIRONMENT=main

MODAL_RENDER_APP_NAME=lifestory-remotion-renderer
MODAL_RENDER_FUNCTION_NAME=render_final
MODAL_RENDER_VOLUME=lifestory-render-jobs
MODAL_RENDER_BRIDGE_PORT=8765

MODAL_RENDER_CPU=8
MODAL_RENDER_MEMORY_MB=16384
MODAL_RENDER_TIMEOUT_SEC=1800
```

The Docker container starts a local-only bridge at `127.0.0.1:8765` when `FINAL_RENDER_BACKEND=modal`. The bridge uploads private render files to the Modal Volume, invokes the deployed function, downloads the final MP4 back into `MEDIA_STORAGE_DIR`, and the existing `/api/media/:id` final-video flow remains unchanged.

## 4. Rebuild and Start Docker

```bash
docker compose up -d --build web
docker compose logs -f web
```

Expected startup behavior:
- With `FINAL_RENDER_BACKEND=modal`, logs should include the app starting normally and the Python bridge process should stay alive.
- With `FINAL_RENDER_BACKEND=local` or unset, the Python bridge should not start and final rendering remains fully local.

## 5. Smoke Test a Render

1. Create or use a short session with one or two generated video clips.
2. Trigger the final render from the app UI.
3. Watch app logs:

```bash
docker compose logs -f web
```

4. Watch Modal logs:

```bash
source .venv-modal/bin/activate
modal app logs lifestory-remotion-renderer
```

Expected result:
- The UI enters the existing final render progress state.
- Modal builds or reuses the renderer image, runs `render_final`, and writes `final.mp4` into the Modal Volume.
- The bridge downloads the MP4 into local private media storage.
- The app completes the session with a final `/api/media/:id` URL.

## 6. Roll Back to Local Rendering

Set:

```env
FINAL_RENDER_BACKEND=local
```

Then restart:

```bash
docker compose up -d --build web
```

No data migration is needed. Modal is only a render executor; SQLite and `/app/data/media` remain the source of truth.

## 7. Logs to Watch

Application logs are structured JSON. In Docker logs, look for:

- `scope=final-render`, `message=backend-selected`: confirms the user's setting, server env, and selected backend.
- `scope=final-render`, `message=modal-render-submit`: app handed the render manifest to the local bridge.
- `scope=modal-render-bridge`, `message=request-start`: Next.js called the local Python bridge.
- `scope=modal-render-bridge`, `message=request-completed`: bridge downloaded the final MP4 back to local media storage.
- `scope=final-render`, `message=modal-render-completed`: final app-side Modal render completion.

In Modal logs, look for:

- `scope=modal-renderer`, `message=render-start`: Modal container started the Remotion render.
- `scope=modal-renderer`, `message=render-completed`: Modal wrote the final MP4 into the Volume.
- Any `message=render-failed`, `modal-render-failed`, or `request-failed` entry marks the layer where the handoff failed.

Useful commands:

```bash
docker compose logs -f web
modal app logs lifestory-remotion-renderer
```

## 8. Tuning

Start with:

```env
MODAL_RENDER_CPU=8
MODAL_RENDER_MEMORY_MB=16384
MODAL_RENDER_TIMEOUT_SEC=1800
REMOTION_RENDER_QUALITY=fast
REMOTION_X264_PRESET=veryfast
REMOTION_CONCURRENCY=50%
```

For 1080x1920 inputs, benchmark before increasing quality:
- `REMOTION_RENDER_QUALITY=standard` gives 720x1280 portrait output.
- `REMOTION_RENDER_QUALITY=ultra` gives 1080x1920 portrait output and costs more CPU time.
- Increase `MODAL_RENDER_CPU` and `MODAL_RENDER_MEMORY_MB` together if renders fail under load or time out.

## 9. Common Failures

- `Function not found`: redeploy with `modal deploy python/modal_renderer/app.py`, then confirm `MODAL_RENDER_APP_NAME=lifestory-remotion-renderer` and `MODAL_RENDER_FUNCTION_NAME=render_final`.
- `Authentication failed`: refresh `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, then restart Docker.
- `Input media file is missing`: the local `/app/data/media` volume is not mounted or the session references deleted media.
- Build fails in Modal image: run deploy from the repo root so `package-lock.json` and `src/remotion` can be uploaded.
- Render times out: increase `MODAL_RENDER_TIMEOUT_SEC`, or use `REMOTION_RENDER_QUALITY=fast` for the first successful benchmark.
