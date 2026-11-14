import { useEffect, useRef, useState } from "react";
import { AvatarVideo } from "./AvatarVideo";
import { GREETING_SPEECH_START_S, assetUrl } from "./avatarClips";
import { newTurnInfo, startLive, type LiveHandle, type LiveState, type TurnInfo } from "./liveAudio";
import { micErrorMessage } from "./micError";
import { startWakeListener, type WakeHandle } from "./wakeListener";
import { ControlsPanel } from "./ControlsPanel";
import { createIdleTimer } from "./idleTimer";
import { getView, subscribe } from "./avatarViewStore";

export default function App() {
  const [state, setState] = useState<LiveState | "idle">("idle");
  const [error, setError] = useState("");
  const [greetKey, setGreetKey] = useState(0);
  const [greetStart, setGreetStart] = useState(0); // birinchi (salom) audio keldi — salom videosi boshlanadi
  const [answer, setAnswer] = useState<{ id: string; key: number } | null>(null); // backend tanlagan tayyor javob klipi
  const turnRef = useRef<TurnInfo>(newTurnInfo()); // javob holati (AvatarVideo: jumlalar orasida og'iz yopilib ketmasin, ovoz tugashi oldindan ma'lum)
  const levelRef = useRef(0); // avatar ovozining balandligi — og'iz FAQAT ovoz bor paytda qimirlaydi (AvatarVideo)
  const handleRef = useRef<LiveHandle | null>(null);
  // KUTISH REJIMI: suhbat boshlanmagan paytda mikrofon mahalliy tinglanadi; yo'lovchi salomlashsa (yoki savol bersa) avatar suhbatni o'zi boshlaydi (tugma shart emas)
  const [standby, setStandby] = useState(false);
  const [standbyBlocked, setStandbyBlocked] = useState(false); // brauzer ovozni yoqmagan: sahifani bir marta bosish kerak (kioskda autoplay flag bilan bo'lmaydi)
  const standbyRef = useRef<WakeHandle | null>(null);
  const standbyGen = useRef(0);
  const idleRef = useRef(createIdleTimer()); // suhbatni tugatish taymeri (jimlik): operator sozlamasi `[` `]` — avatarViewStore.endSec

  const active = state !== "idle" && state !== "stopped" && state !== "error";

  async function startStandby() {
    if (standbyRef.current) return;
    if (new URLSearchParams(location.search).get("manual") === "1") return; // ?manual=1 — kutish rejimi o'chiq, faqat tugma
    try {
      const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (perm?.state === "denied") return; // ruxsat berilmagan: tugma xatoni ko'rsatadi
    } catch {
      /* permissions API yo'q — to'g'ridan-to'g'ri urinib ko'ramiz */
    }
    const gen = ++standbyGen.current;
    try {
      const h = await startWakeListener({
        onSpeech: (pcm) => {
          stopStandby();
          void start(pcm); // birinchi gap backendga: salom bo'lsa suhbat boshlanadi
        },
        onSuspendedChange: setStandbyBlocked,
      });
      if (gen !== standbyGen.current) {
        h.stop(); // kutish davomida to'xtatilgan (tugma bosildi / komponent yopildi)
        return;
      }
      standbyRef.current = h;
      setStandby(true);
    } catch (e) {
      console.warn("standby:", e); // mikrofon yo'q / ruxsat berilmadi — tugma bilan boshlanadi
      setStandby(false);
    }
  }

  function stopStandby() {
    standbyGen.current++;
    standbyRef.current?.stop();
    standbyRef.current = null;
    setStandby(false);
    setStandbyBlocked(false);
  }

  useEffect(() => {
    void startStandby();
    return stopStandby;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suhbatni tugatish taymeri: hech kim gapirmagan vaqt endSec ga yetsa — mikrofon yopiladi, javob (bo'lsa) oxirigacha aytiladi, so'ng stop() va salom kutish rejimi.
  // Avatar gapirayotganda yoki javob yo'lda bo'lsa jimlik sanalmaydi; yo'lovchi gapirsa yoki sozlama o'zgarsa sanoq qayta boshlanadi (endSec = 0 — o'chiq).
  useEffect(() => {
    if (!active) return;
    const timer = idleRef.current;
    timer.start(performance.now());
    const unsub = subscribe(() => timer.touch(performance.now()));
    const id = window.setInterval(() => {
      const h = handleRef.current;
      if (!h) return;
      const step = timer.step(performance.now(), getView().endSec, h.isBusy());
      if (step === "finish") h.muteMic();
      else if (step === "stop") stop();
    }, 500);
    return () => {
      window.clearInterval(id);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function start(wakePcm?: Int16Array) {
    stopStandby();
    setError("");
    setState("connecting");
    if (!wakePcm) setGreetKey((k) => k + 1); // tugma: avatar salom videosini kutadi (birinchi ovozda ijro etiladi); wake: salom videosi faqat backend salom bergach (onGreeting)
    try {
      handleRef.current = await startLive({
        wake: wakePcm,
        onGreeting: () => setGreetKey((k) => k + 1),
        onWakeIgnored: () => stop(), // shovqin edi — suhbat boshlanmaydi, kutishga qaytamiz
        onState: (s) => setState(s),
        onLevel: (v) => (levelRef.current = v),
        onGreetAudio: () => setGreetStart((k) => k + 1),
        greetDelayS: Math.max(0, GREETING_SPEECH_START_S - 0.05), // video ~50 ms keyin boshlanadi
        turnRef,
        onUserSpeech: () => idleRef.current.touch(performance.now()),
        onClip: (id) => setAnswer((a) => ({ id, key: (a?.key ?? 0) + 1 })),
        onClips: (ids) => {
          // tayyor javob kliplari oldindan keshga olinadi (savolda darhol boshlansin)
          for (const id of ids) void fetch(assetUrl(`answers/${id}.mp4`), { cache: "force-cache" }).catch(() => {});
        },
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
    setAnswer(null);
    setState("idle");
    void startStandby(); // suhbat tugadi — yana salom kutamiz
  }

  const status =
    state === "connecting"
      ? "⏳ Ulanmoqda…"
      : state === "listening"
      ? "🎙️ Tinglayapman — gapiravering"
      : state === "speaking"
      ? "🗣️ Javob bermoqda…"
      : standby && !active
      ? standbyBlocked
        ? "👆 Sahifani bir marta bosing, keyin «Assalomu alaykum» deng"
        : "🎙️ «Assalomu alaykum» deng — suhbat boshlanadi"
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
        <AvatarVideo active={active} levelRef={levelRef} greetKey={greetKey} greetStart={greetStart} turnRef={turnRef} answer={answer} onAnswerEnd={() => handleRef.current?.clipEnded()} />
        {status && <div className="status">{status}</div>}
        <ControlsPanel />
      </div>

      <div className="controls">
        {error && <div className="err">{error}</div>}
        {!active ? (
          <button className="talk" onClick={() => void start()}>
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
          {standby
            ? "Mikrofonga «Assalomu alaykum» (yoki «Здравствуйте») deng — suhbat o'zi boshlanadi. Yoki tugmani bosing."
            : "Tugmani bosing, mikrofonga ruxsat bering va bojxona bo'yicha savolingizni ayting."}
        </div>
      </div>
    </div>
  );
}
