// Avatar — haqiqiy xodim, AI yaratgan 3 ta XOM video (piksellarga ishlov berilmagan, faqat qirqilgan; README). Qatlam, qo'shimcha
// harakat yoki yumshatish yo'q.
//
//   idle.mp4      — tinglayotgan avatar (kadrlar oldinga-orqaga: takrorlanish choki yo'q), doim yuradi
//   speaking.mp4  — gapirish, takrorlanadi (qirqilgan bo'lak: takrorlanish choki oddiy harakatdan keskin emas)
//   greeting.mp4  — salom (qo'l bilan Salute), bir marta
//
// OG'IZ FAQAT OVOZ BOR PAYTDA QIMIRLAYDI: pleyerning HAQIQIY ovoz balandligi (liveAudio level, analyser) o'qiladi.
// Ovoz bor → speaking, ovoz VOICE_HOLD_MS dan ko'p jim → idle (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
//
// KLIPDAN KLIPGA SEZILMAY O'TISH: ikkinchi klip xira-o'tish bilan birinchisi ustiga chiqadi, shuning uchun ikkala kadrda
// bosh bir joyda bo'lishi kerak (aks holda "ikki bosh" ko'rinadi).
//  - Kirish: gapirish va salom DOIM BOSHIDAN boshlanadi (ularning birinchi kadrida bosh kutish holatidagi o'rnida).
//  - Chiqish: salom oxirida bosh kutish o'rniga qaytadi (klip shunday qirqilgan); gapirishdan chiqishda esa pleyer boshning
//    o'rni kutish holatiga mos kelgan oraliqni (avatarClips.json, ≤ 0.9 s) kutadi.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { FRAME_H, FRAME_W, SPEAKING_EXITS, assetUrl, nextExitDelay } from "./avatarClips";

type Face = "idle" | "speaking";
const FACES: readonly Face[] = ["idle", "speaking"];

const FADE_MS = 400; // styles.css dagi .rig-face.on / .rig-greeting.on bilan bir xil
const FADE_SAFETY_MS = 500; // transitionend kelmasa, eski klip shuncha qo'shimcha kutilib olib tashlanadi
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
/** Boshidan boshlab ijro etadi (kirish nuqtasi: bosh kutish holatidagi o'rnida). */
const restart = (v: HTMLVideoElement | null) => {
  if (!v) return;
  try {
    v.currentTime = 0;
  } catch {
    /* metadata hali yuklanmagan */
  }
  play(v);
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
  const videos = useRef<Record<Face | "greeting", HTMLVideoElement | null>>({ idle: null, speaking: null, greeting: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<Face>("idle");
  const greetRef = useRef(false);
  const voiceRef = useRef(false);
  const pendingGreet = useRef(false);
  const timers = useRef<{ fade?: number; greet?: number; exit?: number }>({});
  const [view, setView] = useState<{ face: Face; prev: Face | null; greet: boolean }>({ face: "idle", prev: null, greet: false });

  /** Xira-o'tish tugagach: eski klip olib tashlanadi, ishlatilmayotgan gapirish va salom boshiga qaytarilib to'xtatiladi. */
  const finishFade = useCallback(() => {
    window.clearTimeout(timers.current.fade);
    setView((s) => (s.prev ? { ...s, prev: null } : s));
    // kutish HECH QACHON to'xtatilmaydi: to'xtatilgan klipni qayta ishga tushirish ~100 ms qotish bergan (o'lchangan).
    if (faceRef.current !== "speaking") park(videos.current.speaking);
    if (!greetRef.current) park(videos.current.greeting);
  }, []);

  /**
   * Holatni o'zgartiradi: klip (idle/speaking) va salom. Yangi klip eskisi ustida xira-o'tish bilan paydo bo'ladi,
   * eskisi xira-o'tish tugaguncha ko'rinib turadi (o'rtada qorayish bo'lmasin).
   */
  const apply = useCallback(
    (face: Face, greet: boolean) => {
      const faceChanged = face !== faceRef.current;
      const greetChanged = greet !== greetRef.current;
      if (!faceChanged && !greetChanged) return;
      const from = faceRef.current;
      faceRef.current = face;
      greetRef.current = greet;
      const v = videos.current;
      play(v.idle); // brauzer avtoplayni bloklagan bo'lsa — shu yerda ishga tushadi
      if (faceChanged && face === "speaking") restart(v.speaking);
      if (greetChanged && greet) restart(v.greeting);
      setView((s) => ({ face, prev: faceChanged ? from : s.prev, greet }));
      // Eski klip xira-o'tish HAQIQATAN tugagach (onTransitionEnd) olib tashlanadi. Taymer — faqat transitionend
      // kelmaydigan holat uchun zaxira (opacity o'zgarmagan).
      window.clearTimeout(timers.current.fade);
      timers.current.fade = window.setTimeout(finishFade, FADE_MS + FADE_SAFETY_MS);
    },
    [finishFade],
  );

  const startGreeting = useCallback(() => {
    pendingGreet.current = false;
    window.clearTimeout(timers.current.greet);
    apply(faceRef.current, true);
  }, [apply]);

  const afterGreeting = useCallback(() => {
    if (greetRef.current) apply(voiceRef.current ? "speaking" : "idle", false);
  }, [apply]);

  // Ekran o'lchami: avatar sahnaga sig'adi (contain, 9:16).
  // useLayoutEffect: o'lcham birinchi chizishdan oldin o'rnatiladi (bo'sh kadr bo'lmasin).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => {
      const rig = rigRef.current;
      if (!rig) return;
      const w = Math.min(el.clientWidth, (el.clientHeight * FRAME_W) / FRAME_H);
      rig.style.width = `${w}px`;
      rig.style.height = `${(w * FRAME_H) / FRAME_W}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Har kadrda ovoz bor/yo'qligi o'zgarsa klipni almashtiradi.
  useEffect(() => {
    let raf = 0;
    let lastVoice = -1e9;
    const tick = () => {
      const now = performance.now();
      if (levelRef.current > VOICE_ON) lastVoice = now;
      const voice = now - lastVoice < VOICE_HOLD_MS;
      if (voice !== voiceRef.current) {
        voiceRef.current = voice;
        window.clearTimeout(timers.current.exit);
        if (voice && pendingGreet.current) startGreeting(); // salom kutilayotgan bo'lsa — birinchi ovozda boshlanadi
        else if (!greetRef.current) {
          // salom paytida og'iz videoning o'zida
          if (voice) apply("speaking", false);
          else if (faceRef.current === "speaking") {
            // gapirishdan chiqish: boshning o'rni kutish holatiga mos kelgan oraliqda (≤ 0.9 s)
            const sp = videos.current.speaking;
            const delay = nextExitDelay(SPEAKING_EXITS, sp?.currentTime ?? 0, sp?.duration ?? NaN);
            if (delay <= 0) apply("idle", false);
            else
              timers.current.exit = window.setTimeout(() => {
                if (!voiceRef.current && !greetRef.current) apply("idle", false);
              }, delay * 1000);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, apply, startGreeting]);

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
    window.clearTimeout(timers.current.exit);
    apply("idle", false);
  }, [active, apply]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.fade);
      window.clearTimeout(t.greet);
      window.clearTimeout(t.exit);
    };
  }, []);

  return (
    <div ref={containerRef} className="avatar-video" role="img" aria-label="Bojxona virtual xodimi">
      <div ref={rigRef} className="avatar-rig">
        {FACES.map((name) => (
          <video
            key={name}
            ref={(el) => {
              videos.current[name] = el;
            }}
            className={`rig-face${view.face === name ? " on" : ""}${view.prev === name ? " prev" : ""}`}
            src={assetUrl(`${name}.mp4`)}
            muted
            playsInline
            preload="auto"
            loop
            autoPlay={name === "idle"}
            disablePictureInPicture
            tabIndex={-1}
            onTransitionEnd={(e) => {
              if (e.propertyName === "opacity" && e.currentTarget === videos.current[faceRef.current]) finishFade();
            }}
          />
        ))}
        <video
          ref={(el) => {
            videos.current.greeting = el;
          }}
          className={`rig-greeting${view.greet ? " on" : ""}`}
          src={assetUrl("greeting.mp4")}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          onEnded={afterGreeting}
          onTransitionEnd={(e) => {
            if (e.propertyName === "opacity" && !greetRef.current) finishFade();
          }}
        />
      </div>
    </div>
  );
}
