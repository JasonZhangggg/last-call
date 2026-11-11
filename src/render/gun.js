import * as THREE from 'three';
import { scene, camera } from './core.js';
import { Mover, easeInOutCubic, smoothDamp } from './motion.js';
import { quatE } from '../util.js';
import { headWorld } from './characters.js';

const HOME_POS = new THREE.Vector3(0.44, 0.026, 0.3);
const HOME_QUAT = quatE(0, 0.9, Math.PI / 2);
const _o = new THREE.Object3D(), _h = new THREE.Vector3(), _p = new THREE.Vector3();

export const gun = { obj: null, mover: null, drum: null, hammer: null, flash: null, flashLight: null, drumAngle: 0, drumTarget: 0, drumVel: {}, cock: 0, cockTarget: 0, kick: 0, flashT: 0 };

export function buildGun() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c5d62, metalness: 1, roughness: 0.3, envMapIntensity: 2.2 });
  const blued = new THREE.MeshStandardMaterial({ color: 0x23252b, metalness: 0.9, roughness: 0.38, envMapIntensity: 2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2412, roughness: 0.42, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8893e, metalness: 1, roughness: 0.32 });
  const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
  add(g, new THREE.CylinderGeometry(0.0105, 0.012, 0.17, 18), steel, 0, 0.012, 0.12, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(0.0045, 0.0045, 0.172, 10), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, 0.012, 0.1205, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.012, 0.012, 0.16), steel, 0, 0.026, 0.12);
  add(g, new THREE.CylinderGeometry(0.006, 0.006, 0.09, 10), blued, 0, -0.004, 0.09, Math.PI / 2);
  add(g, new THREE.BoxGeometry(0.004, 0.012, 0.01), steel, 0, 0.036, 0.195);
  add(g, new THREE.BoxGeometry(0.03, 0.05, 0.075), blued, 0, 0.004, -0.008);
  add(g, new THREE.BoxGeometry(0.032, 0.012, 0.02), brass, 0, -0.024, -0.035);
  const drum = new THREE.Group(); drum.position.set(0, 0.006, 0.008); g.add(drum);
  add(drum, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 24), steel, 0, 0, 0, Math.PI / 2);
  const holeGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.052, 12), flute = new THREE.CylinderGeometry(0.006, 0.006, 0.046, 8);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    add(drum, holeGeo, holeMat, Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0.0005, Math.PI / 2);
    add(drum, flute, blued, Math.cos(a + Math.PI / 6) * 0.029, Math.sin(a + Math.PI / 6) * 0.029, 0, Math.PI / 2);
  }
  gun.drum = drum;
  const grip = add(g, new THREE.BoxGeometry(0.026, 0.088, 0.036), wood, 0, -0.046, -0.056, -0.38);
  add(grip, new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8), brass, 0, 0.01, 0, 0, 0, Math.PI / 2);
  const hammerPivot = new THREE.Group(); hammerPivot.position.set(0, 0.026, -0.044); g.add(hammerPivot);
  add(hammerPivot, new THREE.BoxGeometry(0.008, 0.022, 0.012), blued, 0, 0.009, -0.004, -0.4);
  gun.hammer = hammerPivot;
  add(g, new THREE.TorusGeometry(0.018, 0.0035, 6, 14, Math.PI), blued, 0, -0.022, 0.006, 0, Math.PI / 2, Math.PI);
  add(g, new THREE.BoxGeometry(0.004, 0.016, 0.004), blued, 0, -0.024, 0.006, 0.3);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, 0.012, 0.22); flash.scale.set(1, 1, 2.2); g.add(flash); gun.flash = flash;
  // permanent, normally dark: adding a light later would recompile every lit shader mid-game
  gun.flashLight = new THREE.PointLight(0xffc070, 0, 3, 2); gun.flashLight.position.set(0, 0.02, 0.24); g.add(gun.flashLight);

  g.position.copy(HOME_POS); g.quaternion.copy(HOME_QUAT); scene.add(g);
  gun.obj = g;
  gun.mover = new Mover(g, scene); gun.mover.smooth = 0.12; gun.mover.rotRate = 9;
}

export function gunHome() { gun.cockTarget = 0; gun.mover.go(scene, HOME_POS, HOME_QUAT, 1, { dur: 0.9, arc: 0.12 }); }

export function gunToCharacter(ch) {
  headWorld(ch, _h);
  ch.head.localToWorld(_p.set(0.27, 0.0, 0.07));
  _o.position.copy(_p); _o.lookAt(_h);
  gun.mover.go(scene, _p, _o.quaternion, 1, { dur: 1.0, arc: 0.18, ease: easeInOutCubic });
}

export function gunToPlayer() {
  _o.position.set(0.16, -0.07, -0.3); _o.lookAt(0.07, 0.01, 0.02);
  gun.mover.go(camera, _o.position, _o.quaternion, 1, { dur: 1.0, arc: 0.05 });
}

export function spinDrum(chambers = 12) { gun.drumTarget += chambers * Math.PI / 3; }
export function cockHammer() { gun.cockTarget = 1; gun.drumTarget += Math.PI / 3; }
export function fire(live) {
  gun.cockTarget = 0;
  gun.kick = live ? 1 : 0.25;
  if (live) gun.flashT = 1;
}

export function updateGun(dt) {
  gun.mover.update(dt);
  gun.drumAngle = smoothDamp(gun.drumAngle, gun.drumTarget, gun.drumVel, 'a', 0.35, dt);
  gun.drum.rotation.z = gun.drumAngle;
  gun.cock += ((gun.cockTarget) - gun.cock) * (1 - Math.exp(-dt * (gun.cockTarget ? 10 : 40)));
  gun.hammer.rotation.x = -gun.cock * 0.7;
  if (gun.kick > 0.002) { gun.obj.rotateX(-gun.kick * 0.35); gun.kick *= Math.exp(-dt * 9); } else gun.kick = 0;
  gun.flashT = Math.max(0, gun.flashT - dt * 9);
  gun.flash.material.opacity = gun.flashT;
  gun.flash.visible = gun.flashT > 0;
  gun.flashLight.intensity = gun.flashT * 30;
}
