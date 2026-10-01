import unittest

import cv2
import numpy as np
from fastapi.testclient import TestClient

import server
from live_tracking import LiveTracker, decode_frame


ANCHORS = [[.18, .18], [.82, .18], [.82, .82], [.18, .82]]


def pitch(seed=42):
    rng = np.random.default_rng(seed)
    image = np.full((450, 800), 75, np.uint8)
    for _ in range(1200):
        x, y = rng.integers([15, 15], [785, 435])
        cv2.circle(image, (int(x), int(y)), int(rng.integers(1, 4)), int(rng.integers(30, 180)), -1)
    cv2.rectangle(image, (140, 80), (660, 370), 245, 3)
    cv2.line(image, (400, 80), (400, 370), 245, 3)
    cv2.circle(image, (400, 225), 58, 245, 3)
    return image


def jpeg(image):
    return cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 82])[1].tobytes()


class TrackerTests(unittest.TestCase):
    def test_pan_zoom_perspective_and_no_accumulated_drift(self):
        image = pitch()
        tracker = LiveTracker(jpeg(image), ANCHORS)
        expected = np.array([[1.04, .012, 16], [-.008, 1.03, 8], [.00003, -.00002, 1.]])
        moved = cv2.warpPerspective(image, expected, (800, 450))
        scale = np.diag([800, 450, 1.])
        for frame, matrix in [(moved, expected), (image, np.eye(3)), (moved, expected)]:
            result = tracker.update(jpeg(frame))
            self.assertFalse(result['lost'], result)
            self.assertGreaterEqual(result['confidence'], .38)
            actual = scale @ np.array(result['h']).reshape(3, 3) @ np.linalg.inv(scale)
            points = np.float32([[[200, 150], [600, 150], [600, 330], [200, 330]]])
            error = np.linalg.norm(cv2.perspectiveTransform(points, actual) - cv2.perspectiveTransform(points, matrix), axis=2)
            self.assertLess(error.max(), 2.5)

    def test_cut_is_latched_until_recalibration(self):
        image = jpeg(pitch())
        tracker = LiveTracker(image, ANCHORS)
        self.assertTrue(tracker.update(jpeg(np.zeros((450, 800), np.uint8)))['lost'])
        self.assertTrue(tracker.update(image)['lost'])
        self.assertFalse(LiveTracker(image, ANCHORS).update(image)['lost'])

    def test_unrelated_textured_cut(self):
        tracker = LiveTracker(jpeg(pitch()), ANCHORS)
        unrelated = np.random.default_rng(999).integers(0, 255, (450, 800), dtype=np.uint8)
        self.assertTrue(tracker.update(jpeg(unrelated))['lost'])

    def test_bad_anchors_and_no_features(self):
        for anchors in [None, [[0, 0]] * 4, [[.1, .1], [.2, .2], [.3, .3], [.4, .4]], [[0, 0], [1, 0], [1, 1], [float('nan'), 1]]]:
            with self.subTest(anchors=anchors), self.assertRaises(ValueError):
                LiveTracker(jpeg(pitch()), anchors)
        with self.assertRaises(ValueError):
            LiveTracker(jpeg(np.zeros((450, 800), np.uint8)), ANCHORS)

    def test_frame_validation_and_resolution_change(self):
        for data in [b'no jpeg', jpeg(np.zeros((1000, 1000), np.uint8)), b'\xff\xd8' + b'x' * 512000]:
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                decode_frame(data)
        tracker = LiveTracker(jpeg(pitch()), ANCHORS)
        self.assertTrue(tracker.update(jpeg(cv2.resize(pitch(), (640, 360))))['lost'])


class WebSocketTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.frame = jpeg(pitch())

    def test_calibrate_track_disconnect_and_isolation(self):
        with self.client.websocket_connect('/api/live-track') as one, self.client.websocket_connect('/api/live-track') as two:
            for socket in [one, two]:
                socket.send_json({'type': 'calibrate', 'anchors': ANCHORS})
                socket.send_bytes(self.frame)
                self.assertEqual(socket.receive_json()['type'], 'ready')
            one.send_bytes(jpeg(np.zeros((450, 800), np.uint8)))
            self.assertTrue(one.receive_json()['lost'])
            two.send_bytes(self.frame)
            result = two.receive_json()
            self.assertEqual(result['seq'], 1)
            self.assertFalse(result['lost'])
        self.assertEqual(server.live_connections, 0)

    def test_invalid_handshake_and_frames(self):
        with self.client.websocket_connect('/api/live-track') as socket:
            socket.send_json({'type': 'wrong'})
            self.assertEqual(socket.receive_json()['type'], 'error')
        with self.client.websocket_connect('/api/live-track') as socket:
            socket.send_json({'type': 'calibrate', 'anchors': ANCHORS})
            socket.send_bytes(b'bad jpeg')
            self.assertEqual(socket.receive_json()['type'], 'error')
        self.assertEqual(server.live_connections, 0)

    def test_foreign_origin_rejected(self):
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/api/live-track', headers={'origin': 'https://elsewhere.example'}):
                pass


if __name__ == '__main__':
    unittest.main()
