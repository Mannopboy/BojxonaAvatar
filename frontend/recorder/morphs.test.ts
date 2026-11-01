import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { sanitizeClip, stripMorphs, isLipSyncMorph } from "./morphs";

const NEEDED = ["V_Open", "Eye_Blink_L"];
const CORR = Array.from({ length: 8 }, (_, i) => `CORR_Uniform_Volume_0${i + 1}`);

function makeMesh(names: string[], name = "mesh") {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  // har target'ni indeksiga teng qiymat bilan belgilaymiz (moslikni tekshirish uchun)
  geo.morphAttributes.position = names.map((_, i) => new THREE.BufferAttribute(new Float32Array(9).fill(i), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.morphTargetDictionary = Object.fromEntries(names.map((n, i) => [n, i]));
  mesh.morphTargetInfluences = names.map((_, i) => i / 100);
  return mesh;
}

describe("stripMorphs", () => {
  it("kiyimning barcha 8 CORR_* morphini saqlaydi, keraksizini olib tashlaydi", () => {
    const mesh = makeMesh(["Junk_A", ...CORR, "V_Open", "Junk_B"]);
    const kept = stripMorphs(mesh, NEEDED);
    expect(kept).toEqual([...CORR, "V_Open"]);
    expect(Object.keys(mesh.morphTargetDictionary!)).toHaveLength(9);
    expect(mesh.morphTargetInfluences).toHaveLength(9);
    expect(mesh.geometry.morphAttributes.position).toHaveLength(9);
  });

  it("dictionary, attributes va influences indekslari mos (asl tartib)", () => {
    const all = ["Junk_A", ...CORR, "V_Open", "Junk_B"];
    const mesh = makeMesh(all);
    stripMorphs(mesh, NEEDED);
    for (const [n, j] of Object.entries(mesh.morphTargetDictionary!)) {
      const orig = all.indexOf(n);
      expect(mesh.geometry.morphAttributes.position[j].array[0]).toBe(orig);
      expect(mesh.morphTargetInfluences![j]).toBeCloseTo(orig / 100);
    }
    // CORR_01 klipdagi weights[0] ga mos: yangi indeks 0
    expect(mesh.morphTargetDictionary!.CORR_Uniform_Volume_01).toBe(0);
  });

  it("ikkinchi chaqiruv idempotent", () => {
    const mesh = makeMesh([...CORR, "Junk"]);
    stripMorphs(mesh, NEEDED);
    expect(stripMorphs(mesh, NEEDED)).toEqual(CORR);
  });

  it("CORR_* lip-sync boshqaruviga qo'shilmaydi", () => {
    expect(isLipSyncMorph("CORR_Uniform_Volume_01", [...NEEDED, "CORR_Uniform_Volume_01"])).toBe(false);
    expect(isLipSyncMorph("V_Open", NEEDED)).toBe(true);
  });
});

describe("sanitizeClip", () => {
  const root = new THREE.Group();
  const uniform = makeMesh(CORR, "Uniform");
  root.add(uniform);

  const weights = new Float32Array(2 * 8).map((_, i) => (i % 8 === 3 ? -0.4 : 0.5)); // manfiy qiymat
  const morphTrack = new THREE.NumberKeyframeTrack("Uniform.morphTargetInfluences", [0, 1], Array.from(weights));
  const boneTrack = new THREE.QuaternionKeyframeTrack("Arm.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);

  it("kiyim morph treklarini va suyak treklarini saqlaydi, qiymatlarni o'zgartirmaydi", () => {
    const clip = new THREE.AnimationClip("Salute", 1, [boneTrack, morphTrack]);
    const out = sanitizeClip(clip, root);
    expect(out.tracks.map((t) => t.name)).toEqual(["Arm.quaternion", "Uniform.morphTargetInfluences"]);
    const v = out.tracks[1].values;
    expect(v[3]).toBeCloseTo(-0.4); // manfiy clamp qilinmagan
    expect(Math.min(...v)).toBeLessThan(0);
  });

  it("influence soniga mos kelmagan morph trekni tashlaydi (indeks siljishi)", () => {
    const bad = new THREE.NumberKeyframeTrack("Uniform.morphTargetInfluences", [0, 1], new Array(2 * 400).fill(0));
    const out = sanitizeClip(new THREE.AnimationClip("S", 1, [boneTrack, bad]), root);
    expect(out.tracks.map((t) => t.name)).toEqual(["Arm.quaternion"]);
  });
});
