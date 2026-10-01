"""Per-connection pitch registration against an operator-selected reference.

Direct reference matching avoids accumulating optical-flow drift. Lost tracking
is latched: a camera cut must be followed by a fresh operator calibration.
"""
import cv2
import numpy as np


def decode_frame(data: bytes) -> np.ndarray:
    if not 4 <= len(data) <= 512_000 or data[:2] != b"\xff\xd8":
        raise ValueError("JPEG kadr kerak (512 KB gacha).")
    # Check JPEG dimensions before allocating a decoded image.
    offset = 2
    dimensions = None
    while offset + 4 <= len(data):
        if data[offset] != 255:
            break
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        if marker in (0xD9, 0xDA):
            break
        if marker in range(0xD0, 0xD8) or marker == 0x01:
            continue
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            break
        if marker in (0xC0, 0xC1, 0xC2) and length >= 8:
            dimensions = (int.from_bytes(data[offset + 5:offset + 7], "big"),
                          int.from_bytes(data[offset + 3:offset + 5], "big"))
            break
        offset += length
    if dimensions is None:
        raise ValueError("JPEG o‘lchamlari o‘qilmadi.")
    width, height = dimensions
    if min(width, height) < 64 or max(width, height) > 960 or width * height > 600_000:
        raise ValueError("Kadr o‘lchami 64–960 piksel, 600 ming pikselgacha bo‘lishi kerak.")
    gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
    if gray is None or gray.shape != (height, width):
        raise ValueError("Kadr o‘qilmadi.")
    return gray


def validate_anchors(anchors: list) -> np.ndarray:
    try:
        selected = np.asarray(anchors, dtype=np.float32)
        if selected.shape != (4, 2) or not np.isfinite(selected).all() or np.any(selected < 0) or np.any(selected > 1):
            raise ValueError
        if min(np.linalg.norm(selected[i] - selected[j]) for i in range(4) for j in range(i)) < .04:
            raise ValueError
        hull = cv2.convexHull(selected)
        if len(hull) != 4 or cv2.contourArea(hull) < .025:
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("4 nuqtani maydon bo‘ylab yoyib tanlang; bir chiziqda yoki bir joyda bo‘lmasin.") from None
    return selected


class LiveTracker:
    def __init__(self, reference: bytes, anchors: list):
        self.gray = decode_frame(reference)
        self.height, self.width = self.gray.shape
        selected = validate_anchors(anchors)
        self.anchors = selected * [self.width, self.height]
        self.mask = np.zeros_like(self.gray)
        cv2.fillConvexPoly(self.mask, cv2.convexHull(self.anchors.astype(np.int32)), 255)
        self.mask = cv2.dilate(self.mask, np.ones((25, 25), np.uint8))
        self.orb = cv2.ORB_create(nfeatures=1600, fastThreshold=7, edgeThreshold=15)
        self.keypoints, self.descriptors = self.orb.detectAndCompute(self.gray, self.mask)
        if self.descriptors is None or len(self.keypoints) < 24:
            raise ValueError("Maydonda aniq detallar kam. Oq chiziqlar ko‘rinadigan keng planni tanlang.")
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        self.lost = False

    def fail(self, reason: str) -> dict:
        self.lost = True
        return {"type": "pose", "confidence": 0.0, "lost": True, "reason": reason}

    def update(self, data: bytes) -> dict:
        if self.lost:
            return self.fail("Tracking yo‘qoldi. 4 NUQTA bilan qayta belgilang.")
        gray = decode_frame(data)
        if gray.shape != self.gray.shape:
            return self.fail("Video o‘lchami o‘zgardi. Qayta kalibrovka qiling.")
        keypoints, descriptors = self.orb.detectAndCompute(gray, None)
        if descriptors is None or len(keypoints) < 16:
            return self.fail("Maydon detallari yo‘qoldi. Qayta kalibrovka qiling.")
        pairs = self.matcher.knnMatch(self.descriptors, descriptors, k=2)
        matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .72 * pair[1].distance]
        # A current feature must not vote more than once for a homography.
        unique = {}
        for match in sorted(matches, key=lambda m: m.distance):
            unique.setdefault(match.trainIdx, match)
        matches = list(unique.values())
        if len(matches) < 14:
            return self.fail("Kamera almashdi yoki maydon ko‘rinmayapti. Qayta belgilang.")
        old = np.float32([self.keypoints[m.queryIdx].pt for m in matches])
        new = np.float32([keypoints[m.trainIdx].pt for m in matches])
        matrix, inliers = cv2.findHomography(old, new, cv2.RANSAC, 2.5, maxIters=1500, confidence=.995)
        count = int(inliers.sum()) if inliers is not None else 0
        if matrix is None or count < 12 or count / len(matches) < .5 or not np.isfinite(matrix).all():
            return self.fail("Tracking ishonchsiz. 4 NUQTA bilan qayta belgilang.")
        spread = cv2.contourArea(cv2.convexHull(old[inliers.ravel() == 1]))
        if spread < cv2.countNonZero(self.mask) * .12:
            return self.fail("Detallar bir joyga to‘plangan. Nuqtalarni kengroq belgilang.")
        scale = np.diag([self.width, self.height, 1.0])
        normalized = np.linalg.inv(scale) @ matrix @ scale
        if abs(normalized[2, 2]) < 1e-6:
            return self.fail("Maydon geometriyasi yo‘qoldi.")
        normalized /= normalized[2, 2]
        corners = np.float32([[0, 0], [1, 0], [1, 1], [0, 1]])
        denominator = np.c_[corners, np.ones(4)] @ normalized[2]
        projected = cv2.perspectiveTransform(corners.reshape(1, -1, 2), normalized)[0]
        area = cv2.contourArea(projected, oriented=True)
        if np.any(denominator < .15) or not np.isfinite(projected).all() or not .15 < area < 6 or np.max(np.abs(projected)) > 5:
            return self.fail("Kamera plani juda o‘zgardi. Qayta kalibrovka qiling.")
        confidence = min(1.0, count / 32) * min(1.0, count / len(matches) / .7)
        return {"type": "pose", "h": normalized.reshape(-1).tolist(), "confidence": round(confidence, 3), "lost": False}
