"""Blender 5.1 pipeline for cleaning, optimizing, and exporting the VW Gol G5 3D asset.

Imports `asterope.yft` via Sollumz, removes armature/collision objects, optimizes mesh
polygons within the 120k budget (preserving exterior panels), centers and mirrors all 4 wheels,
grounds the car at Z=0, rebuilds realistic VW Gol G5 Preto PBR Principled BSDF materials
without broken DDS links, exports `public/models/gol_g5.glb` (< 5.5 MB uncompressed glTF 2.0),
builds a diffused-studio animated showcase scene saved as `blender/gol_g5_portfolio.blend`,
and renders `blender/gol_g5_preview.png`, `docs/gol-g5-preview.mp4`, and `docs/gol-g5-preview.gif`.
"""

from __future__ import annotations

import math
import os
import shutil
import struct
import tempfile
import bpy
import bmesh
import mathutils
import numpy as np


YFT_DIR = r"C:\Users\rsaho\Downloads\5f45e5-Volkswagen Gol G5"
YFT_FILE = "asterope.yft"

WORKSPACE_DIR = r"C:\Users\rsaho\Downloads\portifolio"
GLB_OUT = os.path.join(WORKSPACE_DIR, "public", "models", "gol_g5.glb")
BLEND_OUT = os.path.join(WORKSPACE_DIR, "blender", "gol_g5_portfolio.blend")
PREVIEW_OUT = os.path.join(WORKSPACE_DIR, "blender", "gol_g5_preview.png")
MP4_OUT = os.path.join(WORKSPACE_DIR, "docs", "gol-g5-preview.mp4")
GIF_OUT = os.path.join(WORKSPACE_DIR, "docs", "gol-g5-preview.gif")

WHEEL_RADIUS = 0.3516
Z_LIFT = 0.524

# Frozen wheel positions before Z lift (Blender Z-up, +Y forward, -X left)
WHEEL_SPECS = [
    ("Wheel_FL", (-0.8059, 1.3431, -0.1724), False),
    ("Wheel_FR", (0.8165, 1.3431, -0.1724), True),
    ("Wheel_RL", (-0.8059, -1.4167, -0.1724), False),
    ("Wheel_RR", (0.8165, -1.4167, -0.1724), True),
]

# Decimation ratios: high exterior fidelity while keeping total <= 120,000 polys & GLB < 5.5 MB
DECIMATE_RATIOS = {
    "bodyshell": 0.90,
    "bonnet": 1.0,
    "bumper_f": 0.85,
    "bumper_r": 0.90,
    "door_dside_f": 0.88,
    "door_pside_f": 0.88,
    "door_dside_r": 0.88,
    "door_pside_r": 0.88,
    "headlight_l": 1.0,
    "headlight_r": 1.0,
    "brakelight_l": 1.0,
    "brakelight_m": 1.0,
    "brakelight_r": 1.0,
    "reversinglight_l": 1.0,
    "reversinglight_r": 1.0,
    "hub_lf": 0.55,
    "hub_rf": 0.55,
    "hub_lr": 0.55,
    "hub_rr": 0.55,
    "luxfarol": 1.0,
    "lanternada": 0.85,
    "lanterna": 1.0,
    "Taillight_Housing_Rear": 1.0,
    "painellux": 0.15,
    "painel": 0.14,
    "steeringwheel": 0.10,
}


def clear_scene_data() -> None:
    """Clear existing datablocks without resetting factory preferences (keeps sollumz active)."""
    for col in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.armatures,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.actions,
    ):
        for item in list(col):
            col.remove(item, do_unlink=True)


def set_active_single(obj: bpy.types.Object) -> None:
    """Select only the given object and make it active."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _create_packed_image(name: str, rgba: np.ndarray) -> bpy.types.Image:
    """Create a 512x512 sRGB Blender image from an HxWx4 float32 array and pack it as PNG."""
    height, width, channels = rgba.shape
    assert channels == 4
    img = bpy.data.images.new(name=name, width=width, height=height, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    img.update()
    img.pack()
    return img


def build_optics_textures() -> dict[str, bpy.types.Image]:
    """Generate and pack 6 procedural 512x512 PBR textures for VW Gol G5 headlights & taillights."""
    size = 512
    lin = np.linspace(0.0, 1.0, size, dtype=np.float32)
    u, v = np.meshgrid(lin, lin)

    # ------------------------------------------------------------------
    # 1 & 2. Clean chrome parabolic headlight reflector + uniform xenon emissive
    # ------------------------------------------------------------------
    flute_u = 0.5 + 0.5 * np.cos(u * 2.0 * np.pi * 56.0)
    flute_v = 0.5 + 0.5 * np.cos(v * 2.0 * np.pi * 40.0)
    chrome_val = 0.68 + 0.12 * flute_u + 0.08 * flute_v  # 0.68..0.88 light bluish-silver
    hl_rgb = np.stack(
        [chrome_val * 0.93, chrome_val * 0.97, chrome_val * 1.00],
        axis=-1,
    ).astype(np.float32)

    # Smooth, uniform cool-white xenon glow without dark rings or patches
    hl_em_val = 0.78 + 0.10 * flute_u + 0.06 * flute_v
    hl_em = np.stack(
        [hl_em_val * 0.86, hl_em_val * 0.93, hl_em_val * 1.00],
        axis=-1,
    ).astype(np.float32)

    alpha_one = np.ones((size, size, 1), dtype=np.float32)
    tex_hl_refl = _create_packed_image("Tex_Headlight_Reflector", np.concatenate([hl_rgb, alpha_one], axis=-1))
    tex_hl_em = _create_packed_image("Tex_Headlight_Emissive", np.concatenate([hl_em, alpha_one], axis=-1))

    # ------------------------------------------------------------------
    # 3 & 4. Clean ruby Fresnel taillight texture + uniform ruby emissive
    # ------------------------------------------------------------------
    h_ribs = 0.5 + 0.5 * np.cos(v * 2.0 * np.pi * 64.0)
    ruby_r = 0.38 + 0.24 * h_ribs  # 0.38..0.62 rich ruby red
    ruby_rgb = np.stack(
        [
            ruby_r,
            0.008 + 0.012 * h_ribs,
            0.010 + 0.014 * h_ribs,
        ],
        axis=-1,
    ).astype(np.float32)

    ruby_em = np.stack(
        [
            0.34 + 0.32 * h_ribs,
            0.008 + 0.012 * h_ribs,
            0.006 + 0.010 * h_ribs,
        ],
        axis=-1,
    ).astype(np.float32)

    # Subtle boost on high-mount brake light bar (brakelight_m covers U=[0.57, 0.89], V=[0.77, 0.99])
    m_bar = (u >= 0.56) & (u <= 0.90) & (v >= 0.77) & (v <= 0.83)
    ruby_em[m_bar, 0] = np.maximum(ruby_em[m_bar, 0], 0.76)
    ruby_em[m_bar, 1] = np.maximum(ruby_em[m_bar, 1], 0.03)

    tex_tl_ruby = _create_packed_image("Tex_Taillight_Ruby", np.concatenate([ruby_rgb, alpha_one], axis=-1))
    tex_tl_em = _create_packed_image("Tex_Taillight_Emissive", np.concatenate([ruby_em, alpha_one], axis=-1))

    # ------------------------------------------------------------------
    # 5. Clean horizontal-fluted crystal-silver reverse reflector (0.68..0.82)
    # ------------------------------------------------------------------
    h_flute = 0.5 + 0.5 * np.cos(v * 2.0 * np.pi * 68.0)
    crys_val = 0.68 + 0.14 * h_flute
    crys_rgb = np.stack([crys_val * 0.96, crys_val * 0.98, crys_val * 1.00], axis=-1).astype(np.float32)
    tex_tl_crystal = _create_packed_image("Tex_Taillight_Crystal", np.concatenate([crys_rgb, alpha_one], axis=-1))

    # ------------------------------------------------------------------
    # 6. Amber/smoked automotive turn-signal reflector (fine horizontal stripes)
    # ------------------------------------------------------------------
    amber_ribs = 0.5 + 0.5 * np.cos(v * 2.0 * np.pi * 64.0)
    amber_rgb = np.stack(
        [
            0.72 + 0.16 * amber_ribs,  # 0.72..0.88
            0.34 + 0.12 * amber_ribs,  # 0.34..0.46
            0.05 + 0.05 * amber_ribs,  # 0.05..0.10
        ],
        axis=-1,
    ).astype(np.float32)
    tex_tl_amber = _create_packed_image("Tex_Taillight_Amber", np.concatenate([amber_rgb, alpha_one], axis=-1))

    return {
        "Tex_Headlight_Reflector": tex_hl_refl,
        "Tex_Headlight_Emissive": tex_hl_em,
        "Tex_Taillight_Ruby": tex_tl_ruby,
        "Tex_Taillight_Emissive": tex_tl_em,
        "Tex_Taillight_Crystal": tex_tl_crystal,
        "Tex_Taillight_Amber": tex_tl_amber,
    }


def create_principled_material(
    name: str,
    base_color: tuple[float, float, float, float],
    metallic: float = 0.0,
    roughness: float = 0.5,
    alpha: float = 1.0,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.05,
    emission_color: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    ior: float = 1.45,
    is_blend: bool = False,
    base_color_image: bpy.types.Image | None = None,
    emission_image: bpy.types.Image | None = None,
) -> bpy.types.Material:
    """Create a clean Principled BSDF PBR material with optional packed procedural images."""
    mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None:
        mat.use_nodes = True

    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    bsdf.inputs["IOR"].default_value = ior

    if base_color_image is not None:
        tex_base = nodes.new("ShaderNodeTexImage")
        tex_base.location = (-320, 120)
        tex_base.image = base_color_image
        tex_base.extension = "REPEAT"
        links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if emission_image is not None and "Emission Color" in bsdf.inputs:
        tex_em = nodes.new("ShaderNodeTexImage")
        tex_em.location = (-320, -160)
        tex_em.image = emission_image
        tex_em.extension = "REPEAT"
        links.new(tex_em.outputs["Color"], bsdf.inputs["Emission Color"])
    elif emission_color is not None and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = emission_color
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    if is_blend:
        if hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
    else:
        if hasattr(mat, "blend_method"):
            mat.blend_method = "OPAQUE"
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"

    return mat


def build_pbr_palette() -> dict[str, bpy.types.Material]:
    """Build the realistic VW Gol G5 Preto PBR materials including packed procedural optical textures."""
    tex = build_optics_textures()
    return {
        "Mat_CarPaint_Black": create_principled_material(
            "Mat_CarPaint_Black",
            base_color=(0.015, 0.016, 0.020, 1.0),
            metallic=0.22,
            roughness=0.34,
            coat_weight=0.45,
            coat_roughness=0.15,
        ),
        "Mat_Trim_Black": create_principled_material(
            "Mat_Trim_Black",
            base_color=(0.055, 0.058, 0.064, 1.0),
            metallic=0.04,
            roughness=0.78,
        ),
        "Mat_Tire_Rubber": create_principled_material(
            "Mat_Tire_Rubber",
            base_color=(0.04, 0.042, 0.046, 1.0),
            metallic=0.0,
            roughness=0.88,
        ),
        "Mat_Alloy_Rim": create_principled_material(
            "Mat_Alloy_Rim",
            base_color=(0.68, 0.71, 0.75, 1.0),
            metallic=0.85,
            roughness=0.28,
        ),
        "Mat_Glass_Tint": create_principled_material(
            "Mat_Glass_Tint",
            base_color=(0.015, 0.018, 0.022, 1.0),
            metallic=0.0,
            roughness=0.06,
            alpha=0.58,
            is_blend=True,
        ),
        "Mat_Headlight_Lens": create_principled_material(
            "Mat_Headlight_Lens",
            base_color=(0.14, 0.17, 0.22, 1.0),
            metallic=0.08,
            roughness=0.025,
            alpha=0.34,
            coat_weight=1.0,
            coat_roughness=0.015,
            ior=1.52,
            is_blend=True,
        ),
        "Mat_Headlight_Mask_Black": create_principled_material(
            "Mat_Headlight_Mask_Black",
            base_color=(0.024, 0.027, 0.033, 1.0),
            metallic=0.28,
            roughness=0.22,
            coat_weight=0.65,
            coat_roughness=0.08,
        ),
        "Mat_Chrome_Reflector": create_principled_material(
            "Mat_Chrome_Reflector",
            base_color=(0.88, 0.90, 0.94, 1.0),
            metallic=0.96,
            roughness=0.07,
        ),
        "Mat_Brake_Caliper_Red": create_principled_material(
            "Mat_Brake_Caliper_Red",
            base_color=(0.72, 0.05, 0.05, 1.0),
            metallic=0.25,
            roughness=0.38,
        ),
        "Mat_Brake_Disc": create_principled_material(
            "Mat_Brake_Disc",
            base_color=(0.48, 0.50, 0.54, 1.0),
            metallic=0.88,
            roughness=0.30,
        ),
        "Mat_Chrome_Trim": create_principled_material(
            "Mat_Chrome_Trim",
            base_color=(0.82, 0.84, 0.87, 1.0),
            metallic=0.92,
            roughness=0.22,
        ),
        "Mat_Headlight_Xenon": create_principled_material(
            "Mat_Headlight_Xenon",
            base_color=(0.82, 0.86, 0.92, 1.0),
            metallic=0.92,
            roughness=0.09,
            coat_weight=0.5,
            emission_strength=0.35,
            base_color_image=tex["Tex_Headlight_Reflector"],
            emission_image=tex["Tex_Headlight_Emissive"],
        ),
        "Mat_Brakelight_Red": create_principled_material(
            "Mat_Brakelight_Red",
            base_color=(0.55, 0.02, 0.02, 1.0),
            metallic=0.18,
            roughness=0.10,
            coat_weight=1.0,
            coat_roughness=0.03,
            emission_strength=0.45,
            base_color_image=tex["Tex_Taillight_Ruby"],
            emission_image=tex["Tex_Taillight_Emissive"],
        ),
        "Mat_Taillight_Ruby_Lens": create_principled_material(
            "Mat_Taillight_Ruby_Lens",
            base_color=(0.50, 0.012, 0.015, 1.0),
            metallic=0.06,
            roughness=0.035,
            alpha=0.86,
            coat_weight=1.0,
            coat_roughness=0.02,
            is_blend=True,
        ),
        "Mat_Taillight_Dark_Ruby": create_principled_material(
            "Mat_Taillight_Dark_Ruby",
            base_color=(0.18, 0.006, 0.009, 1.0),
            metallic=0.06,
            roughness=0.045,
            coat_weight=1.0,
            coat_roughness=0.02,
            is_blend=False,
        ),
        "Mat_Taillight_Amber_Chamber": create_principled_material(
            "Mat_Taillight_Amber_Chamber",
            base_color=(0.80, 0.40, 0.075, 1.0),
            metallic=0.35,
            roughness=0.10,
            coat_weight=0.90,
            base_color_image=tex["Tex_Taillight_Amber"],
        ),
        "Mat_Reversing_Light": create_principled_material(
            "Mat_Reversing_Light",
            base_color=(0.85, 0.88, 0.92, 1.0),
            metallic=0.35,
            roughness=0.08,
            coat_weight=0.90,
            emission_color=(0.95, 0.98, 1.0, 1.0),
            emission_strength=0.15,
            base_color_image=tex["Tex_Taillight_Crystal"],
        ),
    }


def resolve_material_for_slot(
    obj_name: str, orig_mat_name: str, palette: dict[str, bpy.types.Material]
) -> bpy.types.Material:
    """Map an imported Sollumz material slot to the clean PBR palette, isolating emblems and optics."""
    base = orig_mat_name.strip()

    # Dedicated headlight & taillight optical assemblies
    if obj_name == "luxfarol":
        return palette["Mat_Headlight_Lens"]
    if obj_name == "lanternada":
        return palette["Mat_Headlight_Mask_Black"]
    if obj_name == "lanterna":
        return palette["Mat_Chrome_Reflector"]
    if obj_name in ("reversinglight_l", "reversinglight_r"):
        return palette["Mat_Reversing_Light"]
    if obj_name == "Taillight_Housing_Rear":
        if base == "vermelgo":
            return palette["Mat_Taillight_Ruby_Lens"]
        if base == "gol01":
            return palette["Mat_Taillight_Dark_Ruby"]
        if base.startswith("vehiclelights128"):
            return palette["Mat_Taillight_Amber_Chamber"]
    if obj_name in ("brakelight_l", "brakelight_r") and base.startswith("vehicle_generic_glasswindows2"):
        return palette["Mat_Taillight_Ruby_Lens"]

    # Exclusive light materials per emitter mesh so runtime light toggles never leak
    if base.startswith("vehiclelights128"):
        if obj_name in ("headlight_l", "headlight_r"):
            return palette["Mat_Headlight_Xenon"]
        if obj_name in ("brakelight_l", "brakelight_m", "brakelight_r"):
            return palette["Mat_Brakelight_Red"]
        if obj_name in ("door_dside_f", "door_pside_f"):
            return palette["Mat_Chrome_Trim"]
        return palette["Mat_Trim_Black"]

    # Primary painted body panels -> deep non-chrome black car paint
    if base in ("vehicle_generic_smallspecmap [PRIMARY]", "gol01"):
        return palette["Mat_CarPaint_Black"]

    # 'reflect' holds VW emblems/GOL/1.6 badges (boot), exhaust tip (bumper_r),
    # front VW emblem/grille bar (bumper_f), and door side badges/trim (door_*)
    if base == "reflect":
        if obj_name in ("boot", "bumper_r", "bumper_f", "door_dside_f", "door_pside_f"):
            return palette["Mat_Chrome_Trim"]
        return palette["Mat_Trim_Black"]

    if base in ("preto", "fosco", "script_rt_schafter_dials"):
        return palette["Mat_Trim_Black"]

    if base == "preto.001":
        return palette["Mat_Tire_Rubber"]

    if base == "vehicle_generic_tyrewallblack":
        # On hub_* this slot is the brake rotor; on any wheel/tire fallback it is rubber
        if obj_name.startswith("hub_"):
            return palette["Mat_Brake_Disc"]
        return palette["Mat_Tire_Rubber"]

    if base == "cinza 4.001":
        return palette["Mat_Alloy_Rim"]

    if base == "cinza 4":
        if obj_name == "boot":
            return palette["Mat_Chrome_Trim"]
        if obj_name in ("door_dside_f", "door_pside_f", "door_dside_r", "door_pside_r"):
            return palette["Mat_Trim_Black"]
        return palette["Mat_Alloy_Rim"]

    if base == "vehicle_licenseplate":
        return palette["Mat_Alloy_Rim"]

    if base.startswith("vehicle_generic_glasswindows2"):
        return palette["Mat_Glass_Tint"]

    if base == "vermelgo":
        return palette["Mat_Brake_Caliper_Red"]

    return palette["Mat_Trim_Black"]


def strip_unused_mesh_attributes(obj: bpy.types.Object) -> None:
    """Remove redundant UV maps (>1) and vertex colors unused by pure Principled BSDF materials."""
    mesh = obj.data
    while len(mesh.uv_layers) > 1:
        mesh.uv_layers.remove(mesh.uv_layers[-1])
    for attr in list(mesh.color_attributes):
        mesh.color_attributes.remove(attr)


def merge_split_vertices(obj: bpy.types.Object, dist: float = 0.0001) -> None:
    """Merge Sollumz split UV/edge vertices so Decimate collapses cleanly without holes."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.validate(verbose=False)
    obj.data.update()


def apply_decimate(obj: bpy.types.Object, ratio: float, smooth_angle_deg: float = 38.0) -> None:
    """Apply Collapse Decimate modifier and recompute angle-based smooth normals."""
    set_active_single(obj)
    if ratio < 0.999:
        mod = obj.modifiers.new(name="Decimate_Opt", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)

    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle_deg))
    obj.data.validate(verbose=False)


def separate_taillight_housing_from_painel() -> bpy.types.Object | None:
    """Separate rear taillight housing polygons (world Y < -1.50) from 'painel' into 'Taillight_Housing_Rear'."""
    painel = bpy.data.objects.get("painel")
    if painel is None:
        return None

    set_active_single(painel)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    selected_count = 0
    for poly in painel.data.polygons:
        wc = painel.matrix_world @ poly.center
        if wc.y < -1.50:
            poly.select = True
            selected_count += 1

    if selected_count == 0:
        return None

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")

    separated = [o for o in bpy.context.selected_objects if o != painel]
    if not separated:
        return None

    housing = separated[0]
    housing.name = "Taillight_Housing_Rear"
    housing.data.name = "Taillight_Housing_Rear"

    for mod in list(housing.modifiers):
        if mod.type == "DECIMATE":
            housing.modifiers.remove(mod)

    used_indices = {p.material_index for p in housing.data.polygons}
    for idx in range(len(housing.material_slots) - 1, -1, -1):
        if idx not in used_indices:
            set_active_single(housing)
            housing.active_material_index = idx
            bpy.ops.object.material_slot_remove()

    return housing


def decimate_boot_preserving_exterior(boot_obj: bpy.types.Object) -> None:
    """Strongly simplify hidden trunk audio mesh ('preto') while keeping exterior tailgate crisp."""
    preto_slot_indices = {
        idx
        for idx, slot in enumerate(boot_obj.material_slots)
        if slot.material and slot.material.name == "Mat_Trim_Black"
    }
    if not preto_slot_indices:
        apply_decimate(boot_obj, 0.22)
        return

    # Separate interior black trim/subwoofers to decimate independently of painted tailgate
    set_active_single(boot_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    for poly in boot_obj.data.polygons:
        if poly.material_index in preto_slot_indices:
            poly.select = True

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")

    separated = [o for o in bpy.context.selected_objects if o != boot_obj]
    apply_decimate(boot_obj, 0.92)
    for part in separated:
        apply_decimate(part, 0.04)

    bpy.ops.object.select_all(action="DESELECT")
    boot_obj.select_set(True)
    for part in separated:
        part.select_set(True)
    bpy.context.view_layer.objects.active = boot_obj
    bpy.ops.object.join()

    if boot_obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38.0))
    boot_obj.data.validate(verbose=False)


def recalc_outward_normals(obj: bpy.types.Object) -> None:
    """Recalculate consistent outward face normals using bmesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.validate(verbose=False)


def refine_headlight_lens(luxfarol_obj: bpy.types.Object) -> None:
    """Keep 100% of main headlight lenses (Z > 0.1), decimate heavy foglight lenses (Z <= 0.1) at 0.18, and fix normals."""
    set_active_single(luxfarol_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    fog_count = 0
    for poly in luxfarol_obj.data.polygons:
        wc = luxfarol_obj.matrix_world @ poly.center
        if wc.z <= 0.1:
            poly.select = True
            fog_count += 1

    if fog_count > 0:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")

        separated = [o for o in bpy.context.selected_objects if o != luxfarol_obj]
        for part in separated:
            apply_decimate(part, 0.18, smooth_angle_deg=45.0)

        bpy.ops.object.select_all(action="DESELECT")
        luxfarol_obj.select_set(True)
        for part in separated:
            part.select_set(True)
        bpy.context.view_layer.objects.active = luxfarol_obj
        bpy.ops.object.join()

    bm = bmesh.new()
    bm.from_mesh(luxfarol_obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for face in bm.faces:
        wc = luxfarol_obj.matrix_world @ face.calc_center_median()
        if wc.z > 0.1 and face.normal.y < 0.0:
            face.normal_flip()
    bm.normal_update()
    bm.to_mesh(luxfarol_obj.data)
    bm.free()

    set_active_single(luxfarol_obj)
    if luxfarol_obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(45.0))
    luxfarol_obj.data.validate(verbose=False)


def build_headlight_bulb_caps(palette: dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Create lightweight 3D Gol G5 dual-focus bulb deflector caps and amber turn bulbs (<250 tris)."""
    bm = bmesh.new()

    def add_dome_and_stem(
        cx: float, cy: float, cz: float, radius: float, stem_y_back: float, mat_idx: int
    ) -> None:
        segs = 12
        angles = [2.0 * math.pi * i / segs for i in range(segs)]
        eq_verts = [
            bm.verts.new((cx + radius * math.cos(a), cy, cz + radius * math.sin(a)))
            for a in angles
        ]
        mid_r = radius * math.cos(math.radians(45.0))
        mid_y = cy + radius * math.sin(math.radians(45.0))
        mid_verts = [
            bm.verts.new((cx + mid_r * math.cos(a), mid_y, cz + mid_r * math.sin(a)))
            for a in angles
        ]
        pole = bm.verts.new((cx, cy + radius, cz))

        created_faces: list[bmesh.types.BMFace] = []
        for i in range(segs):
            nxt = (i + 1) % segs
            f_quad = bm.faces.new((eq_verts[i], eq_verts[nxt], mid_verts[nxt], mid_verts[i]))
            f_tri = bm.faces.new((mid_verts[i], mid_verts[nxt], pole))
            created_faces.extend((f_quad, f_tri))

        stem_segs = 6
        stem_r = radius * 0.40
        s_angles = [2.0 * math.pi * i / stem_segs for i in range(stem_segs)]
        s_back = [
            bm.verts.new((cx + stem_r * math.cos(a), stem_y_back, cz + stem_r * math.sin(a)))
            for a in s_angles
        ]
        s_front = [
            bm.verts.new((cx + stem_r * math.cos(a), cy + 0.002, cz + stem_r * math.sin(a)))
            for a in s_angles
        ]
        for i in range(stem_segs):
            nxt = (i + 1) % stem_segs
            created_faces.append(bm.faces.new((s_back[i], s_back[nxt], s_front[nxt], s_front[i])))

        bm.normal_update()
        ref = mathutils.Vector((cx, cy - 0.004, cz))
        for f in created_faces:
            f.material_index = mat_idx
            f.smooth = True
            if (f.calc_center_median() - ref).dot(f.normal) < 0.0:
                f.normal_flip()

    def add_amber_bulb(cx: float, cy: float, cz: float, radius: float, mat_idx: int) -> None:
        segs = 12
        angles = [2.0 * math.pi * i / segs for i in range(segs)]
        eq_verts = [
            bm.verts.new((cx + radius * math.cos(a), cy, cz + radius * math.sin(a)))
            for a in angles
        ]
        front_pole = bm.verts.new((cx, cy + radius * 1.25, cz))
        back_pole = bm.verts.new((cx, cy - radius * 1.25, cz))
        created_faces: list[bmesh.types.BMFace] = []
        for i in range(segs):
            nxt = (i + 1) % segs
            created_faces.append(bm.faces.new((eq_verts[i], eq_verts[nxt], front_pole)))
            created_faces.append(bm.faces.new((eq_verts[nxt], eq_verts[i], back_pole)))
        bm.normal_update()
        ref = mathutils.Vector((cx, cy, cz))
        for f in created_faces:
            f.material_index = mat_idx
            f.smooth = True
            if (f.calc_center_median() - ref).dot(f.normal) < 0.0:
                f.normal_flip()

    for sign in (-1.0, 1.0):
        # Inner high-beam focus deflector cap (dish back at Y~1.897, luxfarol at Y~2.061)
        add_dome_and_stem(sign * 0.60, 1.935, 0.260, radius=0.018, stem_y_back=1.895, mat_idx=0)
        # Outer low-beam focus deflector cap (dish back at Y~1.764, luxfarol at Y~1.926)
        add_dome_and_stem(sign * 0.73, 1.830, 0.270, radius=0.020, stem_y_back=1.764, mat_idx=0)
        # Side corner amber turn-signal bulb (dish back at Y~1.702, luxfarol at Y~1.84+)
        add_amber_bulb(sign * 0.79, 1.770, 0.300, radius=0.014, mat_idx=1)

    mesh = bpy.data.meshes.new("Headlight_Optics_Detail")
    bm.to_mesh(mesh)
    bm.free()

    tri_count = sum(len(p.vertices) - 2 for p in mesh.polygons)
    assert tri_count <= 250, f"Headlight_Optics_Detail exceeded 250 tris: {tri_count}"

    obj = bpy.data.objects.new("Headlight_Optics_Detail", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(palette["Mat_Chrome_Reflector"])
    obj.data.materials.append(palette["Mat_Taillight_Amber_Chamber"])
    mesh.validate(verbose=False)
    print(f"Created Headlight_Optics_Detail: {len(mesh.polygons)} polys / {tri_count} tris")
    return obj


def build_grid_floor(collection: bpy.types.Collection) -> bpy.types.Object:
    """Create a dark #2B2B2E ground plane with procedural Blender-style XY grid lines."""
    bpy.ops.mesh.primitive_plane_add(size=140.0, location=(0.0, 22.0, 0.0))
    plane = bpy.context.active_object
    plane.name = "BlenderGrid_Floor"
    for c in list(plane.users_collection):
        c.objects.unlink(plane)
    collection.objects.link(plane)

    mat = bpy.data.materials.new("Mat_BlenderGrid_Floor")
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (620, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (340, 0)
    bsdf.inputs["Roughness"].default_value = 0.78
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # Procedural 1m grid using Object coordinates + Brick texture line mask
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-600, 0)

    brick = nodes.new("ShaderNodeTexBrick")
    brick.location = (-280, 80)
    brick.offset = 0.0
    brick.inputs["Scale"].default_value = 140.0
    brick.inputs["Mortar Size"].default_value = 0.025
    brick.inputs["Mortar Smooth"].default_value = 0.15
    brick.inputs["Row Height"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = 1.0
    # Base #2B2B2E in linear sRGB (~0.024, 0.024, 0.027) and grid lines #404047
    brick.inputs["Color1"].default_value = (0.024, 0.024, 0.027, 1.0)
    brick.inputs["Color2"].default_value = (0.024, 0.024, 0.027, 1.0)
    brick.inputs["Mortar"].default_value = (0.060, 0.062, 0.072, 1.0)

    links.new(tex_coord.outputs["Generated"], brick.inputs["Vector"])
    links.new(brick.outputs["Color"], bsdf.inputs["Base Color"])

    plane.data.materials.append(mat)
    return plane


def build_portfolio_monuments(collection: bpy.types.Collection) -> None:
    """Place restrained editorial project monuments along the +Y corridor without glare."""
    projects = [
        ("Monument_01_leitorECU", -7.2, 11.0, (0.78, 0.44, 0.20, 1.0)),
        ("Monument_02_VStable", 7.2, 18.0, (0.68, 0.42, 0.22, 1.0)),
        ("Monument_03_Chatbot", -7.2, 25.0, (0.74, 0.46, 0.24, 1.0)),
        ("Monument_04_Vincula", 7.2, 32.0, (0.64, 0.40, 0.20, 1.0)),
        ("Monument_05_OrdoVitae", -7.2, 39.0, (0.72, 0.44, 0.22, 1.0)),
        ("Monument_06_T2IA", 7.2, 46.0, (0.66, 0.42, 0.21, 1.0)),
    ]

    frame_mat = create_principled_material(
        "Mat_Monument_Frame",
        base_color=(0.045, 0.048, 0.055, 1.0),
        metallic=0.35,
        roughness=0.52,
    )

    for name, x_pos, y_pos, accent in projects:
        # Matte dark slate outer frame
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x_pos, y_pos, 1.65))
        totem = bpy.context.active_object
        totem.name = name
        totem.scale = (0.24, 3.0, 3.1)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        totem.rotation_euler.z = math.radians(-18.0 if x_pos < 0 else 18.0)
        totem.data.materials.append(frame_mat)

        # Subtle warm-amber editorial display panel (low emission to avoid washing car paint)
        inner_offset = 0.14 if x_pos < 0 else -0.14
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x_pos + inner_offset, y_pos, 1.80))
        screen = bpy.context.active_object
        screen.name = f"{name}_Screen"
        screen.scale = (0.05, 2.55, 2.05)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        screen.rotation_euler.z = totem.rotation_euler.z

        screen_mat = create_principled_material(
            f"Mat_{name}_Glow",
            base_color=(0.08, 0.085, 0.095, 1.0),
            metallic=0.05,
            roughness=0.45,
            emission_color=accent,
            emission_strength=0.38,
        )
        screen.data.materials.append(screen_mat)

        for obj in (totem, screen):
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            collection.objects.link(obj)


def set_linear_fcurves(obj: bpy.types.Object) -> None:
    """Force linear keyframe interpolation across Blender 5.1 slotted actions."""
    if not obj.animation_data or not obj.animation_data.action:
        return
    action = obj.animation_data.action
    if hasattr(action, "layers"):
        slot = obj.animation_data.action_slot
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbag"):
                    cb = strip.channelbag(slot)
                    if cb is not None:
                        for fc in cb.fcurves:
                            for kp in fc.keyframe_points:
                                kp.interpolation = "LINEAR"
    elif hasattr(action, "fcurves"):
        for fc in action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


def setup_showcase_scene(car_objects: list[bpy.types.Object], wheel_objects: list[bpy.types.Object]) -> None:
    """Create GolG5_Rig hierarchy, 240-frame drive animation, diffused studio lights, and 3/4 rear camera."""
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 240
    scene.render.fps = 30

    # Smooth highlight rolloff via AgX color management
    if hasattr(scene.view_settings, "view_transform"):
        try:
            scene.view_settings.view_transform = "AgX"
            scene.view_settings.look = "AgX - Medium Contrast"
            scene.view_settings.exposure = 0.05
        except Exception:
            pass

    # Studio World dark slate
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PortfolioWorld")
    if scene.world.node_tree is None:
        scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.026, 0.029, 0.036, 1.0)
        bg.inputs["Strength"].default_value = 0.72

    # Rig Empty parenting all car pieces and 4 wheels
    rig = bpy.data.objects.new("GolG5_Rig", None)
    rig.empty_display_type = "PLAIN_AXES"
    rig.empty_display_size = 1.0
    scene.collection.objects.link(rig)

    for obj in car_objects:
        mw = obj.matrix_world.copy()
        obj.parent = rig
        obj.matrix_world = mw

    # Environment corridor
    build_grid_floor(scene.collection)
    build_portfolio_monuments(scene.collection)

    # Large diffused softbox studio lights (controlled energy so black paint stays deep without white blowout)
    def add_area_light(
        name: str,
        loc: tuple[float, float, float],
        rot_deg: tuple[float, float, float],
        energy: float,
        size: float,
        color: tuple[float, float, float],
        parent_rig: bpy.types.Object,
        spread_deg: float = 135.0,
    ) -> None:
        ldata = bpy.data.lights.new(name=name, type="AREA")
        ldata.energy = energy
        ldata.size = size
        ldata.color = color
        if hasattr(ldata, "spread"):
            ldata.spread = math.radians(spread_deg)
        lobj = bpy.data.objects.new(name, ldata)
        lobj.location = loc
        lobj.rotation_euler = tuple(math.radians(a) for a in rot_deg)
        scene.collection.objects.link(lobj)
        lobj.parent = parent_rig

    add_area_light("Studio_Overhead", (0.0, 0.2, 6.4), (8.0, 0.0, 0.0), 480.0, 9.5, (1.0, 0.98, 0.96), rig)
    add_area_light("Studio_Key_Rear", (5.8, -3.2, 4.0), (54.0, 0.0, 56.0), 420.0, 7.5, (1.0, 0.96, 0.92), rig)
    add_area_light("Studio_Fill_Side", (-6.5, 1.2, 3.6), (62.0, 0.0, -102.0), 340.0, 8.5, (0.86, 0.91, 1.0), rig)
    add_area_light("Studio_Rim_Front", (-1.5, 5.8, 3.0), (70.0, 0.0, 165.0), 280.0, 7.0, (0.92, 0.95, 1.0), rig)

    # 3/4 rear-lateral chase camera attached to GolG5_Rig showing deep black paint, emblems, wheels & calipers
    target = bpy.data.objects.new("GolG5_CamTarget", None)
    target.location = (0.0, 0.35, 0.56)
    scene.collection.objects.link(target)
    target.parent = rig

    cam_data = bpy.data.cameras.new("Chase_Camera")
    cam_data.lens = 38.0
    cam = bpy.data.objects.new("Chase_Camera", cam_data)
    cam.location = (3.15, -4.35, 1.56)
    scene.collection.objects.link(cam)
    cam.parent = rig

    track = cam.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    scene.camera = cam

    # Animate GolG5_Rig moving Y = 0 -> 42m and wheels rolling without slip (-42 / 0.3516 rad)
    travel_y = 42.0
    wheel_rot_x = -travel_y / WHEEL_RADIUS

    rig.location = (0.0, 0.0, 0.0)
    rig.keyframe_insert(data_path="location", frame=1)
    rig.location = (0.0, travel_y, 0.0)
    rig.keyframe_insert(data_path="location", frame=240)
    set_linear_fcurves(rig)

    for w in wheel_objects:
        w.rotation_euler = (0.0, 0.0, 0.0)
        w.keyframe_insert(data_path="rotation_euler", index=0, frame=1)
        w.rotation_euler = (wheel_rot_x, 0.0, 0.0)
        w.keyframe_insert(data_path="rotation_euler", index=0, frame=240)
        set_linear_fcurves(w)


def _build_gif_palette() -> np.ndarray:
    """Build a 256-color palette: 6x6x6 RGB cube (216) + 40 dark-biased grayscale tones."""
    levels = np.array([0, 51, 102, 153, 204, 255], dtype=np.uint8)
    r, g, b = np.meshgrid(levels, levels, levels, indexing="ij")
    cube = np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1)

    # 40 grayscale levels biased toward dark studio/black car tones for smooth gradients
    t = np.linspace(0.0, 1.0, 40)
    grays = np.clip(np.round((t ** 1.45) * 255.0), 0, 255).astype(np.uint8)
    gray_rgb = np.stack([grays, grays, grays], axis=1)
    return np.vstack([cube, gray_rgb])


_BAYER_4X4 = (
    np.array(
        [
            [0, 8, 2, 10],
            [12, 4, 14, 6],
            [3, 11, 1, 9],
            [15, 7, 13, 5],
        ],
        dtype=np.float32,
    )
    / 16.0
    - 0.5
) * 14.0


def _quantize_frame(rgb_u8: np.ndarray, palette_f32: np.ndarray) -> bytes:
    """Quantize an HxWx3 uint8 RGB frame to 256 palette indices using 4x4 Bayer dithering."""
    h, w, _ = rgb_u8.shape
    dither = np.tile(_BAYER_4X4, (h // 4 + 1, w // 4 + 1))[:h, :w, None]
    work = np.clip(rgb_u8.astype(np.float32) + dither, 0.0, 255.0).reshape(-1, 3)

    # Chunked nearest-neighbor Euclidean distance to stay memory-light
    out = np.empty(work.shape[0], dtype=np.uint8)
    chunk = 40960
    pal_sq = np.sum(palette_f32 * palette_f32, axis=1)
    for start in range(0, work.shape[0], chunk):
        end = min(start + chunk, work.shape[0])
        block = work[start:end]
        # ||a - b||^2 = ||a||^2 + ||b||^2 - 2 a.b (omit ||a||^2 since constant per pixel)
        dist = pal_sq[None, :] - 2.0 * (block @ palette_f32.T)
        out[start:end] = np.argmin(dist, axis=1).astype(np.uint8)
    return out.tobytes()


def _lzw_encode_gif(indices: bytes, min_code_size: int = 8) -> bytes:
    """Encode 8-bit palette indices into GIF LZW sub-blocks."""
    clear_code = 1 << min_code_size
    eoi_code = clear_code + 1
    out_bits = bytearray()

    def write_subblocks(raw: bytes) -> bytes:
        chunks = bytearray()
        for i in range(0, len(raw), 255):
            seg = raw[i : i + 255]
            chunks.append(len(seg))
            chunks.extend(seg)
        chunks.append(0)
        return bytes(chunks)

    bit_buf = 0
    bit_count = 0

    def emit(code: int, size: int) -> None:
        nonlocal bit_buf, bit_count
        bit_buf |= code << bit_count
        bit_count += size
        while bit_count >= 8:
            out_bits.append(bit_buf & 0xFF)
            bit_buf >>= 8
            bit_count -= 8

    code_size = min_code_size + 1
    next_code = eoi_code + 1
    table: dict[int, int] = {}
    emit(clear_code, code_size)

    prefix = indices[0]
    for sym in indices[1:]:
        key = (prefix << 8) | sym
        found = table.get(key)
        if found is not None:
            prefix = found
        else:
            emit(prefix, code_size)
            if next_code < 4096:
                table[key] = next_code
                next_code += 1
                if next_code > (1 << code_size) and code_size < 12:
                    code_size += 1
            else:
                emit(clear_code, code_size)
                table.clear()
                code_size = min_code_size + 1
                next_code = eoi_code + 1
            prefix = sym

    emit(prefix, code_size)
    emit(eoi_code, code_size)
    if bit_count > 0:
        out_bits.append(bit_buf & 0xFF)

    return bytes([min_code_size]) + write_subblocks(bytes(out_bits))


def write_animated_gif(frame_paths: list[str], out_path: str, delay_cs: int = 8) -> None:
    """Assemble PNG frames into a looping GIF89a using pure Python + numpy."""
    palette = _build_gif_palette()
    palette_f32 = palette.astype(np.float32)

    first_img = bpy.data.images.load(frame_paths[0], check_existing=False)
    width, height = first_img.size[0], first_img.size[1]
    bpy.data.images.remove(first_img)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        # GIF89a Header + Logical Screen Descriptor (Global Color Table 256 colors)
        f.write(b"GIF89a")
        f.write(struct.pack("<HHBBB", width, height, 0xF7, 0, 0))
        f.write(palette.tobytes())
        # Netscape 2.0 infinite loop extension
        f.write(b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00")

        for fp in frame_paths:
            img = bpy.data.images.load(fp, check_existing=False)
            rgba = np.asarray(img.pixels[:], dtype=np.float32).reshape(height, width, 4)
            bpy.data.images.remove(img)
            # Flip vertically from Blender bottom-up to top-down RGB uint8
            rgb_u8 = np.clip(np.round(rgba[::-1, :, :3] * 255.0), 0, 255).astype(np.uint8)
            indices = _quantize_frame(rgb_u8, palette_f32)
            lzw_data = _lzw_encode_gif(indices, 8)

            # Graphic Control Extension + Image Descriptor + LZW payload
            f.write(struct.pack("<BBBBHBB", 0x21, 0xF9, 4, 0x04, delay_cs, 0, 0))
            f.write(struct.pack("<BHHHHB", 0x2C, 0, 0, width, height, 0x00))
            f.write(lzw_data)

        f.write(b"\x3B")


def render_preview_media(scene: bpy.types.Scene) -> None:
    """Render 1280x720 PNG preview, lightweight MP4 video, and <6MB animated GIF for README."""
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 32

    # 1. 1280x720 preview PNG at frame 24
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = "IMAGE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW_OUT
    scene.frame_set(24)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered preview PNG: {PREVIEW_OUT} ({os.path.getsize(PREVIEW_OUT)} bytes)")

    # 2. Short lightweight MP4 (640x360, 24 fps, 72 frames over frames 1..144 step 2 = 3s)
    os.makedirs(os.path.dirname(MP4_OUT), exist_ok=True)
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 16
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    saved_start, saved_end, saved_step, saved_fps = (
        scene.frame_start,
        scene.frame_end,
        scene.frame_step,
        scene.render.fps,
    )

    scene.frame_start = 1
    scene.frame_end = 144
    scene.frame_step = 2
    scene.render.fps = 24
    scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.filepath = MP4_OUT
    bpy.ops.render.render(animation=True)
    print(f"Rendered preview MP4: {MP4_OUT} ({os.path.getsize(MP4_OUT)} bytes)")

    # 3. Animated GIF for GitHub README (< 6 MB): 640x360, 36 frames (frames 1..141 step 4), 12.5 fps
    tmp_dir = tempfile.mkdtemp(prefix="gol_g5_gif_")
    try:
        scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        frame_paths: list[str] = []
        for idx, fr in enumerate(range(1, 145, 4)):
            fp = os.path.join(tmp_dir, f"frame_{idx:03d}.png")
            scene.frame_set(fr)
            scene.render.filepath = fp
            bpy.ops.render.render(write_still=True)
            frame_paths.append(fp)
        write_animated_gif(frame_paths, GIF_OUT, delay_cs=8)
        gif_bytes = os.path.getsize(GIF_OUT)
        print(f"Rendered preview GIF: {GIF_OUT} ({gif_bytes} bytes / {gif_bytes / (1024 * 1024):.2f} MB)")
        assert gif_bytes < 6 * 1024 * 1024, f"GIF exceeds 6 MB budget: {gif_bytes} bytes"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        scene.frame_start = saved_start
        scene.frame_end = saved_end
        scene.frame_step = saved_step
        scene.render.fps = saved_fps
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 720
        scene.render.image_settings.media_type = "IMAGE"
        scene.render.image_settings.file_format = "PNG"
        scene.frame_set(24)


def main() -> None:
    clear_scene_data()

    bpy.ops.sollumz.import_assets(directory=YFT_DIR, files=[{"name": YFT_FILE}])

    # 1. Delete collisions, armatures, empties, default lights/cameras, and hidden under-hood motor
    for obj in list(bpy.data.objects):
        if (
            obj.name.endswith(".col")
            or obj.name in ("asterope", "asterope.col", "asterope.mesh", "Cube", "Light", "Camera", "motor")
            or obj.type in ("ARMATURE", "EMPTY")
        ):
            bpy.data.objects.remove(obj, do_unlink=True)

    # 2. Unparent remaining meshes keeping world transforms, clear Armature & Vertex Groups
    mesh_objects = [o for o in bpy.data.objects if o.type == "MESH"]
    for obj in mesh_objects:
        mw = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = mw
        for mod in list(obj.modifiers):
            if mod.type == "ARMATURE":
                obj.modifiers.remove(mod)
        obj.vertex_groups.clear()

    # Extract rear taillight housings from 'painel' (world Y < -1.50) before material/decimation pass
    taillight_housing = separate_taillight_housing_from_painel()
    if taillight_housing is not None:
        print(f"Separated {taillight_housing.name}: {len(taillight_housing.data.polygons)} polys")
        mesh_objects = [o for o in bpy.data.objects if o.type == "MESH"]

    # 3. Build clean PBR palette (with packed procedural optical textures) and replace Sollumz/DDS materials
    palette = build_pbr_palette()
    for obj in mesh_objects:
        for slot in obj.material_slots:
            orig_name = slot.material.name if slot.material else ""
            slot.material = resolve_material_for_slot(obj.name, orig_name, palette)

        # Keep front-door side badge chrome, but match the lower door molding strip (friso)
        # to Mat_Trim_Black so front and rear doors have uniform matte trim.
        if obj.name in ("door_dside_f", "door_pside_f"):
            chrome_idx = next(
                (i for i, s in enumerate(obj.material_slots) if s.material == palette["Mat_Chrome_Trim"]),
                None,
            )
            if chrome_idx is not None:
                trim_idx = next(
                    (i for i, s in enumerate(obj.material_slots) if s.material == palette["Mat_Trim_Black"]),
                    None,
                )
                if trim_idx is None:
                    obj.data.materials.append(palette["Mat_Trim_Black"])
                    trim_idx = len(obj.material_slots) - 1
                for poly in obj.data.polygons:
                    if poly.material_index == chrome_idx:
                        wc = obj.matrix_world @ poly.center
                        if wc.y <= 0.55 and wc.z < 0.30:
                            poly.material_index = trim_idx

    # Purge unused Sollumz materials and zero-size DDS images (keep packed procedural textures!)
    for mat in list(bpy.data.materials):
        if mat.users == 0 and mat.name not in palette:
            bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.size[0] == 0 or img.size[1] == 0:
            bpy.data.images.remove(img)

    # 4. Strip unused attributes/extra UVs, merge split seam vertices, and decimate heavy meshes
    for obj in mesh_objects:
        strip_unused_mesh_attributes(obj)
        merge_split_vertices(obj, dist=0.0001)
        if obj.name == "boot":
            decimate_boot_preserving_exterior(obj)
        elif obj.name == "luxfarol":
            refine_headlight_lens(obj)
        elif obj.name == "Taillight_Housing_Rear":
            recalc_outward_normals(obj)
            apply_decimate(obj, 1.0, smooth_angle_deg=35.0)
        elif obj.name in ("brakelight_l", "brakelight_r"):
            recalc_outward_normals(obj)
            apply_decimate(obj, 1.0)
        elif obj.name == "wheel_lf.child":
            apply_decimate(obj, 0.25)
        elif obj.name in DECIMATE_RATIOS:
            apply_decimate(obj, DECIMATE_RATIOS[obj.name])
        else:
            apply_decimate(obj, 1.0)

    # Add lightweight 3D dual-focus bulb deflector caps & amber turn bulbs inside headlights
    build_headlight_bulb_caps(palette)

    # 5. Center wheel geometry origin and instantiate the 4 wheels (sharing L/R mesh data)
    src_wheel = bpy.data.objects["wheel_lf.child"]
    set_active_single(src_wheel)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    left_wheel_mesh = src_wheel.data
    left_wheel_mesh.name = "Wheel_Left_Mesh"
    right_wheel_mesh: bpy.types.Mesh | None = None

    wheel_objects: list[bpy.types.Object] = []
    for wheel_name, pos, flip_180 in WHEEL_SPECS:
        w_obj = src_wheel.copy()
        w_obj.name = wheel_name
        bpy.context.scene.collection.objects.link(w_obj)
        w_obj.location = pos
        if flip_180:
            if right_wheel_mesh is None:
                w_obj.data = left_wheel_mesh.copy()
                w_obj.data.name = "Wheel_Right_Mesh"
                w_obj.rotation_euler = (0.0, 0.0, math.pi)
                set_active_single(w_obj)
                bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
                right_wheel_mesh = w_obj.data
            else:
                w_obj.data = right_wheel_mesh
                w_obj.rotation_euler = (0.0, 0.0, 0.0)
        else:
            w_obj.data = left_wheel_mesh
            w_obj.rotation_euler = (0.0, 0.0, 0.0)
        wheel_objects.append(w_obj)

    bpy.data.objects.remove(src_wheel, do_unlink=True)

    # 6. Lift entire vehicle +0.524m in Z so tires sit flush on Z = 0
    car_objects = [o for o in bpy.data.objects if o.type == "MESH"]
    for obj in car_objects:
        obj.location.z += Z_LIFT

    bpy.context.view_layer.update()

    # Verify global bounding box, polygon count, and zero-size images
    total_polys = sum(len(o.data.polygons) for o in car_objects)
    min_x = min_y = min_z = float("inf")
    max_x = max_y = max_z = float("-inf")
    for obj in car_objects:
        for corner in obj.bound_box:
            wc = obj.matrix_world @ mathutils.Vector(corner)
            min_x, max_x = min(min_x, wc.x), max(max_x, wc.x)
            min_y, max_y = min(min_y, wc.y), max(max_y, wc.y)
            min_z, max_z = min(min_z, wc.z), max(max_z, wc.z)

    empty_images = [img.name for img in bpy.data.images if img.size[0] == 0 or img.size[1] == 0]
    packed_images = [f"{img.name}({img.size[0]}x{img.size[1]})" for img in bpy.data.images if img.packed_file]
    print(f"=== CAR EXPORT SUMMARY ===")
    print(f"Objects count: {len(car_objects)}")
    for o in sorted(car_objects, key=lambda x: len(x.data.polygons), reverse=True):
        print(f"  {o.name}: {len(o.data.polygons)} polys")
    print(f"Total polygons: {total_polys}")
    print(f"Packed procedural images ({len(packed_images)}): {packed_images}")
    print(f"Wheel FL loc: {[round(v, 4) for v in bpy.data.objects['Wheel_FL'].location]}")
    print(f"Wheel FR loc: {[round(v, 4) for v in bpy.data.objects['Wheel_FR'].location]} rot={[round(v, 4) for v in bpy.data.objects['Wheel_FR'].rotation_euler]}")
    print(f"Wheel RL loc: {[round(v, 4) for v in bpy.data.objects['Wheel_RL'].location]}")
    print(f"Wheel RR loc: {[round(v, 4) for v in bpy.data.objects['Wheel_RR'].location]} rot={[round(v, 4) for v in bpy.data.objects['Wheel_RR'].rotation_euler]}")
    print(f"Global BBox X=[{min_x:.4f}, {max_x:.4f}] Y=[{min_y:.4f}, {max_y:.4f}] Z=[{min_z:.4f}, {max_z:.4f}]")
    print(f"Zero-size images remaining: {empty_images}")

    assert total_polys <= 115000, f"Polygon budget exceeded: {total_polys} > 115000"
    assert abs(min_z) < 0.01, f"Vehicle not grounded at Z=0: Z_min={min_z}"
    assert not empty_images, f"Empty images still exist: {empty_images}"
    assert len(packed_images) == 6, f"Expected 6 packed procedural images, got {packed_images}"

    # 7. Export clean GLB without Draco
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in car_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["bodyshell"]

    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT,
        export_format="GLB",
        export_image_format="AUTO",
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=False,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="NONE",
        export_cameras=False,
        export_lights=False,
    )
    glb_bytes = os.path.getsize(GLB_OUT)
    print(f"Exported GLB: {GLB_OUT} ({glb_bytes} bytes / {glb_bytes / (1024 * 1024):.2f} MB)")
    assert glb_bytes < 5.2 * 1024 * 1024, f"GLB exceeds 5.2 MB budget: {glb_bytes} bytes"

    # 8. Build animated Blender showcase scene, save .blend, and render preview PNG + MP4 + GIF
    setup_showcase_scene(car_objects, wheel_objects)
    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    print(f"Saved BLEND: {BLEND_OUT} ({os.path.getsize(BLEND_OUT)} bytes)")

    render_preview_media(bpy.context.scene)


if __name__ == "__main__":
    main()
