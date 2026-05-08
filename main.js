import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- Settings / Meta ----
const PARAMS = {
    lons: 192,
    lats: 94,
    frames: 91,
    currentFrame: 0,
    datasetIndex: 1, // 1 for PWAT1, 2 for PWAT2
    seasonIndex: 0,  // 0=Jan, 1=July
    viewMode: 0,     // 0 = 3D, 1 = 2D, 2 = SPLIT
    showWind: false,
    displayMode: 'pwat', // 'pwat' (Vapeur) ou 'precip' (Vapeur + Nuages/Pluie)
};
let hitRegistry = [];
let isCinematicMode = true;

const TRANSLATIONS = {
    EN: {
        archives: "Archives",
        localImport: "Local Import",
        backArchives: "← Back to Archives",
        dragFiles: "Drag your files here",
        browse: "Browse",
        tracer: "Tracer",
        simulationDay: "Simulation Day",
        switchTracer: "Switch Tracer (Japan ↔ Brazil)",
        seasonSummer: "Season: Summer",
        seasonWinter: "Season: Winter",
        modeVapor: "Mode: Vapor Only",
        modeRain: "Mode: Vapor + Clouds",
        windOn: "Wind Arrows: ON",
        windOff: "Wind Arrows: OFF",
        view3D: "View: 3D Globe",
        view2D: "View: 2D Map",
        viewSplit: "View: Comparative",
        play: "▶ Play",
        pause: "⏸ Pause",
        speed025: "Speed: 0.25x",
        speed05: "Speed: 0.5x",
        speed1: "Speed: 1x",
        headerData: "DATA LAYER",
        headerView: "CAMERA VIEW",
        headerPlayback: "PLAYBACK",
        alertLocalSeason: "To change season in Local Import mode, please drag the corresponding new .ft files.",
        legendVapor: "Atmospheric Vapor Tracer [kg/m²]",
        legendRain: "Tracer rain > 0.1 mm/day",
        months: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    },
    JP: {
        archives: "アーカイブ",
        localImport: "ローカルインポート",
        backArchives: "← アーカイブに戻る",
        dragFiles: "ここにファイルをドラッグ",
        browse: "参照",
        tracer: "トレーサー",
        simulationDay: "シミュレーション日数",
        switchTracer: "トレーサー切替 (日本 ↔ ブラジル)",
        seasonSummer: "季節：夏",
        seasonWinter: "季節：冬",
        modeVapor: "モード：水蒸気のみ",
        modeRain: "モード：水蒸気 + 雲",
        windOn: "風矢：ON",
        windOff: "風矢：OFF",
        view3D: "表示：3D地球儀",
        view2D: "表示：2D地図",
        viewSplit: "表示：比較ビュー",
        play: "▶ 再生",
        pause: "⏸ 一時停止",
        speed025: "速度：0.25x",
        speed05: "速度：0.5x",
        speed1: "速度：1x",
        headerData: "データレイヤー",
        headerView: "カメラ表示",
        headerPlayback: "再生",
        alertLocalSeason: "ローカルインポートモードで季節を変更するには、対応する新しい.ftファイルをドラッグしてください。",
        legendVapor: "水蒸気トレーサー [kg/m²]",
        legendRain: "トレーサー降水量 > 0.1 mm/day",
        months: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
    }
};
let currentLang = 'EN';

// --- UTILITAIRE DE DISTANCE ---
function getDistanceKM(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.floor(R * c);
}

// --- RESET DU RANKING ---
function resetRanking() {
    if (typeof hitRegistry !== 'undefined') hitRegistry = [];
    const list = document.getElementById('ranking-list');
    if (list) list.innerHTML = '';
    markers.forEach(m => {
        if (m.userData && m.userData.sprite) {
            m.userData.sprite.scale.set(0.24, 0.06, 1);
        }
    });
}

// --- INTERPOLATION DATA (Demi-Frames) ---
function expandBuffer(originalBuffer, originalFrames, steps) {
    const gridSize = 192 * 94;
    const newFrames = (originalFrames - 1) * steps + 1;
    const newBuffer = new Float32Array(newFrames * gridSize);
    
    for (let f = 0; f < originalFrames - 1; f++) {
        const base0 = f * gridSize;
        const base1 = (f + 1) * gridSize;
        for (let s = 0; s < steps; s++) {
            const outBase = (f * steps + s) * gridSize;
            const t = s / steps;
            for (let i = 0; i < gridSize; i++) {
                const v0 = originalBuffer[base0 + i];
                const v1 = originalBuffer[base1 + i];
                newBuffer[outBase + i] = v0 + (v1 - v0) * t;
            }
        }
    }
    const lastBaseIn = (originalFrames - 1) * gridSize;
    const lastBaseOut = (newFrames - 1) * gridSize;
    for (let i = 0; i < gridSize; i++) {
        newBuffer[lastBaseOut + i] = originalBuffer[lastBaseIn + i];
    }
    return newBuffer;
}

// Gaussian Latitude levels (from flx.ctl) - Row 0 = North, Row 93 = South
const GAUSSIAN_LATS = [
    88.542, 86.653, 84.753, 82.851, 80.947, 79.043, 77.139, 75.235, 73.331, 71.426,
    69.522, 67.617, 65.713, 63.808, 61.903, 59.999, 58.094, 56.189, 54.285, 52.380,
    50.475, 48.571, 46.666, 44.761, 42.856, 40.952, 39.047, 37.142, 35.238, 33.333,
    31.428, 29.523, 27.619, 25.714, 23.809, 21.904, 20.000, 18.095, 16.190, 14.286,
    12.381, 10.476, 8.571, 6.667, 4.762, 2.857, 0.952, -0.952, -2.857, -4.762,
    -6.667, -8.571, -10.476, -12.381, -14.286, -16.190, -18.095, -20.000, -21.904, -23.809,
    -25.714, -27.619, -29.523, -31.428, -33.333, -35.238, -37.142, -39.047, -40.952, -42.856,
    -44.761, -46.666, -48.571, -50.475, -52.380, -54.285, -56.189, -58.094, -59.999, -61.903,
    -63.808, -65.713, -67.617, -69.522, -71.426, -73.331, -75.235, -77.139, -79.043, -80.947,
    -82.851, -84.753, -86.653, -88.542
];

// ---- Source de verite : make_summer.gs / flx.ctl ----
const SEASONS = [
    {
        prefix: 'jpbz_201707',
        label: 'Summer 2017 — JP tracer (00Z01JUL2017)',
        tdefStart: new Date('2017-07-01T00:00:00Z'),
        increment: 86400000
    },
    {
        prefix: 'jpbz_1_2018',
        label: 'Winter 2018 — JP tracer (00Z01JAN2018)',
        tdefStart: new Date('2018-01-01T00:00:00Z'),
        increment: 86400000
    }
];

let buffer1 = null;
let localBuffer = null;
let localBufferPrecip = null;
let localBufferU = null;
let localBufferV = null;
let archiveBufferU = null;
let archiveBufferV = null;
let archiveBufferPrecip = null;
let localFramesLoaded = 0;
let dataTexture = null;
let vaporTexture = null;
let windTexture = null;
let material = null;

// ---- Particle Advection System (Windy-style) ----
const N_PARTICLES = 3500;   // Couverture globale très dense
const TRAIL_LEN = 35;       // CORRECTION : Traits beaucoup plus longs (anciennement 12)
const WIND_RADIUS = 1.002;  // Très proche de la surface
const WIND_SCALE = 0.005;

const pLat = new Float32Array(N_PARTICLES);
const pLon = new Float32Array(N_PARTICLES);
const pAge = new Uint16Array(N_PARTICLES);
const pLife = new Uint16Array(N_PARTICLES);
const pTrailX = new Float32Array(N_PARTICLES * TRAIL_LEN);
const pTrailY = new Float32Array(N_PARTICLES * TRAIL_LEN);
const pTrailZ = new Float32Array(N_PARTICLES * TRAIL_LEN);
let trailMesh = null;
let windNeedsUpdate = true; // Le verrou anti-lag
let atmosphereSphere = null;
let atmospherePlane = null;
let atmosphereMat = null;

let currentTopWinds = [];

function updateTopWinds(frameIdx) {
    const aU = isLocalData ? localBufferU : archiveBufferU;
    const aV = isLocalData ? localBufferV : archiveBufferV;
    if (!aU || !aV) return;

    const base = frameIdx * 192 * 94;

    // On divise le monde en 8 zones (2 colonnes x 4 rangées)
    const zones = Array.from({ length: 8 }, () => []);

    for (let r = 0; r < 94; r++) {
        const lat = GAUSSIAN_LATS[r];
        const zoneR = Math.floor(r / (94 / 4)); // 0 à 3

        for (let c = 0; c < 192; c++) {
            const lon = (c / 192) * 360;
            const zoneC = Math.floor(c / (192 / 2)); // 0 à 1
            const zoneIdx = zoneR * 2 + zoneC;

            const idx = base + r * 192 + c;

            // 1. On récupère la valeur du traceur (PWAT) à cet endroit exact
            // Note: On utilise le buffer PWAT actif
            const aPwat = isLocalData ? localBuffer : buffer1;
            let pwatVal = 0;
            if (aPwat) {
                pwatVal = aPwat[idx];
            }

            const speedSq = aU[idx] * aU[idx] + aV[idx] * aV[idx];

            // 2. LE MASQUE : On n'enregistre le vent QUE s'il y a du traceur ET que le vent est fort
            if (!isNaN(speedSq) && speedSq > 5.0 && pwatVal > 0.001) {
                zones[zoneIdx].push({ lat, lon, speedSq });
            }
        }
    }

    currentTopWinds = [];
    const perZone = Math.ceil(N_PARTICLES / 8); // On veut environ 3-4 flèches par zone

    // Pour chaque zone, on prend les meilleurs vents
    zones.forEach(z => {
        z.sort((a, b) => b.speedSq - a.speedSq);
        let addedInZone = 0;

        for (const pt of z) { // On boucle sur 'z' (la zone) et pas 'windSpeeds'
            if (currentTopWinds.length >= N_PARTICLES) break;
            if (addedInZone >= perZone) break;

            let tooClose = false;
            for (const s of currentTopWinds) {
                // EXCLUSION RADICALE (25° Lat, 50° Lon) pour forcer la distribution sur tout le globe
                if (Math.abs(s.lat - pt.lat) < 25 && Math.abs(s.lon - pt.lon) < 50) {
                    tooClose = true;
                    break;
                }
            }

            if (!tooClose) {
                currentTopWinds.push(pt);
                addedInZone++; // On compte combien on en ajoute pour cette zone
            }
        }
    });
}
let isLocalData = false;
let currentUploadedFiles = [];

// ---- UI Bindings ----
const uiLabelSet = document.getElementById('dataset-label');
const uiLabelFrame = document.getElementById('frame-label');
const uiDateDisplay = document.getElementById('date-display');
const sliderTime = document.getElementById('time-slider');
const btnToggle = document.getElementById('toggle-data');
const btnPlay = document.getElementById('btn-play');
const btnToggleView = document.getElementById('btn-toggle-view');
const archiveUI = document.getElementById('archive-specific-ui');
const localUI = document.getElementById('local-specific-ui');
const commonUI = document.getElementById('common-ui');

// ---- Localization Logic ----
const btnLang = document.getElementById('btn-lang');
function updateLanguageUI() {
    const t = TRANSLATIONS[currentLang];

    // Tabs
    const tabArchives = document.getElementById('tab-archives');
    const tabUpload = document.getElementById('tab-upload');
    if (tabArchives) tabArchives.innerText = t.archives;
    if (tabUpload) tabUpload.innerText = t.localImport;

    // Back button
    const btnBack = document.getElementById('btn-back-archives');
    if (btnBack) btnBack.innerText = t.backArchives;

    // Drop zone
    const dropZone = document.querySelector('#drop-zone-box p');
    if (dropZone) dropZone.innerText = t.dragFiles;
    const btnBrowse = document.getElementById('btn-browse');
    if (btnBrowse) btnBrowse.innerText = t.browse;

    // Archive labels
    const labels = document.querySelectorAll('.ui-label');
    if (labels.length >= 2) {
        labels[0].innerText = t.tracer;
        labels[1].innerText = t.simulationDay;
    }
    const btnToggle = document.getElementById('toggle-data');
    if (btnToggle) {
        btnToggle.innerText = (currentSeason === 'summer') ? t.seasonSummer : t.seasonWinter;
    }

    // Common buttons
    const btnMode = document.getElementById('btn-toggle-data-type');
    if (btnMode) {
        btnMode.innerText = (PARAMS.displayMode === 'pwat') ? t.modeVapor : t.modeRain;
    }
    const btnWind = document.getElementById('btn-toggle-wind');
    if (btnWind) {
        btnWind.innerText = PARAMS.showWind ? t.windOn : t.windOff;
    }
    const btnView = document.getElementById('btn-toggle-view');
    if (btnView) {
        const viewLabels = [t.view3D, t.view2D, t.viewSplit];
        btnView.innerText = viewLabels[PARAMS.viewMode];
    }
    const btnAuto = document.getElementById('btn-toggle-autorotate');
    if (btnAuto) {
        btnAuto.innerText = autoRotateEnabled ?
            (currentLang === 'EN' ? "Auto-Rotate: ON" : "自動回転：ON") :
            (currentLang === 'EN' ? "Auto-Rotate: OFF" : "自動回転：OFF");
    }
    if (btnPlay) {
        btnPlay.innerText = isPlaying ? t.pause : t.play;
    }

    const btnSpeed = document.getElementById('btn-speed');
    if (btnSpeed) {
        const speedKeys = ['speed1', 'speed05', 'speed025'];
        btnSpeed.innerText = t[speedKeys[playbackSpeedIndex]].replace('Speed: ', '').replace('速度：', '');
    }

    // Headers
    const hData = document.getElementById('header-data');
    const hView = document.getElementById('header-view');
    const hPlayback = document.getElementById('header-playback');
    if (hData) hData.innerText = t.headerData;
    if (hView) hView.innerText = t.headerView;
    if (hPlayback) hPlayback.innerText = t.headerPlayback;

    // Legend
    const legendTitle = document.querySelector('.legend-title');
    if (legendTitle) {
        legendTitle.innerText = (PARAMS.displayMode === 'pwat') ? t.legendVapor : t.legendRain;
    }

    // Date display (force update)
    updateFrame();
}

if (btnLang) {
    btnLang.addEventListener('click', () => {
        currentLang = (currentLang === 'EN') ? 'JP' : 'EN';
        updateLanguageUI();
    });
}


let globe = null;
let graticule = null;
let coastMesh = null;
let basePlane = null;

// 2D Canvas setup (Transparent HUD Layer)
const canvas2D = document.getElementById('canvas-2d');
const ctx2D = canvas2D.getContext('2d', { alpha: true }); // Must be true to see WebGL behind
const canvas2DContainer = document.getElementById('canvas-2d-container');
const mainContent = document.getElementById('main-content');

function resize2DCanvas() {
    if (canvas2DContainer.style.display === 'none') return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas2DContainer.getBoundingClientRect();
    if (rect.width === 0) return;

    // Calcul de la taille max en conservant le ratio strict de 2.04
    let targetW = rect.width * 0.95;
    let targetH = targetW / 2.04;

    if (targetH > rect.height * 0.95) {
        targetH = rect.height * 0.95;
        targetW = targetH * 2.04;
    }

    // Taille physique de la zone de dessin (Retina/High-DPI)
    canvas2D.width = targetW * dpr;
    canvas2D.height = targetH * dpr;

    // Taille visuelle bloquée pour empêcher le CSS d'étirer l'image
    canvas2D.style.width = targetW + 'px';
    canvas2D.style.height = targetH + 'px';

    // SYNCHRONISATION ORTHOGRAPHIQUE (Élimine la perspective 3D sur les nuages)
    // La carte fait 1.0 unité de haut dans le monde 3D. 
    // Elle doit occuper 'targetH' pixels sur les 'rect.height' pixels totaux de l'écran.
    const frustumHeight = rect.height / targetH;
    const aspect = rect.width / rect.height;

    camera2D.left = -frustumHeight * aspect / 2;
    camera2D.right = frustumHeight * aspect / 2;
    camera2D.top = frustumHeight / 2;
    camera2D.bottom = -frustumHeight / 2;
    camera2D.updateProjectionMatrix();
    // Invalidation du cache pour forcer un redessin propre
    mapCacheCanvas.width = canvas2D.width;
    mapCacheCanvas.height = canvas2D.height;
    isMapCached = false;
}

function updateCameras() {
    // 🛡️ BOUCLIER 1 : Force un minimum de 1 pixel pour éviter le bug NaN (écran noir)
    const W = Math.max(1, mainContent.clientWidth);
    const H = Math.max(1, mainContent.clientHeight);

    const aspect = (PARAMS.viewMode === 2) ? (W / 2) / H : (W / H);

    camera2D.aspect = aspect;
    camera2D.updateProjectionMatrix();
    camera3D.aspect = aspect;
    camera3D.updateProjectionMatrix();

    renderer.setSize(W, H);
    resize2DCanvas();
}
// Offscreen Buffer for Bilinear Interpolation (192x94 native resolution)
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 192;
offscreenCanvas.height = 94;
const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true });

let coastlinesGeoJSON = null;

sliderTime.min = 0;
sliderTime.max = PARAMS.frames - 1;

// ---- Auto-Play State ----
let isPlaying = false;
let lastFrameTime = 0;
let lastWindTime = 0; // Chronomètre dédié à l'animation des particules
let currentFPS = 48; // 4x plus rapide pour compenser les 4x plus de frames
let msPerFrame = 1000 / currentFPS;
let playbackSpeedIndex = 0; // 0=1x, 1=0.5x, 2=0.25x

// ---- Three.js Setup ----
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505); // Global Black Workspace

const camera2D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 20000);
camera2D.position.set(0, 0, 5); // Recul fixe

const camera3D = new THREE.PerspectiveCamera(45, (mainContent.clientWidth / 2) / mainContent.clientHeight, 0.1, 20000);
camera3D.position.set(0, 0, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(mainContent.clientWidth, mainContent.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera3D, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
// --- AUTO-ROTATE LOGIC V2 ---
let autoRotateEnabled = true;
// On initialise à 0 pour que (now - 0 > 10000) soit vrai dès le chargement (Auto-start immédiat)
let lastInteractionTime = 0;
let isDraggingGlobe = false;
const INACTIVITY_DELAY = 10000;

// On écoute uniquement les événements des OrbitControls (le mouvement du globe)
controls.addEventListener('start', () => {
    isDraggingGlobe = true;
});

controls.addEventListener('end', () => {
    isDraggingGlobe = false;
    lastInteractionTime = performance.now(); // Le décompte des 10s commence quand on lâche le globe
});
// ----------------------------


// ---- 1. Base Globe ----
const globeGeom = new THREE.SphereGeometry(1.0, 64, 64);
const globeMat = new THREE.MeshStandardMaterial({
    color: 0x2E70C4,
    roughness: 0.6,
    metalness: 0.1
});
globe = new THREE.Mesh(globeGeom, globeMat);
scene.add(globe);

// ---- 2. Graticule ----
const graticuleMat = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5 });
const graticuleGeom = new THREE.BufferGeometry();
const graticulePoints = [];
const radiusGraticule = 1.001;

for (let lon = -180; lon <= 180; lon += 15) {
    const lonRad = lon * Math.PI / 180;
    for (let lat = -90; lat <= 90; lat += 2) {
        const latRad = lat * Math.PI / 180;
        const x = radiusGraticule * Math.cos(latRad) * Math.cos(lonRad);
        const y = radiusGraticule * Math.sin(latRad);
        const z = -radiusGraticule * Math.cos(latRad) * Math.sin(lonRad);
        graticulePoints.push(new THREE.Vector3(x, y, z));
    }
}
for (let lat = -90; lat <= 90; lat += 15) {
    const latRad = lat * Math.PI / 180;
    for (let lon = -180; lon <= 180; lon += 2) {
        const lonRad = lon * Math.PI / 180;
        const x = radiusGraticule * Math.cos(latRad) * Math.cos(lonRad);
        const y = radiusGraticule * Math.sin(latRad);
        const z = -radiusGraticule * Math.cos(latRad) * Math.sin(lonRad);
        graticulePoints.push(new THREE.Vector3(x, y, z));
    }
}
graticuleGeom.setFromPoints(graticulePoints);
graticule = new THREE.LineSegments(graticuleGeom, graticuleMat);
scene.add(graticule);

// ---- 2b. Coastlines ----
function loadCoastlines() {
    fetch('countries.geojson')
        .then(res => res.json())
        .then(data => {
            coastlinesGeoJSON = data;
            const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
            const R = 1.005;
            const positions = [];
            data.features.forEach(f => {
                const rings = (f.geometry.type === 'Polygon') ? [f.geometry.coordinates] : f.geometry.coordinates;
                rings.forEach(poly => poly.forEach(ring => {
                    for (let n = 0; n < ring.length - 1; n++) {
                        if (Math.abs(ring[n][0] - ring[n + 1][0]) > 180) continue;
                        const l1 = ring[n][0] * Math.PI / 180; const a1 = ring[n][1] * Math.PI / 180;
                        const l2 = ring[n + 1][0] * Math.PI / 180; const a2 = ring[n + 1][1] * Math.PI / 180;
                        positions.push(R * Math.cos(a1) * Math.cos(l1), R * Math.sin(a1), -R * Math.cos(a1) * Math.sin(l1));
                        positions.push(R * Math.cos(a2) * Math.cos(l2), R * Math.sin(a2), -R * Math.cos(a2) * Math.sin(l2));
                    }
                }));
            });
            const geom = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            coastMesh = new THREE.LineSegments(geom, mat);
            coastMesh.renderOrder = 3;
            scene.add(coastMesh);
        });
}
loadCoastlines();

// ---- 3. Unified Shader Layer ----
const initialData = new Float32Array(PARAMS.lons * PARAMS.lats);
dataTexture = new THREE.DataTexture(initialData, PARAMS.lons, PARAMS.lats, THREE.RedFormat, THREE.FloatType);
dataTexture.minFilter = THREE.LinearFilter;
dataTexture.magFilter = THREE.LinearFilter;
dataTexture.generateMipmaps = false;
dataTexture.needsUpdate = true;

const initialDataNext = new Float32Array(PARAMS.lons * PARAMS.lats);
const dataTextureNext = new THREE.DataTexture(initialDataNext, PARAMS.lons, PARAMS.lats, THREE.RedFormat, THREE.FloatType);
dataTextureNext.minFilter = THREE.LinearFilter;
dataTextureNext.magFilter = THREE.LinearFilter;
dataTextureNext.generateMipmaps = false;

const initialVaporData = new Float32Array(PARAMS.lons * PARAMS.lats);
vaporTexture = new THREE.DataTexture(initialVaporData, PARAMS.lons, PARAMS.lats, THREE.RedFormat, THREE.FloatType);
vaporTexture.generateMipmaps = false;
vaporTexture.minFilter = THREE.LinearFilter;
vaporTexture.magFilter = THREE.LinearFilter;
vaporTexture.wrapS = THREE.ClampToEdgeWrapping;
vaporTexture.wrapT = THREE.ClampToEdgeWrapping;
vaporTexture.needsUpdate = true;

// Texture pour passer les vents au GPU
const initialWindData = new Float32Array(PARAMS.lons * PARAMS.lats * 4);
windTexture = new THREE.DataTexture(initialWindData, PARAMS.lons, PARAMS.lats, THREE.RGBAFormat, THREE.FloatType);
windTexture.generateMipmaps = false;
windTexture.minFilter = THREE.LinearFilter;
windTexture.magFilter = THREE.LinearFilter;
windTexture.wrapS = THREE.ClampToEdgeWrapping;
windTexture.wrapT = THREE.ClampToEdgeWrapping;
windTexture.needsUpdate = true;

const _VS = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const _FS = `
uniform sampler2D tData;
uniform sampler2D tVaporData;
uniform float u_is3D;
uniform float u_mode; // 0 = Vapor, 1 = Rain
uniform float u_overlay; // 1 = Overlay Mode
varying vec2 vUv;

vec3 getVaporColor(float val) {
    if (val < 0.001 || val > 1.0e15) return vec3(0.05, 0.05, 0.05);
    if (val < 0.02)  return mix(vec3(0.25), vec3(0.45), smoothstep(0.001, 0.02, val));
    if (val < 0.1)   return mix(vec3(0.45), vec3(0.65), smoothstep(0.02, 0.1, val));
    if (val < 1.0)   return mix(vec3(0.65), vec3(0.85), smoothstep(0.1, 1.0, val));
    if (val < 5.0)   return mix(vec3(0.85), vec3(0.96), smoothstep(1.0, 5.0, val));
    return mix(vec3(0.96), vec3(1.00), smoothstep(5.0, 15.0, val));
}

void main() {
    vec2 finalUv;
    if (u_is3D > 0.5) {
        float lon = vUv.x * 360.0 - 180.0;
        float gribLon = (lon < 0.0 ? lon + 360.0 : lon);
        finalUv = vec2(gribLon / 360.0, 1.0 - vUv.y);
    } else {
        finalUv = vec2(vUv.x, 1.0 - vUv.y);
    }
    
    float val = texture2D(tData, finalUv).r;
    float vVal = texture2D(tVaporData, finalUv).r;
    
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // ETAT 1 : Mode Overlay (Vapeur sous les nuages)
    if (u_overlay > 0.5) {
        col = getVaporColor(vVal);
        if (vVal >= 0.001 && vVal < 1.0e15) {
            float tAlpha = clamp((log(vVal) - log(0.001)) / (log(15.0) - log(0.001)), 0.0, 1.0);
            alpha = mix(0.1, 0.95, pow(tAlpha, 1.5));
        }
    } 
    // ETAT 2 : Mode Rain classique (Sphère de données 100% transparente)
    else if (u_mode > 0.5) {
        alpha = 0.0; // Laisse apparaître le globe matériel de base
    } 
    // ETAT 3 : Mode Vapor classique (Vapeur sur fond noir)
    else {
        col = getVaporColor(val);
        if (val >= 0.001 && val < 1.0e15) {
            float tAlpha = clamp((log(val) - log(0.001)) / (log(15.0) - log(0.001)), 0.0, 1.0);
            alpha = mix(0.1, 0.95, pow(tAlpha, 1.5));
        }
    }
    
    gl_FragColor = vec4(col, alpha);
}
`;

material = new THREE.ShaderMaterial({
    uniforms: {
        tData: { value: dataTexture },
        tDataNext: { value: dataTextureNext },
        tVaporData: { value: vaporTexture }, // NOUVEAU : La texture de vapeur
        u_lerp: { value: 0.0 },
        u_is3D: { value: 1.0 },
        u_mode: { value: 0.0 },
        u_time: { value: 0.0 },
        u_overlay: { value: 0.0 } // NOUVEAU : Le flag du mode Overlay
    },
    vertexShader: _VS,
    fragmentShader: _FS,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false
});

const dataSphere = new THREE.Mesh(new THREE.SphereGeometry(1.002, 64, 64), material);
dataSphere.renderOrder = 2;
scene.add(dataSphere);

const dataPlaneGeom = new THREE.PlaneGeometry(2.04, 1.0); // Ratio 192/94
const dataPlane = new THREE.Mesh(dataPlaneGeom, material);
dataPlane.position.set(0, 0, 0.0); // Exactly at origin for 2D mode
dataPlane.rotation.set(0, 0, 0); // No tilt
dataPlane.frustumCulled = false;
dataPlane.visible = false;
dataPlane.renderOrder = 2;
scene.add(dataPlane);

// ---- 3c. 2D Base Ground (The "Surface" Twin) ----
const basePlaneGeom = new THREE.PlaneGeometry(2.04, 1.0);
const basePlaneMat = new THREE.MeshBasicMaterial({ color: 0x2E70C4 });
basePlane = new THREE.Mesh(basePlaneGeom, basePlaneMat);
basePlane.position.set(0, 0, -0.01); // Standard depth layering
basePlane.visible = false;
basePlane.renderOrder = 1;
scene.add(basePlane);

// ---- Markers ----
const CITIES_DB = [
    { name: "Tokyo", lat: 35.68, lon: 139.77, cc: "jp" },
    { name: "Paris", lat: 48.85, lon: 2.35, cc: "fr" },
    { name: "New York", lat: 40.71, lon: -74.00, cc: "us" },
    { name: "Rio de Janeiro", lat: -22.90, lon: -43.17, cc: "br" },
    { name: "London", lat: 51.50, lon: -0.12, cc: "gb" },
    { name: "Beijing", lat: 39.90, lon: 116.40, cc: "cn" },
    { name: "Sydney", lat: -33.86, lon: 151.20, cc: "au" },
    { name: "Cairo", lat: 30.04, lon: 31.23, cc: "eg" },
    { name: "Honolulu", lat: 21.30, lon: -157.85, cc: "us" },
    { name: "Mumbai", lat: 19.07, lon: 72.87, cc: "in" },
    { name: "Cape Town", lat: -33.92, lon: 18.42, cc: "za" },
    { name: "Moscow", lat: 55.75, lon: 37.61, cc: "ru" },
    { name: "Toronto", lat: 43.65, lon: -79.38, cc: "ca" },
    { name: "Dubai", lat: 25.20, lon: 55.27, cc: "ae" },
    { name: "Singapore", lat: 1.35, lon: 103.81, cc: "sg" },
    { name: "Seoul", lat: 37.56, lon: 126.97, cc: "kr" },
    { name: "Mexico City", lat: 19.43, lon: -99.13, cc: "mx" },
    { name: "Los Angeles", lat: 34.05, lon: -118.24, cc: "us" },
    { name: "Istanbul", lat: 41.00, lon: 28.97, cc: "tr" },
    { name: "Buenos Aires", lat: -34.60, lon: -58.38, cc: "ar" },
    { name: "Jakarta", lat: -6.20, lon: 106.81, cc: "id" }
];
let selectedSlots = [0, 1, 2]; 
let markers = [];
function createMarker(lat, lon, labelText, countryCode, isPrimary = false, r = 1.11) {
    const latRad = lat * Math.PI / 180; const lonRad = lon * Math.PI / 180;
    const x = r * Math.cos(latRad) * Math.cos(lonRad);
    const y = r * Math.sin(latRad);
    const z = -r * Math.cos(latRad) * Math.sin(lonRad);
    const group = new THREE.Group(); group.position.set(x, y, z);

    // Taille du point réduite pour les villes secondaires
    const dotSize = isPrimary ? 0.02 : 0.012;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(dotSize), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
    group.add(mesh);

    // Canvas haute résolution élargi pour les noms complets avec drapeaux
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 38px Arial';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    ctx.strokeText(labelText, 256, 110);
    ctx.fillText(labelText, 256, 110);

    const spriteMat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
        depthWrite: false,
        transparent: true
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.center.set(0.5, -0.2);
    sprite.scale.set(0.24, 0.06, 1); // Ratio 4:1 adapté au nouveau canvas 512x128
    sprite.renderOrder = 4;
    group.add(sprite);

    // Sauvegarde en userData avec le code pays
    group.userData = { lat, lon, labelText, countryCode, isPrimary, sprite, totalWater: 0, totalVapor: 0 };

    scene.add(group); markers.push(group);
}



function initComparisonSlots() {
    for (let i = 0; i < 3; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (!slot) continue;
        slot.innerHTML = `
            <div class="slot-header">
                <img id="flag-${i}" src="https://flagcdn.com/w20/${CITIES_DB[selectedSlots[i]].cc}.png" width="16" style="border-radius: 2px;">
                <select class="slot-select" id="select-${i}">
                    ${CITIES_DB.map((c, idx) => `<option value="${idx}" ${idx === selectedSlots[i] ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
            </div>
            <div class="slot-stats">
                <div id="val-${i}" class="slot-val">--</div>
                <div id="day-${i}" class="slot-day">Day 1</div>
            </div>
        `;
        document.getElementById(`select-${i}`).addEventListener('change', (e) => {
            selectedSlots[i] = parseInt(e.target.value);
            document.getElementById(`flag-${i}`).src = `https://flagcdn.com/w20/${CITIES_DB[selectedSlots[i]].cc}.png`;
            updateFrame();
        });
    }
}



// ---- Data Loop ----
async function loadData() {
    const season = SEASONS[PARAMS.seasonIndex];
    console.log('Chargement des archives :', season.prefix);

    const fetchBuf = async (url) => {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const arrayBuf = await res.arrayBuffer();
            // Sécurité absolue : on ignore les pages d'erreur HTML cachées en 404
            if (arrayBuf.byteLength < 1000000) return null; 
            return expandBuffer(new Float32Array(arrayBuf), 91, 4); 
        } catch (e) {
            console.error("Erreur de téléchargement :", url);
            return null;
        }
    };

    if (!isLocalData) {
        // 1. On détruit les anciens vents pour éviter l'effet fantôme de l'été
        buffer1 = null; archiveBufferPrecip = null;
        archiveBufferU = null; archiveBufferV = null;

        // 2. Chargement parallèle (beaucoup plus rapide)
        const [pwat, precip, u, v] = await Promise.all([
            fetchBuf(season.prefix + '_pwat1_91frames.bin'),
            fetchBuf(season.prefix + '_prate1_91frames.bin'),
            fetchBuf(season.prefix + '_u_91frames.bin'),
            fetchBuf(season.prefix + '_v_91frames.bin')
        ]);

        buffer1 = pwat;
        archiveBufferPrecip = precip;
        archiveBufferU = u;
        archiveBufferV = v;
        
        PARAMS.frames = (91 - 1) * 4 + 1;
        
        // CORRECTION : On conserve le moment exact de la simulation pour comparer
        // (Math.min est une sécurité si on charge un dataset plus court)
        PARAMS.currentFrame = Math.min(PARAMS.currentFrame, PARAMS.frames - 1); 
        
        if (sliderTime) {
            sliderTime.max = PARAMS.frames - 1;
            sliderTime.value = PARAMS.currentFrame; // Le slider reste à sa place
        }
        
        resetParticles(false); 
        updateFrame();
    }
}

function updateFrame() {
    let active = null;
    let multiplier = 1.0;

    if (isLocalData) {
        active = (PARAMS.displayMode === 'precip') ? localBufferPrecip : localBuffer;
        if (PARAMS.displayMode === 'precip') multiplier = 86400.0;
        PARAMS.frames = localFramesLoaded;
    } else {
        // En mode Archives, on sélectionne le bon buffer
        active = (PARAMS.displayMode === 'pwat') ? buffer1 : archiveBufferPrecip;
        // On multiplie par 86400 pour passer de kg/m2/s à mm/day
        if (PARAMS.displayMode === 'precip') multiplier = 86400.0;
        
        // CORRECTION CRITIQUE : On débloque la limite des 91 jours pour lire les quarts de frame
        PARAMS.frames = 361; 
    }

    if (!active) {
        if (dataTexture && dataTexture.image && dataTexture.image.data) {
            dataTexture.image.data.fill(0);
            dataTexture.needsUpdate = true;
        }
        return;
    }

    const startIdx = PARAMS.currentFrame * 192 * 94;
    const nextFrameIdx = ((PARAMS.currentFrame + 1) % PARAMS.frames) * 192 * 94;
    
    const currentData = active.subarray(startIdx, startIdx + 192 * 94);
    const nextData = active.subarray(nextFrameIdx, nextFrameIdx + 192 * 94);

    if (multiplier === 1.0) {
        // Fast path : Copie mémoire directe au niveau C++ (instantané)
        dataTexture.image.data.set(currentData);
        dataTextureNext.image.data.set(nextData);
    } else {
        // Slow path : Uniquement nécessaire pour la pluie
        for (let i = 0; i < currentData.length; i++) {
            dataTexture.image.data[i] = currentData[i] * multiplier;
            dataTextureNext.image.data[i] = nextData[i] * multiplier;
        }
    }

    dataTexture.needsUpdate = true;
    dataTextureNext.needsUpdate = true;

    // --- ACCUMULATEUR COMPARATIF & FIRST TOUCH ---
    const slotData = [
        { totalWater: 0, totalVapor: 0, firstTouchDay: -1, isPingFrame: false },
        { totalWater: 0, totalVapor: 0, firstTouchDay: -1, isPingFrame: false },
        { totalWater: 0, totalVapor: 0, firstTouchDay: -1, isPingFrame: false }
    ];

    const activeVapor = isLocalData ? localBuffer : buffer1;
    const activePrecip = isLocalData ? localBufferPrecip : archiveBufferPrecip;

    // PRE-CALCUL DES INDICES DE GRILLE POUR LES VILLES SÉLECTIONNÉES
    const precalcIndices = selectedSlots.map(cityIdx => {
        const city = CITIES_DB[cityIdx];
        const c = Math.floor(((city.lon % 360) + 360) % 360 / (360 / 192));
        let r = 0;
        for (let i = 0; i < 93; i++) {
            if (GAUSSIAN_LATS[i] >= city.lat && city.lat >= GAUSSIAN_LATS[i + 1]) { r = i; break; }
        }
        return r * 192 + c;
    });

    for (let f = 0; f <= PARAMS.currentFrame; f++) {
        const frameOffset = f * 192 * 94;

        selectedSlots.forEach((cityIdx, slotIdx) => {
            const idx = frameOffset + precalcIndices[slotIdx];

            let pwatVal = activeVapor ? Math.max(0, activeVapor[idx] || 0) : 0;
            let prateVal = activePrecip ? Math.max(0, activePrecip[idx] * 86400.0 || 0) : 0;

            const ratioOrigin = Math.min(1.0, pwatVal / 10.0);
            if (prateVal > 0) slotData[slotIdx].totalWater += (prateVal * ratioOrigin) / 4.0;
            slotData[slotIdx].totalVapor += (pwatVal / 4.0);

            // LOGIQUE DE FIRST TOUCH
            let isValidHit = (PARAMS.displayMode === 'pwat') ? (pwatVal >= 0.05) : (prateVal > 0.1 && pwatVal >= 0.01);
            
            if (isValidHit && slotData[slotIdx].firstTouchDay === -1) {
                slotData[slotIdx].firstTouchDay = Math.floor(f / 4) + 1;
                // Si le premier jour d'impact est la frame actuellement lue à l'écran : Ping !
                if (f === PARAMS.currentFrame) {
                    slotData[slotIdx].isPingFrame = true;
                }
            }
        });
    }

    // Mise à jour UI et Animations des slots
    selectedSlots.forEach((cityIdx, slotIdx) => {
        const marker = markers[cityIdx];

        // HTML Update
        const valEl = document.getElementById(`val-${slotIdx}`);
        const dayEl = document.getElementById(`day-${slotIdx}`);
        
        if (valEl) {
            valEl.innerText = (PARAMS.displayMode === 'pwat') 
                ? slotData[slotIdx].totalVapor.toFixed(1) + " kg/m²"
                : `${slotData[slotIdx].totalVapor.toFixed(1)} kg/m² | ${slotData[slotIdx].totalWater.toFixed(1)} L/m²`;
        }
        
        if (dayEl) {
            if (slotData[slotIdx].firstTouchDay !== -1) {
                dayEl.innerText = "Day " + slotData[slotIdx].firstTouchDay;
                dayEl.style.color = '#7ecfff';
            } else {
                dayEl.innerText = "Waiting...";
                dayEl.style.color = '#888888';
            }
        }
    });

    // ✅ Mise à jour de la texture Vapeur (Origin Mask)
    if (activeVapor && vaporTexture) {
        const rawVapor = activeVapor.subarray(startIdx, startIdx + 192 * 94);
        vaporTexture.image.data.set(rawVapor); // Copie instantanée
        vaporTexture.needsUpdate = true;
    }

    // ✅ Mise à jour de la texture des vents pour le shader de pluie
    const aU = isLocalData ? localBufferU : archiveBufferU;
    const aV = isLocalData ? localBufferV : archiveBufferV;
    if (aU && aV && windTexture) {
        for (let i = 0; i < 192 * 94; i++) {
            const idx = startIdx + i;
            // On normalise le vent : on divise par 100 pour ramener dans [-1, 1], puis on ajoute 1 et on divise par 2 pour ramener dans [0, 1]
            // Ainsi, 0m/s -> 0.5, 100m/s -> 1.0, -100m/s -> 0.0
            const normU = (aU[idx] / 100.0 + 1.0) / 2.0;
            const normV = (aV[idx] / 100.0 + 1.0) / 2.0;

            windTexture.image.data[i * 4] = Math.max(0, Math.min(1, normU)); // R = U
            windTexture.image.data[i * 4 + 1] = Math.max(0, Math.min(1, normV)); // G = V
            windTexture.image.data[i * 4 + 2] = 0; // B
            windTexture.image.data[i * 4 + 3] = 1; // A
        }
        windTexture.needsUpdate = true;
    }
    if (sliderTime) sliderTime.value = PARAMS.currentFrame;

    if (uiLabelFrame) {
        uiLabelFrame.innerText = `${Math.floor(PARAMS.currentFrame / 4) + 1} / 91`;
    }

    const dateDisplay = document.getElementById('date-display');
    if (!isLocalData) {
        const d = new Date(SEASONS[PARAMS.seasonIndex].tdefStart.getTime() + (PARAMS.currentFrame / 4.0) * 86400000);
        const months = TRANSLATIONS[currentLang].months;
        if (dateDisplay) dateDisplay.innerText = `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
}

// ========================
// PARTICLE ADVECTION SYSTEM
// =====

function initParticles() {
    const TOTAL_VERTS = N_PARTICLES * (TRAIL_LEN - 1) * 2; 
    const posArr = new Float32Array(TOTAL_VERTS * 3);
    const colArr = new Float32Array(TOTAL_VERTS * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending // Effet lumineux quand les vents se croisent
    });

    if (trailMesh) {
        trailMesh.geometry.dispose();
        trailMesh.material.dispose();
        scene.remove(trailMesh);
    }

    trailMesh = new THREE.LineSegments(geo, mat);
    trailMesh.renderOrder = 3;
    scene.add(trailMesh);
}

function spawnParticle(i, keepPosition = false) {
    const aU = isLocalData ? localBufferU : archiveBufferU;
    const aV = isLocalData ? localBufferV : archiveBufferV;

    let startLat, startLon;
    const tb = i * TRAIL_LEN;

    if (!keepPosition) {
        // Nouvelle naissance aléatoire (quand la particule meurt de vieillesse)
        startLat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
        startLon = Math.random() * 360;
        
        // CORRECTION : Durée de vie doublée pour supporter les longues traînées
        pLife[i] = 80 + Math.floor(Math.random() * 100); 
        pAge[i] = TRAIL_LEN + Math.floor(Math.random() * (pLife[i] / 2)); 
    } else {
        // Pivot statique : on recalcule la ligne depuis la queue actuelle (Scrubbing)
        const tailX = pTrailX[tb];
        const tailY = pTrailY[tb];
        const tailZ = pTrailZ[tb];
        
        // Sécurité si la particule est vide
        if (tailX === 0 && tailY === 0 && tailZ === 0) {
            startLat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
            startLon = Math.random() * 360;
        } else {
            // Extraction mathématique des coordonnées Lat/Lon depuis la 3D
            startLat = Math.asin(tailY / WIND_RADIUS) * (180 / Math.PI);
            startLon = Math.atan2(-tailZ, tailX) * (180 / Math.PI);
        }
    }

    let cLat = startLat;
    let cLon = startLon;

    // Pré-calcul de la forme de la traînée avec la donnée du vent actuel
    for (let t = 0; t < TRAIL_LEN; t++) {
        const latR = cLat * Math.PI / 180;
        const lonR = cLon * Math.PI / 180;

        pTrailX[tb + t] = WIND_RADIUS * Math.cos(latR) * Math.cos(lonR);
        pTrailY[tb + t] = WIND_RADIUS * Math.sin(latR);
        pTrailZ[tb + t] = -WIND_RADIUS * Math.cos(latR) * Math.sin(lonR);

        if (aU && aV) {
            const [u, v] = getWindAtPos(cLat, cLon, PARAMS.currentFrame, aU, aV);
            const cosLat = Math.max(0.05, Math.cos(cLat * Math.PI / 180));
            cLon += u * WIND_SCALE * 0.6 / cosLat; 
            cLat += v * WIND_SCALE * 0.6;
            cLon = ((cLon % 360) + 360) % 360;
            cLat = Math.max(-85, Math.min(85, cLat));
        }
    }
    
    // Mise à jour de la tête de lecture pour l'animation continue
    pLat[i] = cLat;
    pLon[i] = cLon;
}

function resetParticles(keepPosition = false) {
    for (let i = 0; i < N_PARTICLES; i++) {
        spawnParticle(i, keepPosition); 
    }
    if (trailMesh && trailMesh.geometry) {
        trailMesh.geometry.attributes.position.needsUpdate = true;
        windNeedsUpdate = true;
    }
}

function getWindAtPos(lat, lon, frameIdx, aU, aV) {
    lat = Math.max(-87, Math.min(87, lat));
    lon = ((lon % 360) + 360) % 360;
    const cf = lon / (360 / 192);
    const c0 = Math.floor(cf) % 192;
    const c1 = (c0 + 1) % 192;
    const lt = cf - Math.floor(cf);
    let r0 = 92;
    for (let i = 0; i < 93; i++) {
        if (GAUSSIAN_LATS[i] >= lat && lat >= GAUSSIAN_LATS[i + 1]) { r0 = i; break; }
    }
    if (lat > GAUSSIAN_LATS[0]) r0 = 0;
    const r1 = Math.min(r0 + 1, 93);
    const lr = (r0 === r1) ? 0 : (GAUSSIAN_LATS[r0] - lat) / (GAUSSIAN_LATS[r0] - GAUSSIAN_LATS[r1]);
    const base = frameIdx * 192 * 94;
    const lerp = (a, b, t) => a + (b - a) * t;
    const u = lerp(lerp(aU[base + r0 * 192 + c0], aU[base + r0 * 192 + c1], lt),
        lerp(aU[base + r1 * 192 + c0], aU[base + r1 * 192 + c1], lt), lr);
    const v = lerp(lerp(aV[base + r0 * 192 + c0], aV[base + r0 * 192 + c1], lt),
        lerp(aV[base + r1 * 192 + c0], aV[base + r1 * 192 + c1], lt), lr);
    return [u, v];
}

function updateParticles(frameIdx, doAdvance) {
    const aU = isLocalData ? localBufferU : archiveBufferU;
    const aV = isLocalData ? localBufferV : archiveBufferV;
    if (!aU || !aV || !trailMesh) return;

    trailMesh.visible = (PARAMS.viewMode !== 1 && PARAMS.showWind);
    if (!PARAMS.showWind) return; 

    // ⚠️ On a supprimé le verrou de pause. Les vents soufflent désormais en permanence à 60 FPS, 
    // même quand la simulation (les jours) est en pause. C'est le comportement officiel de Windy.com.

    const posArr = trailMesh.geometry.attributes.position.array;
    const colArr = trailMesh.geometry.attributes.color.array;

    let activeParticles = N_PARTICLES;

    for (let i = 0; i < activeParticles; i++) {
        const tb = i * TRAIL_LEN;
        
        // --- ANIMATION CONTINUE ---
        pAge[i]++;
        if (pAge[i] > pLife[i]) {
            spawnParticle(i); // Renaissance naturelle
        }

        for (let t = 0; t < TRAIL_LEN - 1; t++) {
            pTrailX[tb + t] = pTrailX[tb + t + 1];
            pTrailY[tb + t] = pTrailY[tb + t + 1];
            pTrailZ[tb + t] = pTrailZ[tb + t + 1];
        }

        const [u, v] = getWindAtPos(pLat[i], pLon[i], frameIdx, aU, aV);
        const speed = Math.hypot(u, v);
        const cosLat = Math.max(0.05, Math.cos(pLat[i] * Math.PI / 180));
        
        pLon[i] += u * WIND_SCALE * 0.6 / cosLat; 
        pLat[i] += v * WIND_SCALE * 0.6;
        pLon[i] = ((pLon[i] % 360) + 360) % 360;
        pLat[i] = Math.max(-85, Math.min(85, pLat[i]));

        const latR = pLat[i] * Math.PI / 180;
        const lonR = pLon[i] * Math.PI / 180;
        pTrailX[tb + TRAIL_LEN - 1] = WIND_RADIUS * Math.cos(latR) * Math.cos(lonR);
        pTrailY[tb + TRAIL_LEN - 1] = WIND_RADIUS * Math.sin(latR);
        pTrailZ[tb + TRAIL_LEN - 1] = -WIND_RADIUS * Math.cos(latR) * Math.sin(lonR);

        // --- DESSIN GEOMETRIQUE ---
        const vb = i * (TRAIL_LEN - 1) * 6;
        const speedFactor = Math.max(0.05, Math.min(1.0, speed / 20.0));
        const lifeFactor = Math.sin((pAge[i] / pLife[i]) * Math.PI); 

        for (let t = 0; t < TRAIL_LEN - 1; t++) {
            const base = vb + t * 6;

            posArr[base] = pTrailX[tb + t];
            posArr[base + 1] = pTrailY[tb + t];
            posArr[base + 2] = pTrailZ[tb + t];
            
            posArr[base + 3] = pTrailX[tb + t + 1];
            posArr[base + 4] = pTrailY[tb + t + 1];
            posArr[base + 5] = pTrailZ[tb + t + 1];

            const intensity1 = Math.pow(t / (TRAIL_LEN - 1), 1.5) * speedFactor * lifeFactor;
            const intensity2 = Math.pow((t + 1) / (TRAIL_LEN - 1), 1.5) * speedFactor * lifeFactor;

            colArr[base] = intensity1; colArr[base+1] = intensity1; colArr[base+2] = intensity1;
            colArr[base+3] = intensity2; colArr[base+4] = intensity2; colArr[base+5] = intensity2;
        }
    }
    trailMesh.geometry.setDrawRange(0, activeParticles * (TRAIL_LEN - 1) * 2);
    trailMesh.geometry.attributes.position.needsUpdate = true;
    trailMesh.geometry.attributes.color.needsUpdate = true;
}

function alignParticlesToFrame(frameIdx) {
    const aU = isLocalData ? localBufferU : archiveBufferU;
    const aV = isLocalData ? localBufferV : archiveBufferV;
    if (!aU || !aV) return;

    for (let i = 0; i < N_PARTICLES; i++) {
        let cLat = pLat[i];
        let cLon = pLon[i];
        const tb = i * TRAIL_LEN;

        // On reconstruit la traînée à l'envers (de la tête vers la queue)
        for (let t = TRAIL_LEN - 1; t >= 0; t--) {
            const latR = cLat * Math.PI / 180;
            const lonR = cLon * Math.PI / 180;

            pTrailX[tb + t] = WIND_RADIUS * Math.cos(latR) * Math.cos(lonR);
            pTrailY[tb + t] = WIND_RADIUS * Math.sin(latR);
            pTrailZ[tb + t] = -WIND_RADIUS * Math.cos(latR) * Math.sin(lonR);

            // On "recule" dans l'espace pour aligner le point précédent sur le nouveau vent
            const [u, v] = getWindAtPos(cLat, cLon, frameIdx, aU, aV);
            const cosLat = Math.max(0.05, Math.cos(cLat * Math.PI / 180));
            
            cLon -= u * WIND_SCALE * 0.6 / cosLat; 
            cLat -= v * WIND_SCALE * 0.6;
            cLon = ((cLon % 360) + 360) % 360;
            cLat = Math.max(-85, Math.min(85, cLat));
        }
    }
    if (trailMesh && trailMesh.geometry) {
        trailMesh.geometry.attributes.position.needsUpdate = true;
    }
}
// --- CACHE SYSTEM POUR LA CARTE 2D ---
const mapCacheCanvas = document.createElement('canvas');
const mapCacheCtx = mapCacheCanvas.getContext('2d', { alpha: true });
let isMapCached = false;

function render2D() {
    if (!ctx2D || canvas2D.width === 0) return;
    const W = canvas2D.width;
    const H = canvas2D.height;
    const dpr = window.devicePixelRatio || 1;

    ctx2D.clearRect(0, 0, W, H);

    const projectToCanvas = (lat, lon) => {
        let l_360 = ((lon % 360) + 360) % 360;
        const x = (l_360 / 360.0) * W;
        const y = (1.0 - (lat + 90) / 180.0) * H;
        return { x, y };
    };

    // 1. DESSIN DU FOND (CARTE + PINS) VIA CACHE
    if (!isMapCached && coastlinesGeoJSON) {
        mapCacheCtx.clearRect(0, 0, W, H);
        mapCacheCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        mapCacheCtx.lineWidth = 1 * dpr;
        coastlinesGeoJSON.features.forEach(f => {
            const rings = (f.geometry.type === 'Polygon') ? [f.geometry.coordinates] : f.geometry.coordinates;
            rings.forEach(poly => poly.forEach(ring => {
                mapCacheCtx.beginPath();
                for (let n = 0; n < ring.length; n++) {
                    const pos = projectToCanvas(ring[n][1], ring[n][0]);
                    if (n === 0) mapCacheCtx.moveTo(pos.x, pos.y);
                    else {
                        let currL = ((ring[n][0] % 360) + 360) % 360;
                        let prevL = ((ring[n - 1][0] % 360) + 360) % 360;
                        if (Math.abs(currL - prevL) > 180) mapCacheCtx.moveTo(pos.x, pos.y);
                        else mapCacheCtx.lineTo(pos.x, pos.y);
                    }
                }
                mapCacheCtx.stroke();
            }));
        });
        isMapCached = true;
    }

    if (isMapCached) ctx2D.drawImage(mapCacheCanvas, 0, 0);

    // DESSIN DYNAMIQUE DES VILLES SÉLECTIONNÉES
    markers.forEach((m, idx) => {
        if (!selectedSlots.includes(idx)) return;
        const { lat, lon, labelText, isPrimary } = m.userData;
        const pos = projectToCanvas(lat, lon);
        ctx2D.beginPath();
        ctx2D.arc(pos.x, pos.y, (isPrimary ? 4 : 2.5) * dpr, 0, 2 * Math.PI);
        ctx2D.fillStyle = '#ffff00';
        ctx2D.fill();
        ctx2D.font = `${isPrimary ? 'bold' : 'normal'} ${11 * dpr}px Inter, sans-serif`;
        ctx2D.textAlign = 'center';
        ctx2D.textBaseline = 'bottom';
        ctx2D.strokeStyle = '#000';
        ctx2D.lineWidth = 3 * dpr;
        ctx2D.strokeText(labelText, pos.x, pos.y - 5 * dpr);
        ctx2D.fillStyle = '#fff';
        ctx2D.fillText(labelText, pos.x, pos.y - 5 * dpr);
    });

    // 2. DESSIN DU VENT (RESTO DES TRAITS BLANCS ET LONGS)
    const aU2D = isLocalData ? localBufferU : archiveBufferU;
    const aV2D = isLocalData ? localBufferV : archiveBufferV;

    if (PARAMS.showWind && aU2D && aV2D) {
        ctx2D.lineCap = 'round';
        // On remonte un peu le nombre de particules et la longueur pour la fluidité
        const max2DParticles = Math.min(N_PARTICLES, 1200); 
        const max2DTrail = 25; 

        for (let i = 0; i < max2DParticles; i++) {
            const [u, v] = getWindAtPos(pLat[i], pLon[i], PARAMS.currentFrame, aU2D, aV2D);
            const speed = Math.hypot(u, v);
            const sf = Math.max(0.05, Math.min(1.0, speed / 25.0));
            if (sf < 0.1) continue;

            ctx2D.beginPath();
            let cLat = pLat[i], cLon = pLon[i];
            let prevX = -1;
            let started = false;

            for (let t = 0; t < max2DTrail; t++) {
                const pos = projectToCanvas(cLat, cLon);
                if (!started) {
                    ctx2D.moveTo(pos.x, pos.y);
                    started = true;
                } else {
                    if (Math.abs(pos.x - prevX) > W / 2) ctx2D.moveTo(pos.x, pos.y);
                    else ctx2D.lineTo(pos.x, pos.y);
                }
                prevX = pos.x;

                const [up, vp] = getWindAtPos(cLat, cLon, PARAMS.currentFrame, aU2D, aV2D);
                const cosLat = Math.max(0.05, Math.cos(cLat * Math.PI / 180));
                // On utilise un WIND_SCALE normal pour éviter les "sauts" de vitesse
                cLon -= up * WIND_SCALE * 1.2 / cosLat; 
                cLat -= vp * WIND_SCALE * 1.2;
            }

            ctx2D.lineWidth = 1.0 * dpr;
            // Retour au blanc pur avec opacité dynamique selon la vitesse
            ctx2D.strokeStyle = `rgba(255, 255, 255, ${sf * 0.8})`;
            ctx2D.stroke();
        }
    }
}

// ---- Events ----
sliderTime.addEventListener('input', (e) => {
    isPlaying = false;
    if (btnPlay) {
        btnPlay.textContent = '▶ Play';
        btnPlay.classList.remove('playing');
    }
    PARAMS.currentFrame = parseInt(e.target.value);
    
    // NOUVEAU : Réalignement instantané de la forme des vents sur la nouvelle frame
    alignParticlesToFrame(PARAMS.currentFrame);
    
    updateFrame();
});

let currentSeason = 'summer'; // Nouvelles variables d'état (saison)
if (btnToggle) {
    btnToggle.innerText = TRANSLATIONS[currentLang].seasonSummer;

    // Remplacement de l'événement de clic
    btnToggle.addEventListener('click', () => {
        resetRanking();
        currentSeason = currentSeason === 'summer' ? 'winter' : 'summer';

        // Mise à jour visuelle du bouton
        btnToggle.innerText = currentSeason === 'summer' ? TRANSLATIONS[currentLang].seasonSummer : TRANSLATIONS[currentLang].seasonWinter;


        // Mise à jour du label en haut à gauche
        if (typeof uiLabelSet !== 'undefined' && uiLabelSet) {
            uiLabelSet.innerText = `PWAT1 (Japan) — ${currentSeason === 'summer' ? 'Summer' : 'Winter'}`;
        }

        // Action de chargement des données
        if (isLocalData && currentUploadedFiles && currentUploadedFiles.length > 0) {
            alert(TRANSLATIONS[currentLang].alertLocalSeason);
        } else {
            PARAMS.seasonIndex = currentSeason === 'summer' ? 0 : 1;

            loadData();
            console.log(`Chargement des archives pour la saison : ${currentSeason}`);
        }
    });
}
btnPlay.addEventListener('click', () => {
    if (!buffer1 && !localBuffer) return;
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? TRANSLATIONS[currentLang].pause : TRANSLATIONS[currentLang].play;
    if (isPlaying) {

        lastFrameTime = performance.now(); // Solid sync on Play
        btnPlay.classList.add('playing');
    } else {
        btnPlay.classList.remove('playing');
    }
});

// Gestion du bouton de vitesse (déjà présent dans l'index.html)
const btnSpeed = document.getElementById('btn-speed');

if (btnSpeed) {
    btnSpeed.addEventListener('click', () => {
        playbackSpeedIndex = (playbackSpeedIndex + 1) % 3;

        const speeds = [48, 24, 12]; // FPS: 1x=48, 0.5x=24, 0.25x=12
        currentFPS = speeds[playbackSpeedIndex];
        msPerFrame = 1000 / currentFPS;

        const t = TRANSLATIONS[currentLang];
        const speedKeys = ['speed1', 'speed05', 'speed025'];
        // On affiche juste "1x", "0.5x" etc. pour gagner de la place
        btnSpeed.innerText = t[speedKeys[playbackSpeedIndex]].replace('Speed: ', '').replace('速度：', '');

        // Styling based on speed
        if (playbackSpeedIndex === 0) {
            btnSpeed.style.background = '#2a2a2a';
            btnSpeed.style.color = '#e0e0e0';
        } else {
            btnSpeed.style.background = '#4a9eff';
            btnSpeed.style.color = '#fff';
        }
    });
}


const btnToggleWind = document.getElementById('btn-toggle-wind');
btnToggleWind.addEventListener('click', () => {
    PARAMS.showWind = !PARAMS.showWind;
    btnToggleWind.innerText = PARAMS.showWind ? TRANSLATIONS[currentLang].windOn : TRANSLATIONS[currentLang].windOff;
    btnToggleWind.style.borderColor = PARAMS.showWind ? 'var(--border-accent)' : 'var(--border-light)';

    btnToggleWind.style.color = PARAMS.showWind ? 'var(--text-primary)' : 'var(--text-secondary)';
    updateFrame(); // Force le rafraîchissement
});

const btnToggleDataType = document.getElementById('btn-toggle-data-type');

// Couleurs de la vapeur (de très transparent à blanc pur opaque)
const VAPOR_COLORS = [
    'rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.15)',
    'rgba(255, 255, 255, 0.20)', 'rgba(255, 255, 255, 0.30)', 'rgba(255, 255, 255, 0.40)',
    'rgba(255, 255, 255, 0.50)', 'rgba(255, 255, 255, 0.60)', 'rgba(255, 255, 255, 0.70)',
    'rgba(255, 255, 255, 0.80)', 'rgba(255, 255, 255, 0.85)', 'rgba(255, 255, 255, 0.90)',
    'rgba(255, 255, 255, 0.95)', 'rgba(255, 255, 255, 1.0)'
];

// Couleurs Radar (TV Weather) calibrees mm/day
const RAIN_COLORS = ['#3373bd', '#3373bd', '#00ccff', '#00ccff', '#00cc00',
    '#00cc00', '#ffff00', '#ffff00', '#ff8000', '#ff8000', '#ff0000', '#ff0000', '#ff00ff', '#ff00ff'];

function applyLegendColors(colors) {
    const blocks = document.querySelectorAll('.color-blocks div');
    colors.forEach((c, i) => {
        if (blocks[i]) {
            blocks[i].style.background = c;
            blocks[i].style.opacity = 1.0; 
            
            // Gestion intelligente de la lisibilité du texte "Tr" et ">10"
            if (i === 0) {
                blocks[i].style.color = '#888'; // "Tr" gris sur fond sombre
            } else if (i === colors.length - 1) {
                blocks[i].style.color = '#000'; // ">10" noir sur fond blanc opaque
            } else {
                blocks[i].style.color = 'transparent';
            }
        }
    });
}

if (btnToggleDataType) {
    btnToggleDataType.addEventListener('click', () => {
        resetRanking();
        PARAMS.displayMode = (PARAMS.displayMode === 'precip') ? 'pwat' : 'precip';
        btnToggleDataType.innerText = (PARAMS.displayMode === 'pwat') ? TRANSLATIONS[currentLang].modeVapor : TRANSLATIONS[currentLang].modeRain;

        const legendTitle = document.querySelector('.legend-title');

        const labels = document.querySelectorAll('.color-labels span');
        const lastBlock = document.querySelector('.color-blocks div:last-child');

        if (PARAMS.displayMode === 'pwat') {
            material.uniforms.u_mode.value = 0.0;
            material.uniforms.u_overlay.value = 0.0;
            if (legendTitle) legendTitle.innerText = TRANSLATIONS[currentLang].legendVapor;
            applyLegendColors(VAPOR_COLORS);

            const colorBlocks = document.querySelector('.color-blocks');
            const colorLabels = document.querySelector('.color-labels');
            if (colorBlocks) colorBlocks.style.display = 'flex';
            if (colorLabels) colorLabels.style.display = 'flex';

            if (lastBlock) { lastBlock.textContent = '>10'; lastBlock.style.color = '#fff'; }

            if (labels.length >= 3) {
                labels[0].innerText = '0.001';
                labels[1].innerText = '0.05';
                labels[2].innerText = '10.0';
            }
            if (atmosphereSphere) atmosphereSphere.visible = false;
            if (atmospherePlane) atmospherePlane.visible = false;
        } else {
            material.uniforms.u_mode.value = 1.0;
            material.uniforms.u_overlay.value = 1.0;
            if (legendTitle) legendTitle.innerText = TRANSLATIONS[currentLang].legendRain;

            const colorBlocks = document.querySelector('.color-blocks');
            const colorLabels = document.querySelector('.color-labels');
            if (colorBlocks) colorBlocks.style.display = 'none';
            if (colorLabels) colorLabels.style.display = 'none';

            // Visibilité des nuages activée par défaut en mode precip (Vapor + Clouds)
            if (atmosphereSphere) atmosphereSphere.visible = (PARAMS.viewMode === 0 || PARAMS.viewMode === 2);
            if (atmospherePlane) atmospherePlane.visible = (PARAMS.viewMode === 1 || PARAMS.viewMode === 2);
        }
        updateFrame();
    });
}

const btnToggleAutoRotate = document.getElementById('btn-toggle-autorotate');
if (btnToggleAutoRotate) {
    // Style initial "ON"
    btnToggleAutoRotate.style.borderColor = 'var(--border-accent)';
    btnToggleAutoRotate.style.color = 'var(--text-primary)';

    btnToggleAutoRotate.addEventListener('click', () => {
        autoRotateEnabled = !autoRotateEnabled;
        // Si on désactive manuellement, on force l'arrêt immédiat
        if (!autoRotateEnabled) controls.autoRotate = false;

        btnToggleAutoRotate.innerText = autoRotateEnabled ?
            (currentLang === 'EN' ? "Auto-Rotate: ON" : "自動回転：ON") :
            (currentLang === 'EN' ? "Auto-Rotate: OFF" : "自動回転：OFF");

        btnToggleAutoRotate.style.borderColor = autoRotateEnabled ? 'var(--border-accent)' : 'var(--border-light)';
        btnToggleAutoRotate.style.color = autoRotateEnabled ? 'var(--text-primary)' : 'var(--text-secondary)';
    });
}
btnToggleView.addEventListener('click', () => {
    PARAMS.viewMode = (PARAMS.viewMode + 1) % 3;
    const labels = [TRANSLATIONS[currentLang].view3D, TRANSLATIONS[currentLang].view2D, TRANSLATIONS[currentLang].viewSplit];
    btnToggleView.innerText = labels[PARAMS.viewMode];
    if (PARAMS.viewMode === 0) {

        canvas2DContainer.style.display = 'none';
        camera3D.position.set(0, 0, 3.5);
    } else if (PARAMS.viewMode === 1) {
        canvas2DContainer.style.display = 'flex';
        canvas2DContainer.style.width = '100%';
        canvas2DContainer.style.borderRight = 'none';
        dataPlane.rotation.set(0, 0, 0);
        dataPlane.position.set(0, 0, 0);
    } else {
        canvas2DContainer.style.display = 'flex';
        canvas2DContainer.style.width = '50%';
        canvas2DContainer.style.borderRight = '2px solid #333';
        dataPlane.rotation.set(0, 0, 0);
        dataPlane.position.set(0, 0, 0);
        camera3D.position.set(0, 0, 3.5);
    }
    updateCameras();
    camera2D.lookAt(0, 0, 0);
    camera3D.lookAt(0, 0, 0);
    applyLegendColors(VAPOR_COLORS);
    updateFrame();
});

// Initialization
applyLegendColors(VAPOR_COLORS);
updateCameras();
camera2D.lookAt(0, 0, 0);

// --- Focus initial sur Tokyo ---
const startLat = 35.68 * Math.PI / 180;
const startLon = 139.77 * Math.PI / 180;
const dist = 3.5;
camera3D.position.set(
    dist * Math.cos(startLat) * Math.cos(startLon),
    dist * Math.sin(startLat),
    -dist * Math.cos(startLat) * Math.sin(startLon)
);
camera3D.lookAt(0, 0, 0);
controls.update();

updateFrame();
// --- NEW ATMOSPHERIC SYSTEM ---
function createAtmosphere() {
    const texLoader = new THREE.TextureLoader();
    const cloudColorTex = texLoader.load('nasa_clouds.jpg');

    // Éclairage global doux (HemisphereLight)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x0a1a3a, 0.85);
    scene.add(hemiLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8);
    directionalLight.position.set(5, 2, 3); // Position fixe dans l'espace
    scene.add(directionalLight);

    const cloudColorTex2D = cloudColorTex.clone();
    cloudColorTex2D.wrapS = THREE.RepeatWrapping; cloudColorTex2D.offset.x = 0.5;

    function createAtmosphereMaterial(is3D) {
        const mat = new THREE.MeshStandardMaterial({
            map: is3D ? cloudColorTex : cloudColorTex2D,
            alphaMap: is3D ? cloudColorTex : cloudColorTex2D, // On utilise la texture pour l'alpha de base
            bumpMap: is3D ? cloudColorTex : cloudColorTex2D,  // NOUVEAU : Crée le relief 3D avec la lumière
            bumpScale: 0.025,                                 // NOUVEAU : Intensité du relief
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide // Permet à la lumière interne de l'éclair de fonctionner
        });

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.tData = { value: dataTexture };
            shader.uniforms.tVaporData = { value: vaporTexture };
            shader.uniforms.u_mode = material.uniforms.u_mode;

            shader.fragmentShader = `
                uniform sampler2D tData;
                uniform sampler2D tVaporData;
                uniform float u_mode;
                varying float vShellHeight;
            ` + shader.fragmentShader;

            const uvLogic = is3D ? `
                float lon = vMapUv.x * 360.0 - 180.0;
                float gribLon = (lon < 0.0 ? lon + 360.0 : lon);
                vec2 finalUv = vec2(gribLon / 360.0, 1.0 - vMapUv.y);
            ` : `
                float rawX = fract(vMapUv.x - 0.5);
                vec2 finalUv = vec2(rawX, 1.0 - vMapUv.y);
            `;

            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <alphamap_fragment>`,
                `
                #include <alphamap_fragment>
                ${uvLogic}
                float prate = texture2D(tData, finalUv).r; 
                
                if (u_mode > 0.5) {
                    float pwat_val = texture2D(tVaporData, finalUv).r; 
                    if (pwat_val < 0.001) discard;

                    float rainDensity = smoothstep(0.1, 10.0, prate);
                    float fluffiness = diffuseColor.r; 
                    float combinedCloud = rainDensity * fluffiness;
                    float finalAlpha = smoothstep(0.05, 0.3, combinedCloud);
                    float shellAlpha = 1.0 - smoothstep(combinedCloud - 0.15, combinedCloud + 0.05, vShellHeight);
                    
                    diffuseColor.a = finalAlpha * shellAlpha * 0.95; 
                    
                    vec3 baseCloudColor = vec3(1.0);
                    float shadowFactor = smoothstep(0.0, 1.0, vShellHeight);
                    baseCloudColor *= (0.4 + 0.6 * shadowFactor);
                    
                    float stormFactor = smoothstep(5.0, 25.0, prate); 
                    vec3 stormColor = vec3(0.45, 0.50, 0.60); 
                    
                    diffuseColor.rgb = mix(baseCloudColor, stormColor, stormFactor);
                } else {
                    diffuseColor.a = 0.0;
                    discard;
                }
                `
            );

            shader.vertexShader = `
                attribute float shellHeight;
                varying float vShellHeight;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                vShellHeight = shellHeight;
                `
            );
        };
        return mat;
    }

    const atmosphereMat3D = createAtmosphereMaterial(true);
    const atmosphereMat2D = createAtmosphereMaterial(false);

    const SHELL_COUNT = 10;
    const dummy = new THREE.Object3D();
    const shellHeights = new Float32Array(SHELL_COUNT);
    for (let i = 0; i < SHELL_COUNT; i++) shellHeights[i] = i / (SHELL_COUNT - 1);

    // --- Version 3D Sphere (Volumétrique) ---
    const geom3D = new THREE.SphereGeometry(1.05, 128, 128);
    geom3D.setAttribute('shellHeight', new THREE.InstancedBufferAttribute(shellHeights, 1));

    atmosphereSphere = new THREE.InstancedMesh(geom3D, atmosphereMat3D, SHELL_COUNT);
    atmosphereSphere.renderOrder = 3;
    atmosphereSphere.visible = (PARAMS.displayMode === 'precip' && (PARAMS.viewMode === 0 || PARAMS.viewMode === 2));

    for (let i = 0; i < SHELL_COUNT; i++) {
        const scale = 1.0 + shellHeights[i] * (0.06 / 1.05); // Épaisseur 3D du nuage = 0.06 unités
        dummy.scale.set(scale, scale, scale);
        dummy.position.set(0, 0, 0);
        dummy.updateMatrix();
        atmosphereSphere.setMatrixAt(i, dummy.matrix);
    }
    scene.add(atmosphereSphere);

    // --- Version 2D Plane (Volumétrique) ---
    const geom2D = new THREE.PlaneGeometry(2.04, 1.0);
    geom2D.setAttribute('shellHeight', new THREE.InstancedBufferAttribute(shellHeights, 1));

    atmospherePlane = new THREE.InstancedMesh(geom2D, atmosphereMat2D, SHELL_COUNT);
    atmospherePlane.position.set(0, 0, 0.05);
    atmospherePlane.renderOrder = 3;
    atmospherePlane.visible = (PARAMS.displayMode === 'precip' && (PARAMS.viewMode === 1 || PARAMS.viewMode === 2));

    for (let i = 0; i < SHELL_COUNT; i++) {
        dummy.scale.set(1, 1, 1);
        dummy.position.set(0, 0, shellHeights[i] * 0.06);
        dummy.updateMatrix();
        atmospherePlane.setMatrixAt(i, dummy.matrix);
    }
    scene.add(atmospherePlane);

    // Lumière pour le mode 2D
    const dirLight2D = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight2D.position.set(0, 0, 5);
    camera2D.add(dirLight2D);
    scene.add(camera2D);
}

initParticles(); // Démarrage du système de particules
createAtmosphere();



// Flag d'avancement : true uniquement lors d'un tick Play
let _doAdvance = false;

function animateLoop(t) {
    requestAnimationFrame(animateLoop);
    // Gestion intelligente de la rotation :
    // On tourne si : activé ET (on n'est pas en train de dragguer) ET (soit c'est le début, soit 10s sont passées)
    if (isCinematicMode || (autoRotateEnabled && !isDraggingGlobe && (performance.now() - lastInteractionTime > INACTIVITY_DELAY))) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = isCinematicMode ? 0.3 : 0.5;
    } else {
        controls.autoRotate = false;
    }
    controls.update();

    if (material && material.uniforms.u_time) {
        material.uniforms.u_time.value = t * 0.001;

        if (isPlaying) {
            // Calcule à quel point on est proche du prochain jour (0.0 à 1.0)
            const progress = (t - lastFrameTime) / msPerFrame;
            material.uniforms.u_lerp.value = Math.min(1.0, progress);
        } else {
            material.uniforms.u_lerp.value = 0.0;
        }
    }



    _doAdvance = false; // reset chaque frame RAF

    if (isPlaying && (t - lastFrameTime >= msPerFrame)) {
        // VERROU STRICT : Aucun rattrapage mathématique. 
        // Si le GPU rame (ex: vue comparative), la simulation attend son tour et ralentit gracieusement, 
        // ce qui évite les sauts de jours et les accélérations brutales.
        lastFrameTime = t;

        PARAMS.currentFrame = (PARAMS.currentFrame + 1) % PARAMS.frames;
        if (PARAMS.currentFrame === 0) {
            alignParticlesToFrame(0);
        }
        updateFrame();
        _doAdvance = true;
    }

    // RÉGULATEUR DE CHARGE CPU : On bride l'animation du vent à 30 FPS max (toutes les ~33ms) ou 20 FPS (50ms) en Precip
    // Cela libère énormément de puissance processeur pour que le mode Comparative reste fluide.
    const windDelay = (PARAMS.displayMode === 'precip') ? 50 : 33;
    if (t - lastWindTime > windDelay) {
        updateParticles(PARAMS.currentFrame, _doAdvance);
        if (PARAMS.viewMode !== 0) render2D(); // NOUVEAU : La 2D est dessinée en flux continu
        lastWindTime = t;
    }



    const W = mainContent.clientWidth;
    const H = mainContent.clientHeight;

    if (PARAMS.viewMode === 0) {
        // --- RENDU 100% 3D ---
        renderer.setViewport(0, 0, W, H);
        renderer.setScissorTest(false);
        material.uniforms.u_is3D.value = 1.0;

        dataPlane.visible = false; basePlane.visible = false;
        dataSphere.visible = true; globe.visible = true; graticule.visible = true;
        if (coastMesh) coastMesh.visible = true; // 🛡️ SÉCURITÉ ICI
        if (atmosphereSphere) atmosphereSphere.visible = (PARAMS.displayMode === 'precip');
        if (atmospherePlane) atmospherePlane.visible = false;

        const camPos = camera3D.position;
        const camDir = camPos.clone().normalize();
        markers.forEach((m, idx) => {
            const isSelected = selectedSlots.includes(idx);
            // Visible SI sélectionnée ET du bon côté du globe
            const isVisible = isSelected && (camDir.dot(m.position.clone().normalize()) > 0);
            m.visible = isVisible;
            if (isVisible && m.userData.sprite) {
                m.userData.sprite.visible = true;
            }
        });
        renderer.render(scene, camera3D);

    } else if (PARAMS.viewMode === 1) {
        // --- RENDU 100% 2D ---
        renderer.setViewport(0, 0, W, H);
        renderer.setScissorTest(false);
        material.uniforms.u_is3D.value = 0.0;

        dataPlane.visible = true; basePlane.visible = true;
        dataSphere.visible = false; globe.visible = false; graticule.visible = false;
        if (coastMesh) coastMesh.visible = false; // 🛡️ SÉCURITÉ ICI
        if (atmosphereSphere) atmosphereSphere.visible = false;
        if (atmospherePlane) atmospherePlane.visible = (PARAMS.displayMode === 'precip');
        markers.forEach(m => { m.visible = false; });
        renderer.render(scene, camera2D);

    } else if (PARAMS.viewMode === 2) {
        // --- RENDU COMPARATIF (SPLIT) ---
        const W = mainContent.clientWidth;
        const H = mainContent.clientHeight;
        const halfW = W / 2;
        renderer.setScissorTest(true);

        // GAUCHE (2D)
        renderer.setViewport(0, 0, halfW, H);
        renderer.setScissor(0, 0, halfW, H);
        material.uniforms.u_is3D.value = 0.0;
        dataPlane.visible = true; basePlane.visible = true;
        dataSphere.visible = false; globe.visible = false; graticule.visible = false;

        if (atmosphereSphere) atmosphereSphere.visible = false;
        if (atmospherePlane) atmospherePlane.visible = (PARAMS.displayMode === 'precip');

        // 🛡️ ON CACHE LES FLÈCHES 3D ICI
        if (trailMesh) trailMesh.visible = false;

        if (coastMesh) coastMesh.visible = false;
        markers.forEach(m => { m.visible = false; });
        renderer.render(scene, camera2D);

        // DROITE (3D)
        renderer.setViewport(halfW, 0, halfW, H);
        renderer.setScissor(halfW, 0, halfW, H);
        material.uniforms.u_is3D.value = 1.0;
        dataPlane.visible = false; basePlane.visible = false;
        dataSphere.visible = true; globe.visible = true; graticule.visible = true;

        if (atmosphereSphere) atmosphereSphere.visible = (PARAMS.displayMode === 'precip');
        if (atmospherePlane) atmospherePlane.visible = false;

        // 🛡️ ON RÉACTIVE LES FLÈCHES 3D ICI
        if (trailMesh) trailMesh.visible = PARAMS.showWind;

        if (coastMesh) coastMesh.visible = true;
        const camPos = camera3D.position;
        const camDir = camPos.clone().normalize();
        markers.forEach((m, idx) => {
            const isSelected = selectedSlots.includes(idx);
            // Visible SI sélectionnée ET du bon côté du globe
            const isVisible = isSelected && (camDir.dot(m.position.clone().normalize()) > 0);
            m.visible = isVisible;
            if (isVisible && m.userData.sprite) {
                m.userData.sprite.visible = true;
            }
        });
        renderer.render(scene, camera3D);

        renderer.setScissorTest(false);
    }
}
requestAnimationFrame(animateLoop);

window.addEventListener('resize', updateCameras);
loadData();
updateLanguageUI(); // Initialisation de la langue UI

// ============================================================================
// ── UI V3 : DRAG & DROP ET LECTURE MULTIPLE (.bin / .nc) ──
// ============================================================================
const tabArchives = document.getElementById('tab-archives');
const tabUpload = document.getElementById('tab-upload');
const uploadView = document.getElementById('upload-view');
const dropZoneBox = document.getElementById('drop-zone-box');
const btnBrowse = document.getElementById('btn-browse');
const fileInput = document.getElementById('file-input');

// 1. Activation de la sélection multiple
if (fileInput) {
    fileInput.setAttribute('multiple', '');
    fileInput.setAttribute('accept', '.nc,.bin,.ft*');
}

// -- VÉRITABLE DRAG & DROP --
if (dropZoneBox) {
    dropZoneBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZoneBox.style.background = 'rgba(255,255,255,0.1)';
        dropZoneBox.style.border = '2px dashed #00bfff';
    });
    dropZoneBox.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZoneBox.style.background = 'transparent';
        dropZoneBox.style.border = 'none';
    });
    dropZoneBox.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZoneBox.style.background = 'transparent';
        dropZoneBox.style.border = 'none';

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files);
        }
    });
}

// --- LOGIQUE DES ONGLETS AVEC RESET ---
// --- LOGIQUE DES ONGLETS CORRIGÉE ---
// --- LOGIQUE DES ONGLETS CORRIGÉE ET COMPLÈTE ---
if (tabArchives && tabUpload) {

    // 1. CLIC SUR ARCHIVES
    tabArchives.addEventListener('click', () => {
        resetRanking();
        // 1. Arrêt de la lecture
        isPlaying = false;
        btnPlay.textContent = '▶ Play';
        btnPlay.classList.remove('playing');

        // 2. Mise en surbrillance de l'onglet
        tabArchives.classList.add('active-tab');
        tabUpload.classList.remove('active-tab');

        // 3. Gestion de l'affichage des menus
        if (uploadView) uploadView.style.display = 'none';
        if (archiveUI) archiveUI.style.display = 'block';
        if (localUI) localUI.style.display = 'none'; // Cache les options locales
        if (commonUI) commonUI.style.display = 'block'; // On remontre le bouton Play
        const archiveDataGroup = document.getElementById('archive-data-group');
        if (archiveDataGroup) archiveDataGroup.style.display = 'block';

        // 4. On remet la date dans le coin gauche
        if (uiDateDisplay) {
            uiDateDisplay.parentElement.style.width = "auto";
            uiDateDisplay.parentElement.style.textAlign = "left";
        }

        // 5. On recharge les données d'archives
        isLocalData = false;
        PARAMS.currentFrame = 0;
        loadData();
    });

    // 2. CLIC SUR IMPORT LOCAL
    tabUpload.addEventListener('click', () => {
        resetRanking();
        // 1. Arrêt de la lecture
        isPlaying = false;
        btnPlay.textContent = '▶ Play';
        btnPlay.classList.remove('playing');

        // 2. Mise en surbrillance de l'onglet
        tabUpload.classList.add('active-tab');
        tabArchives.classList.remove('active-tab');

        // 3. Gestion de l'affichage des menus
        if (archiveUI) archiveUI.style.display = 'none'; // Cache (Period, Tracer...)
        if (localUI) localUI.style.display = 'block'; // Affiche les options locales s'il y a lieu
        const archiveDataGroup = document.getElementById('archive-data-group');
        if (archiveDataGroup) archiveDataGroup.style.display = 'none';

        if (localBuffer) {
            uploadView.style.display = 'none'; // On cache la zone de drop pour afficher le globe
            if (commonUI) commonUI.style.display = 'block'; // Affiche la barre de lecture
        } else {
            uploadView.style.display = 'flex'; // Affiche la zone de drop
            if (commonUI) commonUI.style.display = 'none'; // Cache le bouton Play
        }

        // 4. Étire le conteneur et centre le texte au milieu de l'écran si pas de données locales
        if (uiDateDisplay) {
            if (!localBuffer) {
                uiDateDisplay.innerText = "WAITING FOR FILES...";
                uiDateDisplay.parentElement.style.width = "100%";
                uiDateDisplay.parentElement.style.textAlign = "center";
                uiDateDisplay.parentElement.style.display = "block";
            } else {
                uiDateDisplay.parentElement.style.width = "auto";
                uiDateDisplay.parentElement.style.textAlign = "left";
                // L'affichage de la bannière se mettra à jour automatiquement via updateFrame()
            }
        }

        // 5. Déclenche la fonction qui met le globe à zéro
        isLocalData = true;
        updateFrame();
    });

    // Le clic sur "Retour aux Archives"
    const btnBackArchives = document.getElementById('btn-back-archives');
    if (btnBackArchives) {
        btnBackArchives.addEventListener('click', (e) => {
            e.preventDefault();
            if (tabArchives) tabArchives.click();
        });
    }

    // Le bouton parcourir
    btnBrowse.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => handleFileSelection(e.target.files));
}

// 2. Validation et Routage (Version Multi-fichiers)
function handleFileSelection(files) {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    const fileName = fileList[0].name.toLowerCase();

    if (fileName.endsWith('.nc')) {
        console.log("Lecture NetCDF locale");
    } else if (fileName.includes('.ft')) {
        currentUploadedFiles = fileList;
        processMultipleGRIBWithVercel(fileList, 150); // Toujours le Japon
    } else if (fileName.includes('.bin')) {
        readMultipleBinFiles(fileList);
    }
}

async function scanFileForVariables(file) {
    if (typeof uiDateDisplay !== 'undefined') uiDateDisplay.innerText = "SCANNING FILE...";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("action", "scan");

    try {
        const response = await fetch('https://isogsm-backend.onrender.com/decode', {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (result.variables && result.variables.length > 0) {
            buildVariableMenu(result.variables);
            // On lance le décodage initial avec la première variable de la liste
            processMultipleGRIBWithVercel(currentUploadedFiles, result.variables[0].id);
        } else {
            throw new Error("No variables found in file.");
        }
    } catch (e) {
        console.error("Scanning error:", e);
        if (typeof uiDateDisplay !== 'undefined') uiDateDisplay.innerText = "SCANNING ERROR";
    }
}

function buildVariableMenu(variables) {
    const container = document.getElementById('local-specific-ui');
    let selectMenu = document.getElementById('dynamic-tracer-select');

    // Si le menu n'existe pas, on le crée
    if (!selectMenu) {
        selectMenu = document.createElement('select');
        selectMenu.id = 'dynamic-tracer-select';
        selectMenu.style.width = '100%';
        selectMenu.style.marginBottom = '10px';
        selectMenu.style.padding = '4px';

        if (container) {
            container.appendChild(selectMenu);
        }

        // Événement : Relance le décodage complet si on change de variable
        selectMenu.addEventListener('change', (e) => {
            const newParamId = parseInt(e.target.value);
            processMultipleGRIBWithVercel(currentUploadedFiles, newParamId);
        });
    }

    // Peupler le menu
    selectMenu.innerHTML = '';
    variables.forEach(v => {
        const option = document.createElement('option');
        option.value = v.id;
        const displayName = v.name !== 'unknown' ? v.name : `Tracer (ID: ${v.id})`;
        option.innerText = `[Lvl ${v.level}] ${displayName}`;
        selectMenu.appendChild(option);
    });
}

async function processMultipleGRIBWithVercel(files, paramId = 150) {
    try {
        console.warn(`[DEBUG IsoGSM] processMultipleGRIBWithVercel appelé avec ${files.length} fichiers !`);

        if (typeof uiDateDisplay !== 'undefined' && uiDateDisplay) {
            uiDateDisplay.innerText = `DECODING ${files.length} FILES...`;
            uiDateDisplay.parentElement.style.display = "block";
        }

        // 1. Sort files sequentially (ft00, ft24, ft48...)
        files.sort((a, b) => {
            const numA = parseInt(a.name.match(/\d+/)?.[0] || 0);
            const numB = parseInt(b.name.match(/\d+/)?.[0] || 0);
            return numA - numB;
        });

        const GRID_SIZE = 192 * 94;
        const cleanArray = (dataArr) => new Float32Array(dataArr).map(v => (v > 1000 || isNaN(v)) ? 0 : v);
        const combinedBuffer = new Float32Array(files.length * GRID_SIZE);
        const combinedBufferP = new Float32Array(files.length * GRID_SIZE);
        const combinedBufferU = new Float32Array(files.length * GRID_SIZE);
        const combinedBufferV = new Float32Array(files.length * GRID_SIZE);

        let framesLoaded = 0;

        const fetchParam = async (id, file) => {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("param_id", id);
            formData.append("action", "decode");
            const response = await fetch('https://isogsm-backend.onrender.com/decode', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) return null;
            return (await response.json()).data;
        };

        // 2. Process each file
        for (let i = 0; i < files.length; i++) {
            console.log(`[DEBUG IsoGSM] Fetching params for ${files[i].name} (${i + 1}/${files.length})`);

            try {
                const [data150, dataP, dataU, dataV] = await Promise.all([
                    fetchParam(150, files[i]), // PWAT
                    fetchParam(67, files[i]),  // PRATE1 (Pluie tracée)
                    fetchParam(33, files[i]),  // U
                    fetchParam(34, files[i])   // V
                ]);

                if (data150) combinedBuffer.set(cleanArray(data150), framesLoaded * GRID_SIZE);
                if (dataP) combinedBufferP.set(cleanArray(dataP), framesLoaded * GRID_SIZE);
                if (dataU) combinedBufferU.set(cleanArray(dataU), framesLoaded * GRID_SIZE);
                if (dataV) combinedBufferV.set(cleanArray(dataV), framesLoaded * GRID_SIZE);

                framesLoaded++;
                if (typeof uiDateDisplay !== 'undefined' && uiDateDisplay) {
                    uiDateDisplay.innerText = `DECODING: ${framesLoaded} / ${files.length}...`;
                }
            } catch (e) {
                console.error("Error decoding file:", files[i].name, e);
            }
        }

        if (framesLoaded === 0) throw new Error("No files were successfully processed.");

        // 4. Update the 3D Player state
        localBuffer = combinedBuffer.slice(0, framesLoaded * GRID_SIZE);
        localBufferPrecip = combinedBufferP.slice(0, framesLoaded * GRID_SIZE);
        localBufferU = combinedBufferU.slice(0, framesLoaded * GRID_SIZE);
        localBufferV = combinedBufferV.slice(0, framesLoaded * GRID_SIZE);
        localFramesLoaded = framesLoaded;
        console.warn(`[DEBUG IsoGSM] FIN. Mise à jour de PARAMS.frames à ${framesLoaded} !`);

        PARAMS.frames = framesLoaded;
        PARAMS.currentFrame = 0;
        isLocalData = true;

        if (typeof sliderTime !== 'undefined' && sliderTime) {
            sliderTime.max = framesLoaded - 1;
            sliderTime.value = 0;
        }

        const datasetLabel = document.getElementById('dataset-label');
        if (datasetLabel) datasetLabel.innerText = `${framesLoaded} .ft file(s) decoded`;

        if (typeof uploadView !== 'undefined' && uploadView) uploadView.style.display = 'none';
        if (typeof commonUI !== 'undefined' && commonUI) commonUI.style.display = 'block';

        updateFrame();
        console.log(`Success: ${framesLoaded} frames loaded and assembled.`);

    } catch (error) {
        console.error("Vercel decoding error:", error);
        alert("Error during decoding: " + error.message);
        if (typeof uiDateDisplay !== 'undefined' && uiDateDisplay) {
            uiDateDisplay.innerText = "WAITING FOR FILES...";
        }
    }
}




async function readMultipleBinFiles(files) {
    const GRID_SIZE = 192 * 94;
    const BYTES_PER_GRID = GRID_SIZE * 4;

    // ---------------------------------------------------------
    // 🛠️ RÉGLAGE IMPORTANT : Index de la variable (Record)
    // Ton fichier de 2.6 Mo contient plein de variables.
    // PWAT n'est probablement pas la première (0). 
    // Il faudra ajuster ce chiffre pour trouver la bonne carte !
    // ---------------------------------------------------------
    const RECORD_INDEX_TO_EXTRACT = 38;

    // Trie les fichiers dans le bon ordre chronologique (ft00, ft24, ft48...)
    files.sort((a, b) => {
        const numA = parseInt(a.name.match(/\d+/)?.[0] || 0);
        const numB = parseInt(b.name.match(/\d+/)?.[0] || 0);
        return numA - numB;
    });

    let totalFrames = 0;
    let allFramesData = [];

    try {
        for (let file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const dataView = new DataView(arrayBuffer);
            const fileSize = arrayBuffer.byteLength;

            // 1. Détection automatique de l'Endianness
            let isLittleEndian = true;
            if (dataView.getUint32(0, true) > 100000000) {
                isLittleEndian = false;
            }

            const frameData = new Float32Array(GRID_SIZE);
            let offset = 0;
            let currentRecord = 0;
            let dataFound = false;

            // 2. L'Explorateur de Fichier Fortran
            while (offset < fileSize) {
                const recordLength = dataView.getUint32(offset, isLittleEndian);
                offset += 4;

                if (currentRecord === RECORD_INDEX_TO_EXTRACT) {
                    if (recordLength === BYTES_PER_GRID) {
                        for (let i = 0; i < GRID_SIZE; i++) {
                            frameData[i] = dataView.getFloat32(offset + i * 4, isLittleEndian);
                        }
                        dataFound = true;
                    } else {
                        console.warn(`Warning: Variable No. ${RECORD_INDEX_TO_EXTRACT} does not correspond to a 192x94 2D grid.`);
                    }
                    break;
                }

                offset += recordLength;
                offset += 4;
                currentRecord++;
            }

            if (dataFound) {
                allFramesData.push(frameData);
                totalFrames++;
            }
        }

        if (totalFrames === 0) {
            alert(`No compatible data could be extracted at index ${RECORD_INDEX_TO_EXTRACT}.`);
            return;
        }

        // 3. Fusion de toutes les frames
        const combinedBuffer = new Float32Array(totalFrames * GRID_SIZE);
        for (let i = 0; i < totalFrames; i++) {
            combinedBuffer.set(allFramesData[i], i * GRID_SIZE);
        }

        // 4. Mise à jour du moteur 3D
        localFramesLoaded = totalFrames;
        PARAMS.frames = totalFrames;
        PARAMS.currentFrame = 0;
        if (sliderTime) sliderTime.max = PARAMS.frames - 1;
        localBuffer = combinedBuffer;
        isLocalData = true;

        const datasetLabel = document.getElementById('dataset-label');
        if (datasetLabel) datasetLabel.innerText = `${totalFrames} file(s) loaded`;
        if (uploadView) uploadView.style.display = 'none';
        if (commonUI) commonUI.style.display = 'block';

        updateFrame();
        console.log(`Success: ${totalFrames} frames in ${isLittleEndian ? "Little-Endian" : "Big-Endian"}`);

    } catch (err) {
        console.error("Fortran reading error:", err);
        alert("Error during binary decoding of files.");
    }
}

// --- GESTION DU HUD ET CINEMATIC MODE ---

// 1. Touche 'H' pour masquer l'UI
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'h') {
        document.querySelector('.side-panel').classList.toggle('ui-hidden');
    }
});

// 2. Mise à jour du HUD dans updateFrame
function updateHUD(dateStr) {
    const hud = document.getElementById('hud-date');
    if (hud) hud.innerText = dateStr;
}

// 3. Logique des Segmented Controls pour le switch Data
const btnPwat = document.getElementById('btn-pwat');
const btnPrecip = document.getElementById('btn-precip');

function switchDataMode(mode) {
    PARAMS.displayMode = mode;

    // Toggle classes active
    btnPwat.classList.toggle('active', mode === 'pwat');
    btnPrecip.classList.toggle('active', mode === 'precip');

    // Style dynamique de l'interface
    const accent = (mode === 'pwat') ? '#4a9eff' : '#a1aab5';
    document.documentElement.style.setProperty('--accent-blue', accent);

    // Mise à jour Shader et Légende (Ton code précédent ici)
    material.uniforms.u_mode.value = (mode === 'pwat') ? 0.0 : 1.0;
    updateFrame();
}

if (btnPwat) btnPwat.addEventListener('click', () => switchDataMode('pwat'));
if (btnPrecip) btnPrecip.addEventListener('click', () => switchDataMode('precip'));

// 4. Update Slider Visual (Track fill)
sliderTime.addEventListener('input', () => {
    const val = (sliderTime.value / sliderTime.max) * 100;
    document.querySelector('.slider-track-fill').style.width = `${val}%`;
});

// Initialisation finale
markers = []; 
CITIES_DB.forEach(city => {
    createMarker(city.lat, city.lon, city.name, city.cc, true);
});

initComparisonSlots(); // Initialise les menus déroulants en bas
updateFrame();

// --- NARRATIVE SCROLL LOGIC ---
const narrativeWrapper = document.getElementById('narrative-wrapper');
const appUi = document.getElementById('app-ui');

function enterSimulation() {
    isCinematicMode = false;
    lastInteractionTime = performance.now();
    narrativeWrapper.style.opacity = '0';
    setTimeout(() => {
        narrativeWrapper.style.display = 'none';
        appUi.style.opacity = '1';
        document.body.style.overflow = 'hidden';
    }, 1000);
}

['btn-enter-direct', 'btn-enter-story'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', enterSimulation);
});