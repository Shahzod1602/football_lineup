"""Local backend for LineUp AR pitch tracking.

The tracker deliberately keeps a confidence score.  It is better to hide a
graphic after a bad camera cut than to let it float across the picture.
"""

from __future__ import annotations

import math
import threading
import uuid
import json
import asyncio
import time
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from live_tracking import LiveTracker, validate_anchors

cv2.setNumThreads(1)  # Bound CPU usage across concurrent live sessions.

BASE_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = BASE_DIR / ".runtime" / "uploads"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LineUp AR Tracker")
live_connections = 0
file_jobs = threading.BoundedSemaphore(1)
MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_VIDEO_SECONDS = 600
MAX_VIDEO_PIXELS = 3840 * 2160


@app.middleware("http")
async def upload_size_limit(request, call_next):
    if request.url.path in ("/api/track", "/api/analyze"):
        try:
            size = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "So‘rov hajmi noto‘g‘ri."}, status_code=400)
        if size > MAX_UPLOAD_BYTES + 1024 * 1024:
            return JSONResponse({"detail": "Video 256 MB dan oshmasin."}, status_code=413)
    return await call_next(request)


@app.websocket("/api/live-track")
async def live_track(socket: WebSocket):
    global live_connections
    origin = socket.headers.get("origin")
    if origin and urlsplit(origin).netloc != socket.headers.get("host"):
        await socket.close(code=1008)
        return
    await socket.accept()
    if live_connections >= 4:
        await socket.send_json({"type": "error", "message": "Tracking serveri band. Birozdan keyin qayta ulang."})
        await socket.close(code=1013)
        return
    live_connections += 1
    try:
        setup = await asyncio.wait_for(socket.receive_json(), timeout=10)
        if not isinstance(setup, dict) or setup.get("type") != "calibrate":
            raise ValueError("Kalibrovka ma’lumotlari kerak.")
        reference = await asyncio.wait_for(socket.receive_bytes(), timeout=10)
        tracker = await run_in_threadpool(LiveTracker, reference, setup.get("anchors"))
        await socket.send_json({"type": "ready"})
        sequence = 0
        while True:
            frame = await asyncio.wait_for(socket.receive_bytes(), timeout=10)
            started = time.monotonic()
            result = await run_in_threadpool(tracker.update, frame)
            sequence += 1
            await socket.send_json({**result, "seq": sequence, "processing_ms": round((time.monotonic() - started) * 1000)})
            if result.get("lost"):
                await socket.close(code=1000)
                break
            await asyncio.sleep(max(0, 1 / 15 - (time.monotonic() - started)))
    except WebSocketDisconnect:
        pass
    except (ValueError, TypeError, KeyError, cv2.error, asyncio.TimeoutError) as error:
        message = str(error) if isinstance(error, ValueError) else "Tracking uzildi. 4 NUQTA bilan qayta ulang."
        try:
            await socket.send_json({"type": "error", "message": message})
            await socket.close(code=1008)
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        live_connections -= 1


def _field_mask(frame: np.ndarray) -> np.ndarray:
    """Return a robust, broad mask of football grass in a broadcast frame."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # Green hue differs under floodlights; saturation/value limits remove crowd.
    mask = cv2.inRange(hsv, (28, 32, 25), (98, 255, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)


def detect_pitch_quad(frame: np.ndarray) -> tuple[np.ndarray | None, float, np.ndarray]:
    """Estimate the visible pitch trapezoid from grass coverage.

    This is an automatic fallback-free first estimate. LK/RANSAC tracking then
    follows this plane across pan/tilt/zoom frames. A trained line-segmentation
    model can replace this function later without changing the API contract.
    """
    h, w = frame.shape[:2]
    mask = _field_mask(frame)
    row_coverage = (mask > 0).sum(axis=1) / w
    valid = np.where(row_coverage > 0.10)[0]
    if len(valid) < max(24, h * 0.14):
        return None, 0.0, mask

    top = int(np.percentile(valid, 8))
    bottom = int(np.percentile(valid, 95))
    if bottom - top < h * 0.16:
        return None, 0.0, mask

    def edge_bounds(y: int) -> tuple[float, float] | None:
        band = mask[max(0, y - 5) : min(h, y + 6)]
        xs = np.where(band > 0)[1]
        if len(xs) < w * 0.08:
            return None
        return float(np.percentile(xs, 2)), float(np.percentile(xs, 98))

    upper = edge_bounds(top)
    lower = edge_bounds(bottom)
    if not upper or not lower:
        return None, 0.0, mask

    # A slightly inset trapezoid avoids unreliable pixels on crowd/advert boards.
    left_t, right_t = upper
    left_b, right_b = lower
    inset_t = max(2.0, (right_t - left_t) * 0.018)
    inset_b = max(2.0, (right_b - left_b) * 0.012)
    quad = np.array(
        [[left_t + inset_t, top], [right_t - inset_t, top], [right_b - inset_b, bottom], [left_b + inset_b, bottom]],
        dtype=np.float32,
    )
    area = cv2.contourArea(quad)
    confidence = min(0.88, max(0.15, area / (w * h) * 1.75))
    # A close-up can still contain plenty of grass, but it is not a usable
    # tactical plan. Do not render field-anchored graphics in that situation.
    if top / h > 0.40:
        confidence *= 0.15
    elif top / h > 0.30:
        confidence *= 0.55
    return quad, float(confidence), mask


def _features(gray: np.ndarray, mask: np.ndarray) -> np.ndarray | None:
    # Only pitch features are used, avoiding parallax from the crowd.
    return cv2.goodFeaturesToTrack(gray, maxCorners=280, qualityLevel=0.008, minDistance=7, mask=mask, blockSize=7)


def _normalized_quad(quad: np.ndarray, width: int, height: int) -> list[list[float]]:
    return [[round(float(x / width), 6), round(float(y / height), 6)] for x, y in quad]


def analyse(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Video ochilmadi. MP4/H.264 formatidan foydalaning.")

    try:
        fps, total, width, height = video_metadata(cap)
    except ValueError:
        cap.release()
        raise
    duration = total / fps if total else 0
    stride = max(1, round(fps / 12))  # 12 pose updates/sec is smooth enough for an overlay.

    index = 0
    prev_gray: np.ndarray | None = None
    points: np.ndarray | None = None
    quad: np.ndarray | None = None
    frames: list[dict] = []

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % stride:
            index += 1
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detected_quad, detected_confidence, mask = detect_pitch_quad(frame)
        confidence = detected_confidence

        if prev_gray is None or points is None or quad is None:
            quad = detected_quad
            points = _features(gray, mask)
        else:
            next_points, status, error = cv2.calcOpticalFlowPyrLK(prev_gray, gray, points, None, winSize=(31, 31), maxLevel=3)
            good_old = points[status.ravel() == 1] if status is not None else np.empty((0, 2))
            good_new = next_points[status.ravel() == 1] if status is not None and next_points is not None else np.empty((0, 2))
            if len(good_old) >= 12:
                transform, inliers = cv2.findHomography(good_old, good_new, cv2.RANSAC, 3.5)
                inlier_count = int(inliers.sum()) if inliers is not None else 0
                if transform is not None and inlier_count >= 10:
                    quad = cv2.perspectiveTransform(quad.reshape(1, -1, 2), transform).reshape(-1, 2)
                    confidence = min(confidence, 0.95) * min(1.0, inlier_count / 36)
                else:
                    confidence *= 0.35
            else:
                confidence *= 0.25

            # Reacquire pitch geometry after cuts or when tracking has low confidence.
            if detected_quad is not None and (confidence < 0.35 or index % (stride * 24) == 0):
                quad = detected_quad
                confidence = max(confidence, detected_confidence)
            points = _features(gray, mask)

        if quad is not None:
            q = quad.copy()
            q[:, 0] = np.clip(q[:, 0], -width, width * 2)
            q[:, 1] = np.clip(q[:, 1], -height, height * 2)
            frames.append({"t": round(index / fps, 3), "quad": _normalized_quad(q, width, height), "confidence": round(float(confidence), 3)})
        prev_gray = gray
        index += 1

    cap.release()
    if not frames:
        raise ValueError("Maydon aniqlanmadi. Keng umumiy stadion planidan foydalaning.")
    return {"fps": round(float(fps), 3), "duration": round(float(duration), 3), "frames": frames}


def video_metadata(cap):
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    if not all(math.isfinite(v) and v > 0 for v in (fps, total, width, height)):
        raise ValueError("Video o‘lchami yoki davomiyligi o‘qilmadi.")
    if fps > 120 or total / fps > MAX_VIDEO_SECONDS or width * height > MAX_VIDEO_PIXELS:
        raise ValueError("Video 10 daqiqa, 4K va 120 FPS chegarasidan oshmasin.")
    return fps, int(total), int(width), int(height)


def track_from_anchors(path: Path, anchors: list[list[float]], start_time: float) -> dict:
    """Register each frame to the calibration image; never reacquire after loss."""
    validate_anchors(anchors)
    if not math.isfinite(start_time) or start_time < 0:
        raise ValueError("Kalibrovka vaqti noto‘g‘ri.")
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise ValueError("Video ochilmadi. MP4/H.264 formatidan foydalaning.")
        fps, total, width, height = video_metadata(cap)
        start_frame = min(total - 1, int(round(start_time * fps)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        ok, first = cap.read()
        if not ok:
            raise ValueError("Kalibrovka kadri o‘qilmadi.")
        scale = min(800 / width, 800 / height, math.sqrt(590000 / (width * height)))
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        def encode(frame):
            resized = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
            return cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 82])[1].tobytes()
        tracker = LiveTracker(encode(first), anchors)
        identity = [1., 0., 0., 0., 1., 0., 0., 0., 1.]
        frames = [{"t": round(start_frame / fps, 6), "h": identity, "confidence": 1.0}]
        for index in range(start_frame + 1, total):
            ok, frame = cap.read()
            if not ok:
                break
            result = tracker.update(encode(frame))
            frames.append({"t": round(index / fps, 6), "h": result.get("h", identity),
                           "confidence": result["confidence"], "lost": result["lost"]})
            if result["lost"]:
                # A terminal lost sample covers the rest of the clip without
                # matching unrelated frames or spending CPU after a camera cut.
                if index < total - 1:
                    frames.append({**frames[-1], "t": round((total - 1) / fps, 6)})
                break
        return {"fps": round(fps, 3), "frames": frames}
    finally:
        cap.release()


def process_upload(video, operation, *args):
    target = RUNTIME_DIR / f"{uuid.uuid4().hex}.video"
    try:
        size = 0
        with target.open("wb") as output:
            while chunk := video.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Video 256 MB dan oshmasin.")
                output.write(chunk)
        return operation(target, *args)
    finally:
        target.unlink(missing_ok=True)


async def run_file_job(video, operation, *args):
    if not file_jobs.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Video hisoblanmoqda. Birozdan keyin qayta urinib ko‘ring.")
    try:
        result = await run_in_threadpool(process_upload, video, operation, *args)
        return {"ok": True, **result}
    except (ValueError, cv2.error) as error:
        raise HTTPException(status_code=422, detail=str(error) if isinstance(error, ValueError) else "Video kadri o‘qilmadi.") from error
    finally:
        file_jobs.release()
        await video.close()


@app.post("/api/analyze")
async def analyze_video(video: UploadFile = File(...)) -> dict:
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=415, detail="Video fayl yuboring.")
    return await run_file_job(video, analyse)


@app.post("/api/track")
async def track_video(
    video: UploadFile = File(...),
    anchors: str = Form(...),
    start_time: float = Form(0.0),
) -> dict:
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=415, detail="Video fayl yuboring.")
    try:
        selected = validate_anchors(json.loads(anchors)).tolist()
        if not math.isfinite(start_time) or start_time < 0:
            raise ValueError("Kalibrovka vaqti noto‘g‘ri.")
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=422, detail="4 ta yoyilgan maydon nuqtasi va to‘g‘ri vaqt kerak.") from error
    return await run_file_job(video, track_from_anchors, selected, start_time)


# Explicit public files: source, configuration and uploads never enter this map.
PUBLIC_FILES = {name: BASE_DIR / name for name in (
    "index.html", "styles.css", "tracking.css", "operator.css", "app.js",
    "smart-layout.js", "live-tracking.js", "project-data.js", "video-geometry.js",
    "assets/demo-player-portraits-v1.png",
)}


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
async def frontend(path: str):
    target = PUBLIC_FILES.get(path or "index.html")
    if target is None:
        raise HTTPException(status_code=404)
    return FileResponse(target)
