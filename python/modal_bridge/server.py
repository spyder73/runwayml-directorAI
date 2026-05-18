from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Any

import modal
from fastapi import FastAPI, HTTPException


app = FastAPI(title="Lifestory Modal render bridge")


def _log(message: str, **fields: Any) -> None:
    print(json.dumps({"scope": "modal-render-bridge", "message": message, **fields}), flush=True)


def _media_roots() -> list[Path]:
    roots = [
        Path(os.environ.get("MEDIA_STORAGE_DIR", "/app/data/media")),
        Path("/app/public/generated"),
        Path("/app/public/uploads"),
    ]
    return [root.resolve() for root in roots]


def _assert_allowed_path(value: str, *, must_exist: bool) -> Path:
    path = Path(value).expanduser().resolve()
    if must_exist and not path.is_file():
        raise HTTPException(status_code=400, detail=f"Input media file is missing: {path}")

    for root in _media_roots():
        if path == root or root in path.parents:
            return path

    raise HTTPException(status_code=400, detail=f"Path is outside allowed media roots: {path}")


def _copy_volume_file(volume: modal.Volume, volume_path: str, local_path: Path) -> int:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    reader = volume.read_file(volume_path)
    byte_size = 0

    with local_path.open("wb") as output:
        if isinstance(reader, bytes):
            output.write(reader)
            return len(reader)

        for chunk in reader:
            output.write(chunk)
            byte_size += len(chunk)

    return byte_size


def _cleanup_job(volume: modal.Volume, output_volume_path: str) -> None:
    if os.environ.get("MODAL_RENDER_CLEANUP_VOLUME", "1") != "1":
        return

    parts = Path(output_volume_path).parts
    if len(parts) < 3 or parts[0] != "/" or parts[1] != "jobs":
        return

    try:
        volume.remove_file(f"/jobs/{parts[2]}", recursive=True)
    except TypeError:
        try:
            volume.remove_file(f"/jobs/{parts[2]}")
        except Exception:
            pass
    except Exception:
        pass


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/render")
def render(payload: dict[str, Any]) -> dict[str, Any]:
    app_name = str(payload.get("appName") or "")
    function_name = str(payload.get("functionName") or "")
    volume_name = str(payload.get("volumeName") or "")
    output_local_path = str(payload.get("outputLocalPath") or "")
    input_files = payload.get("inputFiles")
    manifest = payload.get("manifest")

    if not app_name or not function_name or not volume_name:
        raise HTTPException(status_code=400, detail="Missing Modal app, function, or volume name.")
    if not output_local_path:
        raise HTTPException(status_code=400, detail="Missing outputLocalPath.")
    if not isinstance(input_files, list) or not isinstance(manifest, dict):
        raise HTTPException(status_code=400, detail="Invalid Modal render payload.")

    output_path = _assert_allowed_path(output_local_path, must_exist=False)
    volume = modal.Volume.from_name(volume_name, create_if_missing=True)

    try:
        _log(
            "upload-start",
            appName=app_name,
            functionName=function_name,
            volumeName=volume_name,
            inputCount=len(input_files),
            outputLocalPath=str(output_path),
        )
        with volume.batch_upload(force=True) as batch:
            for item in input_files:
                if not isinstance(item, dict):
                    raise HTTPException(status_code=400, detail="Invalid input file entry.")
                local_path = _assert_allowed_path(str(item.get("localPath") or ""), must_exist=True)
                volume_path = str(item.get("volumePath") or "")
                if not volume_path.startswith("/jobs/"):
                    raise HTTPException(status_code=400, detail=f"Invalid volume input path: {volume_path}")
                batch.put_file(str(local_path), volume_path)

        _log("remote-call-start", appName=app_name, functionName=function_name)
        render_fn = modal.Function.from_name(app_name, function_name)
        result = render_fn.remote(manifest)
        if not isinstance(result, dict):
            raise RuntimeError("Modal render returned an invalid result.")

        output_volume_path = str(result.get("outputVolumePath") or manifest.get("outputVolumePath") or "")
        if not output_volume_path.startswith("/jobs/"):
            raise RuntimeError("Modal render did not return a valid output path.")

        _log("download-start", outputVolumePath=output_volume_path, outputLocalPath=str(output_path))
        byte_size = _copy_volume_file(volume, output_volume_path, output_path)
        _cleanup_job(volume, output_volume_path)
        _log("render-completed", outputLocalPath=str(output_path), byteSize=byte_size)

        return {
            "ok": True,
            "outputLocalPath": str(output_path),
            "byteSize": byte_size,
        }
    except HTTPException:
        raise
    except Exception as exc:
        _log("render-failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
