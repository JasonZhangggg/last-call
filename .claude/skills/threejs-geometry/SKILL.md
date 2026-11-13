---
name: threejs-geometry
description: "Creating and shaping three.js geometry: built-in shapes, 3D text, vertex buffers and attributes, merging, instancing, batching, point clouds and lines (three r170, WebGL). Use when building 3D shapes or text, custom vertex data, custom meshes, instanced meshes, or point clouds."
---

# Three.js Geometry

> Vendored from [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills) at commit 0e18186, MIT licence (`.claude/skills/THREEJS_SKILLS_LICENSE`). Upstream targets three.js r186.
>
> **In this project:** three@0.170.0 from the import map in `index.html`, `WebGLRenderer` only. The upstream WebGPU and TSL sections and WebGPU-only mistakes were cut. Text marked **r170** corrects upstream for this release. `docs/AGENT_BRIEF.md` wins over anything here.

## Quick Start

```javascript
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

// A geometry is the shape; many meshes can share one geometry instance
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial());
scene.add(mesh);

renderer.setAnimationLoop(animate);

function animate() {
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
}
```

## Built-in Geometries

### Basic Shapes

```javascript
new THREE.BoxGeometry(1, 1, 1); // width, height, depth, widthSegments, heightSegments, depthSegments
new THREE.SphereGeometry(1, 32, 16); // radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength
new THREE.SphereGeometry(1, 32, 16, 0, Math.PI); // half sphere (phi sweep, cut through the poles)
new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); // dome (cut at the equator)
new THREE.PlaneGeometry(10, 10, 1, 1); // width, height, widthSegments, heightSegments
new THREE.CircleGeometry(1, 32); // radius, segments, thetaStart, thetaLength
new THREE.CylinderGeometry(1, 1, 2, 32); // radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength
new THREE.CylinderGeometry(1, 1, 2, 6); // hexagonal prism
new THREE.ConeGeometry(1, 2, 32); // radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength
new THREE.TorusGeometry(1, 0.4, 16, 100); // radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength
new THREE.TorusGeometry(1, 0.4, 16, 100, Math.PI); // half arc
new THREE.TorusKnotGeometry(1, 0.4, 100, 16, 2, 3); // radius, tube, tubularSegments, radialSegments, p, q
new THREE.RingGeometry(0.5, 1, 32, 1); // innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength
```

### Advanced Shapes

```javascript
new THREE.CapsuleGeometry(0.5, 1, 4, 8); // r170: radius, length (the middle section only), capSegments, radialSegments

// radius, detail - each detail level subdivides every face
new THREE.IcosahedronGeometry(1, 0); // 20 faces at detail 0
new THREE.DodecahedronGeometry(1, 0);
new THREE.OctahedronGeometry(1, 0);
new THREE.TetrahedronGeometry(1, 0);

// Polyhedron - flat vertices array, indices, radius, detail
const vertices = [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1];
const indices = [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1];
new THREE.PolyhedronGeometry(vertices, indices, 1, 0);
```

### Path-Based Shapes

```javascript
// Lathe - a Vector2 profile rotated around the Y axis: points, segments, phiStart, phiLength
const profile = [
  new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 1), new THREE.Vector2(0, 1),
];
new THREE.LatheGeometry(profile, 32);

// Extrude - a 2D Shape pushed along Z
const shape = new THREE.Shape();
shape.moveTo(0, 0);
shape.lineTo(1, 0);
shape.lineTo(1, 1);
shape.lineTo(0, 1);
new THREE.ExtrudeGeometry(shape, {
  steps: 1, depth: 1, bevelEnabled: true,
  bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
});

// Tube - a circular sweep along a curve: path, tubularSegments, radius, radialSegments, closed
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0),
]);
new THREE.TubeGeometry(curve, 64, 0.2, 8, false);
```

### Text Geometry

```javascript
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

// A .typeface.json font, from examples/fonts in the three.js repository
const font = await new FontLoader().loadAsync("fonts/helvetiker_regular.typeface.json");
const geometry = new TextGeometry("Hello", {
  font: font,
  size: 1, // text size in world units
  depth: 0.2, // extrusion depth
  curveSegments: 12,
  bevelEnabled: true,
  bevelThickness: 0.03,
  bevelSize: 0.02,
  direction: "ltr", // 'ltr', 'rtl' (right to left) or 'tb' (top to bottom)
});

geometry.center(); // recentre the glyphs on the origin
scene.add(new THREE.Mesh(geometry, new THREE.MeshNormalMaterial()));
```

## BufferGeometry

The base class of every geometry: typed arrays of vertex data plus an optional index. Attributes are named buffers of `itemSize` values per vertex; `position`, `normal` and `uv` are the ones materials read by default.

### Custom BufferGeometry

```javascript
const geometry = new THREE.BufferGeometry();

// Four vertices, three floats each (x, y, z)
const vertices = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

// Indices reuse vertices across the two triangles
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

// Normals drive the lighting, UVs address textures
const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
// Optional per-vertex colors, rendered with material.vertexColors = true
const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]);
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true })));
```

### Attribute Types

```javascript
const count = 4;
const geometry = new THREE.BufferGeometry();
// Float32 for positions, normals, UVs and floating-point colors
geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
// Uint16 indices address vertices 0 to 65534 (65535 is the primitive-restart value); setIndex([...]) with a plain array picks Uint16 or Uint32 itself
geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(count), 1));
// Uint8 colors need normalized = true (third argument) so bytes reach the shader as 0.0-1.0
geometry.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(count * 3), 3, true));
```

### Updating a BufferGeometry

```javascript
const geometry = new THREE.PlaneGeometry(2, 2);
const positions = geometry.attributes.position;
positions.setXYZ(0, -2, -2, 0); // overwrite vertex 0
positions.getX(0); // read single components with getX / getY / getZ
positions.needsUpdate = true; // upload the change; an array cannot grow after its first render, so allocate the maximum and use geometry.setDrawRange(0, n)
geometry.computeVertexNormals(); // normals must match the new positions
geometry.computeBoundingBox(); // bounding volumes drive frustum culling and raycasting
geometry.computeBoundingSphere();
```

### Interleaved Buffers

```javascript
// One buffer holding position (3 floats) and uv (2 floats) per vertex
const interleavedBuffer = new THREE.InterleavedBuffer(
  new Float32Array([
    -1, -1, 0, 0, 0, 1, -1, 0, 1, 0, 1, 1, 0, 1, 1, -1, 1, 0, 0, 1, // four vertices: xyz + uv
  ]),
  5, // stride: floats per vertex
);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 3));
geometry.setIndex([0, 1, 2, 0, 2, 3]); // two triangles over the four vertices
// BufferGeometryUtils.interleaveAttributes([position, normal, uv]) packs existing attributes this way
```

## Edges and Wireframes

```javascript
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
// Edges where the two faces' normals differ by at least thresholdAngle (degrees; 15 here), plus open boundary edges
const edges = new THREE.EdgesGeometry(boxGeometry, 15);
const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff }));
// Every triangle edge, diagonals included; an edge shared by two triangles is drawn once
const wireframe = new THREE.WireframeGeometry(boxGeometry);
const wireLines = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0xffffff }));
scene.add(edgeLines, wireLines);
```

## Points

```javascript
const count = 1000;
const positions = new Float32Array(count * 3).map(() => (Math.random() - 0.5) * 10);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
// sizeAttenuation (default true) shrinks points with depth under a perspective camera: a point spans size * (canvas CSS height / 2) / depth CSS pixels
const material = new THREE.PointsMaterial({ size: 0.1, color: 0xffffff });
const points = new THREE.Points(geometry, material);
scene.add(points);
```

## Lines

```javascript
const linePoints = [
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0),
];
const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
const material = new THREE.LineBasicMaterial({ color: 0xff0000 });

// Line connects the points in order; LineLoop closes back to the first point
const line = new THREE.Line(geometry, material);
const loop = new THREE.LineLoop(geometry, material);
scene.add(line, loop);

// LineSegments draws independent pairs: vertex 0-1, 2-3, ...
const segmentsGeometry = new THREE.BufferGeometry().setFromPoints([linePoints[0], linePoints[1], linePoints[1], linePoints[2]]);
const segments = new THREE.LineSegments(segmentsGeometry, material);
scene.add(segments);
```

## InstancedMesh

One draw call for many copies of one geometry, each with its own transform.

```javascript
const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const material = new THREE.MeshBasicMaterial(); // multiplies by instance colors; MeshNormalMaterial ignores them
const count = 1000;
const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
const dummy = new THREE.Object3D();
for (let i = 0; i < count; i++) {
  dummy.position.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
  dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  dummy.scale.setScalar(0.5 + Math.random());
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true; // needed after changes once the mesh has rendered; harmless before

// setColorAt creates instanceColor on first use; flag it after the loop
for (let i = 0; i < count; i++) {
  instancedMesh.setColorAt(i, new THREE.Color(Math.random(), Math.random(), Math.random()));
}
instancedMesh.instanceColor.needsUpdate = true;

scene.add(instancedMesh);
```

At runtime, update and raycast instances like this:

```javascript
// mesh here is an InstancedMesh
const matrix = new THREE.Matrix4();
const index = 7;
mesh.getMatrixAt(index, matrix);
matrix.setPosition(0, 2, 0); // move just this instance
mesh.setMatrixAt(index, matrix);
mesh.instanceMatrix.needsUpdate = true; // flag after any batch of setMatrixAt calls
mesh.computeBoundingSphere(); // instances moved: refresh the bounds used by frustum culling and raycasting

// Raycasting reports which instance was hit
const raycaster = new THREE.Raycaster();
const hits = raycaster.intersectObject(mesh);
if (hits.length > 0) {
  const instanceId = hits[0].instanceId; // undefined for a non-instanced object
}
```

## InstancedBufferGeometry

Per-instance attributes beyond transform and color.

```javascript
const count = 1000;
const geometry = new THREE.InstancedBufferGeometry();
geometry.copy(new THREE.BoxGeometry(1, 1, 1)); // copies the index and all attributes
geometry.instanceCount = count; // required: copy() carries no instance count

const offsets = new Float32Array(count * 3).map(() => Math.random() * 10);
geometry.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));

// With WebGLRenderer and a ShaderMaterial, declare `in vec3 offset;` in the vertex
// shader yourself and add it to position (see threejs-shaders).
```

## BatchedMesh

Many different geometries sharing one material, each instance with its own transform. WebGLRenderer draws them with one multi-draw call where WEBGL_multi_draw is available; the WebGPU backend issues one draw per instance.

```javascript
const material = new THREE.MeshNormalMaterial();
const maxInstanceCount = 1000;
const maxVertexCount = 20000;
const maxIndexCount = 20000;
const batchedMesh = new THREE.BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material);
const boxGeometryId = batchedMesh.addGeometry(new THREE.BoxGeometry(1, 1, 1));
const sphereGeometryId = batchedMesh.addGeometry(new THREE.SphereGeometry(0.5, 16, 16));

// A geometry renders only through its instances; added geometries need matching attributes and index state
const boxInstanceId = batchedMesh.addInstance(boxGeometryId);
batchedMesh.setMatrixAt(boxInstanceId, new THREE.Matrix4().setPosition(-2, 0, 0));
const sphereInstanceId = batchedMesh.addInstance(sphereGeometryId);
batchedMesh.setMatrixAt(sphereInstanceId, new THREE.Matrix4().setPosition(2, 0, 0));

scene.add(batchedMesh);
```

## Geometry Utilities

```javascript
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import * as MikkTSpace from "three/addons/libs/mikktspace.module.js";

const geo1 = new THREE.BoxGeometry(1, 1, 1);
const geo2 = new THREE.SphereGeometry(0.5, 16, 16);
// Merge static geometries; inputs need the same attributes and must all be indexed or all non-indexed (else null).
// useGroups = true adds one group per input, for a material array such as [boxMaterial, sphereMaterial].
const merged = BufferGeometryUtils.mergeGeometries([geo1, geo2], true);

// Weld duplicate vertices; also generates an index for a non-indexed geometry
const welded = BufferGeometryUtils.mergeVertices(geo2);

// Tangents for normal mapping - the core method needs an index plus position, normal and uv
welded.computeTangents();

// MikkTSpace tangents (the convention glTF normal maps use) come from the addon; this makes merged non-indexed in place
await MikkTSpace.ready;
BufferGeometryUtils.computeMikkTSpaceTangents(merged, MikkTSpace);
```

## Transforming Geometry

```javascript
const geometry = new THREE.TorusKnotGeometry(0.5, 0.15, 100, 16);

geometry.center(); // move the vertices so the bounding-box center lands on the origin
geometry.computeBoundingBox(); // refresh after vertex changes
const size = new THREE.Vector3();
geometry.boundingBox.getSize(size);
const maxDim = Math.max(size.x, size.y, size.z);
geometry.scale(1 / maxDim, 1 / maxDim, 1 / maxDim); // fit inside a unit cube

const clone = geometry.clone(); // clone first: these methods mutate the geometry
clone.rotateX(Math.PI / 2);
clone.translate(0, 1, 0);
```

**r170:** `Object3D.pivot` does not exist. To turn an object around a point without touching vertex data, parent it to a `Group` placed at that point and rotate the group.

## Morph Targets

```javascript
const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
const morphPositions = geometry.attributes.position.array.slice();
for (let i = 0; i < morphPositions.length; i += 3) {
  morphPositions[i] *= 2; // stretch X
  morphPositions[i + 1] *= 0.5; // squash Y
}
geometry.morphAttributes.position = [new THREE.BufferAttribute(morphPositions, 3)];

// Build the mesh after assigning morphAttributes so it picks up the targets
const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
mesh.morphTargetInfluences[0] = 0.5; // 50% blend between base and target
scene.add(mesh);
```

## Performance and Disposal

- Cut draw calls: mergeGeometries for static meshes, InstancedMesh for repeated geometry, BatchedMesh for many different geometries (one multi-draw call on WebGLRenderer where WEBGL_multi_draw is available).
- Segment counts trade smoothness for vertex count; the sphere default of 32 by 16 suits most uses, go higher only for close-ups.

```javascript
scene.remove(mesh);
mesh.geometry.dispose(); // frees the GPU buffers at once, even while another mesh shares them (that mesh uploads them again)
mesh.material.dispose(); // its textures need their own texture.dispose()
```

To free a whole subtree, traverse it as in Common Mistakes. **r170:** only `InstancedMesh`, `BatchedMesh` and lights have `dispose()`; on a plain `Mesh` or `Group` the call throws a TypeError. InstancedMesh.dispose() also frees its morph texture.

**In this project:** the upstream WebGPU and TSL section was cut. This project renders with WebGLRenderer.

## Common Mistakes

Entries that only apply to WebGPURenderer or TSL were cut. Entries marked **r170** replace upstream advice that is wrong for three r170.

- `BufferGeometryUtils.computeTangents(geometry)` → `geometry.computeTangents()`: BufferGeometryUtils exports no computeTangents; the core method needs an index plus position, normal and uv attributes.
- `new THREE.BufferAttribute(new Uint8Array(rgbBytes), 3)` → `new THREE.BufferAttribute(new Uint8Array(rgbBytes), 3, true)`: unnormalized bytes reach the shader as 0.0 to 255.0 and the colors blow out.
- `geometry.copy(new THREE.BoxGeometry(1, 1, 1));` → `geometry.copy(new THREE.BoxGeometry(1, 1, 1)); geometry.instanceCount = count;`: InstancedBufferGeometry.copy() overwrites instanceCount with the source's undefined, and WebGLRenderer then draws no instances.
- `batchedMesh.addGeometry(boxGeometry)` → `batchedMesh.addInstance(batchedMesh.addGeometry(boxGeometry))`: a geometry added to a BatchedMesh renders only through an instance created with addInstance (required since r166).
- `import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js"` → `import { TextGeometry } from "three/addons/geometries/TextGeometry.js"`: the examples/jsm specifier does not resolve under the documented import maps, which map three/addons/ but not three/examples/.
- **r170:** CapsuleGeometry's second parameter is `length` (`capsule.parameters.length`) and there are four parameters; `height` and `heightSegments` arrive in r176.
- `{ font: font, size: 1, height: 0.2 }` → `{ font: font, size: 1, depth: 0.2 }`: the TextGeometry extrusion option was renamed from `height` to `depth` in r163; an old height is ignored and the text extrudes the default 50 units.
- `mesh.morphTargetInfluences[0] = 0.5` → `mesh.updateMorphTargets(); mesh.morphTargetInfluences[0] = 0.5;`: influences exist only for morph attributes the mesh saw at construction, so refresh them after adding targets to an existing mesh.
- `gltf.scene.dispose()` → `gltf.scene.traverse((child) => { child.geometry?.dispose(); for (const material of [child.material ?? []].flat()) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); } child.dispose?.(); })`: **r170:** Object3D has no dispose() (only InstancedMesh, BatchedMesh and lights do), so call it optionally; the GPU resources are the geometries, materials and textures.
- `new THREE.BoxBufferGeometry(1, 1, 1)` → `new THREE.BoxGeometry(1, 1, 1)`: the `*BufferGeometry` aliases of the built-in shapes no longer exist; every built-in geometry is already a BufferGeometry.
- `BufferGeometryUtils.mergeBufferGeometries([geo1, geo2])` → `BufferGeometryUtils.mergeGeometries([geo1, geo2])`: the old name is not exported, so the call throws a TypeError.
- `geometry.setAttribute("uv2", geometry.attributes.uv)` → `material.aoMap = aoTexture;`: an aoMap reads `uv` (channel 0) by default; only a separate baked unwrap goes in `uv1`, with `aoTexture.channel = 1`.
- `new THREE.LineBasicMaterial({ linewidth: 4 })` → `new Line2(new LineGeometry().setPositions(xyzArray), new LineMaterial({ linewidth: 4 }))`: WebGL and WebGPU draw line primitives one pixel wide whatever linewidth says; Line2, LineGeometry and LineMaterial from three/addons/lines/ draw thick lines on WebGLRenderer, and under WebGPURenderer the Line2 from three/addons/lines/webgpu/Line2.js takes a Line2NodeMaterial from three/webgpu.

## See Also

- `threejs-fundamentals` - scene setup, the render loop, Object3D transforms and disposal.
- `threejs-materials` - material types and settings for the meshes built here.
- `threejs-shaders` - ShaderMaterial vertex and fragment code for WebGLRenderer.
- `threejs-animation` - animating morph target influences and transforms over time.
- `threejs-loaders` - glTF and other formats that bring their own geometry.
- `threejs-performance` - choosing between merging, instancing, batching and LOD by measured draw calls.
