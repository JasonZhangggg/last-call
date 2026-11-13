// Prints what a generated .glb holds: size by kind, meshes, the skeleton, where the sockets sit in
// the rest pose, and the clips. No dependencies; it reads the GLB's JSON chunk.
//   node tools/models/inspect.mjs assets/models/brass.glb [--bones]
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'assets/models/brass.glb';
const buf = readFileSync(file);
const jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const acc = (i) => gltf.accessors[i], viewBytes = (i) => gltf.bufferViews[acc(i).bufferView].byteLength;
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const bytes = (i) => acc(i).count * COMP[acc(i).componentType] * N[acc(i).type];

console.log(`${file}: ${(buf.length / 1024).toFixed(0)} KB, JSON ${(jsonLen / 1024).toFixed(0)} KB`);
let geo = 0, verts = 0, tris = 0;
for (const m of gltf.meshes) for (const p of m.primitives) {
  const b = Object.values(p.attributes).reduce((s, a) => s + bytes(a), 0) + bytes(p.indices);
  geo += b; verts += acc(p.attributes.POSITION).count; tris += acc(p.indices).count / 3;
  console.log(`  ${gltf.materials[p.material].name.padEnd(8)} ${String(acc(p.attributes.POSITION).count).padStart(6)} vertices ${String(acc(p.indices).count / 3).padStart(6)} triangles ${(b / 1024).toFixed(0).padStart(5)} KB  [${Object.keys(p.attributes).join(' ')}; joints ${acc(p.attributes.JOINTS_0).componentType === 5121 ? 'u8' : 'u16'}]`);
}
console.log(`  geometry ${(geo / 1024).toFixed(0)} KB, ${verts} vertices, ${tris} triangles, ${gltf.meshes.reduce((s, m) => s + m.primitives.length, 0)} draw calls`);

const skin = gltf.skins[0], joints = new Set(skin.joints);
const parent = new Map();
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
const mulQ = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const rot = (q, v) => { const [x, y, z, w] = q, [a, b, c] = v, tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a); return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]; };
function world(i) {
  const n = gltf.nodes[i], t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1];
  if (!parent.has(i)) return { p: t, q: r };
  const P = world(parent.get(i)), rp = rot(P.q, t);
  return { p: [P.p[0] + rp[0], P.p[1] + rp[1], P.p[2] + rp[2]], q: mulQ(P.q, r) };
}
const f = (a) => a.map((x) => (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4)).join(' ');
const turned = skin.joints.filter((j) => { const r = gltf.nodes[j].rotation; return r && Math.abs(Math.abs(r[3]) - 1) > 1e-5; });
console.log(`skeleton: ${skin.joints.length} bones, ${turned.length} with a rest rotation${turned.length ? ` (${turned.map((j) => gltf.nodes[j].name).join(', ')})` : ''}`);
if (process.argv.includes('--bones')) for (const j of skin.joints) console.log(`  ${gltf.nodes[j].name.padEnd(14)} ${f(world(j).p)}`);
console.log('sockets (rest pose, position then quaternion):');
gltf.nodes.forEach((n, i) => { if (!joints.has(i) && n.mesh == null && parent.has(i) && joints.has(parent.get(i))) { const w = world(i); console.log(`  ${n.name.padEnd(11)} on ${gltf.nodes[parent.get(i)].name.padEnd(7)} ${f(w.p)}   ${f(w.q)}`); } });
console.log('clips:');
let animBytes = 0;
for (const a of gltf.animations || []) {
  const seen = new Set(); let b = 0;
  for (const s of a.samplers) for (const k of [s.input, s.output]) if (!seen.has(k)) { seen.add(k); b += bytes(k); }
  animBytes += b;
  const dur = Math.max(...a.samplers.map((s) => acc(s.input).max[0]));
  const paths = a.channels.reduce((o, c) => ((o[c.target.path] = (o[c.target.path] || 0) + 1), o), {});
  console.log(`  ${a.name.padEnd(11)} ${dur.toFixed(2)} s  ${String(a.channels.length).padStart(3)} tracks (${Object.entries(paths).map(([k, v]) => `${v} ${k}`).join(', ')})  ${(b / 1024).toFixed(0)} KB`);
}
console.log(`  animation ${(animBytes / 1024).toFixed(0)} KB`);
