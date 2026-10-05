// 3D avatar — galogramma bojxona xodimi (ADR-002).
// GLB: public/avatar.web.glb (CC4 uniform model, 'Salute' animatsiya, viseme morph'lar;
//   scripts/optimize-avatar.mjs orqali teksturalar 1024/webp ga kichraytirilgan).
// Keraksiz morph'lar render'dan oldin JS'da olib tashlanadi (GPU xotira → context lost oldini oladi).
// Gapirganda (speaking=true) viseme morph'lar tebranadi → lip-sync. Ko'z pirpiraydi.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { sanitizeClip, stripMorphs } from "./morphs";

const MODEL_URL = "/avatar.web.glb";
useGLTF.preload(MODEL_URL);

// Lip-sync uchun ishlatiladigan viseme morph nomlari (CC4)
const MOUTH = ["V_Open", "V_Wide", "V_Tight_O", "V_Explosive", "V_Lip_Open"];
const BLINK = ["Eye_Blink_L", "Eye_Blink_R"];
const NEEDED = [...MOUTH, ...BLINK];

type MorphRef = { infl: number[]; idx: number };

export function Avatar({
  levelRef,
  greetKey,
}: {
  levelRef: MutableRefObject<number>;
  greetKey: number;
}) {
  const group = useRef<THREE.Group>(null);
  const smoothOpen = useRef(0);
  const { scene, animations } = useGLTF(MODEL_URL);

  // GPU xotirani saqlash uchun keraksiz morph'larni render'dan OLDIN olib tashlaymiz
  // (400 morph → GPU morph-teksturasi xotirani portlatadi → WebGL context lost).
  // So'ng lip-sync uchun kerakli morph refs'ni yig'amiz.
  const morphs = useMemo(() => {
    const map: Record<string, MorphRef[]> = {};
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.geometry) return;

      // Yuz morphlari (NEEDED) + kiyim CORR_* saqlanadi (Salute klipi boshqaradi)
      stripMorphs(m, NEEDED);

      for (const name of NEEDED) {
        const idx = m.morphTargetDictionary?.[name];
        if (idx !== undefined && m.morphTargetInfluences) {
          (map[name] ||= []).push({ infl: m.morphTargetInfluences as number[], idx });
        }
      }
    });
    return map;
  }, [scene]);

  // Morph strip'dan KEYIN klip treklarini tekshiramiz (kiyim CORR_* treklari saqlanadi)
  const clips = useMemo(
    () => (void morphs, animations.map((c) => sanitizeClip(c, scene))),
    [animations, scene, morphs],
  );
  const { actions, names } = useAnimations(clips, group);

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
    const target = 1.7;
    const s = size.y > 0.0001 ? target / size.y : 1;
    scene.scale.setScalar(s);
    scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  }, [scene]);

  // 'Salute': suyak treklari + kiyim CORR_Uniform_Volume_* morph weights bir mixer'da, bir vaqtda.
  // Klip morph treklari saqlanadi (sanitizeClip faqat indeks mos kelmaganini tashlaydi).
  // Boshlanishi: fadeIn → ushlab turish (HOLD) → fadeOut → stop() (bone + morph bind holatiga qaytadi).
  const SALUTE_HOLD = 1.5; // soniya, qo'l ko'tarilgan holatda ushlab turish
  const SALUTE_FADE = 0.5;
  const saluteName = useMemo(() => names.find((n) => /salute/i.test(n)), [names]);
  const saluteClip = useMemo(() => clips.find((a) => a.name === saluteName), [clips, saluteName]);

  useEffect(() => {
    if (!saluteName || !actions[saluteName] || !saluteClip) return;
    const action = actions[saluteName]!;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; // qo'l tugagach ham ko'tarilgan holatda turadi (HOLD)
    action.fadeIn(0.2).play();
    const mixer = action.getMixer();
    let hold: ReturnType<typeof setTimeout> | undefined;
    const onFinished = (e: any) => {
      if (e.action !== action) return;
      hold = setTimeout(() => action.fadeOut(SALUTE_FADE), SALUTE_HOLD * 1000);
    };
    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
      if (hold) clearTimeout(hold);
      action.stop(); // qayta boshlanganda / unmount'da bone + morph tiklanadi
    };
  }, [actions, saluteName, saluteClip, greetKey]);

  if (import.meta.env.DEV) (window as any).__avatarDebug = { scene, actions, morphs, saluteClip };

  const blink = useRef({ next: 2, t: 0, active: false });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // --- Lip-sync: real audio balandligiga qarab, viseme almashinuvi bilan (tabiiy nutq) ---
    const level = levelRef.current || 0;
    smoothOpen.current = THREE.MathUtils.lerp(smoothOpen.current, level, delta * 22);
    const o = THREE.MathUtils.clamp(smoothOpen.current * 1.7, 0, 1); // kuchaytirilgan ochilish
    // vaqt bo'yicha almashinuvchi og'iz shakllari (unli/undosh taqlidi) → jag' + lab birga qimirlaydi
    const a = (Math.sin(t * 11) + 1) / 2; // 0..1
    const c = (Math.sin(t * 15.7 + 1.3) + 1) / 2; // 0..1
    setMorph("V_Open", o * (0.5 + 0.5 * a)); // og'iz/jag' ochilishi
    setMorph("V_Lip_Open", o * 0.85); // LAB ochilishi (kuchli)
    setMorph("V_Wide", o * 0.6 * c); // "ee" — lab keng
    setMorph("V_Tight_O", o * 0.55 * (1 - a)); // "oo" — lab dumaloq
    setMorph("V_Explosive", o * 0.25 * (1 - c)); // yopiq undosh (p/b/m)

    // --- Ko'z pirpirash (tabiiy: to'liq yumilib-ochilish) ---
    const b = blink.current;
    b.next -= delta;
    if (b.next <= 0 && !b.active) {
      b.active = true;
      b.t = 0;
    }
    if (b.active) {
      b.t += delta;
      // 0→1→0, ~0.18s (yumilish tez, ochilish biroz sekin)
      const v = b.t < 0.08 ? b.t / 0.08 : b.t < 0.18 ? 1 - (b.t - 0.08) / 0.1 : 0;
      setMorph("Eye_Blink_L", v);
      setMorph("Eye_Blink_R", v);
      if (b.t >= 0.18) {
        b.active = false;
        b.next = 2 + Math.random() * 3; // har 2-5 soniyada
      }
    }

    // --- Yengil nafas + gapirganda ozgina tebranish (jonli ko'rinish) ---
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.4) * 0.006;
      group.current.rotation.y = o * 0.03 * Math.sin(t * 2.3);
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}
