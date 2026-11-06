import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ============ 1. SCENE, SHINKAI SKY & RENDERER ============
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbbe6ff, 80, 290);

function createAnimeSkyDome() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#0284c7');
  grad.addColorStop(0.38, '#38bdf8');
  grad.addColorStop(0.52, '#bae6fd');
  grad.addColorStop(0.56, '#f8fafc');
  grad.addColorStop(1.0, '#cbd5e1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 512);

  for (let i = 0; i < 55; i++) {
    const cx = Math.random() * 1024;
    const cy = 140 + Math.random() * 120;
    const rx = 35 + Math.random() * 85;
    const ry = 14 + Math.random() * 30;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.94)');
    g.addColorStop(0.6, 'rgba(240, 249, 255, 0.58)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const skyGeo = new THREE.SphereGeometry(360, 32, 24);
  const skyMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(skyGeo, skyMat);
}
const skyDome = createAnimeSkyDome();
scene.add(skyDome);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 420);
camera.position.set(0, 2.35, 27.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('app').appendChild(renderer.domElement);

window.addEventListener('contextmenu', e => e.preventDefault());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false; // Replaced by full 360° + unrestricted vertical pitch camera controller

// ============ 2. SUNLIGHT & AMBIENT LIGHTING ============
const ambient = new THREE.AmbientLight(0xe0f2fe, 1.18);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x7dd3fc, 0xd6d3d1, 0.95);
scene.add(hemi);

const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.35);
sunLight.position.set(-45, 75, 40);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 2;
sunLight.shadow.camera.far = 220;
sunLight.shadow.camera.left = -85;
sunLight.shadow.camera.right = 85;
sunLight.shadow.camera.top = 85;
sunLight.shadow.camera.bottom = -85;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// ============ 3. REAL 3D CITY LOADER (./city/source/procedural_city_6.glb) + MINECRAFT INFINITE SECTORS ============
// Exact dimensions of procedural_city_6.glb:
// X: [-185.5 .. +62.1] (width = 247.6m), Z: [-67.5 .. +128.6] (depth = 196.1m)
// Shifted by +34.05m in X so the Main Central Avenue asphalt (X in [-3.75 .. +3.75]) centers at X = 0.0!
const SECTOR_W = 247.6;
const SECTOR_D = 196.1;
const CITY_OFFSET_X = 34.05;
const CHUNK_SIZE = 60.0;
const RENDER_DIST = 1; // 3x3 = 9 full 3D City Sectors (742m x 588m) loaded dynamically around player!
const roadWidth = 10.0;
const crossingZ = 0.0; // Runs along the Central East-West Avenue (Z in [-3.70 .. +3.70])!
const roadXCoords = [-144.8, -58.0, 0.0, 87.9];
const roadZCoords = [-60.0, 0.0, 60.6, 121.1];

// Exact 9 Building Block Footprints measured directly from procedural_city_6.glb geometry (+34.05m X offset)
const BASE_CITY_BLOCKS = [
  { minX: -130.59, maxX: -71.61, minZ: -50.63, maxZ: -15.51 },
  { minX: -128.41, maxX: -68.03, minZ:  13.27, maxZ:  47.59 },
  { minX: -130.71, maxX: -69.59, minZ:  74.02, maxZ: 107.07 },
  { minX:  -47.46, maxX:  -8.65, minZ: -51.76, maxZ:  -8.24 },
  { minX:  -42.62, maxX: -15.51, minZ:  14.07, maxZ:  45.93 },
  { minX:  -44.58, maxX: -10.96, minZ:  73.62, maxZ: 113.83 },
  { minX:   15.50, maxX:  75.20, minZ: -50.70, maxZ: -13.34 },
  { minX:   15.50, maxX:  76.84, minZ:  13.21, maxZ:  51.18 },
  { minX:   15.50, maxX:  75.31, minZ:  73.31, maxZ: 109.83 }
];

function getChunkBiome(cx, cz) {
  const s = Math.abs(cx) + Math.abs(cz);
  if (s === 0) return 'FINANCIAL_DOWNTOWN';
  if (s % 3 === 1) return 'NEON_SHIBUYA';
  if (s % 3 === 2) return 'SAKURA_RESIDENTIAL';
  return 'PARK';
}

// High-Detail Asphalt Base Floor (Follows player so raycasting & horizon never run out)
function createRoadTileTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2d3139';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const baseGround = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshStandardMaterial({ map: createRoadTileTexture(), roughness: 0.85, metalness: 0.08 })
);
baseGround.rotation.x = -Math.PI / 2;
baseGround.position.y = -0.04;
baseGround.receiveShadow = true;
scene.add(baseGround);

const steelMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 });
function createHazardStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#18181b';
  for (let x = -64; x < 320; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 24, 0);
    ctx.lineTo(x + 48, 64); ctx.lineTo(x + 24, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const hazardMat = new THREE.MeshStandardMaterial({ map: createHazardStripeTexture(), roughness: 0.4 });
const railBedMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });

// Active City Sectors Registry: key "sx,sz" -> { cx, cz, group, colliders, radarItems, crossingLights, barrierArms }
const activeChunks = new Map();
let cityTemplateScene = null;
let lastPlayerSX = null;
let lastPlayerSZ = null;

function buildSectorCollidersAndRadar(sx, sz) {
  const ox = sx * SECTOR_W;
  const oz = sz * SECTOR_D;
  const colliders = [];
  const radarItems = [];

  BASE_CITY_BLOCKS.forEach((b) => {
    const minX = b.minX + ox;
    const maxX = b.maxX + ox;
    const minZ = b.minZ + oz;
    const maxZ = b.maxZ + oz;
    colliders.push({ minX, maxX, minZ, maxZ });
    radarItems.push({
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      w: maxX - minX,
      d: maxZ - minZ,
      isPark: false
    });
  });

  return { colliders, radarItems };
}

function generateSector(sx, sz) {
  const key = `${sx},${sz}`;
  if (activeChunks.has(key)) return activeChunks.get(key);

  const group = new THREE.Group();
  const ox = sx * SECTOR_W;
  const oz = sz * SECTOR_D;
  const { colliders, radarItems } = buildSectorCollidersAndRadar(sx, sz);
  const chunkCrossingLights = [];
  const chunkBarrierArms = [];

  if (cityTemplateScene) {
    const cityClone = cityTemplateScene.clone(true);
    cityClone.position.set(ox + CITY_OFFSET_X, 0, oz);
    group.add(cityClone);
  }

  // Railway tracks & crossings along sz === 0 at the main avenues
  if (sz === 0) {
    const rBed = new THREE.Mesh(new THREE.BoxGeometry(SECTOR_W, 0.08, 4.4), railBedMat);
    rBed.position.set(ox - 30, 0.03, crossingZ);
    rBed.receiveShadow = true;
    group.add(rBed);

    for (let rz of [-1.1, -0.2, 0.6, 1.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(SECTOR_W, 0.12, 0.08), steelMat);
      rail.position.set(ox - 30, 0.08, crossingZ + rz);
      group.add(rail);
    }

    for (let aveX of [-61.0, 0.0, 83.0]) {
      const rx = ox + aveX;
      for (let side of [-1, 1]) {
        const px = rx + side * 8.5;
        const pz = crossingZ + 3.2;

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 4.3, 10), hazardMat);
        pole.position.set(px, 2.15, pz);
        group.add(pole);

        for (let lx of [-0.3, 0.3]) {
          const redLens = new THREE.Mesh(
            new THREE.CircleGeometry(0.16, 10),
            new THREE.MeshBasicMaterial({ color: 0xff1e32, side: THREE.DoubleSide })
          );
          redLens.position.set(px + lx, 2.95, pz + 0.18);
          group.add(redLens);
          chunkCrossingLights.push(redLens);
        }

        const pivot = new THREE.Group();
        pivot.position.set(px, 1.05, pz - 0.3);
        const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 6.2, 8), hazardMat);
        armMesh.rotation.z = Math.PI / 2;
        armMesh.position.x = -side * 3.1;
        pivot.add(armMesh);
        group.add(pivot);
        chunkBarrierArms.push({ pivot, side });
      }
    }
  }

  scene.add(group);
  const sectorData = {
    cx: sx, cz: sz, biome: getChunkBiome(sx, sz),
    group, colliders, radarItems,
    crossingLights: chunkCrossingLights,
    barrierArms: chunkBarrierArms
  };
  activeChunks.set(key, sectorData);
  return sectorData;
}

function unloadSector(key) {
  const sec = activeChunks.get(key);
  if (!sec) return;
  scene.remove(sec.group);
  activeChunks.delete(key);
}

function updateWorldChunks(playerPos, force = false) {
  const pSX = Math.round(playerPos.x / SECTOR_W);
  const pSZ = Math.round(playerPos.z / SECTOR_D);

  skyDome.position.set(playerPos.x, 0, playerPos.z);
  baseGround.position.set(playerPos.x, -0.04, playerPos.z);
  sunLight.position.set(playerPos.x - 45, 85, playerPos.z + 45);
  sunLight.target.position.set(playerPos.x, 0, playerPos.z);

  if (!force && pSX === lastPlayerSX && pSZ === lastPlayerSZ) return;
  lastPlayerSX = pSX;
  lastPlayerSZ = pSZ;

  for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
      generateSector(pSX + dx, pSZ + dz);
    }
  }

  for (const [key, sec] of activeChunks.entries()) {
    if (Math.abs(sec.cx - pSX) > RENDER_DIST || Math.abs(sec.cz - pSZ) > RENDER_DIST) {
      unloadSector(key);
    }
  }

  const chunkBadgeEl = document.getElementById('chunkBadge');
  if (chunkBadgeEl) {
    chunkBadgeEl.textContent = `SECTOR [${pSX}, ${pSZ}] • ${activeChunks.size} ACTIVOS`;
  }
}

// Initialize collision sectors immediately and load ./city/source/procedural_city_6.glb
updateWorldChunks(new THREE.Vector3(0, 0, 22), true);

const cityGltfLoader = new GLTFLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
cityGltfLoader.load(
  './city/source/procedural_city_6.glb',
  (gltf) => {
    cityTemplateScene = gltf.scene;
    cityTemplateScene.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (!m) return;
        // Enhance all PBR textures with 16x Anisotropic Filtering for ultra-crisp roads & facades
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((tKey) => {
          if (m[tKey]) {
            m[tKey].anisotropy = maxAniso;
            if (tKey === 'map' || tKey === 'emissiveMap') {
              m[tKey].colorSpace = THREE.SRGBColorSpace;
            }
            m[tKey].needsUpdate = true;
          }
        });
        // Fix foliage and street stain decals so they don't z-fight
        const mName = m.name || '';
        if (/Foliage|Decal|lanes/i.test(mName)) {
          m.alphaTest = 0.35;
          m.depthWrite = true;
        }
        m.needsUpdate = true;
      });
    });

    // Rebuild active sectors with the loaded 3D city model
    for (const key of [...activeChunks.keys()]) unloadSector(key);
    updateWorldChunks(character.position, true);
    console.log('Real 3D City (procedural_city_6.glb) loaded and tiled across sectors!');
  },
  (xhr) => {
    if (xhr.total) {
      const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
      const chunkBadgeEl = document.getElementById('chunkBadge');
      if (chunkBadgeEl && pct < 100) {
        chunkBadgeEl.textContent = `CARGANDO CIUDAD 3D: ${pct}%`;
      }
    }
  },
  (err) => console.error('Error loading procedural_city_6.glb:', err)
);

// Express Commuter Train running along Z = crossingZ
const trainGroup = new THREE.Group();
const trainBodyMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.5, roughness: 0.3 });
const trainStripeMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
const trainWinMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
for (let car = 0; car < 5; car++) {
  const cx = (car - 2) * 17.0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(16.2, 3.4, 2.9), trainBodyMat);
  body.position.set(cx, 1.9, 0);
  body.castShadow = true;
  trainGroup.add(body);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(16.25, 0.35, 2.94), trainStripeMat);
  stripe.position.set(cx, 1.5, 0);
  trainGroup.add(stripe);

  const win = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.9, 2.96), trainWinMat);
  win.position.set(cx, 2.25, 0);
  trainGroup.add(win);
}
trainGroup.position.set(-140, 0, crossingZ);
scene.add(trainGroup);
let crossingClosed = false;
let trainPassTimer = 0;
let trainRelX = -140;

// ============ 6. FLEET OF DRIVABLE VEHICLES & AI TRAFFIC (GTA SYSTEM) ============
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.1 });
const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff1e32 });
const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

const vehicles = [];
const shootables = [];

function createVehicle({ name, colorHex, x, z, rotY = 0, maxSpeed = 20, isAI = false, isPolice = false }) {
  const carGroup = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.72, roughness: 0.26 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.72, 4.4), bodyMat);
  chassis.position.y = 0.68;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  carGroup.add(chassis);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.62, 2.3), carGlassMat);
  cabin.position.set(0, 1.28, -0.15);
  cabin.castShadow = true;
  carGroup.add(cabin);

  // Police Lightbar
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.28), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    bar.position.set(0, 1.65, -0.1);
    carGroup.add(bar);
  }

  // Taillights & Headlights
  for (let sx of [-0.62, 0.62]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.08), tailLightMat);
    tl.position.set(sx, 0.76, 2.18);
    carGroup.add(tl);

    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headLightMat);
    hl.position.set(sx, 0.72, -2.18);
    carGroup.add(hl);
  }

  const wheels = [];
  for (let [wx, wz] of [[-0.96, -1.35], [0.96, -1.35], [-0.96, 1.35], [0.96, 1.35]]) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wx, 0.36, wz);
    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    spinPivot.add(wheel);

    carGroup.add(steerPivot);
    wheels.push({ spinPivot, steerPivot, isFront: wz < 0, spinSign: -1 });
  }

  carGroup.position.set(x, 0, z);
  carGroup.rotation.y = rotY;
  scene.add(carGroup);

  const vObj = {
    name,
    mesh: carGroup,
    wheels,
    speed: isAI ? 11.5 : 0,
    baseAiSpeed: 11.5,
    aiLaneX: x,
    aiRotY: rotY,
    steerAngle: 0,
    maxSpeed,
    isAI,
    isPolice,
    colorHex
  };
  chassis.userData = { type: 'vehicle', hp: 8, alive: true, parentGroup: carGroup, vehicleRef: vObj };
  shootables.push(chassis);
  vehicles.push(vObj);
  return vObj;
}

// 1) MCLAREN P1 GTR 2015 SUPERCAR (Loaded from ./source/McLaren P1 GTR 2015.fbx + ./textures/) — Left asphalt lane (X = -1.85)
const mclarenMain = createVehicle({ name: 'MCLAREN P1 GTR 2015', colorHex: 0x4d00b3, x: -1.85, z: 15.0, rotY: 0, maxSpeed: 39, isAI: false });
// 2) LAMBORGHINI AVENTADOR LP700-4 4K (./cars/aventador_4k.glb) — Left asphalt lane ahead of McLaren
const lamboAventador = createVehicle({ name: 'LAMBORGHINI AVENTADOR LP700 4K', colorHex: 0xf97316, x: -1.85, z: 7.5, rotY: 0, maxSpeed: 40, isAI: false });
// 3) FERRARI 458 ITALIA 4K (./cars/ferrari_458.glb) — Left asphalt lane behind player
const ferrariMain = createVehicle({ name: 'FERRARI 458 ITALIA 4K', colorHex: 0xdc2626, x: -1.85, z: 27.5, rotY: 0, maxSpeed: 38, isAI: false });
// 4) LAMBORGHINI CENTENARIO LP770-4 4K (./cars/lamborghini_4k.glb - 42MB 4K Model) — Left asphalt lane north of crossing
const lamboCentenario = createVehicle({ name: 'LAMBORGHINI CENTENARIO LP770 4K', colorHex: 0x18181b, x: -1.85, z: -13.5, rotY: Math.PI, maxSpeed: 41, isAI: false });
// 5) BMW M3 GTR E46 AC SCHNITZER 4K (./cars/bmw_m3_gtr_4k.glb - 14.5MB 4K Model) — Left asphalt lane north
const bmwM3Gtr = createVehicle({ name: 'BMW M3 GTR E46 STREET 4K', colorHex: 0x0f172a, x: -1.85, z: -24.5, rotY: Math.PI, maxSpeed: 35, isAI: false });
// 6) PORSCHE 911 CARRERA 4S 4K (./cars/porsche_911_4k.glb) — Left asphalt lane south
const porsche911 = createVehicle({ name: 'PORSCHE 911 CARRERA 4S 4K', colorHex: 0x94a3b8, x: -1.85, z: 39.0, rotY: 0, maxSpeed: 36, isAI: false });
// 7) BMW M4 CSL COMPETITION 4K (./cars/bmw_m4_csl.glb) — Left asphalt lane south
const bmwM4Csl = createVehicle({ name: 'BMW M4 CSL COMPETITION 4K', colorHex: 0x1e293b, x: -1.85, z: 51.0, rotY: 0, maxSpeed: 36, isAI: false, isPolice: true });

// 8) AI Traffic Supercars cruising on exact unobstructed asphalt lanes of procedural_city_6.glb!
// Main Central Avenue Right Asphalt Lane (X = +1.85, Northbound rotY = 0)
const ferrariAI = createVehicle({ name: 'FERRARI 458 SPIDER GT', colorHex: 0xeab308, x: 1.85, z: -45.0, rotY: 0, maxSpeed: 28, isAI: true });
const porscheAI = createVehicle({ name: 'PORSCHE 911 TURBO S', colorHex: 0x0284c7, x: 1.85, z: 68.0, rotY: 0, maxSpeed: 29, isAI: true });
// West-Central 4-Lane Boulevard Asphalt Lanes (X = -55.6 Northbound, X = -60.2 Southbound)
const mclarenAI = createVehicle({ name: 'MCLAREN P1 GTR CYBER', colorHex: 0x9333ea, x: -55.6, z: 45.0, rotY: 0, maxSpeed: 34, isAI: true });
const bmwM3AI = createVehicle({ name: 'BMW M3 GTR INTERCEPTOR', colorHex: 0x0f172a, x: -60.2, z: -20.0, rotY: Math.PI, maxSpeed: 32, isAI: true, isPolice: true });
// East 4-Lane Boulevard Asphalt Lane (X = +85.2 Southbound)
const aventadorAI = createVehicle({ name: 'LAMBORGHINI AVENTADOR SVJ', colorHex: 0x22c55e, x: 85.2, z: -35.0, rotY: Math.PI, maxSpeed: 35, isAI: true });

// Load the real 3D Supercar from ./source/McLaren P1 GTR 2015.fbx and ./textures/
const texLoader = new THREE.TextureLoader();
function loadSupercarTex(path) {
  const t = texLoader.load(path);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
const texCarbon = loadSupercarTex('./textures/кабра.jpg');
const texSciFi = loadSupercarTex('./textures/1673155554_grizly-club-p-besshovnaya-tekst.jpg');
const texWheelBase = loadSupercarTex('./textures/Material_baseColor.jpeg');
const texWheelRim = loadSupercarTex('./textures/Material.036_baseColor.png');

const fbxManager = new THREE.LoadingManager();
const emptyGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
fbxManager.setURLModifier((url) => {
  const dec = decodeURIComponent(url);
  if (/1673155554_grizly/i.test(dec)) return './textures/1673155554_grizly-club-p-besshovnaya-tekst.jpg';
  if (/Material\.036_baseColor\.png/i.test(dec)) return './textures/Material.036_baseColor.png';
  if (/Material_baseColor\.jpeg/i.test(dec)) return './textures/Material_baseColor.jpeg';
  if (/кабра/i.test(dec)) return './textures/кабра.jpg';
  if (/Сверху|Сзади|Сбоку|Спереди/i.test(dec)) return emptyGif;
  return url;
});

function applyMcLarenModelToVehicle(vObj, templateGroup, customPaintHex = null) {
  // Hide procedural placeholder visuals inside carGroup (keep invisible hit-box for raycasting)
  vObj.mesh.children.forEach((c, idx) => {
    if (idx === 0) {
      c.material = new THREE.MeshBasicMaterial({ visible: false });
    } else {
      c.visible = false;
    }
  });

  const supercar = templateGroup.clone(true);
  const wheelMeshes = [];

  supercar.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const isWheelPart = /^(OBJECTS00|Object_35|Object_37|Окружность00[1-7]|Окружность$|Цилиндр00[1-3]|Цилиндр$)/.test(child.name) ||
      (child.parent && /^OBJECTS00/.test(child.parent.name));
    if (isWheelPart) wheelMeshes.push(child);

    const fixMat = (origMat) => {
      const m = origMat.clone();
      // Reset Blender FBX white emissive bug so materials show their real colors & textures
      if (m.emissive) m.emissive.setHex(0x000000);
      m.shininess = Math.max(m.shininess || 40, 75);

      const mName = m.name || '';
      const hex = m.color ? m.color.getHex() : 0x000000;

      // Explicit texture assignment from ./textures/
      if (mName === 'Материал.017') {
        m.map = texSciFi;
        m.color.setHex(0xffffff);
      } else if (mName === 'Материал.036') {
        m.map = texCarbon;
        m.color.setHex(0xffffff);
      } else if (mName === 'Material.006') {
        m.map = texWheelBase;
        m.color.setHex(0xffffff);
      } else if (mName.includes('CRBN_JANTE')) {
        m.map = texWheelRim;
        m.color.setHex(0xffffff);
      } else if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.color.setHex(0xffffff);
      }

      // Apply custom paint color to purple body panels (#4d00b3 / #4d00cc) if specified
      if (customPaintHex !== null && (hex === 0x4d00b3 || hex === 0x4d00cc)) {
        m.color.setHex(customPaintHex);
      }

      // Neon LED accents (#00ff99)
      if (hex === 0x00ff99 && m.emissive) {
        m.emissive.setHex(0x005533);
      }
      // Headlight / taillight strips
      if ((mName === 'Материал.030' || mName === 'Материал.031' || mName === 'Материал.033') && m.emissive) {
        m.emissive.setHex(0xfff1a8);
      }

      // Tinted supercar glass on cabin windows
      if (child.name === 'Vert007' || child.name === 'Vert016' || child.name === 'Vert003') {
        m.color.setHex(0x090d16);
        m.shininess = 140;
      }

      m.needsUpdate = true;
      return m;
    };

    child.material = Array.isArray(child.material)
      ? child.material.map(fixMat)
      : fixMat(child.material);
  });

  // Rig the 4 McLaren P1 GTR 2015 wheel assemblies around their exact hub centers for spinning & front steering!
  supercar.updateMatrixWorld(true);
  const wheelConfigs = [
    { isFront: true,  tire: 'OBJECTS004', spinParts: ['OBJECTS004', 'Окружность', 'Окружность001', 'Цилиндр'],       caliper: 'Object_37' },
    { isFront: true,  tire: 'OBJECTS003', spinParts: ['OBJECTS003', 'Окружность006', 'Окружность007', 'Цилиндр003'], caliper: 'Object_37003' },
    { isFront: false, tire: 'OBJECTS001', spinParts: ['OBJECTS001', 'Окружность002', 'Окружность003', 'Цилиндр001'], caliper: 'Object_37001' },
    { isFront: false, tire: 'OBJECTS002', spinParts: ['OBJECTS002', 'Окружность004', 'Окружность005', 'Цилиндр002'], caliper: 'Object_37002' }
  ];

  const riggedWheels = [];
  wheelConfigs.forEach((cfg) => {
    const tireObj = supercar.getObjectByName(cfg.tire);
    if (!tireObj) return;

    const hubCenter = new THREE.Vector3();
    new THREE.Box3().setFromObject(tireObj).getCenter(hubCenter);

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(hubCenter);
    supercar.add(steerPivot);

    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);
    steerPivot.updateMatrixWorld(true);

    cfg.spinParts.forEach((pName) => {
      const part = supercar.getObjectByName(pName);
      if (part) spinPivot.attach(part);
    });

    const cal = supercar.getObjectByName(cfg.caliper);
    if (cal) steerPivot.attach(cal);

    riggedWheels.push({ spinPivot, steerPivot, isFront: cfg.isFront, spinSign: 1 });
  });

  // Scale McLaren P1 GTR from FBX centimeters to world meters and face -Z (forward)
  supercar.scale.setScalar(0.005);
  supercar.rotation.y = Math.PI;
  supercar.position.set(0, 0.572, 0);

  vObj.mesh.add(supercar);
  vObj.wheels = riggedWheels;
}

const fbxLoader = new FBXLoader(fbxManager);
fbxLoader.load(
  './source/McLaren P1 GTR 2015.fbx',
  (fbx) => {
    // Remove the 3D modeling blueprint reference box ("Референс")
    const toRemove = [];
    fbx.traverse((c) => {
      if (c.name === 'Референс') toRemove.push(c);
    });
    toRemove.forEach((c) => c.parent && c.parent.remove(c));

    // Pass root fbx group so OBJECTS keeps its internal [100,100,100] transform & -90° X rotation
    applyMcLarenModelToVehicle(mclarenMain, fbx, null);   // Original Purple & Carbon P1 GTR
    applyMcLarenModelToVehicle(mclarenAI, fbx, 0x00f0ff); // Cyber Neon P1 GTR
    console.log('McLaren P1 GTR 2015 loaded successfully from ./source and ./textures');
  },
  undefined,
  (err) => console.error('Error loading McLaren P1 GTR 2015.fbx:', err)
);

// ============ 6B. 4K GLB SUPERCAR FLEET LOADER & 4-WHEEL QUADRANT RIGGER ============
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
const carGltfLoader = new GLTFLoader();
carGltfLoader.setDRACOLoader(dracoLoader);
carGltfLoader.setMeshoptDecoder(MeshoptDecoder);

function splitAndRigGlbWheels(vObj, carRoot, wheelTest) {
  vObj.mesh.updateMatrixWorld(true);
  const invVehicleMat = new THREE.Matrix4().copy(vObj.mesh.matrixWorld).invert();

  const buckets = { FL: [], FR: [], RL: [], RR: [] };
  const bounds = {
    FL: new THREE.Box3(),
    FR: new THREE.Box3(),
    RL: new THREE.Box3(),
    RR: new THREE.Box3()
  };

  const matchedMeshes = [];
  carRoot.traverse((child) => {
    if (child.isMesh && child.visible && wheelTest(child)) {
      matchedMeshes.push(child);
    }
  });

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  matchedMeshes.forEach((mesh) => {
    if (!mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const relMat = new THREE.Matrix4().multiplyMatrices(invVehicleMat, mesh.matrixWorld);
    const bb = mesh.geometry.boundingBox.clone().applyMatrix4(relMat);

    const sx = bb.max.x - bb.min.x;
    const sz = bb.max.z - bb.min.z;

    // Fast path: mesh already belongs to a single wheel quadrant (preserves quantized & standard geometries via .attach)
    if (sx < 1.0 && sz < 1.0) {
      const center = new THREE.Vector3();
      bb.getCenter(center);
      const q = (center.z < 0 ? 'F' : 'R') + (center.x < 0 ? 'L' : 'R');
      bounds[q].union(bb);
      buckets[q].push({ attachMesh: mesh });
      return;
    }

    // Quadrant triangle splitter for merged axle/wheel meshes (BMW M3 GTR, Lamborghini Centenario, Porsche 911)
    const baseGeom = mesh.geometry.clone();
    baseGeom.applyMatrix4(relMat);
    mesh.visible = false;

    const pos = baseGeom.attributes.position;
    if (!pos) return;
    const qIndices = { FL: [], FR: [], RL: [], RR: [] };
    const idxAttr = baseGeom.index;
    const triCount = idxAttr ? idxAttr.count : pos.count;

    for (let i = 0; i < triCount; i += 3) {
      const a = idxAttr ? idxAttr.getX(i) : i;
      const b = idxAttr ? idxAttr.getX(i + 1) : i + 1;
      const c = idxAttr ? idxAttr.getX(i + 2) : i + 2;

      vA.fromBufferAttribute(pos, a);
      vB.fromBufferAttribute(pos, b);
      vC.fromBufferAttribute(pos, c);

      const cx = (vA.x + vB.x + vC.x) / 3;
      const cz = (vA.z + vB.z + vC.z) / 3;
      const q = (cz < 0 ? 'F' : 'R') + (cx < 0 ? 'L' : 'R');

      qIndices[q].push(a, b, c);
      bounds[q].expandByPoint(vA);
      bounds[q].expandByPoint(vB);
      bounds[q].expandByPoint(vC);
    }

    for (const q of ['FL', 'FR', 'RL', 'RR']) {
      if (qIndices[q].length > 0) {
        const qGeom = baseGeom.clone();
        qGeom.setIndex(qIndices[q]);
        buckets[q].push({ geom: qGeom, material: mesh.material });
      }
    }
  });

  const riggedWheels = [];
  for (const q of ['FL', 'FR', 'RL', 'RR']) {
    if (buckets[q].length === 0 || bounds[q].isEmpty()) continue;
    const hubCenter = new THREE.Vector3();
    bounds[q].getCenter(hubCenter);

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(hubCenter);
    vObj.mesh.add(steerPivot);

    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);
    vObj.mesh.updateMatrixWorld(true);

    buckets[q].forEach((item) => {
      if (item.attachMesh) {
        spinPivot.attach(item.attachMesh);
      } else {
        const wMesh = new THREE.Mesh(item.geom, item.material);
        wMesh.castShadow = true;
        wMesh.receiveShadow = true;
        wMesh.position.set(-hubCenter.x, -hubCenter.y, -hubCenter.z);
        spinPivot.add(wMesh);
      }
    });

    riggedWheels.push({
      spinPivot,
      steerPivot,
      isFront: q === 'FL' || q === 'FR',
      spinSign: -1
    });
  }

  if (riggedWheels.length > 0) {
    vObj.wheels = riggedWheels;
  }
}

function applyGlbCarModelToVehicle(vObj, templateScene, cfg) {
  // Hide procedural placeholder visuals inside carGroup (keep invisible hit-box for raycasting)
  vObj.mesh.children.forEach((c, idx) => {
    if (idx === 0) {
      c.material = new THREE.MeshBasicMaterial({ visible: false });
    } else {
      c.visible = false;
    }
  });

  const carWrapper = new THREE.Group();
  const carRoot = templateScene.clone(true);
  carWrapper.add(carRoot);

  // Remove/hide studio floors, walls, shadow planes, or display pedestals
  carRoot.traverse((obj) => {
    if (cfg.hideNodeTest && cfg.hideNodeTest(obj)) {
      obj.visible = false;
    }
    if (!obj.isMesh || !obj.visible) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const enhanceMat = (origMat) => {
      if (!origMat) return origMat;
      const m = origMat.clone();
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((tKey) => {
        if (m[tKey]) {
          m[tKey].anisotropy = maxAniso;
          if (tKey === 'map' || tKey === 'emissiveMap') {
            m[tKey].colorSpace = THREE.SRGBColorSpace;
          }
          m[tKey].needsUpdate = true;
        }
      });
      if (cfg.customPaintHex !== undefined && cfg.customPaintHex !== null && cfg.paintMatTest && cfg.paintMatTest(m, obj)) {
        if (m.color) m.color.setHex(cfg.customPaintHex);
      }
      m.needsUpdate = true;
      return m;
    };

    obj.material = Array.isArray(obj.material)
      ? obj.material.map(enhanceMat)
      : enhanceMat(obj.material);
  });

  // Orient the car so its front faces -Z (our forward driving direction)
  carRoot.rotation.y = cfg.rotY || 0;
  carWrapper.updateMatrixWorld(true);

  // Compute exact vertex bounding box of visible car parts to normalize scale & ground contact
  const box = new THREE.Box3();
  const tempPt = new THREE.Vector3();
  carRoot.traverse((child) => {
    if (!child.isMesh || !child.visible) return;
    let p = child.parent;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    const pos = child.geometry && child.geometry.attributes && child.geometry.attributes.position;
    if (!pos) return;
    // Sample vertices for fast, exact bounds
    const step = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += step) {
      tempPt.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      box.expandByPoint(tempPt);
    }
  });

  if (!box.isEmpty()) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const targetLen = cfg.targetLength || 4.65;
    const scaleFactor = targetLen / Math.max(size.z, 0.1);
    carWrapper.scale.setScalar(scaleFactor);
    carWrapper.position.set(
      -center.x * scaleFactor,
      -box.min.y * scaleFactor,
      -center.z * scaleFactor
    );
  }

  vObj.mesh.add(carWrapper);
  splitAndRigGlbWheels(vObj, carRoot, cfg.wheelTest);
}

const carGlbRegistry = [
  {
    url: './cars/aventador_4k.glb',
    rotY: -Math.PI / 2,
    targetLength: 4.78,
    hideNodeTest: (obj) => /Shadow_Plane/i.test(obj.name),
    wheelTest: (mesh) => {
      const n = mesh.name + ' ' + (mesh.parent ? mesh.parent.name : '');
      return /Obj_(Tyre|Rim|DiscRotor|WheelHub)_/i.test(n);
    },
    paintMatTest: (m) => /Mt_Body/i.test(m.name || ''),
    targets: [
      { vehicle: lamboAventador, customPaintHex: null },
      { vehicle: aventadorAI, customPaintHex: 0x22c55e }
    ]
  },
  {
    url: './cars/ferrari_458.glb',
    rotY: 0,
    targetLength: 4.56,
    hideNodeTest: () => false,
    wheelTest: (mesh) => {
      let p = mesh;
      while (p) {
        if (/^wheel_(fl|fr|rl|rr)$/i.test(p.name)) return !/brake/i.test(mesh.name);
        p = p.parent;
      }
      return false;
    },
    paintMatTest: (m, obj) => obj.name === 'body' || /body/i.test(m.name || ''),
    targets: [
      { vehicle: ferrariMain, customPaintHex: 0xdc2626 },
      { vehicle: ferrariAI, customPaintHex: 0xfacc15 }
    ]
  },
  {
    url: './cars/lamborghini_4k.glb',
    rotY: Math.PI,
    targetLength: 4.86,
    hideNodeTest: (obj) => /^(Display_5|Object_28|Object_29|moteur_11|Object_60|Object_61|Object_23|Object_25|<Wheel\.002_3|<Wheel\.004_4)$/.test(obj.name),
    wheelTest: (mesh) => {
      let p = mesh;
      while (p) {
        if (/^<Wheel(_0|\.003_2)$/.test(p.name)) return true;
        p = p.parent;
      }
      return false;
    },
    paintMatTest: (m) => /Body_Colour|Carbon_R/i.test(m.name || ''),
    targets: [
      { vehicle: lamboCentenario, customPaintHex: null }
    ]
  },
  {
    url: './cars/bmw_m3_gtr_4k.glb',
    rotY: Math.PI,
    targetLength: 4.62,
    hideNodeTest: (obj) => /^(Object_4|Object_12|Object_22)$/.test(obj.name),
    wheelTest: (mesh) => /^(Object_5|Object_11|Object_45|Object_46|Object_47|Object_48|Object_54|Object_55)$/.test(mesh.name),
    paintMatTest: (m) => /BMW_M3_GTR/i.test(m.name || ''),
    targets: [
      { vehicle: bmwM3Gtr, customPaintHex: null },
      { vehicle: bmwM3AI, customPaintHex: 0x38bdf8 }
    ]
  },
  {
    url: './cars/porsche_911_4k.glb',
    rotY: Math.PI,
    targetLength: 4.54,
    hideNodeTest: (obj) => /^Plane(_0)?$/.test(obj.name),
    wheelTest: (mesh) => /^Cylinder\.00[01]_[012]$/.test(mesh.name),
    paintMatTest: (m) => /^paint$/i.test(m.name || ''),
    targets: [
      { vehicle: porsche911, customPaintHex: null },
      { vehicle: porscheAI, customPaintHex: 0x0284c7 }
    ]
  },
  {
    url: './cars/bmw_m4_csl.glb',
    rotY: Math.PI,
    targetLength: 4.79,
    hideNodeTest: () => false,
    wheelTest: (mesh) => {
      let p = mesh;
      while (p) {
        if (/^(M4xNME_wheels_enkeif|Object_4\.00[1234]|amdb11_brakedisc_FR\.00[1234])/.test(p.name)) {
          return !/caliper/i.test(mesh.name);
        }
        p = p.parent;
      }
      return false;
    },
    paintMatTest: (m) => /M4xNME_Paint$/i.test(m.name || ''),
    targets: [
      { vehicle: bmwM4Csl, customPaintHex: null }
    ]
  }
];

carGlbRegistry.forEach((entry) => {
  carGltfLoader.load(
    entry.url,
    (gltf) => {
      entry.targets.forEach((t) => {
        applyGlbCarModelToVehicle(t.vehicle, gltf.scene, {
          ...entry,
          customPaintHex: t.customPaintHex
        });
      });
      console.log(`Loaded 4K car model: ${entry.url}`);
    },
    undefined,
    (err) => console.error(`Error loading ${entry.url}:`, err)
  );
});

// ============ 7. PATROL DRONES across the City ============
const drones = [];
for (let i = 0; i < 10; i++) {
  const dGroup = new THREE.Group();
  const dCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.2 })
  );
  dGroup.add(dCore);
  const dEye = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xf43f5e })
  );
  dEye.position.set(0, 0, 0.34);
  dGroup.add(dEye);

  const rx = roadXCoords[(i % 5) + 1];
  const rz = -70 + i * 16;
  dGroup.position.set(rx + (i % 2 === 0 ? -3 : 3), 3.3 + (i % 2) * 0.9, rz);
  dGroup.userData = {
    type: 'drone', hp: 3, alive: true, hacked: false,
    baseX: dGroup.position.x, baseY: dGroup.position.y, baseZ: dGroup.position.z,
    phase: i * 1.3, eyeMesh: dEye
  };
  dCore.userData.parentGroup = dGroup;
  scene.add(dGroup);
  drones.push(dGroup);
  shootables.push(dCore);
}

// ============ 8. INTIMIDATING PROTAGONIST ("GHOST-01" SPEC-OPS ENFORCER) ============
let mixer, model, actions = {}, currentAction;
const character = new THREE.Group();
character.position.set(0, 0, 22);
scene.add(character);

const rigBones = {};
let rifleGroup, muzzleFlashMesh, muzzleLight, laserLine, laserDot, visorMaterial;

function createTacticalRifle() {
  const gun = new THREE.Group();
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.88, roughness: 0.25 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: 0x27272a, metalness: 0.7, roughness: 0.4 });
  const redGlow = new THREE.MeshBasicMaterial({ color: 0xf43f5e });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(4.2, 34, 8.5), gunMetal);
  receiver.position.set(0, 14, 3);
  gun.add(receiver);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(3.6, 26, 6.2), gunAccent);
  guard.position.set(0, 38, 3.5);
  gun.add(guard);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 28, 12), gunMetal);
  barrel.position.set(0, 56, 4.5);
  gun.add(barrel);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(3.0, 8, 18), gunAccent);
  mag.position.set(0, 22, -6);
  mag.rotation.x = 0.25;
  gun.add(mag);

  const holo = new THREE.Mesh(new THREE.BoxGeometry(3.4, 8, 4.5), gunAccent);
  holo.position.set(0, 18, 9.2);
  gun.add(holo);

  const holoLens = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 3.2), redGlow);
  holoLens.position.set(0, 21, 9.8);
  gun.add(holoLens);

  const flashGeo = new THREE.ConeGeometry(5.5, 18, 8);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.9 });
  muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
  muzzleFlashMesh.position.set(0, 76, 4.5);
  muzzleFlashMesh.visible = false;
  gun.add(muzzleFlashMesh);

  return gun;
}

function createBackRig() {
  const pack = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.85, roughness: 0.25 });
  const coreGlow = new THREE.MeshBasicMaterial({ color: 0xf43f5e });

  const body = new THREE.Mesh(new THREE.BoxGeometry(22, 28, 9), armorMat);
  body.position.set(0, 4, -14);
  pack.add(body);

  for (let y of [-4, 4, 12]) {
    const cell = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 2), coreGlow);
    cell.position.set(0, y, -18.2);
    pack.add(cell);
  }
  return pack;
}

const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
laserLine = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xf43f5e }));
laserLine.frustumCulled = false;
laserLine.visible = false;
scene.add(laserLine);

laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xf43f5e }));
laserDot.visible = false;
scene.add(laserDot);

muzzleLight = new THREE.PointLight(0xff9922, 0, 10);
scene.add(muzzleLight);

const gltfLoader = new GLTFLoader();
const loadBar = document.querySelector('#loadbar > div');

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, (xhr) => {
      if (xhr.lengthComputable) {
        loadBar.style.width = Math.round((xhr.loaded / xhr.total) * 100) + '%';
      }
    }, reject);
  });
}

async function initEnforcer() {
  try {
    let gltf;
    try {
      gltf = await loadGLB('soldier.glb');
    } catch (e) {
      gltf = await loadGLB('https://threejs.org/examples/models/gltf/Soldier.glb');
    }

    model = gltf.scene;
    model.scale.set(1.12, 1.12, 1.12);
    model.position.set(0, 0, 0);

    model.traverse((obj) => {
      if (obj.isBone) rigBones[obj.name] = obj;
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          const mat = obj.material.clone();
          if (obj.name.toLowerCase().includes('visor')) {
            mat.color.setHex(0x1a0004);
            mat.emissive = new THREE.Color(0xf43f5e);
            mat.emissiveIntensity = 2.4;
            visorMaterial = mat;
          } else {
            mat.color.setHex(0x3f4452);
            mat.roughness = 0.42;
            mat.metalness = 0.65;
          }
          obj.material = mat;
        }
      }
    });

    if (rigBones['mixamorig:RightHand']) {
      rifleGroup = createTacticalRifle();
      rigBones['mixamorig:RightHand'].add(rifleGroup);
    }
    if (rigBones['mixamorig:Spine2']) {
      rigBones['mixamorig:Spine2'].add(createBackRig());
    }

    character.add(model);
    mixer = new THREE.AnimationMixer(model);

    gltf.animations.forEach((clip) => {
      actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
    });

    if (actions['idle']) {
      actions['idle'].play();
      currentAction = actions['idle'];
    }

    loadBar.style.width = '100%';
    setTimeout(() => {
      document.getElementById('loader').classList.add('hidden');
    }, 250);
  } catch (err) {
    console.error('Error cargando soldier.glb:', err);
  }
}
initEnforcer();

function fadeToAction(name, duration = 0.22) {
  const next = actions[name];
  if (!next || currentAction === next) return;
  if (currentAction) currentAction.fadeOut(duration);
  next.reset().fadeIn(duration).play();
  currentAction = next;
}

// ============ 9. MOUSE CAMERA ROTATION, DRIVING & COMBAT CONTROLS ============
const keys = {};
let isAiming = false;
let isFiring = false;
let activeVehicle = null; // Currently driven vehicle object
let aimBlend = 0;
let recoilAmount = 0;
let fireCooldown = 0;
let magAmmo = 30;
let isReloading = false;
let cash = 45000;
let wantedLevel = 0;
let killsCount = 0;
let baseCamDistance = 5.5;
let currentCamDist = 5.5;
let camYaw = 0;         // Horizontal rotation angle (unlimited 360°)
let camPitch = -0.12;   // Vertical look angle (-1.38 rad down to +1.38 rad high up into the sky!)
let invertMouseX = false; // Mouse Right -> Look Right, Mouse Left -> Look Left (press [I] to toggle)
const camPivot = new THREE.Vector3(0, 1.55, 22);
let lastMouseX = null;
let lastMouseY = null;

const crosshairEl = document.getElementById('crosshair');
const promptBox = document.getElementById('prompt-box');

function setAiming(state) {
  if (activeVehicle) state = false;
  isAiming = state;
  crosshairEl.classList.toggle('aiming', isAiming);
  updateKeyUI('q', isAiming);
}

window.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  }
  if (e.button === 2) {
    setAiming(true);
  } else if (e.button === 0 && !activeVehicle) {
    isFiring = true;
    updateKeyUI('f', true);
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2) {
    setAiming(false);
    isFiring = false;
  } else if (e.button === 0) {
    isFiring = false;
    updateKeyUI('f', false);
  }
});

// Free 360° + Full Vertical Pitch Mouse Look (No horizon lock!)
window.addEventListener('mousemove', (e) => {
  let dx = e.movementX;
  let dy = e.movementY;

  if (document.pointerLockElement !== renderer.domElement) {
    if (lastMouseX !== null && lastMouseY !== null) {
      dx = e.clientX - lastMouseX;
      dy = e.clientY - lastMouseY;
    } else {
      dx = 0; dy = 0;
    }
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  } else {
    lastMouseX = null;
    lastMouseY = null;
  }

  if (!dx && !dy) return;

  const sensitivity = isAiming ? 0.0026 : 0.0042;
  // Inverted axes:
  // - Moving mouse UP (dy < 0) increases camPitch -> looks UP toward the sky (+80° without blocking!)
  // - Moving mouse DOWN (dy > 0) decreases camPitch -> looks DOWN toward the street
  // - Horizontal axis inverted relative to previous (toggleable anytime with [I])
  const xSign = invertMouseX ? -1 : 1;
  camYaw += dx * sensitivity * xSign;
  camPitch = THREE.MathUtils.clamp(camPitch - dy * sensitivity, -1.38, 1.38);
});

window.addEventListener('wheel', (e) => {
  baseCamDistance = Math.max(2.2, Math.min(12.0, baseCamDistance + e.deltaY * 0.004));
});

window.addEventListener('keydown', (e) => {
  const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  keys[k] = true;
  updateKeyUI(k, true);

  if (k === 'q' && !e.repeat) setAiming(!isAiming);
  if (k === 'f' && !activeVehicle) isFiring = true;
  if (k === 'r' && !isReloading && magAmmo < 30) reloadWeapon();
  if (k === 'e' && !e.repeat) triggerCrossingAndHack();
  if (k === 'g' && !e.repeat) toggleVehicle();
  if (k === 'i' && !e.repeat) invertMouseX = !invertMouseX;
});

window.addEventListener('keyup', (e) => {
  const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
  keys[k] = false;
  updateKeyUI(k, false);
  if (k === 'f') isFiring = false;
});

function updateKeyUI(k, pressed) {
  const el = document.querySelector(`.key[data-k="${k}"]`);
  if (el) el.classList.toggle('active', pressed);
}

// Find nearest vehicle for GTA hijacking/driving
function findNearestVehicle() {
  let closest = null;
  let minDist = 5.0;
  vehicles.forEach(v => {
    const d = character.position.distanceTo(v.mesh.position);
    if (d < minDist) {
      minDist = d;
      closest = v;
    }
  });
  return closest;
}

function toggleVehicle() {
  if (!activeVehicle) {
    const nearCar = findNearestVehicle();
    if (nearCar) {
      activeVehicle = nearCar;
      activeVehicle.isAI = false;
      activeVehicle.speed = 0;
      setAiming(false);
      character.visible = false;
      document.getElementById('weapon-name').textContent = activeVehicle.name;
      updateStateBadge('drive');
    }
  } else {
    character.position.copy(activeVehicle.mesh.position).add(new THREE.Vector3(-2.0, 0, 0));
    character.visible = true;
    activeVehicle = null;
    document.getElementById('weapon-name').textContent = 'VX-47 SPEC-OPS CARBINE';
    updateStateBadge('idle');
  }
}

function triggerCrossingAndHack() {
  crossingClosed = !crossingClosed;
  if (crossingClosed) trainRelX = -135;
  updateStateBadge('hack');
  if (visorMaterial) visorMaterial.emissive.setHex(0x00f0ff);

  drones.forEach((d) => {
    if (d.userData.alive && d.position.distanceTo(character.position) < 42) {
      d.userData.hacked = true;
      d.userData.eyeMesh.material.color.setHex(0x00f0ff);
      spawnExplosion(d.position.clone(), 0x00f0ff);
      addWantedAndCash(1000);
    }
  });

  setTimeout(() => {
    if (visorMaterial) visorMaterial.emissive.setHex(0xf43f5e);
  }, 2000);
}

function reloadWeapon() {
  isReloading = true;
  document.getElementById('magAmmo').textContent = 'REC...';
  setTimeout(() => {
    magAmmo = 30;
    isReloading = false;
    document.getElementById('magAmmo').textContent = magAmmo;
  }, 1000);
}

function addWantedAndCash(bounty) {
  cash += bounty;
  document.getElementById('cash-display').textContent = '$' + cash.toLocaleString();
  killsCount++;
  document.getElementById('sDist').textContent = killsCount + ' bajas';

  wantedLevel = Math.min(5, Math.floor((killsCount + 1) / 2));
  const stars = document.querySelectorAll('#wanted-stars .star');
  stars.forEach((s, idx) => {
    s.classList.toggle('active', idx < wantedLevel);
    s.classList.toggle('flashing', wantedLevel >= 3 && idx < wantedLevel);
  });
}

const activeEffects = [];
function spawnTracerAndSparks(startPos, endPos) {
  const geo = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfde047 }));
  scene.add(line);
  activeEffects.push({ mesh: line, life: 0.07, maxLife: 0.07 });

  for (let i = 0; i < 6; i++) {
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xfbbf24 : 0xf43f5e })
    );
    spark.position.copy(endPos);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
    scene.add(spark);
    activeEffects.push({ mesh: spark, vel, gravity: -15, life: 0.35, maxLife: 0.35 });
  }
}

function spawnExplosion(pos, colorHex = 0xf97316) {
  for (let i = 0; i < 16; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? colorHex : 0xfde047 })
    );
    frag.position.copy(pos);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 11, 3 + Math.random() * 7, (Math.random() - 0.5) * 11);
    scene.add(frag);
    activeEffects.push({ mesh: frag, vel, gravity: -18, life: 0.65, maxLife: 0.65 });
  }
}

const raycaster = new THREE.Raycaster();
function fireWeapon() {
  if (isReloading || magAmmo <= 0) {
    if (magAmmo <= 0 && !isReloading) reloadWeapon();
    return;
  }
  magAmmo--;
  document.getElementById('magAmmo').textContent = magAmmo;
  recoilAmount = 1.0;

  const muzzlePos = new THREE.Vector3();
  if (muzzleFlashMesh) {
    muzzleFlashMesh.getWorldPosition(muzzlePos);
    muzzleFlashMesh.visible = true;
  } else {
    muzzlePos.copy(character.position).add(new THREE.Vector3(0, 1.45, 0));
  }
  muzzleLight.position.copy(muzzlePos);
  muzzleLight.intensity = 4.0;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects([baseGround, ...shootables], false);
  const hitPoint = new THREE.Vector3();

  if (hits.length > 0) {
    hitPoint.copy(hits[0].point);
    const obj = hits[0].object;
    const targetData = obj.userData.parentGroup ? obj.userData.parentGroup.userData : obj.userData;
    if (targetData && targetData.alive) {
      targetData.hp--;
      if (targetData.hp <= 0) {
        targetData.alive = false;
        const targetMesh = obj.userData.parentGroup || obj;
        spawnExplosion(targetMesh.position.clone(), 0xf43f5e);
        if (obj.userData.type !== 'vehicle') targetMesh.visible = false;
        addWantedAndCash(1500);
      }
    }
  } else {
    raycaster.ray.at(65, hitPoint);
  }
  spawnTracerAndSparks(muzzlePos, hitPoint);
}

// High-Precision Collision Engine (Buildings, Multi-Point Vehicle OBB, & Vehicle-to-Vehicle/Player)
function resolveBuildingCollision(pos, radius = 0.55) {
  let hit = false;
  for (const chunk of activeChunks.values()) {
    const cols = chunk.colliders;
    for (let i = 0; i < cols.length; i++) {
      const b = cols[i];
      if (pos.x + radius > b.minX && pos.x - radius < b.maxX &&
          pos.z + radius > b.minZ && pos.z - radius < b.maxZ) {
        const dLeft = (pos.x + radius) - b.minX;
        const dRight = b.maxX - (pos.x - radius);
        const dTop = (pos.z + radius) - b.minZ;
        const dBottom = b.maxZ - (pos.z - radius);
        const minOverlap = Math.min(dLeft, dRight, dTop, dBottom);
        if (minOverlap === dLeft) pos.x -= dLeft;
        else if (minOverlap === dRight) pos.x += dRight;
        else if (minOverlap === dTop) pos.z -= dTop;
        else pos.z += dBottom;
        hit = true;
      }
    }
  }
  return hit;
}

// Multi-Point Oriented Bounding Box (OBB) Collision for Vehicles against Buildings & Other Cars
const carSampleOffsets = [
  new THREE.Vector3( 0.0,  0,  0.0),  // Center
  new THREE.Vector3(-0.98, 0, -2.2),  // Front-Left Bumper
  new THREE.Vector3( 0.98, 0, -2.2),  // Front-Right Bumper
  new THREE.Vector3(-0.98, 0,  2.2),  // Rear-Left Bumper
  new THREE.Vector3( 0.98, 0,  2.2)   // Rear-Right Bumper
];

function resolveVehiclePhysicsCollisions(car) {
  const pos = car.mesh.position;
  const rotY = car.mesh.rotation.y;
  const upAxis = new THREE.Vector3(0, 1, 0);
  let wallHit = false;

  // 1) Test all 5 OBB points of the car against active city building blocks
  for (let s = 0; s < carSampleOffsets.length; s++) {
    const worldPt = carSampleOffsets[s].clone().applyAxisAngle(upAxis, rotY).add(pos);
    const beforeX = worldPt.x, beforeZ = worldPt.z;
    if (resolveBuildingCollision(worldPt, 0.32)) {
      pos.x += (worldPt.x - beforeX);
      pos.z += (worldPt.z - beforeZ);
      wallHit = true;
    }
  }

  // 2) Vehicle-to-Vehicle Collisions
  vehicles.forEach((other) => {
    if (other === car) return;
    const dx = pos.x - other.mesh.position.x;
    const dz = pos.z - other.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = 3.1;
    if (distSq < minDist * minDist && distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const overlap = minDist - dist;
      const nx = dx / dist;
      const nz = dz / dist;
      if (other.isAI && other !== activeVehicle) {
        pos.x += nx * overlap;
        pos.z += nz * overlap;
      } else {
        pos.x += nx * overlap * 0.65;
        pos.z += nz * overlap * 0.65;
        other.mesh.position.x -= nx * overlap * 0.35;
        other.mesh.position.z -= nz * overlap * 0.35;
      }
      wallHit = true;
    }
  });

  if (wallHit && Math.abs(car.speed) > 6.0) {
    car.speed *= 0.45; //Realistic impact damping on collision
  }
}

// Prevent Player on foot from walking through parked or moving vehicles
function resolvePlayerVehicleCollisions(playerPos) {
  const upAxis = new THREE.Vector3(0, 1, 0);
  vehicles.forEach((v) => {
    const rel = playerPos.clone().sub(v.mesh.position).applyAxisAngle(upAxis, -v.mesh.rotation.y);
    const halfW = 1.32, halfL = 2.62;
    if (Math.abs(rel.x) < halfW && Math.abs(rel.z) < halfL) {
      const ox = halfW - Math.abs(rel.x);
      const oz = halfL - Math.abs(rel.z);
      if (ox < oz) rel.x = Math.sign(rel.x || 1) * halfW;
      else rel.z = Math.sign(rel.z || 1) * halfL;
      rel.applyAxisAngle(upAxis, v.mesh.rotation.y).add(v.mesh.position);
      playerPos.x = rel.x;
      playerPos.z = rel.z;
    }
  });
}

function updateDistrictTitle(pos) {
  const el = document.getElementById('districtName');
  if (Math.abs(pos.z - crossingZ) < 11) {
    el.textContent = 'PASO FERROVIARIO SHINJUKU';
    return;
  }
  const cx = Math.round(pos.x / SECTOR_W);
  const cz = Math.round(pos.z / SECTOR_D);
  const biome = getChunkBiome(cx, cz);
  const names = {
    PARK: 'PARQUE IMPERIAL YOYOGI',
    FINANCIAL_DOWNTOWN: 'DISTRITO FINANCIERO TOKYO',
    NEON_SHIBUYA: 'DISTRITO NEÓN SHIBUYA',
    SAKURA_RESIDENTIAL: 'DISTRITO RESIDENCIAL SAKURA'
  };
  el.textContent = names[biome] || 'DISTRITO CENTRAL TOKYO';
}

// ============ 10. MOVEMENT, DRIVING & PROCEDURAL COMBAT RIG ============
const velocity = new THREE.Vector3();
const moveDir = new THREE.Vector3();
let stamina = 100;
let currentState = 'idle';
let isJumping = false;
let jumpVelocity = 0;

const qRightArmAim = new THREE.Quaternion(0.22, 0.15, 0.45, 0.85).normalize();
const qRightForeArmAim = new THREE.Quaternion(0.55, 0.05, 0.05, 0.83).normalize();
const qLeftArmAim = new THREE.Quaternion(0.28, -0.22, -0.42, 0.83).normalize();
const qLeftForeArmAim = new THREE.Quaternion(0.52, -0.1, -0.08, 0.84).normalize();

function updateCamera(delta, rightVec) {
  const targetPivot = activeVehicle
    ? activeVehicle.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0))
    : character.position.clone().add(new THREE.Vector3(0, 1.55, 0)).add(rightVec.clone().multiplyScalar(isAiming ? 0.55 : 0));

  camPivot.lerp(targetPivot, Math.min(1, 15 * delta));

  const targetDist = activeVehicle ? 7.4 : (isAiming ? 2.45 : baseCamDistance);
  currentCamDist = THREE.MathUtils.lerp(currentCamDist, targetDist, Math.min(1, 10 * delta));

  const lookDir = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    -Math.cos(camYaw) * Math.cos(camPitch)
  ).normalize();

  // Pull camera slightly closer when looking high up so it stays above the asphalt without blocking upward pitch
  const upFactor = Math.max(0, Math.sin(camPitch));
  const effectiveDist = currentCamDist * (1.0 - upFactor * 0.42);

  const camPos = camPivot.clone().addScaledVector(lookDir, -effectiveDist);
  if (camPos.y < 0.42) camPos.y = 0.42;

  camera.position.copy(camPos);
  camera.lookAt(camPos.clone().addScaledVector(lookDir, 50));
}

function updateMovement(delta) {
  if (!model) return;

  updateWorldChunks(character.position);
  updateDistrictTitle(character.position);

  const nearCar = findNearestVehicle();
  if (!activeVehicle && nearCar) {
    promptBox.innerHTML = `Presiona <b>[G]</b> para conducir <b>${nearCar.name}</b>`;
    promptBox.classList.add('visible');
  } else {
    promptBox.classList.remove('visible');
  }

  const forward = new THREE.Vector3(Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  if (activeVehicle) {
    const car = activeVehicle;
    const accelInput = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
    const steerInput = (keys['a'] ? 1 : 0) - (keys['d'] ? 1 : 0);
    const topSpeed = keys['shift'] ? car.maxSpeed * 1.35 : car.maxSpeed;

    if (accelInput !== 0) {
      car.speed = THREE.MathUtils.lerp(car.speed, accelInput * topSpeed, 3.8 * delta);
    } else {
      car.speed = THREE.MathUtils.lerp(car.speed, 0, 5.0 * delta);
    }

    if (Math.abs(car.speed) > 0.3) {
      car.mesh.rotation.y += steerInput * 2.1 * delta * Math.sign(car.speed);
    }

    // Smooth front-wheel steering angle (up to ~26 degrees left/right when pressing A / D)
    car.steerAngle = THREE.MathUtils.lerp(car.steerAngle || 0, steerInput * 0.46, Math.min(1, 11 * delta));

    const carForward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.mesh.rotation.y);
    car.mesh.position.addScaledVector(carForward, car.speed * delta);
    resolveVehiclePhysicsCollisions(car);

    character.position.copy(car.mesh.position);
    updateWorldChunks(character.position);
    updateCamera(delta, right);

    car.wheels.forEach((w) => {
      w.spinPivot.rotation.x += w.spinSign * car.speed * delta * 2.8;
      if (w.isFront) w.steerPivot.rotation.y = car.steerAngle;
    });
    document.getElementById('sSpeed').textContent = Math.abs(car.speed).toFixed(1) + ' m/s';
    return;
  }

  // On-Foot Movement
  moveDir.set(0, 0, 0);
  if (keys['w']) moveDir.add(forward);
  if (keys['s']) moveDir.sub(forward);
  if (keys['d']) moveDir.add(right);
  if (keys['a']) moveDir.sub(right);

  const isMoving = moveDir.lengthSq() > 0;
  const isRunning = keys['shift'] && isMoving && !isAiming && stamina > 0;

  let targetSpeed = 0;
  if (isMoving) targetSpeed = isAiming ? 3.2 : (isRunning ? 8.5 : 4.4);

  if (isMoving) moveDir.normalize();
  velocity.lerp(moveDir.clone().multiplyScalar(targetSpeed), Math.min(1, 13 * delta));

  character.position.addScaledVector(velocity, delta);
  resolveBuildingCollision(character.position, 0.58);
  resolvePlayerVehicleCollisions(character.position);

  updateCamera(delta, right);

  if (isAiming || isFiring) {
    const aimAngle = Math.atan2(-forward.x, -forward.z);
    let diff = aimAngle - model.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    model.rotation.y += diff * Math.min(1, 18 * delta);
  } else if (velocity.lengthSq() > 0.02) {
    const moveAngle = Math.atan2(-velocity.x, -velocity.z);
    let diff = moveAngle - model.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    model.rotation.y += diff * Math.min(1, 11 * delta);
  }

  if (isRunning) stamina = Math.max(0, stamina - 16 * delta);
  else stamina = Math.min(100, stamina + 14 * delta);
  document.getElementById('stam-fill').style.width = stamina + '%';

  if (keys['space'] && !isJumping && character.position.y <= 0.01) {
    isJumping = true;
    jumpVelocity = 7.8;
  }
  if (isJumping) {
    character.position.y += jumpVelocity * delta;
    jumpVelocity += -19 * delta;
    if (character.position.y <= 0) {
      character.position.y = 0;
      isJumping = false;
      jumpVelocity = 0;
    }
  }

  let animState = 'idle';
  if (isMoving) animState = isRunning ? 'run' : 'walk';
  if (animState !== currentState) {
    fadeToAction(animState);
    currentState = animState;
  }

  if (isAiming || isFiring) updateStateBadge('aim');
  else if (isJumping) updateStateBadge('jump');
  else updateStateBadge(animState);

  document.getElementById('sSpeed').textContent = velocity.length().toFixed(1) + ' m/s';
}

function applyProceduralCombatPose(delta) {
  const targetAim = (!activeVehicle && (isAiming || isFiring)) ? 1.0 : 0.0;
  aimBlend = THREE.MathUtils.lerp(aimBlend, targetAim, Math.min(1, 14 * delta));
  recoilAmount = Math.max(0, recoilAmount - 8 * delta);

  if (aimBlend > 0.01 && rigBones['mixamorig:RightArm'] && rigBones['mixamorig:RightForeArm']) {
    rigBones['mixamorig:RightArm'].quaternion.slerp(qRightArmAim, aimBlend);
    rigBones['mixamorig:RightForeArm'].quaternion.slerp(qRightForeArmAim, aimBlend);
    if (rigBones['mixamorig:LeftArm'] && rigBones['mixamorig:LeftForeArm']) {
      rigBones['mixamorig:LeftArm'].quaternion.slerp(qLeftArmAim, aimBlend * 0.85);
      rigBones['mixamorig:LeftForeArm'].quaternion.slerp(qLeftForeArmAim, aimBlend * 0.85);
    }
    if (recoilAmount > 0) {
      rigBones['mixamorig:RightForeArm'].rotateX(recoilAmount * 0.14);
    }
  }

  if (aimBlend > 0.5 && muzzleFlashMesh) {
    const start = new THREE.Vector3();
    muzzleFlashMesh.getWorldPosition(start);
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects([baseGround, ...shootables], false);
    const end = new THREE.Vector3();
    if (hits.length > 0) end.copy(hits[0].point);
    else raycaster.ray.at(45, end);

    const posAttr = laserLine.geometry.attributes.position;
    posAttr.setXYZ(0, start.x, start.y, start.z);
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;
    laserLine.visible = true;
    laserDot.position.copy(end);
    laserDot.visible = true;
  } else {
    laserLine.visible = false;
    laserDot.visible = false;
  }
}

function updateStateBadge(state) {
  const badge = document.getElementById('stateBadge');
  const labels = {
    idle: 'EXPLORACIÓN',
    walk: 'PATRULLA URBANA',
    run: 'SPRINT TÁCTICO',
    jump: 'SALTO',
    aim: 'APUNTANDO // FUEGO',
    drive: 'CONDUCIENDO',
    hack: 'HACKEO ctOS'
  };
  badge.className = 'state-badge state-' + state;
  badge.textContent = labels[state] || state.toUpperCase();
}

// ============ 11. INFINITE CHUNK MINIMAP RADAR ============
const mapCanvas = document.getElementById('mapCanvas');
const mapCtx = mapCanvas.getContext('2d');

function drawMinimap() {
  const w = 195, h = 195, cx = w / 2, cy = h / 2;
  const scale = activeVehicle ? 0.65 : 0.95;
  mapCtx.clearRect(0, 0, w, h);

  // Draw Real 3D City Sectors, Avenues & Building Blocks on Radar
  for (const chunk of activeChunks.values()) {
    const ox = chunk.cx * SECTOR_W;
    const oz = chunk.cz * SECTOR_D;
    mapCtx.fillStyle = 'rgba(100, 116, 139, 0.38)';
    for (let aveX of [-61.0, 0.0, 83.0]) {
      const sx = cx + (ox + aveX - character.position.x) * scale;
      const sz = cy + (oz - 68 - character.position.z) * scale;
      mapCtx.fillRect(sx - (roadWidth * scale) / 2, sz, roadWidth * scale, SECTOR_D * scale);
    }
    for (let aveZ of [2.5, 62.5]) {
      const sx = cx + (ox - 155 - character.position.x) * scale;
      const sz = cy + (oz + aveZ - character.position.z) * scale;
      mapCtx.fillRect(sx, sz - (roadWidth * scale) / 2, SECTOR_W * scale, roadWidth * scale);
    }

    for (let i = 0; i < chunk.radarItems.length; i++) {
      const b = chunk.radarItems[i];
      const bx = cx + (b.x - character.position.x) * scale;
      const bz = cy + (b.z - character.position.z) * scale;
      mapCtx.fillStyle = 'rgba(148, 163, 184, 0.58)';
      mapCtx.fillRect(bx - (b.w * scale) / 2, bz - (b.d * scale) / 2, b.w * scale, b.d * scale);
    }
  }

  // Railway Line
  const railZ = cy + (crossingZ - character.position.z) * scale;
  mapCtx.strokeStyle = '#f59e0b';
  mapCtx.lineWidth = 2;
  mapCtx.beginPath(); mapCtx.moveTo(0, railZ); mapCtx.lineTo(w, railZ); mapCtx.stroke();

  // All Vehicles on Radar
  vehicles.forEach(v => {
    const vx = cx + (v.mesh.position.x - character.position.x) * scale;
    const vz = cy + (v.mesh.position.z - character.position.z) * scale;
    mapCtx.fillStyle = v.isPolice ? '#38bdf8' : '#4ade80';
    mapCtx.fillRect(vx - 3, vz - 4, 6, 8);
  });

  // Drones
  drones.forEach(d => {
    if (!d.userData.alive) return;
    const dx = cx + (d.position.x - character.position.x) * scale;
    const dz = cy + (d.position.z - character.position.z) * scale;
    mapCtx.fillStyle = d.userData.hacked ? '#00f0ff' : '#f43f5e';
    mapCtx.beginPath(); mapCtx.arc(dx, dz, 3.2, 0, Math.PI * 2); mapCtx.fill();
  });

  // Player Arrow
  mapCtx.save();
  mapCtx.translate(cx, cy);
  const rot = activeVehicle ? -activeVehicle.mesh.rotation.y : (model ? -model.rotation.y : 0);
  mapCtx.rotate(rot);
  mapCtx.fillStyle = '#ffffff';
  mapCtx.beginPath();
  mapCtx.moveTo(0, -7); mapCtx.lineTo(-5, 5); mapCtx.lineTo(0, 2); mapCtx.lineTo(5, 5);
  mapCtx.closePath(); mapCtx.fill();
  mapCtx.restore();
}

// ============ 12. MAIN GAME LOOP ============
let frames = 0, lastFpsTime = performance.now();
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (mixer && !activeVehicle) mixer.update(delta);
  updateMovement(delta);
  applyProceduralCombatPose(delta);

  // AI Traffic Vehicles Cruising on Exact Asphalt Lanes & Wrapping Around Active City Sectors
  const spanZ = SECTOR_D;
  const curSectorOx = Math.round(character.position.x / SECTOR_W) * SECTOR_W;
  vehicles.forEach((v) => {
    if (!v.isAI || v === activeVehicle) return;

    // 1) Active Asphalt Lane-Keeping (locks AI car to its exact road lane center in the current sector)
    const targetLaneX = curSectorOx + v.aiLaneX;
    v.mesh.position.x = THREE.MathUtils.lerp(v.mesh.position.x, targetLaneX, Math.min(1, 10 * delta));
    v.mesh.rotation.y = v.aiRotY;

    // 2) Forward Traffic Radar (stop for railway crossing, player, or other vehicles ahead in lane)
    const distToCrossing = Math.abs(v.mesh.position.z - crossingZ);
    let shouldStop = crossingClosed && distToCrossing < 9.5 && distToCrossing > 3.5;

    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.mesh.rotation.y);
    if (!shouldStop) {
      for (let i = 0; i < vehicles.length; i++) {
        const other = vehicles[i];
        if (other === v) continue;
        const lat = Math.abs(other.mesh.position.x - v.mesh.position.x);
        if (lat < 2.2) {
          const fwd = (other.mesh.position.z - v.mesh.position.z) * dir.z;
          if (fwd > 0 && fwd < 11.5) {
            shouldStop = true;
            break;
          }
        }
      }
      if (!shouldStop && !activeVehicle) {
        const latP = Math.abs(character.position.x - v.mesh.position.x);
        const fwdP = (character.position.z - v.mesh.position.z) * dir.z;
        if (latP < 1.8 && fwdP > 0 && fwdP < 8.5) shouldStop = true;
      }
    }

    const targetSpd = shouldStop ? 0 : (v.baseAiSpeed || 11.5);
    v.speed = THREE.MathUtils.lerp(v.speed, targetSpd, Math.min(1, 8 * delta));

    v.mesh.position.addScaledVector(dir, v.speed * delta);
    v.wheels.forEach((w) => {
      w.spinPivot.rotation.x += w.spinSign * v.speed * delta * 2.8;
    });

    // Keep AI traffic cruising within the active 3D city sectors around the player
    if (v.mesh.position.z - character.position.z < -spanZ) v.mesh.position.z += spanZ * 2;
    if (v.mesh.position.z - character.position.z > spanZ) v.mesh.position.z -= spanZ * 2;
  });

  // Animate Railway Crossing Barriers & Lights across all active railway chunks
  const targetBarrierRot = crossingClosed ? 0 : (Math.PI / 2.2);
  const flashPhase = Math.floor(t * 3.5) % 2;
  for (const chunk of activeChunks.values()) {
    chunk.barrierArms.forEach(({ pivot, side }) => {
      const desired = side === -1 ? -targetBarrierRot : targetBarrierRot;
      pivot.rotation.z = THREE.MathUtils.lerp(pivot.rotation.z, desired, 4 * delta);
    });
    chunk.crossingLights.forEach((lens, idx) => {
      const isLit = crossingClosed && (idx % 2 === flashPhase);
      lens.material.color.setHex(isLit ? 0xff1e32 : 0x3b070c);
    });
  }

  const baseTrainOriginX = Math.round(character.position.x / SECTOR_W) * SECTOR_W;
  if (crossingClosed) {
    trainRelX += 34 * delta;
    trainGroup.position.x = baseTrainOriginX + trainRelX;
    if (trainRelX > 165) {
      crossingClosed = false;
    }
  } else {
    trainPassTimer += delta;
    if (trainPassTimer > 16) {
      trainPassTimer = 0;
      crossingClosed = true;
      trainRelX = -165;
      trainGroup.position.x = baseTrainOriginX + trainRelX;
    }
  }

  // Weapon firing
  if (muzzleLight.intensity > 0) {
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 45 * delta);
    if (muzzleLight.intensity < 0.5 && muzzleFlashMesh) muzzleFlashMesh.visible = false;
  }
  fireCooldown = Math.max(0, fireCooldown - delta);
  if (isFiring && fireCooldown <= 0) {
    fireWeapon();
    fireCooldown = 0.11;
  }

  // Patrol Drones
  drones.forEach((d, idx) => {
    if (!d.userData.alive) return;
    d.position.x = d.userData.baseX + Math.sin(t * 1.4 + d.userData.phase) * 3.0;
    d.position.y = d.userData.baseY + Math.cos(t * 2.2 + idx) * 0.35;
    d.lookAt(character.position.x, d.position.y, character.position.z);
  });

  // Active particle effects
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const fx = activeEffects[i];
    fx.life -= delta;
    if (fx.vel) {
      fx.mesh.position.addScaledVector(fx.vel, delta);
      if (fx.gravity) fx.vel.y += fx.gravity * delta;
    }
    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      activeEffects.splice(i, 1);
    }
  }

  drawMinimap();

  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    document.getElementById('sFps').textContent = Math.round((frames * 1000) / (now - lastFpsTime)) + ' FPS';
    frames = 0;
    lastFpsTime = now;
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
