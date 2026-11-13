"""Shrinks a written .glb in place: skin weights to u8, uvs to u16 and normals to i8 (all
normalised), and keyed rotations to i16. Positions stay float, so skinning and the sockets are
untouched. Normals in bytes need KHR_mesh_quantization, which three's GLTFLoader reads; the rest is
core glTF. No Blender in this file.

    BODY.build(out, parts, colours, clips, after=quantise.quantise)
"""
import json
import struct
import numpy as np

FLOAT, BYTE, UBYTE, SHORT, USHORT = 5126, 5120, 5121, 5122, 5123
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def _read(path):
    buf = open(path, 'rb').read()
    n = struct.unpack_from('<I', buf, 12)[0]
    gltf = json.loads(buf[20:20 + n])
    bn = struct.unpack_from('<I', buf, 20 + n)[0]
    return gltf, buf[28 + n:28 + n + bn]


def _array(gltf, binary, i):
    a = gltf['accessors'][i]; v = gltf['bufferViews'][a['bufferView']]
    assert a['componentType'] == FLOAT and 'byteStride' not in v
    w = WIDTH[a['type']]; start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(binary, '<f4', a['count'] * w, start).reshape(a['count'], w)


def _weights(W):
    """Rows summing to 255 exactly: round down, then hand the remainder to the largest parts."""
    S = W * 255; Q = np.floor(S).astype(int); short = 255 - Q.sum(1)
    order = np.argsort(-(S - Q), axis=1)
    for k in range(W.shape[1]):
        Q[np.arange(len(Q)), order[:, k]] += short > k
    return Q.astype(np.uint8)


def quantise(path):
    gltf, binary = _read(path)
    new = {}   # accessor index -> (bytes, componentType, normalized, byteStride or None)
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            for name, i in at.items():
                if i in new or not (name == 'NORMAL' or name.startswith(('WEIGHTS', 'TEXCOORD'))):
                    continue
                x = _array(gltf, binary, i)
                if name.startswith('WEIGHTS'):
                    new[i] = (_weights(x / np.maximum(x.sum(1, keepdims=True), 1e-9)).tobytes(), UBYTE, True, None)
                elif name.startswith('TEXCOORD') and x.min() >= 0 and x.max() <= 1:
                    new[i] = (np.round(x * 65535).astype('<u2').tobytes(), USHORT, True, None)
                elif name == 'NORMAL':
                    n = x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-9)
                    q = np.zeros((len(n), 4), np.int8); q[:, :3] = np.round(n * 127)
                    new[i] = (q.tobytes(), BYTE, True, 4)
    for anim in gltf.get('animations', []):
        for ch in anim['channels']:
            if ch['target']['path'] != 'rotation':
                continue
            i = anim['samplers'][ch['sampler']]['output']
            if i not in new:
                q = _array(gltf, binary, i)
                new[i] = (np.round(q * 32767).astype('<i2').tobytes(), SHORT, True, None)

    # lay the buffer out again, one view per accessor, each on a 4-byte boundary
    out, views = bytearray(), []
    for i, a in enumerate(gltf['accessors']):
        v = gltf['bufferViews'][a['bufferView']]
        if i in new:
            data, ctype, norm, stride = new[i]
            a['componentType'] = ctype; a['normalized'] = norm
            if ctype in (BYTE, SHORT) and 'min' in a:
                del a['min'], a['max']
        else:
            stride = v.get('byteStride')
            start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            data = binary[start:start + (stride or SIZE[a['componentType']] * WIDTH[a['type']]) * a['count']]
        while len(out) % 4:
            out.append(0)
        view = dict(buffer=0, byteOffset=len(out), byteLength=len(data))
        if stride:
            view['byteStride'] = stride
        if 'target' in v:
            view['target'] = v['target']
        views.append(view); a['bufferView'] = len(views) - 1; a.pop('byteOffset', None)
        out += data
    assert all('bufferView' in a for a in gltf['accessors'])
    for img in gltf.get('images', []):
        assert 'bufferView' not in img
    gltf['bufferViews'] = views
    while len(out) % 4:
        out.append(0)
    gltf['buffers'] = [dict(byteLength=len(out))]
    for key in ('extensionsUsed', 'extensionsRequired'):
        gltf[key] = sorted(set(gltf.get(key, [])) | {'KHR_mesh_quantization'})

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
