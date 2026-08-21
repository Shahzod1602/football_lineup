"""Local backend for LineUp AR pitch tracking.

The tracker deliberately keeps a confidence score.  It is better to hide a
graphic after a bad camera cut than to let it float across the picture.
"""

from __future__ import annotations

import shutil
import uuid
import json
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = BASE_DIR / ".runtime" / "uploads"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LineUp AR Tracker")


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

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
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


def track_from_anchors(path: Path, anchors: list[list[float]], start_time: float) -> dict:
    """Track a manually calibrated pitch plane through a prerecorded clip.

    The operator selects four durable white-line intersections.  We seed feature
    points around them, estimate a RANSAC homography every frame and compose it
    from the calibration frame.  A weak homography is sent with low confidence;
    the browser then hides the overlay rather than letting it drift.
    """
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Video ochilmadi. MP4/H.264 formatidan foydalaning.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = max(0, min(max(0, total - 1), int(round(start_time * fps))))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    ok, first = cap.read()
    if not ok or not width or not height:
        raise ValueError("Kalibrovka kadri o‘qilmadi.")

    base_anchors = np.asarray([[x * width, y * height] for x, y in anchors], dtype=np.float32)
    radius = max(22, int(min(width, height) * 0.075))

    def feature_mask(current_anchors: np.ndarray) -> np.ndarray:
        mask = np.zeros((height, width), dtype=np.uint8)
        for x, y in current_anchors:
            cv2.circle(mask, (int(x), int(y)), radius, 255, -1)
        return mask

    def seed_features(gray: np.ndarray, current_anchors: np.ndarray) -> np.ndarray:
        found = cv2.goodFeaturesToTrack(
            gray, maxCorners=160, qualityLevel=0.003, minDistance=4,
            mask=feature_mask(current_anchors), blockSize=5,
        )
        # Include exact clicks as a fallback; the nearby corner features usually
        # carry the homography, while these help at high-contrast line joints.
        anchor_points = current_anchors.reshape(-1, 1, 2).astype(np.float32)
        return anchor_points if found is None else np.vstack((found, anchor_points))

    prev_gray = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    points = seed_features(prev_gray, base_anchors)
    homography = np.eye(3, dtype=np.float64)
    # OpenCV estimates in video pixels, while the browser stores cards as 0..1
    # stage coordinates.  Convert H with S⁻¹HS before serialising it.
    pixel_scale = np.array([[width, 0.0, 0.0], [0.0, height, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
    inverse_pixel_scale = np.linalg.inv(pixel_scale)

    def normalized_h(matrix: np.ndarray) -> list[float]:
        converted = inverse_pixel_scale @ matrix @ pixel_scale
        if abs(converted[2, 2]) > 1e-7:
            converted /= converted[2, 2]
        return [round(float(value), 8) for value in converted.reshape(-1)]

    frames: list[dict] = [{
        "t": round(start_frame / fps, 3),
        "h": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        "confidence": 1.0,
    }]
    frame_index = start_frame + 1

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        next_points, status, _ = cv2.calcOpticalFlowPyrLK(
            prev_gray, gray, points, None, winSize=(31, 31), maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
        )
        good_old = points[status.ravel() == 1] if status is not None and next_points is not None else np.empty((0, 2))
        good_new = next_points[status.ravel() == 1] if status is not None and next_points is not None else np.empty((0, 2))
        confidence = 0.0

        if len(good_old) >= 8:
            step, inliers = cv2.findHomography(good_old, good_new, cv2.RANSAC, 2.8)
            inlier_count = int(inliers.sum()) if inliers is not None else 0
            if step is not None and inlier_count >= 7:
                homography = step @ homography
                if abs(homography[2, 2]) > 1e-7:
                    homography /= homography[2, 2]
                confidence = min(1.0, inlier_count / max(12, len(good_old) * 0.58))

        if confidence < 0.28:
            # Do not relock to a close-up/cut: that would move cards to a wrong
            # place. Keeping low confidence lets the frontend hide them safely.
            points = seed_features(gray, cv2.perspectiveTransform(base_anchors.reshape(1, -1, 2), homography).reshape(-1, 2))
        elif len(good_new) < 24 or frame_index % int(max(fps * 2, 1)) == 0:
            current_anchors = cv2.perspectiveTransform(base_anchors.reshape(1, -1, 2), homography).reshape(-1, 2)
            points = seed_features(gray, current_anchors)
        else:
            points = good_new.reshape(-1, 1, 2)

        frames.append({
            "t": round(frame_index / fps, 3),
            "h": normalized_h(homography),
            "confidence": round(float(confidence), 3),
        })
        prev_gray = gray
        frame_index += 1

    cap.release()
    return {"fps": round(float(fps), 3), "frames": frames}


@app.post("/api/analyze")
async def analyze_video(video: UploadFile = File(...)) -> dict:
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=415, detail="Video fayl yuboring.")
    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    target = RUNTIME_DIR / f"{uuid.uuid4().hex}{suffix}"
    try:
        with target.open("wb") as output:
            shutil.copyfileobj(video.file, output)
        result = analyse(target)
        return {"ok": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        target.unlink(missing_ok=True)


@app.post("/api/track")
async def track_video(
    video: UploadFile = File(...),
    anchors: str = Form(...),
    start_time: float = Form(0.0),
) -> dict:
    if not (video.content_type or "").startswith("video/"):
        raise HTTPException(status_code=415, detail="Video fayl yuboring.")
    try:
        selected = json.loads(anchors)
        if not isinstance(selected, list) or len(selected) != 4:
            raise ValueError
        selected = [[float(point[0]), float(point[1])] for point in selected]
        if any(not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0) for x, y in selected):
            raise ValueError
    except (ValueError, TypeError, IndexError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail="4 ta maydon nuqtasi kerak.") from error

    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    target = RUNTIME_DIR / f"{uuid.uuid4().hex}{suffix}"
    try:
        with target.open("wb") as output:
            shutil.copyfileobj(video.file, output)
        result = track_from_anchors(target, selected, max(0.0, start_time))
        return {"ok": True, **result}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        target.unlink(missing_ok=True)


# API routes are registered before this catch-all static frontend route.
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="frontend")
