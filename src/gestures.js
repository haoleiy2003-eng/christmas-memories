const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const PINCH_FINGERS = [
  { tip: 8, label: '食指', photoIndex: 0 },
  { tip: 12, label: '中指', photoIndex: 1 },
  { tip: 16, label: '无名指', photoIndex: 2 },
  { tip: 20, label: '小指', photoIndex: 3 },
];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function getRuntimeProfile(coarsePointer, narrowScreen) {
  const mobile = coarsePointer || narrowScreen;
  return {
    delegate: mobile ? 'CPU' : 'GPU',
    detectionInterval: mobile ? 90 : 0,
  };
}

export class GestureController {
  constructor({ video, canvas, onGesture, onHand, onStatus, onStage }) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.onGesture = onGesture;
    this.onHand = onHand;
    this.onStatus = onStatus;
    this.onStage = onStage;
    this.profile = getRuntimeProfile(
      window.matchMedia('(pointer: coarse)').matches,
      window.innerWidth < 760,
    );
    this.active = false;
    this.requestId = 0;
    this.lastVideoTime = -1;
    this.lastDetectionTime = 0;
    this.candidate = 'none';
    this.candidateFrames = 0;
    this.lastCommitted = 'none';
    this.pinchReady = true;
  }

  async start() {
    const requestId = ++this.requestId;
    this.assertCurrent(requestId);
    this.onStage?.('model');
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    this.assertCurrent(requestId);
    const base = import.meta.env.BASE_URL;
    const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);
    const fallbackDelegate = this.profile.delegate === 'CPU' ? 'GPU' : 'CPU';
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: this.profile.delegate },
        runningMode: 'VIDEO', numHands: 1,
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate: fallbackDelegate },
        runningMode: 'VIDEO', numHands: 1,
      });
    }

    this.assertCurrent(requestId);
    this.onStage?.('camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    if (requestId !== this.requestId) {
      this.stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Gesture startup cancelled', 'AbortError');
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.assertCurrent(requestId);
    this.active = true;
    this.lastVideoTime = -1;
    this.detect();
  }

  assertCurrent(requestId) {
    if (requestId !== this.requestId) throw new DOMException('Gesture startup cancelled', 'AbortError');
  }

  detect() {
    if (!this.active) return;
    this.frame = requestAnimationFrame(() => this.detect());
    const now = performance.now();
    if (document.hidden || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    if (now - this.lastDetectionTime < this.profile.detectionInterval) return;
    this.lastDetectionTime = now;
    this.lastVideoTime = this.video.currentTime;
    const result = this.landmarker.detectForVideo(this.video, now);
    const landmarks = result.landmarks?.[0];
    this.draw(landmarks);
    if (!landmarks) {
      this.onHand({ detected: false, x: 0, y: 0 });
      this.onStatus('none', '未检测到手');
      this.candidate = 'none';
      this.candidateFrames = 0;
      this.lastCommitted = 'none';
      this.pinchReady = true;
      return;
    }

    this.onHand({
      detected: true,
      x: (0.5 - landmarks[9].x) * 2,
      y: (landmarks[9].y - 0.5) * 2,
    });
    this.stabilize(this.classify(landmarks));
  }

  classify(landmarks) {
    const wrist = landmarks[0];
    const handSize = Math.max(distance(wrist, landmarks[9]), 0.05);
    let pinchIndex = -1;
    let pinchDistance = Infinity;
    PINCH_FINGERS.forEach((finger, index) => {
      const ratio = distance(landmarks[4], landmarks[finger.tip]) / handSize;
      if (ratio < pinchDistance) {
        pinchDistance = ratio;
        pinchIndex = index;
      }
    });
    if (pinchDistance < 0.48) return `pinch-${pinchIndex}`;

    const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]];
    const extended = fingers.filter(([tip, pip]) => distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.13).length;
    if (extended >= 4) return 'palm';
    if (extended <= 1) return 'fist';
    return 'none';
  }

  stabilize(gesture) {
    if (gesture === this.candidate) this.candidateFrames += 1;
    else {
      this.candidate = gesture;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames < 4) return;

    const isPinch = gesture.startsWith('pinch-');
    if (!isPinch) this.pinchReady = true;
    if (isPinch) {
      const fingerIndex = Number(gesture.split('-')[1]);
      const finger = PINCH_FINGERS[fingerIndex];
      this.onStatus(gesture, `${finger.label}捏合 · 照片聚焦`);
      if (this.pinchReady || gesture !== this.lastCommitted) {
        this.onGesture('focus', finger.photoIndex);
        this.pinchReady = false;
        this.lastCommitted = gesture;
      }
      return;
    }
    if (gesture === this.lastCommitted) return;

    if (gesture === 'palm') {
      this.onGesture('scatter');
      this.onStatus('palm', '张手 · 散开');
    } else if (gesture === 'fist') {
      this.onGesture('tree');
      this.onStatus('fist', '握拳 · 聚合');
    } else {
      this.onStatus('none', '移动手掌可旋转');
    }
    this.lastCommitted = gesture;
  }

  draw(landmarks) {
    const { width, height } = this.canvas;
    const context = this.context;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(this.video, 0, 0, width, height);
    context.restore();
    if (!landmarks) return;

    context.strokeStyle = 'rgba(244, 201, 104, .85)';
    context.lineWidth = 2;
    CONNECTIONS.forEach(([from, to]) => {
      context.beginPath();
      context.moveTo((1 - landmarks[from].x) * width, landmarks[from].y * height);
      context.lineTo((1 - landmarks[to].x) * width, landmarks[to].y * height);
      context.stroke();
    });
    context.fillStyle = '#fff1c4';
    landmarks.forEach((point) => {
      context.beginPath();
      context.arc((1 - point.x) * width, point.y * height, 2.5, 0, Math.PI * 2);
      context.fill();
    });
  }

  stop() {
    this.requestId += 1;
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onHand({ detected: false, x: 0, y: 0 });
  }
}
