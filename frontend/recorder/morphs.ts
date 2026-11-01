// Morph target saralash + animatsiya treklarini tekshirish (Avatar.tsx uchun, testlanadi).
//
// Yuz morphlari (viseme/blink) lip-sync uchun qoldiriladi; kiyimning CORR_* (masalan
// CORR_Uniform_Volume_01…08) morphlari esa 'Salute' klipi boshqaradi — ular O'CHIRILMASLIGI shart,
// aks holda qo'l ko'tarilganda yelka/qo'ltiq deformatsiyasi (mesh cho'ziladi) buziladi.
// CORR_* qiymatlari manfiy bo'lishi mumkin — ularga clamp/normalizatsiya QO'LLANMAYDI.
import * as THREE from "three";

export const CORRECTIVE_RE = /^CORR_/;

export type MorphMesh = Pick<
  THREE.Mesh,
  "morphTargetDictionary" | "morphTargetInfluences" | "geometry"
>;

/** Shu nom saqlanishi kerakmi: lip-sync ro'yxatida yoki kiyim corrective morphi. */
export const shouldKeepMorph = (name: string, needed: readonly string[]) =>
  needed.includes(name) || CORRECTIVE_RE.test(name);

/**
 * Keraksiz morphlarni olib tashlaydi. Qoldirilganlar ASL indeks tartibida saqlanadi
 * (klipdagi weights qiymatlari shu tartibga mos), dictionary / attributes / influences
 * bir xil indekslarga qayta quriladi, joriy influence qiymatlari ko'chiriladi.
 * Qaytaradi: qoldirilgan nomlar (yangi indeks tartibida).
 */
export function stripMorphs(mesh: MorphMesh, needed: readonly string[]): string[] {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const dict = mesh.morphTargetDictionary;
  if (!dict || !geo) return [];
  if (geo.userData.__stripped) {
    return Object.keys(dict).sort((a, b) => dict[a] - dict[b]);
  }

  const kept = Object.keys(dict)
    .filter((n) => shouldKeepMorph(n, needed))
    .sort((a, b) => dict[a] - dict[b]);

  if (kept.length === 0) {
    geo.morphAttributes = {};
    mesh.morphTargetDictionary = {};
    mesh.morphTargetInfluences = [];
  } else {
    const oldIdx = kept.map((n) => dict[n]);
    const oldInfl = mesh.morphTargetInfluences ?? [];
    const newAttrs: Record<string, THREE.BufferAttribute[]> = {};
    for (const key in geo.morphAttributes) {
      newAttrs[key] = oldIdx
        .map((i) => geo.morphAttributes[key][i])
        .filter(Boolean) as THREE.BufferAttribute[];
    }
    geo.morphAttributes = newAttrs as any;
    const newDict: Record<string, number> = {};
    kept.forEach((n, j) => (newDict[n] = j));
    mesh.morphTargetDictionary = newDict;
    mesh.morphTargetInfluences = oldIdx.map((i) => oldInfl[i] ?? 0);
  }
  geo.userData.__stripped = true;
  return kept;
}

const MORPH_TRACK_RE = /^(.*)\.morphTargetInfluences$/;

/**
 * Klipning morph treklarini (kiyim CORR_* weights) SAQLAYDI — faqat ularning qiymatlari soni
 * mesh'dagi qolgan influence soniga mos kelmasa olib tashlaydi (indeks siljishi xavfi).
 * Suyak (position/quaternion/scale) treklariga tegmaydi.
 */
export function sanitizeClip(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip {
  const influenceCounts = new Map<string, number[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.morphTargetInfluences) {
      const arr = influenceCounts.get(m.name) ?? [];
      arr.push(m.morphTargetInfluences.length);
      influenceCounts.set(m.name, arr);
    }
  });

  const tracks = clip.tracks.filter((t) => {
    const match = MORPH_TRACK_RE.exec(t.name);
    if (!match) return true;
    const counts = influenceCounts.get(THREE.PropertyBinding.sanitizeNodeName(match[1]))
      ?? influenceCounts.get(match[1]);
    if (!counts) return false;
    const perKey = t.times.length ? t.values.length / t.times.length : 0;
    return counts.every((c) => c === perKey);
  });
  if (tracks.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

/** Lip-sync/reset faqat shu nomlarni boshqaradi — CORR_* hech qachon. */
export const isLipSyncMorph = (name: string, mouthAndBlink: readonly string[]) =>
  mouthAndBlink.includes(name) && !CORRECTIVE_RE.test(name);
