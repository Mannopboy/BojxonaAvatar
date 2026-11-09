// Avatar — oldindan tayyorlangan videolar (haqiqiy xodim rasmidan AI yaratgan, `npm run process:avatar` saytga tayyorlaydi).
//
//   idle     — og'iz yopiq (tinglayotgan avatar yoki gapirish pauzasi), uzluksiz takrorlanadi
//   speaking — og'iz harakatda, uzluksiz takrorlanadi
//   greeting — salom (qo'l bilan Salute, og'zi harakatda), bir marta
//
// OG'IZ FAQAT OVOZ BOR PAYTDA QIMIRLAYDI: pleyerning HAQIQIY ovoz balandligi (liveAudio level, analyser) o'qiladi.
// Ovoz bor → speaking, ovoz VOICE_HOLD_MS dan ko'p jim → idle. Shu tariqa so'zlar/jumlalar orasidagi pauzalarda va
// javob tugagach og'iz yopiladi (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
//
// idle va speaking DOIM BIRGA yurib turadi (salom paytida ham) — almashtirish xira-o'tish (crossfade) bilan, seek va qayta
// ishga tushirishsiz (to'xtatilgan klipni qayta boshlash ~100 ms qotish bergan). Kliplar orasida tana, furajka va soch
// piksel-piksel bir xil (asl kadr), farq faqat yuzda (build-avatar-clips.py), shuning uchun fazalari ahamiyatsiz.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

type Phase = "idle" | "speaking" | "greeting";
const CLIPS: readonly Phase[] = ["idle", "speaking", "greeting"];

const FADE_MS = 120; // styles.css dagi .avatar-layer.on bilan bir xil
const FADE_SAFETY_MS = 400; // transitionend kelmasa, eski qatlam shuncha qo'shimcha kutilib olib tashlanadi
const VOICE_ON = 0.04; // ovoz balandligi (0..1) shundan oshsa — ovoz bor (haqiqiy Gemini nutqida pauzada ~0.01 dan past)
const VOICE_HOLD_MS = 250; // shuncha jim bo'lsa og'iz yopiladi: so'zlar orasidagi qisqa tushishda speaking↔idle miltillamasin
// Salom normal holatda birinchi ovozda boshlanadi. Haqiqiy Gemini Live'da birinchi audio tugmadan 4–8 s keyin keladi
// (ulanish ~2 s + model 2–6 s, o'lchangan), shuning uchun zaxira undan ancha keyin — faqat ovoz umuman kelmay qolsa ishlaydi.
const GREET_FALLBACK_MS = 15_000;

interface Props {
  /** suhbat ketyapti (ulanmoqda / tinglayapti / gapiryapti) */
  active: boolean;
  /** pleyerda ijro etilayotgan avatar ovozining balandligi 0..1 (liveAudio dan) */
  levelRef: MutableRefObject<number>;
  /** har ortishida yangi suhbat boshlanadi va salom kutiladi */
  greetKey: number;
}

const play = (v: HTMLVideoElement | null) => {
  v?.play().catch(() => {
    /* avtoplay bloklangan bo'lsa — keyingi harakatda ishga tushadi */
  });
};
const park = (v: HTMLVideoElement | null) => {
  if (!v) return;
  v.pause();
  try {
    v.currentTime = 0;
  } catch {
    /* metadata hali yuklanmagan */
  }
};

export function AvatarVideo({ active, levelRef, greetKey }: Props) {
  const videos = useRef<Record<Phase, HTMLVideoElement | null>>({ idle: null, speaking: null, greeting: null });
  const phaseRef = useRef<Phase>("idle");
  const voiceRef = useRef(false);
  const pendingGreet = useRef(false);
  const timers = useRef<{ fade?: number; greet?: number }>({});
  const [view, setView] = useState<{ phase: Phase; prev: Phase | null }>({ phase: "idle", prev: null });

  /** Xira-o'tish tugagach: eski qatlam olib tashlanadi, ishlatilmayotgan salom boshiga qaytarilib to'xtatiladi. */
  const finishFade = useCallback(() => {
    window.clearTimeout(timers.current.fade);
    setView((s) => (s.prev ? { ...s, prev: null } : s));
    // idle va speaking HECH QACHON to'xtatilmaydi: to'xtatilgan klipni qayta ishga tushirish ~100 ms qotish bergan (o'lchangan).
    // Tana hamma kliplarda bir xil rasm bo'lgani uchun ularning fazasi (qaysi kadrda ekani) ahamiyatsiz.
    if (phaseRef.current !== "greeting") park(videos.current.greeting);
  }, []);

  /** Qatlamni almashtiradi: yangisi ustida xira-o'tish bilan paydo bo'ladi, eskisi xira-o'tish tugaguncha ko'rinib turadi. */
  const go = useCallback((next: Phase) => {
    const from = phaseRef.current;
    if (from === next) return;
    phaseRef.current = next;
    const v = videos.current;
    if (next === "greeting") {
      if (v.greeting) v.greeting.currentTime = 0;
      play(v.greeting);
    } else {
      // ikkala loop doim yuradi (brauzer avtoplayni bloklagan bo'lsa — shu yerda ishga tushadi)
      play(v.idle);
      play(v.speaking);
    }
    setView({ phase: next, prev: from });

    // Eski qatlam xira-o'tish HAQIQATAN tugagach (onTransitionEnd) olib tashlanadi. Qat'iy taymer bosh oqimi band bo'lganda
    // (mikrofon, audio, React) xira-o'tish boshlanmasdan ishlab, orqadagi qatlamni yo'qotardi — rasm bir lahza qorayardi.
    // Taymer — faqat transitionend kelmaydigan holat uchun zaxira (opacity o'zgarmagan: masalan, prev → on).
    window.clearTimeout(timers.current.fade);
    timers.current.fade = window.setTimeout(finishFade, FADE_MS + FADE_SAFETY_MS);
  }, [finishFade]);

  const startGreeting = useCallback(() => {
    pendingGreet.current = false;
    window.clearTimeout(timers.current.greet);
    go("greeting");
  }, [go]);

  const afterGreeting = useCallback(() => {
    if (phaseRef.current === "greeting") go(voiceRef.current ? "speaking" : "idle");
  }, [go]);

  // Ovoz balandligini kuzatish: ovoz bor/yo'q o'zgarganda videoni almashtiradi.
  useEffect(() => {
    let raf = 0;
    let lastVoice = -1e9;
    const tick = () => {
      const now = performance.now();
      if (levelRef.current > VOICE_ON) lastVoice = now;
      const voice = now - lastVoice < VOICE_HOLD_MS;
      if (voice !== voiceRef.current) {
        voiceRef.current = voice;
        if (voice && pendingGreet.current) startGreeting(); // salom kutilayotgan bo'lsa — birinchi ovozda boshlanadi
        else if (phaseRef.current !== "greeting") go(voice ? "speaking" : "idle"); // salom paytida og'iz videoning o'zida
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, go, startGreeting]);

  // Yangi suhbat: salom kutiladi (ovoz kelmasa ham GREET_FALLBACK_MS dan keyin ijro etiladi).
  useEffect(() => {
    if (greetKey === 0) return;
    pendingGreet.current = true;
    window.clearTimeout(timers.current.greet);
    timers.current.greet = window.setTimeout(startGreeting, GREET_FALLBACK_MS);
  }, [greetKey, startGreeting]);

  // Suhbat tugadi — kutilayotgan salom bekor, avatar idle'ga qaytadi.
  useEffect(() => {
    if (active) return;
    pendingGreet.current = false;
    window.clearTimeout(timers.current.greet);
    go("idle");
  }, [active, go]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.fade);
      window.clearTimeout(t.greet);
    };
  }, []);

  return (
    <div className="avatar-video" role="img" aria-label="Bojxona virtual xodimi">
      {CLIPS.map((name) => (
        <video
          key={name}
          ref={(el) => {
            videos.current[name] = el;
          }}
          className={`avatar-layer${view.phase === name ? " on" : ""}${view.prev === name ? " prev" : ""}`}
          muted
          playsInline
          preload="auto"
          loop={name !== "greeting"}
          autoPlay={name !== "greeting"}
          disablePictureInPicture
          tabIndex={-1}
          onEnded={name === "greeting" ? afterGreeting : undefined}
          onTransitionEnd={(e) => {
            if (e.propertyName === "opacity" && e.currentTarget === videos.current[phaseRef.current]) finishFade();
          }}
        >
          <source src={`/avatar/${name}.mp4`} type="video/mp4" />
          {/* mp4 (H.264) ijro etilmasa — webm. Oxirgi manba ham yuklanmasa, qatlam kutish videosiga qaytadi. */}
          <source src={`/avatar/${name}.webm`} type="video/webm" onError={() => phaseRef.current === name && go("idle")} />
        </video>
      ))}
    </div>
  );
}
