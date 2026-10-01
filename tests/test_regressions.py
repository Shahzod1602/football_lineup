import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import httpx
import numpy as np
from fastapi.testclient import TestClient
import server
from test_live_tracking import pitch, ANCHORS


class FileTrackingTests(unittest.TestCase):
    def test_unrelated_cut_never_reacquires_even_if_reference_returns(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'cut.avi'
            writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),25,(800,450))
            for gray in [pitch()]*4+[np.zeros((450,800),np.uint8)]*2+[pitch(999)]*4+[pitch()]*2:
                writer.write(cv2.cvtColor(gray,cv2.COLOR_GRAY2BGR))
            writer.release()
            result=server.track_from_anchors(path,ANCHORS,0)
            self.assertEqual(result['frames'][0]['confidence'],1)
            lost=[f for f in result['frames'] if f['t']>=4/25]
            self.assertTrue(lost)
            self.assertTrue(all(f['lost'] and f['confidence']==0 for f in lost))
            self.assertAlmostEqual(result['frames'][-1]['t'],11/25)

    def test_public_files_allowlist_and_anchor_validation(self):
        client=TestClient(server.app)
        for path in ['/','/app.js','/project-data.js','/video-geometry.js','/assets/demo-player-portraits-v1.png']:
            self.assertEqual(client.get(path).status_code,200,path)
        for path in ['/server.py','/live_tracking.py','/.git/HEAD','/.runtime/uploads/test.mp4','/requirements.txt','/tests/test_live_tracking.py','/assets/../server.py']:
            self.assertEqual(client.get(path).status_code,404,path)
        for anchors in [[{}]*4,[[0,0]]*4,[[.1,.1],[.2,.2],[.3,.3],[.4,.4]],[[0,0],[1,0],[1,1],[float('nan'),1]]]:
            r=client.post('/api/track',files={'video':('v.mp4',b'x','video/mp4')},data={'anchors':json.dumps(anchors)})
            self.assertEqual(r.status_code,422)
        for start in ['nan','inf','-1']:
            r=client.post('/api/track',files={'video':('v.mp4',b'x','video/mp4')},data={'anchors':json.dumps(ANCHORS),'start_time':start})
            self.assertEqual(r.status_code,422)

    def test_oversize_upload_is_rejected_and_job_slot_released(self):
        with patch.object(server,'MAX_UPLOAD_BYTES',8):
            r=TestClient(server.app).post('/api/track',files={'video':('v.mp4',b'x'*20,'video/mp4')},data={'anchors':json.dumps(ANCHORS)})
        self.assertEqual(r.status_code,413)
        self.assertTrue(server.file_jobs.acquire(blocking=False));server.file_jobs.release()


class ConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_video_worker_does_not_block_http_and_rejects_parallel_jobs(self):
        started=threading.Event();release=threading.Event()
        def slow(*args):
            started.set();release.wait(2);return {'frames':[]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),base_url='http://testserver') as client:
            async def request():
                return await client.post('/api/track',files={'video':('v.mp4',b'x','video/mp4')},data={'anchors':json.dumps(ANCHORS)})
            with patch.object(server,'track_from_anchors',slow):
                task=asyncio.create_task(request())
                try:
                    for _ in range(100):
                        if started.is_set():break
                        await asyncio.sleep(.005)
                    self.assertTrue(started.is_set())
                    self.assertFalse(task.done(),'video computation blocked the event loop')
                    self.assertEqual((await asyncio.wait_for(client.get('/'),.5)).status_code,200)
                    self.assertEqual((await asyncio.wait_for(request(),.5)).status_code,429)
                finally:
                    release.set()
                    self.assertEqual((await task).status_code,200)
        self.assertTrue(server.file_jobs.acquire(blocking=False));server.file_jobs.release()
