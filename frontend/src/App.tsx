import { useRef, useState } from "react";
import { AvatarVideo } from "./AvatarVideo";
import { GREETING_SPEECH_START_S } from "./avatarClips";
import { newTurnInfo, startLive, type LiveHandle, type LiveState, type TurnInfo } from "./liveAudio";
import { micErrorMessage } from "./micError";

export default function App() {
  const [state, setState] = useState<LiveState | "idle">("idle");
  const [error, setError] = useState("");
  const [greetKey, setGreetKey] = useState(0);
  const [greetStart, setGreetStart] = useState(0); // birinchi (salom) audio keldi — salom videosi boshlanadi
  const turnRef = useRef<TurnInfo>(newTurnInfo()); // javob holati (AvatarVideo: jumlalar orasida og'iz yopilib ketmasin, ovoz tugashi oldindan ma'lum)
  const levelRef = useRef(0); // avatar ovozining balandligi — og'iz FAQAT ovoz bor paytda qimirlaydi (AvatarVideo)
  const handleRef = useRef<LiveHandle | null>(null);

  const active = state !== "idle" && state !== "stopped" && state !== "error";

  async function start() {
    setError("");
    setState("connecting");
    setGreetKey((k) => k + 1); // avatar salom videosini kutadi (birinchi ovozda ijro etiladi)
    try {
      handleRef.current = await startLive({
        onState: (s) => setState(s),
        onLevel: (v) => (levelRef.current = v),
        onGreetAudio: () => setGreetStart((k) => k + 1),
        greetDelayS: Math.max(0, GREETING_SPEECH_START_S - 0.05), // video ~50 ms keyin boshlanadi
        turnRef,
        onError: (msg) => {
          setError(msg);
          setState("error");
        },
      });
    } catch (e) {
      console.error("startLive:", e);
      setError(micErrorMessage(e));
      setState("error");
    }
  }

  function stop() {
    handleRef.current?.stop();
    handleRef.current = null;
    levelRef.current = 0;
    turnRef.current = newTurnInfo();
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
        <AvatarVideo active={active} levelRef={levelRef} greetKey={greetKey} greetStart={greetStart} turnRef={turnRef} />
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
        {/* Doim joyida (faqat ko'rinmaydi): paydo bo'lib-yo'qolsa tugmalar bloki balandligi o'zgarib, avatar o'lchami sakrab ketardi */}
        <div className="hint" style={{ visibility: !active && !error ? "visible" : "hidden" }} aria-hidden={active || !!error}>
          Tugmani bosing, mikrofonga ruxsat bering va bojxona bo'yicha savolingizni ayting.
        </div>
      </div>
    </div>
  );
}
