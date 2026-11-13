"""Shrinks a written .glb in place: normals to signed bytes and uvs to shorts (KHR_mesh_quantization),
skin weights to unsigned bytes and keyed rotations to signed shorts (both core glTF). three.js's
GLTFLoader reads all of them. Positions and times stay floats, and so do uvs outside -1..1.

    Body.build(out, parts, colours, clips, after=quantise.quantise)
"""
import json
import struct
import numpy as np

FLOAT, BYTE, UBYTE, SHORT, USHORT = 5126, 5120, 5121, 5122, 5123
WIDTH = dict(SCALAR=1, VEC2=2, VEC3=3, VEC4=4)


def _read(path):
    buf = open(path, 'rb').read()
    n = struct.unpack_from('<I', buf, 12)[0]
    gltf = json.loads(buf[20:20 + n])
    m = struct.unpack_from('<I', buf, 20 + n)[0]
    return gltf, buf[28 + n:28 + n + m]


def _write(path, gltf, bin_):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4); bin_ += b'\0' * (-len(bin_) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942) + bin_)


def quantise(path):
    gltf, bin_ = _read(path)
    acc, views = gltf['accessors'], gltf['bufferViews']

    def floats(i):
        a = acc[i]; v = views[a['bufferView']]; w = WIDTH[a['type']]
        assert a['componentType'] == FLOAT and 'byteStride' not in v
        return np.frombuffer(bin_, '<f4', a['count'] * w, v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, w)

    new = {}  # accessor -> (bytes, componentType, stride)
    for mesh in gltf['meshes']:
        for p in mesh['primitives']:
            at = p['attributes']
            if 'NORMAL' in at and at['NORMAL'] not in new:
                n = floats(at['NORMAL'])
                q = np.round(np.clip(n, -1, 1) * 127).astype('<i1')
                new[at['NORMAL']] = (np.concatenate([q, np.zeros((len(q), 1), '<i1')], 1).tobytes(), BYTE, 4)
            if 'TEXCOORD_0' in at and at['TEXCOORD_0'] not in new:
                uv = floats(at['TEXCOORD_0'])
                if uv.min() >= 0 and uv.max() <= 1:
                    new[at['TEXCOORD_0']] = (np.round(uv * 65535).astype('<u2').tobytes(), USHORT, None)
                elif np.abs(uv).max() <= 1:
                    new[at['TEXCOORD_0']] = (np.round(uv * 32767).astype('<i2').tobytes(), SHORT, None)
            if 'WEIGHTS_0' in at and at['WEIGHTS_0'] not in new:
                w = floats(at['WEIGHTS_0']).astype(float)
                w = w / w.sum(1, keepdims=True) * 255
                q = np.floor(w).astype(int)
                # hand the rounding back to the largest remainders, so each vertex still sums to 255
                short = 255 - q.sum(1)
                order = np.argsort(-(w - q), 1)
                for k in range(4):
                    q[np.arange(len(q)), order[:, k]] += short > k
                new[at['WEIGHTS_0']] = (q.astype('<u1').tobytes(), UBYTE, None)
    for anim in gltf.get('animations', []):
        for ch in anim['channels']:
            if ch['target']['path'] != 'rotation':
                continue
            out = anim['samplers'][ch['sampler']]['output']
            if out not in new:
                new[out] = (np.round(np.clip(floats(out), -1, 1) * 32767).astype('<i2').tobytes(), SHORT, None)

    # lay the buffer out again, view by view
    out, used = bytearray(), {}
    owner = {}
    for i, a in enumerate(acc):
        owner.setdefault(a.get('bufferView'), []).append(i)
    for vi, v in enumerate(views):
        mine = [i for i in owner.get(vi, []) if i in new]
        if mine:
            assert len(owner[vi]) == 1, 'a quantised accessor shares its view'
            data, ctype, stride = new[mine[0]]
            a = acc[mine[0]]
            a['componentType'] = ctype; a['normalized'] = True; a.pop('byteOffset', None)
            if ctype in (SHORT, USHORT) and 'min' in a:
                a.pop('min'); a.pop('max', None)
            if stride:
                v['byteStride'] = stride
        else:
            data = bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out); v['byteLength'] = len(data)
        out += data
    gltf['buffers'][0]['byteLength'] = len(out)
    for k in ('extensionsUsed', 'extensionsRequired'):
        gltf[k] = sorted(set(gltf.get(k, [])) | {'KHR_mesh_quantization'})
    _write(path, gltf, bytes(out))
