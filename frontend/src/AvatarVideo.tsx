// Avatar — haqiqiy xodim, AI yaratgan XOM videolar (piksellarga ishlov berilmagan, faqat qirqilgan; README). Qatlam, qo'shimcha
// harakat yoki yumshatish yo'q.
//
//   idle.mp4          — tinglayotgan avatar (kadrlar oldinga-orqaga: takrorlanish choki yo'q), doim yuradi
//   speaking-NN.mp4   — gapirish, bir nechta XIL variant: og'iz harakati har safar bir xil takrorlanmasin deb tasodifiy tanlanadi
//   greeting.mp4      — salom (qo'l bilan Salute), bir marta
//
// OG'IZ FAQAT OVOZ BOR PAYTDA QIMIRLAYDI: pleyerning HAQIQIY ovoz balandligi (liveAudio level, analyser) o'qiladi.
// Ovoz bor → gapirish, ovoz VOICE_HOLD_MS dan ko'p jim → kutish (Gemini nutqida pauzalar vaqtning ~15–20% ini tashkil etadi).
//
// SEZILMAY O'TISH: ikkinchi klip xira-o'tish bilan birinchisi ustiga chiqadi, shuning uchun ikkala kadrda bosh bir joyda va og'iz
// bir holatda (yopiq) bo'lishi kerak. Hamma klip bir xil uy kadridan boshlanadi va shu kadrda tugaydi:
//  - Kirish: gapirish va salom DOIM BOSHIDAN boshlanadi (uy kadri: og'iz yopiq, bosh kutish o'rnida).
//  - Variantdan variantga: oldingisi tugashiga CHAIN_LEAD_S qolganda keyingisi (ikkinchi bufer, oldindan yuklangan) boshlanadi — ikkalasi uy kadrida.
//  - Chiqish: gapirishdan kutishga FAQAT og'iz yopiq va bosh kutish o'rnida bo'lgan oraliqlarda (avatarClips.json); salom oxirida uy kadri.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { FRAME_H, FRAME_W, SPEAKING_VARIANTS, assetUrl, isExitTime, pickVariant } from "./avatarClips";

type Layer = "idle" | "a" | "b"; // idle; a/b — gapirish uchun ikki bufer (biri ijro etiladi, ikkinchisi keyingi variant bilan tayyor)
const LAYERS: readonly Layer[] = ["idle", "a", "b"];
const other = (l: "a" | "b"): "a" | "b" => (l === "a" ? "b" : "a");

// Xira-o'tish davomiyligi (ms) holatga qarab (inline transition-duration; styles.css dagi 400 — salom uchun):
//  - chiqish (gapirish -> kutish): 400 ms; eski klip yopiq lablar kadrida MUZLATILADI, shuning uchun og'iz o'tish davomida qayta ochilmaydi
//  - kirish (kutish -> gapirish): 200 ms; gapirish uy kadridan boshlanadi, harakatlanayotgan lablar kutish ustida uzoq ikkilanmasin
//  - ulanish (variant -> variant): 250 ms; ikkalasi uy kadrida
//  - ovoz qaytdi (chiqish davom etayotganda): 200 ms; klip muzlatilgan joyidan davom etadi
const EXIT_FADE_MS = 400;
const ENTER_FADE_MS = 200;
const CHAIN_FADE_MS = 250;
const RESUME_FADE_MS = 200;
const FADE_MS = EXIT_FADE_MS;
const FADE_SAFETY_MS = 500; // transitionend kelmasa, eski klip shuncha qo'shimcha kutilib olib tashlanadi
const EXIT_MAX_WAIT_MS = 2500; // o'tish oralig'i shuncha vaqtda topilmasa — baribir chiqadi (klipda oraliq yo'q bo'lsa osilib qolmasin)
const VOICE_ON = 0.04; // ovoz balandligi (0..1) shundan oshsa — ovoz bor (haqiqiy Gemini nutqida pauzada ~0.01 dan past)
const VOICE_HOLD_MS = 170; // shuncha jim bo'lsa og'iz yopiladi: so'zlar orasidagi qisqa tushishda gapirish↔kutish miltillamasin
const CHAIN_LEAD_S = 0.2; // variant tugashiga shuncha qolganda keyingisi boshlanadi (ikkalasi uy kadrida)
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
/** Boshidan boshlab ijro etadi (kirish nuqtasi: uy kadri). */
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
  const videos = useRef<Record<Layer | "greeting", HTMLVideoElement | null>>({ idle: null, a: null, b: null, greeting: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<Layer>("idle"); // hozir ko'rinib turgan (ustidagi) klip
  const greetRef = useRef(false);
  const voiceRef = useRef(false);
  const pendingGreet = useRef(false);
  const timers = useRef<{ fade?: number; greet?: number; exit?: number }>({});
  // gapirish buferlari: cur — ijro etilayotgan/navbatdagi, staged — har buferga yuklangan variant, last — oxirgi ijro etilgan variant
  const speak = useRef<{ cur: "a" | "b"; staged: Record<"a" | "b", number>; last: number }>({ cur: "a", staged: { a: -1, b: -1 }, last: -1 });
  const exiting = useRef<"a" | "b" | null>(null); // chiqish davom etyapti: shu gapirish buferi yopiq lablar kadrida muzlatilgan
  const exitSince = useRef<number | null>(null); // ovoz tugagan payt (o'tish oralig'ini kutish boshlangan)
  const [view, setView] = useState<{ front: Layer; prev: Layer | null; out: Layer | null; greet: boolean; fadeMs: number }>({
    front: "idle",
    prev: null,
    out: null,
    greet: false,
    fadeMs: EXIT_FADE_MS,
  });

  /** Buferga variant yuklaydi (to'xtatilgan, boshida). */
  const stage = useCallback((layer: "a" | "b", idx: number) => {
    const v = videos.current[layer];
    const s = speak.current;
    s.staged[layer] = idx;
    if (!v) return;
    const file = SPEAKING_VARIANTS[idx].file;
    if (v.dataset.file !== file) {
      v.dataset.file = file;
      v.src = assetUrl(file);
      v.load();
    } else {
      park(v);
    }
    v.pause();
  }, []);

  /** Ko'rinmayotgan buferlarga yangi (oldingisidan farqli) variantlar yuklaydi. */
  const refill = useCallback(() => {
    const s = speak.current;
    const n = SPEAKING_VARIANTS.length;
    const idle = frontRef.current === "idle";
    for (const layer of ["a", "b"] as const) {
      if (frontRef.current === layer) continue; // ko'rinib turgan bufer tegilmaydi
      park(videos.current[layer]);
      // idle holatida cur ham qayta yuklanadi (oldingi gapirishdagi variant takrorlanmasin); gapirishda faqat zaxira
      if (!idle && layer === s.cur) continue;
      const avoid = layer === s.cur ? s.last : s.staged[other(layer)] >= 0 ? s.staged[other(layer)] : s.last;
      stage(layer, pickVariant(n, avoid));
    }
    if (idle) {
      // idle: cur ham, zaxira ham farqli bo'lsin
      const sp = other(s.cur);
      if (s.staged[sp] === s.staged[s.cur]) stage(sp, pickVariant(n, s.staged[s.cur]));
    }
  }, [stage]);

  /** Xira-o'tish tugagach: eski klip olib tashlanadi, ishlatilmayotgan klip boshiga qaytarilib to'xtatiladi, buferlar to'ldiriladi. */
  const finishFade = useCallback(() => {
    window.clearTimeout(timers.current.fade);
    setView((s) => (s.prev || s.out ? { ...s, prev: null, out: null } : s));
    exiting.current = null;
    // kutish HECH QACHON to'xtatilmaydi: to'xtatilgan klipni qayta ishga tushirish ~100 ms qotish bergan (o'lchangan).
    if (!greetRef.current) park(videos.current.greeting);
    refill();
  }, [refill]);

  const startFadeTimer = useCallback(() => {
    // Eski klip xira-o'tish HAQIQATAN tugagach (onTransitionEnd) olib tashlanadi. Taymer — faqat transitionend
    // kelmaydigan holat uchun zaxira (opacity o'zgarmagan).
    window.clearTimeout(timers.current.fade);
    timers.current.fade = window.setTimeout(finishFade, FADE_MS + FADE_SAFETY_MS);
  }, [finishFade]);

  /**
   * Holatni o'zgartiradi: klip (kutish/gapirish) va salom. Yangi klip eskisi ustida xira-o'tish bilan paydo bo'ladi,
   * eskisi xira-o'tish tugaguncha ko'rinib turadi (o'rtada qorayish bo'lmasin).
   */
  const apply = useCallback(
    (speaking: boolean, greet: boolean) => {
      const to: Layer = speaking ? speak.current.cur : "idle";
      const from = frontRef.current;
      const faceChanged = to !== from;
      const greetChanged = greet !== greetRef.current;
      if (!faceChanged && !greetChanged) return;
      frontRef.current = to;
      greetRef.current = greet;
      const v = videos.current;
      play(v.idle); // brauzer avtoplayni bloklagan bo'lsa — shu yerda ishga tushadi
      let fadeMs = EXIT_FADE_MS;
      if (faceChanged && to === "idle" && from !== "idle") {
        // CHIQISH: eski gapirish klipi yopiq lablar kadrida to'xtatiladi — xira-o'tish davomida og'iz qayta ochilmaydi
        v[from]?.pause();
        exiting.current = from;
      } else if (faceChanged && to !== "idle") {
        exiting.current = null;
        restart(v[to]); // gapirish doim boshidan: uy kadri
        speak.current.last = speak.current.staged[to];
        fadeMs = ENTER_FADE_MS;
      }
      if (greetChanged && greet) restart(v.greeting);
      exitSince.current = null;
      setView((s) => ({ front: to, prev: faceChanged ? from : s.prev, out: null, greet, fadeMs: faceChanged ? fadeMs : s.fadeMs }));
      startFadeTimer();
    },
    [startFadeTimer],
  );

  /** Chiqish davom etayotganda ovoz qaytdi: muzlatilgan gapirish klipi shu joyidan davom etadi, kutish xira bo'lib ketadi (qayta boshlanmaydi). */
  const resumeSpeaking = useCallback(() => {
    const layer = exiting.current;
    if (!layer) return false;
    exiting.current = null;
    exitSince.current = null;
    frontRef.current = layer;
    play(videos.current[layer]);
    setView((s) => ({ ...s, front: layer, prev: null, out: "idle", fadeMs: RESUME_FADE_MS }));
    startFadeTimer();
    return true;
  }, [startFadeTimer]);

  /** Gapirish davomida keyingi variantga ulanadi (ikkalasi uy kadrida: sezilmaydi). */
  const chainNext = useCallback(() => {
    const s = speak.current;
    const old = s.cur;
    const nxt = other(old);
    s.cur = nxt;
    frontRef.current = nxt;
    s.last = s.staged[nxt];
    restart(videos.current[nxt]);
    setView((st) => ({ ...st, front: nxt, prev: old, out: null, fadeMs: CHAIN_FADE_MS }));
    startFadeTimer();
  }, [startFadeTimer]);

  const startGreeting = useCallback(() => {
    pendingGreet.current = false;
    window.clearTimeout(timers.current.greet);
    apply(frontRef.current !== "idle", true);
  }, [apply]);

  const afterGreeting = useCallback(() => {
    if (greetRef.current) apply(voiceRef.current, false);
  }, [apply]);

  // Variantlar tugadi (zaxira bufer tayyor bo'lmasa chainNext ishlamagan): ovoz hali bor bo'lsa — shu variantni qayta boshlaydi.
  const onSpeakEnded = useCallback(
    (layer: "a" | "b") => {
      if (frontRef.current !== layer || greetRef.current) return;
      if (voiceRef.current) {
        const sp = videos.current[other(layer)];
        if (sp && sp.readyState >= 3) chainNext();
        else restart(videos.current[layer]);
      }
    },
    [chainNext],
  );

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

  // Boshlanishda ikkala gapirish buferiga tasodifiy variantlar yuklanadi; qolganlari fonda keshga olinadi (gapirish boshlanganda kutilmasin).
  useEffect(() => {
    const n = SPEAKING_VARIANTS.length;
    const first = pickVariant(n, -1);
    stage("a", first);
    stage("b", pickVariant(n, first));
    let cancelled = false;
    const t = window.setTimeout(async () => {
      for (const v of SPEAKING_VARIANTS) {
        if (cancelled) return;
        try {
          await fetch(assetUrl(v.file), { cache: "force-cache" });
        } catch {
          /* tarmoq xatosi — kerak bo'lganda brauzer o'zi yuklaydi */
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [stage]);

  // Har kadrda: ovoz bor/yo'qligi o'zgarsa klipni almashtiradi; gapirish tugashiga yaqin keyingi variantga ulaydi.
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
        else if (!greetRef.current) {
          // salom paytida og'iz videoning o'zida
          if (voice) {
            exitSince.current = null;
            if (!resumeSpeaking()) apply(true, false);
          } else if (frontRef.current !== "idle") exitSince.current = now; // chiqish: og'iz yopiq va bosh kutish o'rnida bo'lgan kadrni kutadi
        }
      }
      // gapirish tugagan: yopiq lablar kadriga yetishi bilan kutishga o'tadi (klip shu kadrda to'xtatiladi)
      if (exitSince.current !== null && !voiceRef.current && !greetRef.current && frontRef.current !== "idle") {
        const sp0 = speak.current;
        const sp = videos.current[sp0.cur];
        const variant = SPEAKING_VARIANTS[sp0.staged[sp0.cur]];
        if (!sp || !variant || isExitTime(variant.exits, sp.currentTime, sp.duration) || now - exitSince.current > EXIT_MAX_WAIT_MS) apply(false, false);
      }
      // gapirish davom etyapti va variant tugayapti — keyingisiga ulanadi
      if (voiceRef.current && !greetRef.current && frontRef.current !== "idle") {
        const s = speak.current;
        const cur = videos.current[s.cur];
        const spare = videos.current[other(s.cur)];
        if (cur && Number.isFinite(cur.duration) && cur.duration - cur.currentTime < CHAIN_LEAD_S && spare && spare.readyState >= 3) chainNext();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, apply, startGreeting, chainNext, resumeSpeaking]);

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
    exitSince.current = null;
    apply(false, false);
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
        {LAYERS.map((name) => (
          <video
            key={name}
            ref={(el) => {
              videos.current[name] = el;
            }}
            className={`rig-face${view.front === name ? " on" : ""}${view.prev === name ? " prev" : ""}${view.out === name ? " out" : ""}`}
            style={{ transitionDuration: `${view.fadeMs}ms` }}
            // idle — bitta fayl, doim takrorlanadi; a/b — variantlar src ni stage() qo'yadi (takrorlanmaydi, tugagach ulanadi)
            {...(name === "idle" ? { src: assetUrl("idle.mp4"), loop: true, autoPlay: true } : { onEnded: () => onSpeakEnded(name) })}
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            tabIndex={-1}
            onTransitionEnd={(e) => {
              if (e.propertyName === "opacity" && e.currentTarget === videos.current[frontRef.current]) finishFade();
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
