import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { Avatar } from "./Avatar";
import { ask, getFaq, type AskResponse, type FaqItem } from "./api";
import { speak, stopSpeaking, warmupVoices } from "./tts";

type Lang = "uz" | "ru";

// Web Speech Recognition (brauzer)
const SR: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export default function App() {
  const [lang, setLang] = useState<Lang>("uz");
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recogRef = useRef<any>(null);
  const sessionId = useRef<string>(
    "kiosk-" + Math.random().toString(36).slice(2, 10)
  );

  useEffect(() => {
    warmupVoices();
    getFaq().then(setFaq).catch(() => setError("Backend ulanmadi (8000-port)."));
  }, []);

  async function handleAsk(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    stopSpeaking();
    setError("");
    setQuestion(text);
    setAnswer(null);
    setLoading(true);
    try {
      const res = await ask(text, lang, sessionId.current);
      setAnswer(res);
      setLoading(false);
      speak(
        res.answer,
        res.lang || lang,
        () => setSpeaking(true),
        () => setSpeaking(false)
      );
    } catch (e: any) {
      setLoading(false);
      setError(e?.message || "Xatolik");
    }
  }

  function toggleMic() {
    if (!SR) {
      setError("Bu brauzer ovozli kiritishni qo'llab-quvvatlamaydi.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = lang === "ru" ? "ru-RU" : "uz-UZ";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (ev: any) => {
      const t = ev.results[0][0].transcript;
      setListening(false);
      handleAsk(t);
    };
    r.onerror = () => {
      setListening(false);
      setError("Ovozli kiritishda xatolik.");
    };
    r.onend = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    r.start();
  }

  const status = listening
    ? "🎙️ Tinglayapman..."
    : loading
    ? "⏳ Javob tayyorlanmoqda..."
    : speaking
    ? "🗣️ Javob bermoqda..."
    : "";

  return (
    <div className="stage">
      {/* Sarlavha */}
      <header className="topbar">
        <div className="brand">
          <span className="crest">⚖️</span>
          <div>
            <div className="brand-title">Bojxona virtual xodimi</div>
            <div className="brand-sub">Davlat bojxona qo'mitasi · ma'lumot xizmati</div>
          </div>
        </div>
        <div className="lang">
          <button className={lang === "uz" ? "on" : ""} onClick={() => setLang("uz")}>
            O'zbekcha
          </button>
          <button className={lang === "ru" ? "on" : ""} onClick={() => setLang("ru")}>
            Русский
          </button>
        </div>
      </header>

      {/* 3D avatar sahnasi */}
      <div className="scene">
        <Canvas
          camera={{ position: [0, 1.5, 2.3], fov: 28 }}
          shadows
          gl={{ preserveDrawingBuffer: true }}
        >
          <color attach="background" args={["#05070d"]} />
          <hemisphereLight args={["#dfeaff", "#0a1020", 0.6]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 5, 4]} intensity={2.6} />
          <directionalLight position={[-4, 2, 1]} intensity={0.7} color="#bfe0ff" />
          <spotLight position={[0, 3.2, 3]} angle={0.6} penumbra={1} intensity={14} color="#eaf4ff" />
          {/* orqadan siyan rim — galogramma effekti */}
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
            <Avatar speaking={speaking} />
          </Suspense>
          <ContactShadows
            position={[0, 0.01, 0]}
            opacity={0.55}
            scale={4}
            blur={2.6}
            far={2}
            color="#000000"
          />
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

      {/* Suhbat paneli */}
      <div className="panel">
        {error && <div className="err">{error}</div>}

        {answer && (
          <div className={`bubble ${answer.source_type}`}>
            {question && <div className="you">— {question}</div>}
            <div className="ans">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="sources">
                Manba:{" "}
                {answer.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url}
                  </a>
                ))}
              </div>
            )}
            {answer.disclaimer && <div className="disc">{answer.disclaimer}</div>}
            <span className={`tag tag-${answer.source_type}`}>
              {answer.source_type === "faq"
                ? "Rasmiy FAQ"
                : answer.source_type === "web"
                ? answer.grounded
                  ? "Rasmiy web (grounding)"
                  : "Manba topilmadi"
                : "Yo'naltirish"}
            </span>
          </div>
        )}

        {!answer && !loading && (
          <div className="hint">
            Savolingizni yozing yoki mikrofonni bosing. Quyidagi tez-tez so'raladigan
            savollardan ham tanlashingiz mumkin.
          </div>
        )}

        {/* 3 asosiy savol tugmalari */}
        <div className="faq">
          {faq.map((f) => (
            <button key={f.id} className="chip" onClick={() => handleAsk(f.question)}>
              {f.question}
            </button>
          ))}
        </div>

        {/* Kiritish */}
        <div className="input">
          <input
            value={question}
            placeholder="Bojxona bo'yicha savolingiz…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk(question)}
          />
          <button className={`mic ${listening ? "rec" : ""}`} onClick={toggleMic} title="Ovozli">
            🎙️
          </button>
          <button className="send" onClick={() => handleAsk(question)} disabled={loading}>
            So'rash
          </button>
        </div>
      </div>
    </div>
  );
}
