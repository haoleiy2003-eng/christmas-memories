/*
 * Adapted from stone100010/JennieKim (Apache License 2.0).
 * Modified: instanced rendering, local photo uploads, optional gesture input,
 * responsive controls, snowfall, and a new visual treatment.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TREE_HEIGHT = 22;
const TREE_RADIUS = 7.6;
const GOLD = 0xf4c968;
const PALE_GOLD = 0xffe6a3;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function dampFactor(speed, dt) {
  return 1 - Math.exp(-speed * dt);
}

function treePosition(target, radialBias = 1) {
  const t = Math.pow(Math.random(), 0.9);
  const y = t * TREE_HEIGHT - TREE_HEIGHT / 2;
  const maxRadius = Math.max(0.2, TREE_RADIUS * Math.pow(1 - t, 0.86));
  const angle = t * Math.PI * 34 + Math.random() * Math.PI * 2;
  const radius = maxRadius * (0.48 + Math.random() * 0.52) * radialBias;
  return target.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function scatterPosition(target, min = 12, max = 23) {
  const radius = min + Math.random() * (max - min);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return target.set(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi) * 0.72,
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,244,196,.95)');
  gradient.addColorStop(0.35, 'rgba(255,204,104,.38)');
  gradient.addColorStop(1, 'rgba(255,180,60,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function candyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff2d7';
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = '#a61f2b';
  context.lineWidth = 19;
  for (let x = -128; x < 256; x += 52) {
    context.beginPath();
    context.moveTo(x, 128);
    context.lineTo(x + 128, 0);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  return texture;
}

class OrnamentBatch {
  constructor(parent, geometry, material, count, kind) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.kind = kind;
    this.items = [];
    this.dummy = new THREE.Object3D();
    parent.add(this.mesh);

    for (let i = 0; i < count; i += 1) {
      const tree = treePosition(new THREE.Vector3(), kind === 'green' ? 0.93 : 1.04);
      const item = {
        tree,
        scatter: scatterPosition(new THREE.Vector3(), 10, 21),
        position: tree.clone(),
        rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.8),
        scale: kind === 'candy' ? 0.65 + Math.random() * 0.55 : 0.34 + Math.random() * 0.58,
        phase: Math.random() * Math.PI * 2,
      };
      this.items.push(item);
    }
  }

  update(dt, time, scattered) {
    const positionDamp = dampFactor(2.25, dt);
    const rotationDamp = dampFactor(2.8, dt);
    this.items.forEach((item, index) => {
      item.position.lerp(scattered ? item.scatter : item.tree, positionDamp);
      this.dummy.position.copy(item.position);
      if (!scattered) {
        this.dummy.position.x += Math.sin(time * 0.65 + item.phase) * 0.025;
        item.rotation.x = THREE.MathUtils.lerp(item.rotation.x, 0, rotationDamp);
        item.rotation.z = THREE.MathUtils.lerp(item.rotation.z, 0, rotationDamp);
        item.rotation.y += dt * 0.35;
      } else {
        item.rotation.x += item.spin.x * dt;
        item.rotation.y += item.spin.y * dt;
        item.rotation.z += item.spin.z * dt;
      }
      this.dummy.rotation.copy(item.rotation);
      const pulse = this.kind === 'gold' ? 1 + Math.sin(time * 2.2 + item.phase) * 0.09 : 1;
      this.dummy.scale.setScalar(item.scale * pulse);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class ChristmasScene {
  constructor(container, onPhotoChange) {
    this.container = container;
    this.onPhotoChange = onPhotoChange;
    this.mode = 'tree';
    this.photos = [];
    this.photoSources = [];
    this.focusIndex = -1;
    this.focusTarget = null;
    this.active = true;
    this.inViewport = true;
    this.hand = { detected: false, x: 0, y: 0 };
    this.rotationTarget = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.batches = [];
    this.tempVector = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.init();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030d21);
    this.scene.fog = new THREE.FogExp2(0x030d21, 0.009);
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 180);
    this.camera.position.set(0, 1.5, window.innerWidth < 760 ? 68 : 57);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.replaceChildren(this.renderer.domElement);

    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environment = this.environment;
    room.dispose();
    pmrem.dispose();

    this.mainGroup = new THREE.Group();
    this.mainGroup.position.y = -1.8;
    this.scene.add(this.mainGroup);
    this.addLights();
    this.createOrnaments();
    this.createMagicDust();
    this.createGarlands();
    this.createStar();
    this.createBaseGlow();
    this.createSnow();
    this.createBackgroundStars();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 29;
    this.controls.maxDistance = 68;
    this.controls.minPolarAngle = Math.PI * 0.25;
    this.controls.maxPolarAngle = Math.PI * 0.72;
    this.controls.target.set(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.48, 0.38, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.active = false;
      window.dispatchEvent(new CustomEvent('christmas-webgl-error'));
    });
    this.animate();
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0xb5c9e2, 0.9));
    const key = new THREE.DirectionalLight(0xfff0d4, 1.65);
    key.position.set(8, 15, 18);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6e9bd4, 1.6);
    rim.position.set(-14, 4, -10);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xffb63f, 42, 30, 2);
    warm.position.set(0, 1, 5);
    this.mainGroup.add(warm);
    const base = new THREE.PointLight(0xffc85e, 28, 18, 2);
    base.position.set(0, -9, 2);
    this.mainGroup.add(base);
  }

  createOrnaments() {
    const gold = new THREE.MeshStandardMaterial({
      color: GOLD, metalness: 0.88, roughness: 0.22,
      emissive: 0x8a4c08, emissiveIntensity: 0.28, envMapIntensity: 1.45,
    });
    const paleGold = new THREE.MeshStandardMaterial({
      color: PALE_GOLD, metalness: 0.72, roughness: 0.26,
      emissive: 0x6f420c, emissiveIntensity: 0.2,
    });
    const green = new THREE.MeshStandardMaterial({
      color: 0x03452c, metalness: 0.16, roughness: 0.62,
      emissive: 0x012217, emissiveIntensity: 0.25, envMapIntensity: 0.45,
    });
    const red = new THREE.MeshPhysicalMaterial({
      color: 0x8f0f1d, metalness: 0.4, roughness: 0.22,
      clearcoat: 0.7, emissive: 0x240105, emissiveIntensity: 0.25, envMapIntensity: 0.65,
    });
    const candy = new THREE.MeshStandardMaterial({ map: candyTexture(), roughness: 0.35, metalness: 0.08 });

    this.batches.push(new OrnamentBatch(this.mainGroup, new THREE.SphereGeometry(0.42, 12, 10), gold, 450, 'gold'));
    this.batches.push(new OrnamentBatch(this.mainGroup, new THREE.BoxGeometry(0.55, 0.55, 0.55), paleGold, 270, 'gold-box'));
    this.batches.push(new OrnamentBatch(this.mainGroup, new THREE.BoxGeometry(0.64, 0.64, 0.64), green, 550, 'green'));
    this.batches.push(new OrnamentBatch(this.mainGroup, new THREE.SphereGeometry(0.43, 12, 10), red, 220, 'red'));

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.65, 0), new THREE.Vector3(0, 0.28, 0),
      new THREE.Vector3(0.08, 0.58, 0), new THREE.Vector3(0.32, 0.6, 0),
      new THREE.Vector3(0.45, 0.4, 0),
    ]);
    this.batches.push(new OrnamentBatch(this.mainGroup, new THREE.TubeGeometry(curve, 12, 0.085, 6, false), candy, 65, 'candy'));
  }

  createMagicDust() {
    const count = 1450;
    const positions = new Float32Array(count * 3);
    const tree = new Float32Array(count * 3);
    const scatter = new Float32Array(count * 3);
    const vector = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      treePosition(vector, 1.09);
      vector.toArray(tree, i * 3);
      vector.toArray(positions, i * 3);
      scatterPosition(vector, 8, 24).toArray(scatter, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.PointsMaterial({
      color: 0xffd77a, size: 0.24, map: glowTexture(), transparent: true,
      opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.magicDust = new THREE.Points(geometry, material);
    this.magicDust.frustumCulled = false;
    this.magicDust.userData = { tree, scatter };
    this.mainGroup.add(this.magicDust);
  }

  createGarlands() {
    this.garlands = [];
    for (let strand = 0; strand < 3; strand += 1) {
      const points = [];
      for (let i = 0; i <= 500; i += 1) {
        const t = i / 500;
        const angle = t * Math.PI * 16 + strand * (Math.PI * 2 / 3);
        const radius = TREE_RADIUS * Math.pow(1 - t, 0.88) * 1.03;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, t * TREE_HEIGHT - TREE_HEIGHT / 2, Math.sin(angle) * radius));
      }
      const material = new THREE.LineBasicMaterial({
        color: strand === 1 ? 0xffe6a5 : 0xd9a83f,
        transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      this.mainGroup.add(line);
      this.garlands.push(line);
    }
  }

  createStar() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? 1.35 : 0.58;
      const angle = Math.PI / 2 + i * Math.PI / 5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: true, bevelSize: 0.09, bevelThickness: 0.08, bevelSegments: 2 });
    geometry.center();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd666, metalness: 0.72, roughness: 0.18,
      emissive: 0xffa615, emissiveIntensity: 2.1,
    });
    this.star = new THREE.Mesh(geometry, material);
    this.star.position.set(0, TREE_HEIGHT / 2 + 1.15, 0);
    this.star.userData.tree = this.star.position.clone();
    this.star.userData.scatter = new THREE.Vector3(3, 8, 4);
    this.mainGroup.add(this.star);

    this.starGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc64d, transparent: true,
      opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.starGlow.scale.set(7, 7, 1);
    this.star.add(this.starGlow);
  }

  createBaseGlow() {
    const material = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xd9942f, transparent: true,
      opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.baseGlow = new THREE.Sprite(material);
    this.baseGlow.position.set(0, -11.6, -1);
    this.baseGlow.scale.set(25, 5, 1);
    this.mainGroup.add(this.baseGlow);
  }

  createSnow() {
    this.snowSystems = [];
    const mobile = window.innerWidth < 760;
    const layers = [
      { count: mobile ? 400 : 800, size: 0.11, opacity: 0.55, minSpeed: 0.45, speedRange: 0.85, minZ: -38, maxZ: 3, drift: 0.18 },
      { count: mobile ? 180 : 360, size: 0.3, opacity: 0.82, minSpeed: 1.25, speedRange: 1.55, minZ: 2, maxZ: 34, drift: 0.42 },
    ];
    layers.forEach((layer) => {
      const positions = new Float32Array(layer.count * 3);
      const speeds = new Float32Array(layer.count);
      for (let i = 0; i < layer.count; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * 85;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 64;
        positions[i * 3 + 2] = layer.minZ + Math.random() * (layer.maxZ - layer.minZ);
        speeds[i] = layer.minSpeed + Math.random() * layer.speedRange;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      const snow = new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0xf2f8ff, size: layer.size, map: glowTexture(), transparent: true,
        opacity: layer.opacity, depthWrite: false, blending: THREE.NormalBlending,
      }));
      snow.userData = { speeds, drift: layer.drift, offset: Math.random() * Math.PI * 2 };
      this.snowSystems.push(snow);
      this.scene.add(snow);
    });
  }

  createBackgroundStars() {
    const positions = [];
    for (let i = 0; i < 380; i += 1) {
      positions.push((Math.random() - 0.5) * 110, (Math.random() - 0.5) * 65, -25 - Math.random() * 30);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xbcd8f4, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false,
    })));
  }

  async setPhotoSources(sources) {
    this.photoSources = sources;
    this.photos.forEach(({ mesh }) => {
      this.mainGroup.remove(mesh);
      mesh.traverse((child) => {
        child.geometry?.dispose();
        if (child.material) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
    });
    this.photos = [];
    this.focusTarget = null;
    if (this.mode === 'focus') this.mode = 'scatter';

    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(sources.map(async (source) => {
      const texture = await loader.loadAsync(source.src);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return texture;
    }));

    const cardCount = Math.max(12, textures.length);
    for (let i = 0; i < cardCount; i += 1) {
      const texture = textures[i % textures.length];
      const image = texture.image;
      const aspect = image.width / image.height;
      let height = 1.65;
      let width = height * aspect;
      if (width > 2.15) {
        width = 2.15;
        height = width / aspect;
      }
      const group = new THREE.Group();
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.18, height + 0.18, 0.085),
        new THREE.MeshBasicMaterial({ color: 0xc99f51, toneMapped: false }),
      );
      const picture = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      );
      picture.position.z = 0.047;
      group.add(frame, picture);

      const t = 0.08 + (i / cardCount) * 0.78;
      const angle = i * 2.39996 + 0.4;
      const radius = TREE_RADIUS * Math.pow(1 - t, 0.86) + 0.85;
      const tree = new THREE.Vector3(Math.cos(angle) * radius, t * TREE_HEIGHT - TREE_HEIGHT / 2, Math.sin(angle) * radius);
      group.position.copy(tree);
      this.mainGroup.add(group);
      this.photos.push({
        mesh: group, tree, scatter: scatterPosition(new THREE.Vector3(), 11, 19),
        position: tree.clone(), sourceIndex: i % textures.length,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  setMode(mode) {
    if (mode === 'focus') {
      this.focusNext();
      return;
    }
    this.mode = mode;
    this.focusTarget = null;
    this.focusIndex = -1;
    this.onPhotoChange?.(-1, this.photoSources.length);
  }

  focusNext() {
    if (!this.photos.length) return;
    this.focusIndex = (this.focusIndex + 1) % this.photos.length;
    this.focusTarget = this.photos[this.focusIndex];
    this.mode = 'focus';
    this.onPhotoChange?.(this.focusTarget.sourceIndex, this.photoSources.length);
  }

  focusPhoto(sourceIndex) {
    const photo = this.photos.find((item) => item.sourceIndex === sourceIndex);
    if (!photo) return;
    this.focusIndex = this.photos.indexOf(photo);
    this.focusTarget = photo;
    this.mode = 'focus';
    this.onPhotoChange?.(sourceIndex, this.photoSources.length);
  }

  setHand(hand) {
    this.hand = hand;
  }

  setActive(active) {
    this.active = active;
    this.clock.getDelta();
  }

  updateDust(dt, scattered) {
    const attribute = this.magicDust.geometry.attributes.position;
    const current = attribute.array;
    const { tree, scatter } = this.magicDust.userData;
    const target = scattered ? scatter : tree;
    const amount = dampFactor(2.5, dt);
    for (let i = 0; i < current.length; i += 1) current[i] += (target[i] - current[i]) * amount;
    attribute.needsUpdate = true;
  }

  updateSnow(dt, time) {
    this.snowSystems.forEach((snow) => {
      const attribute = snow.geometry.attributes.position;
      const positions = attribute.array;
      const { speeds, drift, offset } = snow.userData;
      for (let i = 0; i < speeds.length; i += 1) {
        positions[i * 3 + 1] -= speeds[i] * dt;
        positions[i * 3] += Math.sin(time * 0.65 + i * 1.7 + offset) * drift * dt;
        if (positions[i * 3 + 1] < -32) {
          positions[i * 3 + 1] = 32;
          positions[i * 3] = (Math.random() - 0.5) * 85;
        }
      }
      attribute.needsUpdate = true;
    });
  }

  updatePhotos(dt, time) {
    const positionDamp = dampFactor(3.1, dt);
    const scaleDamp = dampFactor(4.2, dt);
    this.mainGroup.updateMatrixWorld(true);
    if (this.mode === 'focus' && this.focusTarget) {
      this.camera.getWorldDirection(this.tempDirection);
      this.tempVector.copy(this.camera.position).addScaledVector(this.tempDirection, 12.5);
      this.mainGroup.worldToLocal(this.tempVector);
    }

    this.photos.forEach((photo) => {
      const focused = this.mode === 'focus' && photo === this.focusTarget;
      const target = focused ? this.tempVector : (this.mode === 'tree' ? photo.tree : photo.scatter);
      photo.position.lerp(target, positionDamp);
      photo.mesh.position.copy(photo.position);
      photo.mesh.lookAt(this.camera.position);
      photo.mesh.rotateZ(focused ? 0 : Math.sin(time * 0.45 + photo.phase) * 0.055);
      const targetScale = focused ? 3.2 : (this.mode === 'scatter' ? 1.35 : 0.9);
      const scale = THREE.MathUtils.lerp(photo.mesh.scale.x, targetScale, scaleDamp);
      photo.mesh.scale.setScalar(scale);
    });
  }

  animate() {
    this.animationFrame = requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.active || !this.inViewport || document.hidden) return;
    const time = this.clock.elapsedTime;
    const scattered = this.mode !== 'tree';

    if (this.mode === 'scatter' && this.hand.detected) {
      this.rotationTarget.set(this.hand.y * 0.38, this.hand.x * Math.PI * 1.2);
      this.mainGroup.rotation.x = THREE.MathUtils.lerp(this.mainGroup.rotation.x, this.rotationTarget.x, dampFactor(3, dt));
      this.mainGroup.rotation.y = THREE.MathUtils.lerp(this.mainGroup.rotation.y, this.rotationTarget.y, dampFactor(3, dt));
    } else {
      this.mainGroup.rotation.x = THREE.MathUtils.lerp(this.mainGroup.rotation.x, 0, dampFactor(2, dt));
      this.mainGroup.rotation.y += dt * (reducedMotion ? 0 : (this.mode === 'tree' ? 0.16 : 0.055));
    }

    this.batches.forEach((batch) => batch.update(dt, time, scattered));
    this.updateDust(dt, scattered);
    this.updateSnow(reducedMotion ? dt * 0.25 : dt, time);
    this.updatePhotos(dt, time);
    this.garlands.forEach((line) => {
      line.material.opacity = THREE.MathUtils.lerp(line.material.opacity, scattered ? 0 : 0.38, dampFactor(3, dt));
    });
    this.star.position.lerp(this.mode === 'tree' ? this.star.userData.tree : this.star.userData.scatter, dampFactor(2.5, dt));
    this.star.lookAt(this.camera.position);
    this.star.rotateZ(Math.sin(time * 0.8) * 0.09);
    this.baseGlow.material.opacity = THREE.MathUtils.lerp(this.baseGlow.material.opacity, scattered ? 0.03 : 0.16, dampFactor(2, dt));
    this.controls.update();
    this.composer.render();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }
}
