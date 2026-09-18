import { Suspense, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { Avatar } from "./Avatar";
import { startLive, type LiveHandle, type LiveState } from "./liveAudio";

export default function App() {
  const [state, setState] = useState<LiveState | "idle">("idle");
  const [error, setError] = useState("");
  const levelRef = useRef(0);
  const handleRef = useRef<LiveHandle | null>(null);

  const active = state !== "idle" && state !== "stopped" && state !== "error";

  async function start() {
    setError("");
    setState("connecting");
    try {
      handleRef.current = await startLive({
        onState: (s) => setState(s),
        onLevel: (v) => (levelRef.current = v),
        onError: (msg) => {
          setError(msg);
          setState("error");
        },
      });
    } catch (e: any) {
      setError(e?.message || "Mikrofon ochilmadi (ruxsat bering)");
      setState("error");
    }
  }

  function stop() {
    handleRef.current?.stop();
    handleRef.current = null;
    levelRef.current = 0;
    setState("idle");
  }

  const status =
    state === "connecting"
      ? "⏳ Ulanmoqda…"
      : state === "listening"
      ? "🎙️ Tinglayapman — gapiravering"
      : state === "speaking"
      ? "🗣️ Javob bermoqda…"
      : "";

  return (
    <div className="stage">
      <header className="topbar">
        <div className="brand">
          <span className="crest">⚖️</span>
          <div>
            <div className="brand-title">Bojxona virtual xodimi</div>
            <div className="brand-sub">Davlat bojxona qo'mitasi · jonli ovozli maslahat</div>
          </div>
        </div>
        {active && <div className="livedot">● JONLI</div>}
      </header>

      <div className="scene">
        <Canvas camera={{ position: [0, 1.5, 2.3], fov: 28 }} shadows gl={{ preserveDrawingBuffer: true }}>
          <color attach="background" args={["#05070d"]} />
          <hemisphereLight args={["#dfeaff", "#0a1020", 0.6]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 5, 4]} intensity={2.6} />
          <directionalLight position={[-4, 2, 1]} intensity={0.7} color="#bfe0ff" />
          <spotLight position={[0, 3.2, 3]} angle={0.6} penumbra={1} intensity={14} color="#eaf4ff" />
          <pointLight position={[0, 1.4, -2.5]} intensity={22} color="#39c6ff" />
          <Environment resolution={128} frames={1}>
            <Lightformer intensity={2.2} position={[0, 2, 3]} scale={[6, 6, 1]} />
            <Lightformer intensity={1.4} position={[-4, 1, 2]} scale={[3, 6, 1]} color="#bfe6ff" />
            <Lightformer intensity={1.4} position={[4, 1, 2]} scale={[3, 6, 1]} color="#ffffff" />
          </Environment>
          <Suspense
            fallback={
              <Html center>
                <div className="loader">Avatar yuklanmoqda…</div>
              </Html>
            }
          >
            <Avatar levelRef={levelRef} />
          </Suspense>
          <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={4} blur={2.6} far={2} color="#000000" />
          <OrbitControls
            target={[0, 1.38, 0]}
            enablePan={false}
            minDistance={1.2}
            maxDistance={4}
            minPolarAngle={Math.PI / 3}
            maxPolarAngle={Math.PI / 1.9}
          />
        </Canvas>
        {status && <div className="status">{status}</div>}
      </div>

      <div className="controls">
        {error && <div className="err">{error}</div>}
        {!active ? (
          <button className="talk" onClick={start}>
            <span className="talk-ic">🎙️</span>
            Suhbatni boshlash
          </button>
        ) : (
          <button className="talk stop" onClick={stop}>
            <span className="talk-ic">⏹</span>
            Tugatish
          </button>
        )}
        {!active && !error && (
          <div className="hint">Tugmani bosing, mikrofonga ruxsat bering va bojxona bo'yicha savolingizni ayting.</div>
        )}
      </div>
    </div>
  );
}
