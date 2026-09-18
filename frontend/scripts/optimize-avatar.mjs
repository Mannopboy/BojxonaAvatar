// Avatar GLB'ni web/kiosk uchun optimallashtirish.
// Teksturalarni kichraytiradi (1024, webp) + (ixtiyoriy) morph'larni kamaytiradi.
//
// Ishlatish (loyihada shu ishlatiladi — morph'lar JS'da strip qilinadi, Avatar.tsx):
//   KEEP_MORPHS=1 node scripts/optimize-avatar.mjs ../model-src/avatar-original.glb public/avatar.web.glb
//
// KEEP_MORPHS=1 => morph'lar saqlanadi (three yuklaydi; keraksizlari brauzerda olib tashlanadi).
//   ⚠️ Morph'larni bu skript o'chirsa (KEEP_MORPHS yo'q), gltf-transform bo'sh `targets: []`
//   yozib three.js'ni buzadi — shuning uchun morph strip Avatar.tsx (JS) tomonida qilinadi.
import { NodeIO } from "@gltf-transform/core";
import { prune, dedup, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const IN = process.argv[2] || "../model-src/avatar-original.glb";
const OUT = process.argv[3] || "public/avatar.web.glb";

// Lip-sync + mimika uchun saqlanadigan morph nomlari (CC4 viseme + blink + smile)
const KEEP = new Set([
  "V_Open", "V_Wide", "V_Tight_O", "V_Tight", "V_Explosive",
  "V_Dental_Lip", "V_Lip_Open", "V_Affricate",
  "Eye_Blink_L", "Eye_Blink_R",
  "Mouth_Smile_L", "Mouth_Smile_R",
]);

const io = new NodeIO();
console.log("O'qilyapti:", IN);
const doc = await io.read(IN);

let removed = 0, kept = 0;
const KEEP_MORPHS = process.env.KEEP_MORPHS === "1"; // 1 => morph'lar saqlanadi (JS'da strip qilinadi)
for (const mesh of (KEEP_MORPHS ? [] : doc.getRoot().listMeshes())) {
  const prims = mesh.listPrimitives();
  const counts = prims.map((p) => p.listTargets().length);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  if (maxCount === 0) continue;

  const extras = mesh.getExtras() || {};
  const names = extras.targetNames;
  // Nomlar target soniga TO'LIQ mos kelsagina nom bo'yicha tanlaymiz.
  // Aks holda — bu mesh morph'larini butunlay olib tashlaymiz (xavfsiz, buzilmaydi).
  const aligned =
    Array.isArray(names) &&
    names.length === maxCount &&
    counts.every((c) => c === maxCount);

  let keepIdx = [];
  if (aligned) {
    names.forEach((n, i) => {
      if (KEEP.has(n)) keepIdx.push(i);
    });
  }

  for (const prim of prims) {
    const targets = prim.listTargets();
    targets.forEach((t, i) => {
      if (keepIdx.includes(i)) kept++;
      else {
        prim.removeTarget(t);
        removed++;
      }
    });
  }

  const newNames = keepIdx.map((i) => names[i]);
  mesh.setExtras({ ...extras, targetNames: newNames });
  const w = mesh.getWeights?.() || [];
  mesh.setWeights(keepIdx.map((i) => w[i] ?? 0));
}
console.log(`Morph targetlar — saqlandi: ${kept}, o'chirildi: ${removed}`);

// Teksturalarni kichraytirish + tozalash
console.log("Teksturalar kichraytirilyapti (max 1024, webp)...");
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
  prune(),
  dedup()
);

// --- VALIDATSIYA: har mesh'da primitive target soni === targetNames uzunligi ---
let bad = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  const counts = mesh.listPrimitives().map((p) => p.listTargets().length);
  const nlen = ((mesh.getExtras() || {}).targetNames || []).length;
  const ok = counts.every((c) => c === (counts[0] || 0)) && (counts[0] || 0) === nlen;
  if (!ok) {
    bad++;
    console.log("  ⚠️ MISMATCH:", mesh.getName(), "targetCounts", counts, "names", nlen);
  }
}
console.log(bad === 0 ? "Validatsiya: OK (barcha mesh mos)" : `Validatsiya: ${bad} ta muammo!`);

await io.write(OUT, doc);
console.log("Yozildi:", OUT);
