// 3D avatar — galogramma bojxona xodimi (ADR-002).
// GLB: public/avatar.web.glb (CC4 uniform model, 'Salute' animatsiya, viseme morph'lar;
//   scripts/optimize-avatar.mjs orqali teksturalar 1024/webp ga kichraytirilgan).
// Keraksiz morph'lar render'dan oldin JS'da olib tashlanadi (GPU xotira → context lost oldini oladi).
// Gapirganda (speaking=true) viseme morph'lar tebranadi → lip-sync. Ko'z pirpiraydi.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";

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
  const { actions, names } = useAnimations(animations, group);

  // GPU xotirani saqlash uchun keraksiz morph'larni render'dan OLDIN olib tashlaymiz
  // (400 morph → GPU morph-teksturasi xotirani portlatadi → WebGL context lost).
  // So'ng lip-sync uchun kerakli morph refs'ni yig'amiz.
  const morphs = useMemo(() => {
    const map: Record<string, MorphRef[]> = {};
    scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.geometry) return;
      const geo = m.geometry as THREE.BufferGeometry;

      if (!geo.userData.__stripped) {
        const dict = m.morphTargetDictionary;
        const keepNames = NEEDED.filter((n) => n in dict);
        const keepIdx = keepNames.map((n) => dict[n]);

        if (keepNames.length === 0) {
          geo.morphAttributes = {};
          m.morphTargetDictionary = {};
          m.morphTargetInfluences = [];
        } else {
          const newAttrs: Record<string, THREE.BufferAttribute[]> = {};
          for (const key in geo.morphAttributes) {
            newAttrs[key] = keepIdx
              .map((i) => geo.morphAttributes[key][i])
              .filter(Boolean) as THREE.BufferAttribute[];
          }
          geo.morphAttributes = newAttrs as any;
          const newDict: Record<string, number> = {};
          keepNames.forEach((n, j) => (newDict[n] = j));
          m.morphTargetDictionary = newDict;
          m.morphTargetInfluences = keepNames.map(() => 0);
        }
        geo.userData.__stripped = true;
      }

      for (const name of NEEDED) {
        const idx = m.morphTargetDictionary?.[name];
        if (idx !== undefined && m.morphTargetInfluences) {
          (map[name] ||= []).push({ infl: m.morphTargetInfluences as number[], idx });
        }
      }
    });
    return map;
  }, [scene]);

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

  // Salomlashuv: 'Salute' (harbiy salom) — mount'da va har suhbat boshlanganda (greetKey o'zgarsa)
  useEffect(() => {
    const clip = names.find((n) => /salute/i.test(n)) || names[0];
    if (clip && actions[clip]) {
      const a = actions[clip];
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.fadeIn(0.2).play();
    }
  }, [actions, names, greetKey]);

  const blink = useRef({ next: 2, t: 0, active: false });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // --- Lip-sync: real audio balandligiga qarab (levelRef 0..1) ---
    const level = levelRef.current || 0;
    smoothOpen.current = THREE.MathUtils.lerp(smoothOpen.current, level, delta * 18);
    const open = THREE.MathUtils.clamp(smoothOpen.current * 1.15, 0, 0.9);
    // og'iz "yopishib qolmasligi" uchun yengil tebranish
    const jitter = open > 0.04 ? 1 + 0.1 * Math.sin(t * 24) : 1;
    setMorph("V_Open", open * jitter);
    setMorph("V_Lip_Open", open * 0.45);
    setMorph("V_Wide", open * 0.22);
    setMorph("V_Tight_O", Math.max(0, 0.15 * Math.sin(t * 9) * open));

    // --- Ko'z pirpirash ---
    const b = blink.current;
    b.next -= delta;
    if (b.next <= 0 && !b.active) {
      b.active = true;
      b.t = 0;
    }
    if (b.active) {
      b.t += delta;
      const v = b.t < 0.07 ? b.t / 0.07 : b.t < 0.15 ? 1 - (b.t - 0.07) / 0.08 : 0;
      setMorph("Eye_Blink_L", v);
      setMorph("Eye_Blink_R", v);
      if (b.t >= 0.15) {
        b.active = false;
        b.next = 2.5 + Math.random() * 3;
      }
    }

    // --- Yengil nafas / tebranish ---
    if (group.current) {
      group.current.position.y = Math.sin(t * 1.4) * 0.006;
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
}
