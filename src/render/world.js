// The tavern: room, bar, table, props and lighting. Exposes shared materials for other builders.
import * as THREE from 'three';
import { scene, canvasTex } from './core.js';
import { woodCanvas, feltCanvas, softDot } from './textures.js';
import { rand, pick, UP } from '../util.js';

export const mats = {};
export const world = { lights: [], haze: [], dust: null, lampPivot: null, spot: null };
export const TABLE = { radius: 1.06, feltRadius: 0.8 };
const _v = new THREE.Vector3();

export function buildWorld() {
  mats.brass = new THREE.MeshStandardMaterial({ color: 0xb8893e, metalness: 1, roughness: 0.3, envMapIntensity: 2 });
  mats.chair = new THREE.MeshStandardMaterial({ color: 0x2e170b, roughness: 0.6 });
  mats.pewter = new THREE.MeshStandardMaterial({ color: 0x8a8478, metalness: 0.85, roughness: 0.38 });
  buildRoom();
  buildBar();
  buildLamp();
  buildTable();
  buildAtmosphere();
}

function buildRoom() {
  const floorTex = canvasTex(woodCanvas(512, { planks: 8, base: [92, 54, 32], dark: [30, 16, 9], seed: 5 }), { repeat: [7, 7] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.76; floor.receiveShadow = true; scene.add(floor);
  const wallTex = canvasTex(woodCanvas(512, { planks: 10, base: [70, 38, 24], dark: [24, 12, 7], vertical: true, seed: 11 }), { repeat: [10, 1] });
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 4.2, 48, 1, true), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, side: THREE.BackSide }));
  walls.position.y = 1.3; scene.add(walls);
  const rafter = new THREE.MeshStandardMaterial({ color: 0x1c100a, roughness: 0.9 });
  for (const x of [-1.6, 0, 1.6]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 10.4), rafter); b.position.set(x, 2.95, 0); scene.add(b); }
}

function buildBar() {
  const barWood = new THREE.MeshStandardMaterial({ map: canvasTex(woodCanvas(256, { planks: 3, base: [96, 50, 28], dark: [34, 16, 8], seed: 21 })), roughness: 0.55 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 0.6), barWood); counter.position.set(0, -0.2, -3.6); counter.receiveShadow = true; scene.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.35, 0.06, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.3, metalness: 0.1 })); top.position.set(0, 0.37, -3.6); scene.add(top);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2b170c, roughness: 0.8 });
  const shelfY = [0.95, 1.45, 1.95];
  for (const y of shelfY) { const s = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.05, 0.3), shelfMat); s.position.set(0, y, -4.75); scene.add(s); }
  const prof = [[0, 0], [0.036, 0], [0.041, 0.012], [0.041, 0.16], [0.032, 0.2], [0.013, 0.235], [0.012, 0.29], [0.015, 0.3], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  const bottleMat = new THREE.MeshStandardMaterial({ roughness: 0.24, metalness: 0.1, envMapIntensity: 2 });
  const nB = 42, bottles = new THREE.InstancedMesh(new THREE.LatheGeometry(prof, 14), bottleMat, nB);
  const glass = [0x1f4a1c, 0x5a2d0c, 0x7a4a12, 0x24324a, 0x3a0f14, 0x6b6a52, 0x14301f];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < nB; i++) {
    const row = i % 3, x = -1.65 + (Math.floor(i / 3) / (nB / 3 - 1)) * 3.3 + rand(-0.04, 0.04), s = rand(0.85, 1.35);
    m4.compose(_v.set(x, shelfY[row] + 0.025, -4.75 + rand(-0.06, 0.06)), q.setFromAxisAngle(UP, rand(0, 6)), sc.set(s, s * rand(0.85, 1.2), s));
    bottles.setMatrixAt(i, m4); bottles.setColorAt(i, col.setHex(pick(glass)));
  }
  scene.add(bottles);
}

function buildLamp() {
  const pivot = new THREE.Group(); pivot.position.set(0, 2.9, 0); scene.add(pivot); world.lampPivot = pivot;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.05, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a18, metalness: 0.9, roughness: 0.4 }));
  chain.position.y = -0.52; pivot.add(chain);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1f3a2a, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.32, 0.2, 40, 1, true), shadeMat); shade.position.y = -1.13; pivot.add(shade);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.069, 0.318, 0.198, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xffe7b8, emissive: 0xffc478, emissiveIntensity: 0.6, side: THREE.BackSide }));
  inner.position.y = -1.13; pivot.add(inner);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, 0.05, 20), shadeMat); cap.position.y = -1.02; pivot.add(cap);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 6 }));
  bulb.position.y = -1.2; pivot.add(bulb);
  // the only shadow caster in the scene
  const spot = new THREE.SpotLight(0xffc486, 13, 6, 0.78, 0.55, 2);
  spot.position.y = -1.27; pivot.add(spot);
  spot.target.position.set(0, -2.9, 0); pivot.add(spot.target);
  spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.015;
  spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 4.5;
  world.spot = spot;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffb46a) }, uOpacity: { value: 0.085 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float a = pow(clamp(vY, 0.0, 1.0), 1.6) * f * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.35, 1.75, 40, 1, true), beamMat);
  beam.position.y = -1.23 - 0.875; pivot.add(beam);
}

/** Resizes the lamp's shadow map (quality ladder). */
export function setShadowSize(size) {
  const s = world.spot.shadow; if (s.mapSize.x === size) return;
  s.mapSize.set(size, size); if (s.map) { s.map.dispose(); s.map = null; }
}

function buildTable() {
  const g = new THREE.Group(); scene.add(g);
  const topMat = new THREE.MeshStandardMaterial({ map: canvasTex(woodCanvas(512, { planks: 6, base: [128, 64, 34], dark: [48, 20, 10], seed: 3 })), roughness: 0.42, metalness: 0.02 });
  const sideMat = new THREE.MeshStandardMaterial({ map: canvasTex(woodCanvas(256, { planks: 2, base: [110, 54, 28], dark: [40, 18, 8], seed: 8 }), { repeat: [8, 1] }), roughness: 0.5 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.radius, 1.02, 0.07, 72), [sideMat, topMat, sideMat]);
  top.position.y = -0.035; top.receiveShadow = true; top.castShadow = true; g.add(top);
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE.feltRadius, 72), new THREE.MeshStandardMaterial({ map: canvasTex(feltCanvas(256), { repeat: [3, 3] }), roughness: 0.96 }));
  felt.rotation.x = -Math.PI / 2; felt.position.y = 0.0015; felt.receiveShadow = true; g.add(felt);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(TABLE.feltRadius + 0.005, 0.008, 8, 96), mats.brass); ring.rotation.x = Math.PI / 2; ring.position.y = 0.003; g.add(ring);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE.radius, 0.04, 14, 96), new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.32, metalness: 0.05 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = -0.01; rim.castShadow = true; rim.receiveShadow = true; g.add(rim);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.66, 24), sideMat); ped.position.y = -0.4; g.add(ped);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.06, 32), sideMat); foot.position.y = -0.73; g.add(foot);

  // candle
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.02, 20), mats.brass); holder.position.set(-0.56, 0.01, -0.36); holder.castShadow = true; g.add(holder);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.11, 16), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x3a2008, emissiveIntensity: 0.4 }));
  wax.position.set(-0.56, 0.075, -0.36); wax.castShadow = true; g.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  flame.scale.set(1, 2.2, 1); flame.position.set(-0.56, 0.155, -0.36); g.add(flame);
  const cl = new THREE.PointLight(0xff9a48, 0.35, 2.2, 2); cl.position.set(-0.56, 0.2, -0.36); g.add(cl);
  world.lights.push({ l: cl, f: flame, base: 0.35, seed: 7.3, candle: true });

  const mugGeo = new THREE.CylinderGeometry(0.042, 0.046, 0.11, 22), handleGeo = new THREE.TorusGeometry(0.03, 0.007, 8, 16, Math.PI);
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.9 });
  for (const [x, z, rot] of [[0.5, 0.62, 0.4], [-0.78, -0.05, 2.2], [0.3, -0.8, -1.2], [0.82, 0.25, -2.4]]) {
    const m = new THREE.Group(); m.position.set(x, 0.055, z); m.rotation.y = rot;
    const body = new THREE.Mesh(mugGeo, mats.pewter); body.castShadow = true; m.add(body);
    const h = new THREE.Mesh(handleGeo, mats.pewter); h.position.x = 0.045; h.rotation.z = -Math.PI / 2; h.castShadow = true; m.add(h);
    const foam = new THREE.Mesh(new THREE.CircleGeometry(0.039, 18), foamMat); foam.rotation.x = -Math.PI / 2; foam.position.y = 0.05; m.add(foam);
    g.add(m);
  }
}

function buildAtmosphere() {
  scene.add(new THREE.HemisphereLight(0x56607a, 0x2a1408, 0.35));
  const rim = new THREE.DirectionalLight(0x7f97d0, 0.9); rim.position.set(0.6, 2.2, -4); scene.add(rim);
  const kick = new THREE.DirectionalLight(0xff8a4a, 0.45); kick.position.set(-4, 1.2, -1); scene.add(kick);
  const kick2 = new THREE.DirectionalLight(0xff9a5a, 0.35); kick2.position.set(4, 1.2, -0.5); scene.add(kick2);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x5a4022, metalness: 0.9, roughness: 0.35 });
  for (const [x, y, z, inten] of [[0, 2.25, -4.6, 6], [-4.2, 1.7, -1.6, 5], [4.2, 1.7, 1.2, 3.5]]) {
    const l = new THREE.PointLight(0xff9440, inten, 7, 2); l.position.set(x, y, z); scene.add(l);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), flameMat); f.scale.set(1, 1.7, 1); f.position.set(x, y, z); scene.add(f);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.03, 16), plateMat); plate.position.set(x, y - 0.07, z); scene.add(plate);
    world.lights.push({ l, f, base: inten, seed: Math.random() * 100 });
  }

  const hazeMat = new THREE.SpriteMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0x8d6a4e, transparent: true, opacity: 0.07, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const sp = new THREE.Sprite(hazeMat), a = i / 9 * Math.PI * 2;
    sp.position.set(Math.cos(a) * rand(1.2, 2.6), rand(0.7, 2.0), Math.sin(a) * rand(1.2, 2.6) - 0.6);
    sp.scale.setScalar(rand(1.8, 3.2)); sp.userData = { x: sp.position.x, y: sp.position.y, s: Math.random() * 10 };
    scene.add(sp); world.haze.push(sp);
  }

  const N = 260, pos = new Float32Array(N * 3), seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = Math.sqrt(Math.random()) * 1.15, a = Math.random() * Math.PI * 2; seeds[i * 3] = Math.cos(a) * r; seeds[i * 3 + 1] = Math.random() * 1.6 + 0.05; seeds[i * 3 + 2] = Math.sin(a) * r; }
  pos.set(seeds);
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: canvasTex(softDot(), { srgb: false }), color: 0xffd7a0, size: 0.014, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  world.dust = { obj: dust, seeds, pos, N }; scene.add(dust);
}

export function updateWorld(dt, t) {
  world.lampPivot.rotation.z = Math.sin(t * 0.55) * 0.022;
  world.lampPivot.rotation.x = Math.sin(t * 0.41 + 1) * 0.016;
  for (const L of world.lights) {
    const n = Math.sin(t * 13 + L.seed) * 0.5 + Math.sin(t * 23.7 + L.seed * 2) * 0.3 + Math.sin(t * 5.3 + L.seed) * 0.4;
    L.l.intensity = L.base * (1 + n * (L.candle ? 0.12 : 0.07));
    L.f.scale.y = (L.candle ? 2.2 : 1.7) * (1 + n * 0.08);
  }
  for (const h of world.haze) { const u = h.userData; h.position.x = u.x + Math.sin(t * 0.05 + u.s) * 0.4; h.position.y = u.y + Math.sin(t * 0.07 + u.s * 2) * 0.12; }
  const D = world.dust, s = D.seeds;
  for (let i = 0; i < D.N; i++) {
    const j = i * 3;
    D.pos[j] = s[j] + Math.sin(t * 0.13 + i) * 0.06;
    D.pos[j + 1] = ((s[j + 1] + t * 0.012 * (1 + (i % 5) * 0.2)) % 1.7) + 0.02;
    D.pos[j + 2] = s[j + 2] + Math.cos(t * 0.11 + i * 1.3) * 0.06;
  }
  D.obj.geometry.attributes.position.needsUpdate = true;
}
