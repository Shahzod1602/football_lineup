/* One JPEG in flight. The displayed frame and its pose always share an ID. */
function captureLiveFrame(video, aspect) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Kamera kadri hali tayyor emas.');
  const frame = document.createElement('canvas');
  frame.width = Math.min(1920, video.videoWidth);
  frame.height = Math.round(frame.width / aspect);
  const sourceAspect = video.videoWidth / video.videoHeight;
  const width = sourceAspect > aspect ? video.videoHeight * aspect : video.videoWidth;
  const height = sourceAspect > aspect ? video.videoHeight : video.videoWidth / aspect;
  frame.getContext('2d').drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2, width, height, 0, 0, frame.width, frame.height);
  return frame;
}

function showLiveFrame(frame, display) {
  if (display.width !== frame.width || display.height !== frame.height) {
    display.width = frame.width; display.height = frame.height;
  }
  display.getContext('2d').drawImage(frame, 0, 0);
}

class LivePitchSession {
  constructor({ video, reference, onFrame, onFailure }) {
    this.video = video;
    this.reference = reference;
    this.aspect = reference.width / reference.height;
    this.onFrame = onFrame;
    this.onFailure = onFailure;
    this.closed = false;
    this.sequence = 0;
    this.encoder = document.createElement('canvas');
    const scale = Math.min(800 / reference.width, 800 / reference.height, Math.sqrt(590000 / (reference.width * reference.height)));
    this.encoder.width = Math.round(reference.width * scale);
    this.encoder.height = Math.round(reference.height * scale);
  }

  encode(frame) {
    this.encoder.getContext('2d').drawImage(frame, 0, 0, this.encoder.width, this.encoder.height);
    return new Promise((resolve, reject) => this.encoder.toBlob(blob => blob ? resolve(blob) : reject(new Error('Kadr kodlanmadi.')), 'image/jpeg', .82));
  }

  deadline(ms) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail('Tracking javobi kechikdi. 4 NUQTA bilan qayta ulang.'), ms);
  }

  start(anchors) {
    const url = new URL('/api/live-track', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    this.deadline(8000);
    socket.onopen = async () => {
      try {
        const blob = await this.encode(this.reference);
        if (this.closed) return;
        socket.send(JSON.stringify({ type: 'calibrate', anchors }));
        socket.send(blob);
      } catch (error) { this.fail(error.message); }
    };
    socket.onmessage = event => {
      if (this.closed) return;
      try {
        const result = JSON.parse(event.data);
        if (result.type === 'error') { this.fail(result.message); return; }
        if (result.type === 'ready' && !this.ready) {
          this.ready = true;
          clearTimeout(this.watchdog);
          this.sendNext();
          return;
        }
        if (result.type !== 'pose' || !this.pendingFrame || result.seq !== this.sequence) throw new Error('Tracking kadrlari mos kelmadi.');
        if (result.lost || result.confidence < .38) { this.fail(result.reason || 'Tracking yo‘qoldi. Qayta belgilang.'); return; }
        if (!Array.isArray(result.h) || result.h.length !== 9 || !result.h.every(Number.isFinite) || !Number.isFinite(result.confidence)) throw new Error('Tracking javobi noto‘g‘ri.');
        clearTimeout(this.watchdog);
        const latency = performance.now() - this.sentAt;
        const receivedAt = performance.now();
        const fps = this.lastReceivedAt ? 1000 / (receivedAt - this.lastReceivedAt) : 0;
        this.lastReceivedAt = receivedAt;
        this.onFrame(this.pendingFrame, { ...result, latency, fps, receivedAt });
        this.pendingFrame = null;
        this.timer = setTimeout(() => this.sendNext(), Math.max(0, 1000 / 12 - latency));
      } catch (error) { this.fail(error.message); }
    };
    socket.onerror = () => this.fail('Tracking serveriga ulanib bo‘lmadi. Qayta kalibrovka qiling.');
    socket.onclose = () => { if (!this.closed) this.fail('Tracking ulanishi uzildi. 4 NUQTA bilan qayta ulang.'); };
  }

  async sendNext() {
    if (this.closed) return;
    try {
      if (this.video.paused || this.video.srcObject?.getVideoTracks().some(track => track.muted || track.readyState !== 'live')) throw new Error('Kamera signali yo‘qoldi. Qayta kalibrovka qiling.');
      this.deadline(2000);
      this.sentAt = performance.now();
      this.pendingFrame = captureLiveFrame(this.video, this.aspect);
      const blob = await this.encode(this.pendingFrame);
      if (this.closed) return;
      this.sequence++;
      this.socket.send(blob);
    } catch (error) { this.fail(error.message); }
  }

  fail(message) {
    if (this.closed) return;
    this.stop();
    this.onFailure(message);
  }

  stop() {
    this.closed = true;
    clearTimeout(this.watchdog); clearTimeout(this.timer);
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
    }
    this.reference = this.pendingFrame = null;
  }
}
