import './style.css';
import { ChristmasScene } from './scene.js';
import { GestureController } from './gestures.js';

const defaultPhotos = [
  { src: `${import.meta.env.BASE_URL}photos/christmas-tree.jpg`, name: 'Christmas tree' },
  { src: `${import.meta.env.BASE_URL}photos/ornaments.jpg`, name: 'Ornaments' },
  { src: `${import.meta.env.BASE_URL}photos/gifts.jpg`, name: 'Gifts' },
  { src: `${import.meta.env.BASE_URL}photos/cookies.jpg`, name: 'Cookies' },
  { src: `${import.meta.env.BASE_URL}photos/lights.jpg`, name: 'Lights' },
  { src: `${import.meta.env.BASE_URL}photos/snow.jpg`, name: 'Snow' },
];

const elements = {
  loader: document.querySelector('#loader'),
  scene: document.querySelector('#scene'),
  modeButtons: [...document.querySelectorAll('.mode-button')],
  upload: document.querySelector('#upload-button'),
  musicButton: document.querySelector('#music-button'),
  musicButtonLabel: document.querySelector('#music-button-label'),
  music: document.querySelector('#background-music'),
  addPhoto: document.querySelector('#add-photo'),
  input: document.querySelector('#photo-input'),
  memoryList: document.querySelector('#memory-list'),
  memoryCount: document.querySelector('#memory-count'),
  gestureButton: document.querySelector('#gesture-button'),
  gestureButtonLabel: document.querySelector('#gesture-button-label'),
  cameraCard: document.querySelector('#camera-card'),
  cameraPlaceholder: document.querySelector('#camera-placeholder'),
  trackingState: document.querySelector('#tracking-state'),
  gestureName: document.querySelector('#gesture-name'),
  video: document.querySelector('#webcam'),
  handCanvas: document.querySelector('#hand-canvas'),
  closeFocus: document.querySelector('#close-focus'),
  focusCaption: document.querySelector('#focus-caption'),
  toast: document.querySelector('#toast'),
};

let photoSources = [...defaultPhotos];
let gestures;
let toastTimer;
let scene;
let musicWanted = false;
let resumeMusic = false;

function notify(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3200);
}

function syncMusicUI() {
  const playing = !elements.music.paused;
  elements.musicButton.classList.toggle('playing', playing);
  elements.musicButton.setAttribute('aria-pressed', String(playing));
  elements.musicButtonLabel.textContent = playing ? '关闭音乐' : '圣诞音乐';
}

async function toggleMusic() {
  if (!elements.music.paused) {
    musicWanted = false;
    resumeMusic = false;
    elements.music.pause();
    return;
  }
  musicWanted = true;
  elements.musicButtonLabel.textContent = '加载音乐';
  try {
    await elements.music.play();
    notify('圣诞纯音乐已开启');
  } catch (error) {
    console.error('Music playback failed:', error);
    musicWanted = false;
    notify(`音乐播放失败：${error.name || '未知错误'}`);
  }
}

function syncMode() {
  const mode = scene.mode;
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.body.classList.toggle('focus-mode', mode === 'focus');
  elements.closeFocus.hidden = mode !== 'focus';
  elements.focusCaption.hidden = mode !== 'focus';
}

function updateFocus(index, total) {
  elements.focusCaption.querySelector('b').textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  [...elements.memoryList.children].forEach((thumbnail, thumbnailIndex) => {
    thumbnail.classList.toggle('active', thumbnailIndex === index);
  });
  syncMode();
}

function renderPreviews() {
  elements.memoryList.replaceChildren();
  const tilts = [-3, 2, -1, 3, -2, 1];
  photoSources.forEach((source, index) => {
    const button = document.createElement('button');
    button.className = 'memory-thumb';
    button.style.setProperty('--tilt', `${tilts[index % tilts.length]}deg`);
    button.setAttribute('aria-label', `聚焦照片 ${index + 1}：${source.name}`);
    const image = document.createElement('img');
    image.src = source.src;
    image.alt = source.name || `圣诞回忆 ${index + 1}`;
    image.draggable = false;
    button.append(image);
    button.addEventListener('click', () => {
      scene.focusPhoto(index);
      syncMode();
    });
    elements.memoryList.append(button);
  });
  elements.memoryCount.textContent = String(photoSources.length).padStart(2, '0');
}

function setMode(mode, photoIndex) {
  if (mode === 'focus' && Number.isInteger(photoIndex)) {
    scene.focusPhoto(photoIndex % photoSources.length);
  } else {
    scene.setMode(mode);
  }
  syncMode();
}

function validateImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(source);
    image.onerror = reject;
    image.src = source.src;
  });
}

async function handlePhotos(files) {
  const candidates = [...files]
    .filter((file) => file.type.startsWith('image/') && file.size <= 20 * 1024 * 1024)
    .slice(0, 24);
  if (!candidates.length) {
    notify('请选择 JPG、PNG、WebP 或 GIF 图片，单张不超过 20 MB');
    return;
  }

  const incoming = candidates.map((file) => ({ src: URL.createObjectURL(file), name: file.name, owned: true }));
  const valid = (await Promise.allSettled(incoming.map(validateImage)))
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  incoming.filter((source) => !valid.includes(source)).forEach((source) => URL.revokeObjectURL(source.src));
  if (!valid.length) {
    notify('这些图片无法读取，请换一批试试');
    return;
  }

  elements.upload.disabled = true;
  try {
    await scene.setPhotoSources(valid);
    photoSources.filter((source) => source.owned).forEach((source) => URL.revokeObjectURL(source.src));
    photoSources = valid;
    renderPreviews();
    setMode('tree');
    notify(`已将 ${valid.length} 张照片挂上圣诞树`);
  } catch (error) {
    console.error('Photo loading failed:', error);
    valid.forEach((source) => URL.revokeObjectURL(source.src));
    notify('照片加载失败，请重试');
  } finally {
    elements.upload.disabled = false;
    elements.input.value = '';
  }
}

function updateGestureUI(active) {
  elements.gestureButton.classList.toggle('active', active);
  elements.gestureButton.classList.remove('loading');
  elements.gestureButton.setAttribute('aria-pressed', String(active));
  elements.gestureButtonLabel.textContent = active ? '关闭手势' : '开启手势';
  elements.cameraCard.classList.toggle('active', active);
  elements.trackingState.textContent = active ? 'ON' : 'OFF';
  elements.gestureName.hidden = !active;
  if (!active) elements.gestureName.textContent = '等待手势';
}

async function toggleGestures() {
  if (gestures?.active) {
    gestures.stop();
    updateGestureUI(false);
    notify('手势控制已关闭');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    notify('当前环境无法使用摄像头，仍可用按钮和鼠标操作');
    return;
  }

  elements.gestureButton.disabled = true;
  elements.gestureButton.classList.add('loading');
  elements.gestureButtonLabel.textContent = '加载模型';
  try {
    gestures ??= new GestureController({
      video: elements.video,
      canvas: elements.handCanvas,
      onGesture: setMode,
      onHand: (hand) => scene.setHand(hand),
      onStatus: (_, label) => { elements.gestureName.textContent = label; },
      onStage: (stage) => {
        elements.gestureButtonLabel.textContent = stage === 'camera' ? '等待权限' : '加载模型';
      },
    });
    let startupTimeout;
    try {
      await Promise.race([
        gestures.start(),
        new Promise((_, reject) => {
          startupTimeout = setTimeout(() => reject(new DOMException('Gesture startup timed out', 'TimeoutError')), 45000);
        }),
      ]);
    } finally {
      clearTimeout(startupTimeout);
    }
    updateGestureUI(true);
    notify('捏食指/中指/无名指/小指，分别查看第 1/2/3/4 张照片');
  } catch (error) {
    console.error('Gesture initialization failed:', error);
    gestures?.stop();
    updateGestureUI(false);
    if (error.name === 'NotAllowedError') notify('未获得摄像头权限，可在浏览器设置中允许后重试');
    else if (error.name === 'NotFoundError') notify('没有检测到摄像头，仍可用按钮和鼠标操作');
    else if (error.name === 'NotReadableError') notify('摄像头正被其他应用占用，请关闭后重试');
    else if (error.name === 'TimeoutError') notify('手势启动超时，请检查摄像头权限后重试');
    else if (error.name !== 'AbortError') notify('手势模型加载失败，请检查网络或稍后重试');
  } finally {
    elements.gestureButton.disabled = false;
  }
}

function setupVisibility() {
  elements.scene.addEventListener('contentvisibilityautostatechange', (event) => {
    scene.inViewport = !event.skipped;
  });
  if (!('contentVisibility' in document.documentElement.style)) {
    const observer = new IntersectionObserver(([entry]) => {
      scene.inViewport = entry.isIntersecting;
    }, { rootMargin: '200px' });
    observer.observe(elements.scene);
  }
  document.addEventListener('visibilitychange', () => {
    scene.setActive(!document.hidden);
    if (document.hidden) {
      resumeMusic = !elements.music.paused;
      elements.music.pause();
    } else if (resumeMusic && musicWanted) {
      elements.music.play().catch(() => {
        musicWanted = false;
        notify('返回页面后音乐未能恢复，请重新点击音乐按钮');
      });
      resumeMusic = false;
    }
  });
}

async function init() {
  try {
    scene = new ChristmasScene(elements.scene, updateFocus);
    await scene.setPhotoSources(photoSources);
    renderPreviews();
    setupVisibility();
    elements.loader.classList.add('done');
  } catch (error) {
    console.error('Scene initialization failed:', error);
    elements.loader.querySelector('span').textContent = '场景加载失败，请确认浏览器支持 WebGL 后刷新';
    elements.loader.querySelector('.loader-line').hidden = true;
  }
}

elements.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
elements.closeFocus.addEventListener('click', () => setMode('tree'));
[elements.upload, elements.addPhoto].forEach((button) => button.addEventListener('click', () => elements.input.click()));
elements.input.addEventListener('change', () => handlePhotos(elements.input.files));
elements.gestureButton.addEventListener('click', toggleGestures);
elements.musicButton.addEventListener('click', toggleMusic);
elements.music.addEventListener('play', syncMusicUI);
elements.music.addEventListener('pause', syncMusicUI);
elements.music.addEventListener('error', () => {
  if (musicWanted) notify('音乐文件加载失败，请检查音频格式或重新下载');
});
elements.music.volume = 0.36;

window.addEventListener('keydown', (event) => {
  if (!scene) return;
  if (event.code === 'Escape') setMode('tree');
  if (event.code !== 'Space' || ['BUTTON', 'INPUT', 'A'].includes(document.activeElement.tagName)) return;
  event.preventDefault();
  const modes = ['tree', 'scatter', 'focus'];
  setMode(modes[(modes.indexOf(scene.mode) + 1) % modes.length]);
});

window.addEventListener('christmas-webgl-error', () => notify('显卡渲染上下文已中断，请刷新页面恢复'));
window.addEventListener('beforeunload', () => {
  gestures?.stop();
  elements.music.pause();
  photoSources.filter((source) => source.owned).forEach((source) => URL.revokeObjectURL(source.src));
});

init();
