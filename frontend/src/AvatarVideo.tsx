// Avatar — haqiqiy xodim rasmi va AI videolaridan yig'ilgan QATLAMLAR (`npm run process:avatar` saytga tayyorlaydi).
//
//   base.jpg      — tana (qimirlamaydi, boshsiz)
//   head.webp     — bosh: furajka, soch, yuz, quloq (alfa kanalli). Pleyer uni bo'yin tagi atrofida yengil aylantirib siljitadi
//                   (nafas, gapirganda irg'ash) — bosh HECH QACHON qotib turmaydi
//   idle.mp4      — yuz qirqimi: og'iz yopiq (tinglayotgan avatar yoki gapirish pauzasi), uzluksiz takrorlanadi
//   speaking.mp4  — yuz qirqimi: og'iz harakatda, uzluksiz takrorlanadi
//   greeting.mp4  — salom (qo'l bilan Salute): to'liq kadr, bir marta; boshi va oxiri qatlamlarga piksel-piksel teng
//
// Yuz videolari bosh qatlami ICHIDA turadi, shuning uchun bosh bilan birga yuradi: yuz "yopishtirilgan niqob" bo'lib ko'rinmaydi.
// Kliplar almashganda faqat kichik yuz qirqimi xira-o'tadi; tana, furajka va soch qatlamlari hech qachon almashmaydi.
//
// OG'IZ FAQAT OVOZ BOR PAYTDA QIMIRLAYDI: pleyerning HAQIQIY ovoz balandligi (liveAudio level, analyser) o'qiladi.
// Ovoz bor → speaking, ovoz VOICE_HOLD_MS dan ko'p jim → idle. Shu tariqa so'zlar/jumlalar orasidagi pauzalarda va
// javob tugagach og'iz yopiladi (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { FACE_RECT, FRAME_H, FRAME_W, HEAD_RECT, PIVOT, assetUrl, follow, headPose, pct } from "./avatarRig";

type Face = "idle" | "speaking";
const FACES: readonly Face[] = ["idle", "speaking"];

const FADE_MS = 120; // styles.css dagi .rig-face.on / .rig-greeting.on bilan bir xil
const FADE_SAFETY_MS = 400; // transitionend kelmasa, eski qatlam shuncha qo'shimcha kutilib olib tashlanadi
const VOICE_ON = 0.04; // ovoz balandligi (0..1) shundan oshsa — ovoz bor (haqiqiy Gemini nutqida pauzada ~0.01 dan past)
const VOICE_HOLD_MS = 250; // shuncha jim bo'lsa og'iz yopiladi: so'zlar orasidagi qisqa tushishda speaking↔idle miltillamasin
// Salom normal holatda birinchi ovozda boshlanadi. Haqiqiy Gemini Live'da birinchi audio tugmadan 4–8 s keyin keladi
// (ulanish ~2 s + model 2–6 s, o'lchangan), shuning uchun zaxira undan ancha keyin — faqat ovoz umuman kelmay qolsa ishlaydi.
const GREET_FALLBACK_MS = 15_000;

const [HX0, HY0, HX1, HY1] = HEAD_RECT;
const [FX0, FY0, FX1, FY1] = FACE_RECT;
const HEAD_W = HX1 - HX0;
const HEAD_H = HY1 - HY0;

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
  const videos = useRef<Record<Face | "greeting", HTMLVideoElement | null>>({ idle: null, speaking: null, greeting: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const pxPerUnit = useRef(1); // ekran pikseli / kadr pikseli
  const faceRef = useRef<Face>("idle");
  const greetRef = useRef(false);
  const voiceRef = useRef(false);
  const pendingGreet = useRef(false);
  const timers = useRef<{ fade?: number; greet?: number }>({});
  const [view, setView] = useState<{ face: Face; prev: Face | null; greet: boolean }>({ face: "idle", prev: null, greet: false });

  /** Xira-o'tish tugagach: eski qatlam olib tashlanadi, ishlatilmayotgan salom boshiga qaytarilib to'xtatiladi. */
  const finishFade = useCallback(() => {
    window.clearTimeout(timers.current.fade);
    setView((s) => (s.prev ? { ...s, prev: null } : s));
    // idle va speaking HECH QACHON to'xtatilmaydi: to'xtatilgan klipni qayta ishga tushirish ~100 ms qotish bergan (o'lchangan).
    if (!greetRef.current) park(videos.current.greeting);
  }, []);

  /**
   * Holatni o'zgartiradi: yuz klipi (idle/speaking) va salom qatlami. Yangi qatlam eskisi ustida xira-o'tish bilan paydo bo'ladi,
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
      // ikkala yuz klipi doim yuradi (brauzer avtoplayni bloklagan bo'lsa — shu yerda ishga tushadi)
      play(v.idle);
      play(v.speaking);
      if (greetChanged && greet) {
        if (v.greeting) v.greeting.currentTime = 0;
        play(v.greeting);
      }
      setView((s) => ({ face, prev: faceChanged ? from : s.prev, greet }));
      // Eski qatlam xira-o'tish HAQIQATAN tugagach (onTransitionEnd) olib tashlanadi. Taymer — faqat transitionend
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

  // Ekran o'lchami: avatar sahnaga sig'adi (contain). Bosh siljishi ekran pikseliga shu koeffitsient bilan o'tkaziladi.
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
      pxPerUnit.current = w / FRAME_W;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Har kadrda: (1) ovoz bor/yo'qligi o'zgarsa yuz klipini almashtiradi, (2) boshning tabiiy harakatini qo'llaydi.
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let lastVoice = -1e9;
    let prev = performance.now();
    let speech = 0; // gapirish zo'ri (0..1), silliq
    let calm = 0; // umumiy harakat ko'paytirgichi: salom paytida 0, keyin silliq ko'tariladi
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const level = levelRef.current;
      if (level > VOICE_ON) lastVoice = now;
      const voice = now - lastVoice < VOICE_HOLD_MS;
      if (voice !== voiceRef.current) {
        voiceRef.current = voice;
        if (voice && pendingGreet.current) startGreeting(); // salom kutilayotgan bo'lsa — birinchi ovozda boshlanadi
        else if (!greetRef.current) apply(voice ? "speaking" : "idle", false); // salom paytida og'iz videoning o'zida
      }
      speech = follow(speech, voice ? 0.55 + 0.45 * Math.min(1, level * 1.6) : 0, dt, 0.15, 0.45);
      calm = follow(calm, greetRef.current || still ? 0 : 1, dt, 0.25, 0.08);
      const head = headRef.current;
      if (head) {
        const p = headPose(now / 1000, speech, calm);
        const s = pxPerUnit.current;
        head.style.transform = `translate(${(p.dx * s).toFixed(2)}px, ${(p.dy * s).toFixed(2)}px) rotate(${p.rot.toFixed(3)}deg)`;
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
    apply("idle", false);
  }, [active, apply]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      window.clearTimeout(t.fade);
      window.clearTimeout(t.greet);
    };
  }, []);

  return (
    <div ref={containerRef} className="avatar-video" role="img" aria-label="Bojxona virtual xodimi">
      <div ref={rigRef} className="avatar-rig">
        <img className="rig-base" src={assetUrl("base.jpg")} alt="" draggable={false} />
        <div
          ref={headRef}
          className="rig-head"
          style={{
            left: pct(HX0, FRAME_W),
            top: pct(HY0, FRAME_H),
            width: pct(HEAD_W, FRAME_W),
            height: pct(HEAD_H, FRAME_H),
            transformOrigin: `${((PIVOT[0] - HX0) / HEAD_W) * 100}% ${((PIVOT[1] - HY0) / HEAD_H) * 100}%`,
          }}
        >
          <img className="rig-head-img" src={assetUrl("head.webp")} alt="" draggable={false} />
          {FACES.map((name) => (
            <video
              key={name}
              ref={(el) => {
                videos.current[name] = el;
              }}
              className={`rig-face${view.face === name ? " on" : ""}${view.prev === name ? " prev" : ""}`}
              style={{
                left: pct(FX0 - HX0, HEAD_W),
                top: pct(FY0 - HY0, HEAD_H),
                width: pct(FX1 - FX0, HEAD_W),
                height: pct(FY1 - FY0, HEAD_H),
              }}
              muted
              playsInline
              preload="auto"
              loop
              autoPlay
              disablePictureInPicture
              tabIndex={-1}
              onTransitionEnd={(e) => {
                if (e.propertyName === "opacity" && e.currentTarget === videos.current[faceRef.current]) finishFade();
              }}
            >
              <source src={assetUrl(`${name}.mp4`)} type="video/mp4" />
              {/* mp4 (H.264) ijro etilmasa — webm */}
              <source src={assetUrl(`${name}.webm`)} type="video/webm" />
            </video>
          ))}
        </div>
        <video
          ref={(el) => {
            videos.current.greeting = el;
          }}
          className={`rig-greeting${view.greet ? " on" : ""}`}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          onEnded={afterGreeting}
          onTransitionEnd={(e) => {
            if (e.propertyName === "opacity" && !greetRef.current) finishFade();
          }}
          // salom yuklanmasa (tarmoq/format) — kutish holatida qolinadi, suhbat to'xtamaydi
          onError={() => greetRef.current && apply(voiceRef.current ? "speaking" : "idle", false)}
        >
          <source src={assetUrl("greeting.mp4")} type="video/mp4" />
          <source src={assetUrl("greeting.webm")} type="video/webm" onError={() => greetRef.current && apply(voiceRef.current ? "speaking" : "idle", false)} />
        </video>
      </div>
    </div>
  );
}
