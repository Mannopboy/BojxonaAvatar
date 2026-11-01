// 3D avatar — FAQAT videoga yozib olish uchun (ADR-002, ADR-006). Sayt uni yuklamaydi: tayyor videolarni o'ynaydi.
// GLB: recorder/avatar.web.glb (CC4 uniform model, 'Salute' animatsiya, viseme morph'lar;
//   scripts/optimize-avatar.mjs orqali teksturalar 1024/webp ga kichraytirilgan).
// Keraksiz morph'lar render'dan oldin JS'da olib tashlanadi (GPU xotira → context lost oldini oladi).
//
// Avvalgi jonli Avatar.tsx dan farqi: hammasi t (soniya) ning FUNKSIYASI — real vaqt, setTimeout va Math.random yo'q.
// Kadrni R3F `advance(t)` chaqiradi (frameloop="never"); og'iz/ko'z/salom `timeline.ts` dan keladi.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import modelUrl from "./avatar.web.glb?url";
import { sanitizeClip, stripMorphs } from "./morphs";
import { control } from "./control";
import { FPS, blinkValue, mouthLevel, saluteState } from "./timeline";

useGLTF.preload(modelUrl);

// Lip-sync uchun ishlatiladigan viseme morph nomlari (CC4)
const MOUTH = ["V_Open", "V_Wide", "V_Tight_O", "V_Explosive", "V_Lip_Open"];
const BLINK = ["Eye_Blink_L", "Eye_Blink_R"];
const NEEDED = [...MOUTH, ...BLINK];

type MorphRef = { infl: number[]; idx: number };

export function RecorderAvatar() {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(modelUrl);

  // GPU xotirani saqlash uchun keraksiz morph'larni render'dan OLDIN olib tashlaymiz
  // (400 morph → GPU morph-teksturasi xotirani portlatadi → WebGL context lost).
  const morphs = useMemo(() => {
    const map: Record<string, MorphRef[]> = {};
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.geometry) return;
      stripMorphs(m, NEEDED); // yuz morphlari + kiyim CORR_* (Salute klipi boshqaradi) saqlanadi
      for (const name of NEEDED) {
        const idx = m.morphTargetDictionary?.[name];
        if (idx !== undefined && m.morphTargetInfluences) {
          (map[name] ||= []).push({ infl: m.morphTargetInfluences as number[], idx });
        }
      }
    });
    return map;
  }, [scene]);

  // 'Salute' — o'z mixer'imiz, qo'lda boshqariladi (paused: vaqt va vazn har kadrda timeline'dan qo'yiladi).
  const salute = useMemo(() => {
    void morphs; // morph strip'dan KEYIN klip treklarini tekshiramiz
    const clip = animations.map((c) => sanitizeClip(c, scene)).find((c) => /salute/i.test(c.name));
    if (!clip) return null;
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = true;
    action.play();
    return { mixer, action, duration: clip.duration };
  }, [animations, scene, morphs]);

  const setMorph = (name: string, value: number) => {
    const refs = morphs[name];
    if (!refs) return;
    for (const r of refs) r.infl[r.idx] = value;
  };

  // Modelni normallashtirish — bo'y ~1.7, oyoq y=0, markazda (CC4 cm-scale muammosini hal qiladi)
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const s = size.y > 0.0001 ? 1.7 / size.y : 1;
    scene.scale.setScalar(s);
    scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    control.saluteDuration = salute?.duration ?? 0;
    control.ready = true;
    return () => {
      control.ready = false;
    };
  }, [scene, salute]);

  useFrame((state) => {
    const spec = control.spec;
    if (!spec) return;
    const t = state.clock.elapsedTime;

    // --- Salute: faqat greeting klipida; boshqalarda vazn 0 (suyak va kiyim morphlari bind holatiga qaytadi) ---
    if (salute) {
      if (spec.name === "greeting") {
        const s = saluteState(t, salute.duration);
        salute.action.time = s.time;
        salute.action.weight = s.weight;
      } else {
        salute.action.weight = 0;
      }
      salute.mixer.update(0); // vaqtni o'zimiz qo'ydik — faqat qo'llash
    }

    // --- Lip-sync: avvalgi formulalar, audio balandligi o'rniga timeline'dagi nutq ---
    control.smooth = THREE.MathUtils.lerp(control.smooth, mouthLevel(spec, t), (1 / FPS) * 22);
    const o = THREE.MathUtils.clamp(control.smooth * 1.7, 0, 1);
    const a = (Math.sin(t * 11) + 1) / 2;
    const c = (Math.sin(t * 15.7 + 1.3) + 1) / 2;
    setMorph("V_Open", o * (0.5 + 0.5 * a));
    setMorph("V_Lip_Open", o * 0.85);
    setMorph("V_Wide", o * 0.6 * c);
    setMorph("V_Tight_O", o * 0.55 * (1 - a));
    setMorph("V_Explosive", o * 0.25 * (1 - c));

    control.debug = {
      t,
      level: mouthLevel(spec, t),
      smooth: control.smooth,
      o,
      found: Object.fromEntries(Object.entries(morphs).map(([k, v]) => [k, v.length])),
      applied: { V_Open: morphs.V_Open?.[0]?.infl[morphs.V_Open[0].idx] },
    };

    // --- Ko'z pirpirash ---
    const blink = blinkValue(spec, t);
    setMorph("Eye_Blink_L", blink);
    setMorph("Eye_Blink_R", blink);

    // --- Yengil nafas + gapirganda ozgina tebranish ---
    // greeting'da nafas fazasi OXIRIDA 0 bo'ladi: u idle/speaking boshiga (faza 0) sakrashsiz ulanadi.
    const breath = spec.name === "greeting" ? t - spec.duration : t;
    if (group.current) {
      group.current.position.y = Math.sin(breath * 1.4) * 0.006;
      group.current.rotation.y = o * 0.03 * Math.sin(t * 2.3);
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}
