"""The Blender side: armature, skinned mesh, sockets, baked actions and the glTF export.

Everything is authored in the game's space (+y up, +z toward the table) and converted here.
Every bone is a short stub pointing up with its axes on the game's axes, so a bone's rotation in
Blender, in the .glb and in three.js is the same quaternion, and the rest pose is all identities.
"""
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from . import meshkit as mk

# game (x, y, z) -> Blender (x, -z, y)
C = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1.0]])
g2b = lambda p: (float(p[0]), float(-p[2]), float(p[1]))


def reset(fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = fps


def build_armature(name, bones):
    """`bones`: (name, parent or None, head position) in parent-first order."""
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head in bones:
        eb = data.edit_bones.new(bname)
        eb.head = g2b(head); eb.tail = Vector(g2b(head)) + Vector((0, 0, 0.03))
        eb.align_roll(Vector((0, -1, 0)))
        eb.use_connect = False
        if parent:
            eb.parent = data.edit_bones[parent]
        m = np.array(eb.matrix)[:3, :3]
        assert np.allclose(m, [[1, 0, 0], [0, 0, -1], [0, 1, 0]], atol=1e-5), (bname, m)
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in obj.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return obj


def build_mesh(name, parts, armature, colours):
    """`parts`: (material name, Geo with weights). One mesh, one material slot per name."""
    names = []
    for m, _ in parts:
        if m not in names:
            names.append(m)
    geo = mk.merge([g for _, g in parts])
    mat_of_vert = np.concatenate([np.full(len(g.P), names.index(m)) for m, g in parts])
    # triangles face the way their vertices' normals do
    F = geo.F.copy()
    fn = np.cross(geo.P[F[:, 1]] - geo.P[F[:, 0]], geo.P[F[:, 2]] - geo.P[F[:, 0]])
    flip = np.einsum('ij,ij->i', fn, geo.N[F].sum(axis=1)) < 0
    F[flip] = F[flip][:, ::-1]
    area = np.linalg.norm(fn, axis=1)
    F = F[area > 1e-12]

    to_b = lambda a: np.stack([a[:, 0], -a[:, 2], a[:, 1]], -1)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_b(geo.P).tolist(), [], F.tolist())
    for n in names:
        mat = bpy.data.materials.new(n)
        mat.diffuse_color = (*colours.get(n, (0.8, 0.8, 0.8)), 1)
        mesh.materials.append(mat)
    mesh.polygons.foreach_set('material_index', mat_of_vert[F[:, 0]].astype(np.int32))
    mesh.polygons.foreach_set('use_smooth', np.ones(len(F), dtype=bool))
    loops = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', loops)
    uv = mesh.uv_layers.new(name='UVMap')
    uvs = geo.UV[loops].copy(); uvs[:, 1] = 1 - uvs[:, 1]
    uv.data.foreach_set('uv', uvs.ravel())
    mesh.normals_split_custom_set_from_vertices(to_b(geo.N).tolist())
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    # the four strongest bones a vertex, as glTF carries
    W = geo.W.copy()
    if W.shape[1] > 4:
        cut = np.sort(W, axis=1)[:, -4][:, None]
        W[W < cut] = 0
    W /= W.sum(axis=1, keepdims=True)
    for j, bone in enumerate(geo.bones):
        vg = obj.vertex_groups.new(name=bone)
        col = W[:, j]
        for w in np.unique(np.round(col[col > 1e-4], 4)):
            vg.add(np.nonzero(np.abs(col - w) < 5e-5)[0].tolist(), float(w), 'REPLACE')
    obj.parent = armature
    obj.modifiers.new('Armature', 'ARMATURE').object = armature
    return obj, dict(vertices=len(geo.P), triangles=len(F), materials=names)


def add_socket(name, armature, bone, M):
    """An empty on `bone` whose frame, in the armature's rest pose, is the game-space matrix M."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(e)
    e.parent = armature; e.parent_type = 'BONE'; e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix((C @ M @ np.linalg.inv(C)).tolist())
    return e


def bake_action(armature, name, frames):
    """`frames`: one dict per frame, bone -> quaternion (x, y, z, w), or (bone, 'loc') -> offset from rest."""
    ad = armature.animation_data or armature.animation_data_create()
    action = bpy.data.actions.new(name)
    ad.action = action
    for pb in armature.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    last = {}
    for f, pose in enumerate(frames):
        for key, v in pose.items():
            if isinstance(key, tuple):
                pb = armature.pose.bones[key[0]]
                pb.location = (float(v[0]), float(v[1]), float(v[2]))
                pb.keyframe_insert('location', frame=f)
                continue
            q = np.asarray(v, float)
            if key in last and np.dot(last[key], q) < 0:
                q = -q
            last[key] = q
            pb = armature.pose.bones[key]
            pb.rotation_quaternion = Quaternion((q[3], q[0], q[1], q[2]))
            pb.keyframe_insert('rotation_quaternion', frame=f)
    track = ad.nla_tracks.new(); track.name = name
    track.strips.new(name, 0, action)
    ad.action = None
    for pb in armature.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    return action


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=False,
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=False,
        export_anim_slide_to_zero=True, export_morph=False,
        export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_extras=False,
    )
