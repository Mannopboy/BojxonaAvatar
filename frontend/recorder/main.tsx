// Yozib olish sahifasi: /recorder/index.html — `npm run record:avatar` shuni Chrome'da ochib, klip-klip video yozadi.
// Qo'lda ham sinab ko'rish mumkin: konsolda `await recorder.preview("greeting", [0, 1, 3])`.
import { Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { RecorderAvatar } from "./Avatar";
import { control } from "./control";
import { encode, pickCodec, type VideoFormat } from "./encode";
import { CLIP_NAMES, FPS, buildSpec, type ClipName } from "./timeline";

// Video o'lchami: 1:1. Avvalgi sahna (kamera fov 28, bo'yi ~1.15 m ko'rinadi) bilan bir xil kadr;
// Salute paytida tirsak markazdan ~0.46 m chetga chiqadi — 3:4 kadrda kesilib qolardi, 1:1 da sig'adi.
// Boshqa o'lcham kerak bo'lsa — `?w=…&h=…` (juft son).
const params = new URLSearchParams(location.search);
const W = Number(params.get("w")) || 1440;
const H = Number(params.get("h")) || 1440;

function Scene() {
  const advance = useThree((s) => s.advance);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    camera.lookAt(0, 1.38, 0); // avvalgi OrbitControls target'i
    control.advance = advance;
    control.canvas = gl.domElement;
  }, [advance, gl, camera]);

  // Yoritish va muhit — avvalgi App.tsx dagi sahna bilan bir xil
  return (
    <>
      <color attach="background" args={["#05070d"]} />
      <hemisphereLight args={["#dfeaff", "#0a1020", 0.6]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 4]} intensity={2.6} />
      <directionalLight position={[-4, 2, 1]} intensity={0.7} color="#bfe0ff" />
      <spotLight position={[0, 3.2, 3]} angle={0.6} penumbra={1} intensity={14} color="#eaf4ff" />
      <pointLight position={[0, 1.7, -2.2]} intensity={9} color="#dfebff" />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.2} position={[0, 2, 3]} scale={[6, 6, 1]} />
        <Lightformer intensity={1.3} position={[-4, 1, 2]} scale={[3, 6, 1]} color="#eef4ff" />
        <Lightformer intensity={1.3} position={[4, 1, 2]} scale={[3, 6, 1]} color="#ffffff" />
      </Environment>
      <Suspense fallback={null}>
        <RecorderAvatar />
      </Suspense>
      <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={4} blur={2.6} far={2} color="#000000" />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <div style={{ width: W, height: H }}>
    <Canvas frameloop="never" dpr={1} gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ position: [0, 1.5, 2.3], fov: 28 }}>
      <Scene />
    </Canvas>
  </div>,
);

// ---- Node skripti (puppeteer) chaqiradigan API ----

/**
 * Klipni boshlang'ich holatga keltiradi: 3 ta qizdirish kadri (muhit xaritasi, soyalar).
 * Loop klipda butun davr oldindan chiziladi: og'iz yumshatish holati davr OXIRIDAGIga teng bo'lib, yoziladigan
 * birinchi kadr takrorlanganda oxirgi kadrga uzluksiz ulanadi.
 */
function prepare(name: ClipName) {
  const spec = buildSpec(name, control.saluteDuration);
  control.spec = spec;
  for (let k = 0; k < 3; k++) control.advance!(0);
  control.smooth = 0;
  if (spec.loop) for (let i = 0; i < spec.frames; i++) control.advance!(i / FPS);
  return spec;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const api = {
  size: { width: W, height: H, fps: FPS },

  isReady: () => control.ready && control.advance !== null && control.canvas !== null,

  info: () => ({
    saluteDuration: control.saluteDuration,
    clips: Object.fromEntries(
      CLIP_NAMES.map((n) => {
        const s = buildSpec(n, control.saluteDuration);
        return [n, { duration: s.duration, frames: s.frames, loop: s.loop }];
      }),
    ),
  }),

  /** Klipni videoga yozadi, base64 qaytaradi. */
  async record(name: ClipName, format: VideoFormat, bitrate: number): Promise<string> {
    const spec = prepare(name);
    const bytes = await encode({
      canvas: control.canvas!,
      width: W,
      height: H,
      fps: FPS,
      frames: spec.frames,
      bitrate,
      format,
      renderFrame: (i) => control.advance!(i / FPS),
    });
    return toBase64(bytes);
  },

  /** Belgilangan vaqtlardagi kadrlarni PNG (base64) qilib qaytaradi — ko'zdan kechirish uchun. */
  preview(name: ClipName, times: number[]): string[] {
    const spec = prepare(name);
    const want = new Map(times.map((t) => [Math.min(spec.frames - 1, Math.round(t * FPS)), t]));
    const last = Math.max(...want.keys());
    const out: string[] = [];
    for (let i = 0; i <= last; i++) {
      control.advance!(i / FPS);
      if (want.has(i)) out.push(control.canvas!.toDataURL("image/png").split(",")[1]);
    }
    return out;
  },

  /** Diagnostika: klipni t gacha chizib, oxirgi kadr qiymatlarini qaytaradi. */
  debug(name: ClipName, t: number) {
    const spec = prepare(name);
    const last = Math.round(t * FPS);
    for (let i = 0; i <= last; i++) control.advance!(i / FPS);
    return control.debug;
  },

  /** Qaysi codec'lar ishlashi (diagnostika). */
  async codecs() {
    const res: Record<string, string> = {};
    for (const f of ["mp4", "webm"] as const) {
      try {
        res[f] = await pickCodec({ width: W, height: H, fps: FPS, bitrate: 5e6, format: f });
      } catch (e) {
        res[f] = `YO'Q: ${(e as Error).message}`;
      }
    }
    return res;
  },
};

declare global {
  interface Window {
    recorder: typeof api;
  }
}
window.recorder = api;
