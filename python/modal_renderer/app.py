from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import modal


APP_NAME = os.environ.get("MODAL_RENDER_APP_NAME", "lifestory-remotion-renderer")
VOLUME_NAME = os.environ.get("MODAL_RENDER_VOLUME", "lifestory-render-jobs")
VOLUME_MOUNT_PATH = os.environ.get("MODAL_RENDER_VOLUME_MOUNT_PATH", "/render-data")
WORKDIR = "/workspace"

volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
app = modal.App(APP_NAME)

image = (
    modal.Image.from_registry("node:20-bookworm-slim", add_python="3.11")
    .apt_install(
        "ca-certificates",
        "chromium",
        "ffmpeg",
        "fonts-liberation",
        "libasound2",
        "libatk-bridge2.0-0",
        "libatk1.0-0",
        "libcairo2",
        "libcups2",
        "libdbus-1-3",
        "libgbm-dev",
        "libnss3",
        "libpango-1.0-0",
        "libxcomposite1",
        "libxdamage1",
        "libxfixes3",
        "libxkbcommon-dev",
        "libxrandr2",
    )
    .workdir(WORKDIR)
    .add_local_file("package.json", f"{WORKDIR}/package.json", copy=True)
    .add_local_file("package-lock.json", f"{WORKDIR}/package-lock.json", copy=True)
    .add_local_file("tsconfig.json", f"{WORKDIR}/tsconfig.json", copy=True)
    .add_local_dir("src/remotion", f"{WORKDIR}/src/remotion", copy=True)
    .add_local_file("python/modal_renderer/render_runner.mjs", f"{WORKDIR}/render_runner.mjs", copy=True)
    .run_commands("npm ci")
    .env(
        {
            "NEXT_TELEMETRY_DISABLED": "1",
            "REMOTION_BROWSER_EXECUTABLE": "/usr/bin/chromium",
        }
    )
)


def _cpu() -> float:
    try:
        return float(os.environ.get("MODAL_RENDER_CPU", "8"))
    except ValueError:
        return 8.0


def _memory() -> int:
    try:
        return int(os.environ.get("MODAL_RENDER_MEMORY_MB", "16384"))
    except ValueError:
        return 16384


def _timeout() -> int:
    try:
        return int(os.environ.get("MODAL_RENDER_TIMEOUT_SEC", "1800"))
    except ValueError:
        return 1800


def _log(message: str, **fields: Any) -> None:
    print(json.dumps({"scope": "modal-renderer", "message": message, **fields}), flush=True)


@app.function(
    image=image,
    volumes={VOLUME_MOUNT_PATH: volume},
    cpu=_cpu(),
    memory=_memory(),
    timeout=_timeout(),
    max_containers=2,
)
def render_final(manifest: dict[str, Any]) -> dict[str, Any]:
    output_path = Path(str(manifest.get("outputMountedPath") or ""))
    output_volume_path = str(manifest.get("outputVolumePath") or "")
    if not output_path.is_absolute() or not output_volume_path.startswith("/jobs/"):
        raise ValueError("Invalid Modal render output path.")

    _log(
        "render-start",
        jobId=manifest.get("jobId"),
        outputVolumePath=output_volume_path,
        width=manifest.get("composition", {}).get("width"),
        height=manifest.get("composition", {}).get("height"),
        durationInFrames=manifest.get("composition", {}).get("durationInFrames"),
    )
    manifest_path = Path("/tmp") / f"{manifest.get('jobId', 'render')}.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    try:
        subprocess.run(
            ["node", f"{WORKDIR}/render_runner.mjs", str(manifest_path)],
            cwd=WORKDIR,
            check=True,
        )
    except Exception as exc:
        _log("render-failed", jobId=manifest.get("jobId"), error=str(exc))
        raise
    volume.commit()
    byte_size = output_path.stat().st_size
    _log("render-completed", jobId=manifest.get("jobId"), byteSize=byte_size)

    return {
        "ok": True,
        "outputVolumePath": output_volume_path,
        "byteSize": byte_size,
    }
