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
import { FRAME_H, FRAME_W, SPEAKING_VARIANTS, assetUrl, isExitTime, isHoldTime, pickLinked, pickTransition, pickVariant, planExit, PLAN_MAX_RATE, PLAN_MIN_RATE } from "./avatarClips";
import type { TurnInfo } from "./liveAudio";

type Layer = "idle" | "a" | "b"; // idle; a/b — gapirish uchun ikki bufer (biri ijro etiladi, ikkinchisi keyingi variant bilan tayyor)
const LAYERS: readonly Layer[] = ["idle", "a", "b"];
const other = (l: "a" | "b"): "a" | "b" => (l === "a" ? "b" : "a");

// Xira-o'tish davomiyligi (ms) holatga qarab (inline transition-duration; styles.css dagi 400 — salom uchun):
//  - chiqish (gapirish -> kutish): 400 ms; eski klip yopiq lablar kadrida MUZLATILADI, shuning uchun og'iz o'tish davomida qayta ochilmaydi
//  - kirish (kutish -> gapirish): 200 ms; gapirish uy kadridan boshlanadi, harakatlanayotgan lablar kutish ustida uzoq ikkilanmasin
//  - ulanish (variant -> variant): 0 ms (bir kadrda); og'iz yopiq paytda almashadi
//  - ovoz qaytdi (chiqish davom etayotganda): 200 ms; klip muzlatilgan joyidan davom etadi
const EXIT_FADE_MS = 400;
const ENTER_FADE_MS = 200;
const BODY_FADE_MS = 200; // variant almashganda faqat TANA (yoqadan pastki qism) shuncha xira-o'tadi; bosh/yuz bir kadrda almashadi (styles.css .bodyfade)
const CHAIN_FADE_MS = 0; // variant -> variant: xira-o'tishsiz, og'iz YOPIQ paytda bir kadrda almashadi (ochiq paytda almashsa lablar "bijirlab" bilinadi)
const RESUME_FADE_MS = 200;
const FADE_MS = EXIT_FADE_MS;
const FADE_SAFETY_MS = 500; // transitionend kelmasa, eski klip shuncha qo'shimcha kutilib olib tashlanadi
const EXIT_HOLD_WAIT_MS = 700; // chiqish: avval lablar ANIQ yopiq kadrni kutadi, shuncha vaqtdan keyin istalgan yopiq oynada chiqadi
const EXIT_MAX_WAIT_MS = 3000; // o'tish oralig'i shuncha vaqtda topilmasa — baribir chiqadi (klipda oraliq yo'q bo'lsa osilib qolmasin)
const VOICE_ON = 0.04; // ovoz balandligi (0..1) shundan oshsa — ovoz bor (haqiqiy Gemini nutqida pauzada ~0.01 dan past)
// Gap o'rtasida variantdan variantga almashish FAQAT og'iz YOPIQ paytda va xira-o'tishsiz (avatarClips.json "graph": A ning yopiq-og'iz oralig'i markazi -> B ning
// o'xshash yopiq-og'iz kadri): zaxira buferni shu kadrga oldindan suradi, A shu kadrga yetganda B ijroni davom ettiradi (bir kadrda; ikki yopiq yuz deyarli bir xil — bilinmaydi).
// Og'iz ochiq paytda almashish bilinardi. Mos nuqta bo'lmasa — klip oxirigacha o'ynaydi, oxirgi yopiq oynada B ning boshiga o'tadi.
const SWITCH_MIN_AHEAD_S = 0.45; // zaxira bufer surilib tayyor bo'lishi uchun
const SWITCH_MAX_AHEAD_S = 1.6;
const SWITCH_MIN_DWELL_MS = 1800; // klip boshlangach kamida shuncha o'ynaydi (juda tez-tez almashmasin)
const SWITCH_LEAD_S = 0.02;
const PRE_ROLL_S = 0.3; // zaxira klip almashishdan shuncha OLDIN ko'rinmas holda ijroni boshlaydi: almashganda dekoder qotib qolmasin (video "to'xtab" qolmasin)
const SWITCH_FADE_MS = 0;
// Ovoz tugashini OLDINDAN bilamiz (TTS audiosi hammasi kelib bo'lgan: liveAudio turnRef.remaining): shu paytga yaqin klipning og'iz yopiladigan oynasi to'g'rilanadi
// (o'ynash tezligi 0.7–1.4 ichida), oynaga yetgach klip ovoz tugaguncha to'xtab turadi — og'iz ovoz bilan birga yopiladi, jim holda qimirlab turmaydi.
const END_PLAN_S = 3.5;
const MIN_TRACK_RATE = 0.4; // ovoz tugashiga qarab sozlashda (kuzatish) tezlik chegarasi: erta yetib qolsa klip to'xtab qolmay sekinlashadi
const MAX_TRACK_RATE = 2.5;
const HOLD_MAX_S = 0.12; // lablar yopiq kadrda kutish: ovoz tugashiga shundan ko'p qolgan bo'lsa klip TO'XTATILMAYDI (ovoz gapirayotganda video qotmasin)
const END_LEAD_S = 0.05; // lablar yopiq kadrga oxirgi tovushdan ~50 ms OLDIN yetadi (kadr/rAF kechikishi hisobiga), qolgan vaqt shu kadrda kutadi
const VOICE_HOLD_TURN_MS = 1500; // javob davomida (turn tugamagan): jumlalar orasidagi pauza shu vaqtgacha gapirishni uzmaydi
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
  /** har ortishida salomning birinchi audiosi keldi: salom videosi boshlanadi (ovoz GREETING_SPEECH_START_S dan keyin chalinadi) */
  greetStart: number;
  /** javob davomida true (liveAudio): jumlalar orasidagi pauzada og'iz yopilib-ochilmasin */
  turnRef: MutableRefObject<TurnInfo>;
}

const play = (v: HTMLVideoElement | null) => {
  v?.play().catch(() => {
    /* avtoplay bloklangan bo'lsa — keyingi harakatda ishga tushadi */
  });
};
/** Boshidan boshlab ijro etadi (kirish nuqtasi: uy kadri). */
const restart = (v: HTMLVideoElement | null) => {
  if (!v) return;
  v.playbackRate = 1;
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
  v.playbackRate = 1;
  try {
    v.currentTime = 0;
  } catch {
    /* metadata hali yuklanmagan */
  }
};

export function AvatarVideo({ active, levelRef, greetKey, greetStart, turnRef }: Props) {
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
  const sw = useRef<{ to: "a" | "b"; t: number; u: number; pre: number; started: boolean; at: number } | null>(null); // rejalangan kadr-mos almashinuv (A t soniyada -> B u soniyadan)
  const endPlan = useRef<{ layer: "a" | "b"; target: number } | null>(null); // ovoz tugashiga to'g'rilangan chiqish oynasi
  const dbgLast = useRef(0); // (faqat sinov: window.__avatarDbg bo'lsa holat yoziladi)
  const speakSince = useRef(0); // joriy gapirish klipi boshlangan payt (performance.now)
  const exiting = useRef<"a" | "b" | null>(null); // chiqish davom etyapti: shu gapirish buferi yopiq lablar kadrida muzlatilgan
  const exitSince = useRef<number | null>(null); // ovoz tugagan payt (o'tish oralig'ini kutish boshlangan)
  const [view, setView] = useState<{ front: Layer; prev: Layer | null; out: Layer | null; greet: boolean; fadeMs: number; bodyFade: boolean }>({
    front: "idle",
    prev: null,
    out: null,
    greet: false,
    fadeMs: EXIT_FADE_MS,
    bodyFade: false,
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

  /** Ko'rinmayotgan buferlarga yangi variantlar yuklaydi: zaxira — joriy variant bilan kadr-mos o'tish nuqtalari bor variantlardan (pickLinked). */
  const refill = useCallback(() => {
    const s = speak.current;
    const n = SPEAKING_VARIANTS.length;
    const idle = frontRef.current === "idle";
    for (const layer of ["a", "b"] as const) {
      if (frontRef.current !== layer) park(videos.current[layer]); // ko'rinib turgan bufer tegilmaydi
    }
    // idle holatida cur ham qayta yuklanadi (oldingi gapirishdagi variant takrorlanmasin); gapirishda faqat zaxira
    if (idle) stage(s.cur, pickVariant(n, s.last));
    const spareLayer = other(s.cur);
    if (frontRef.current !== spareLayer) stage(spareLayer, pickLinked(s.staged[s.cur], n));
  }, [stage]);

  /** Xira-o'tish tugagach: eski klip olib tashlanadi, ishlatilmayotgan klip boshiga qaytarilib to'xtatiladi, buferlar to'ldiriladi. */
  const finishFade = useCallback(() => {
    window.clearTimeout(timers.current.fade);
    setView((s) => (s.prev || s.out ? { ...s, prev: null, out: null, bodyFade: false } : s));
    exiting.current = null;
    // kutish HECH QACHON to'xtatilmaydi: to'xtatilgan klipni qayta ishga tushirish ~100 ms qotish bergan (o'lchangan).
    if (!greetRef.current) park(videos.current.greeting);
    refill();
  }, [refill]);

  const startFadeTimer = useCallback((ms?: number) => {
    // Eski klip xira-o'tish HAQIQATAN tugagach (onTransitionEnd) olib tashlanadi. Taymer — faqat transitionend
    // kelmaydigan holat uchun zaxira (opacity o'zgarmagan).
    window.clearTimeout(timers.current.fade);
    timers.current.fade = window.setTimeout(finishFade, ms ?? FADE_MS + FADE_SAFETY_MS);
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
        sw.current = null;
        endPlan.current = null;
        speakSince.current = performance.now();
        restart(v[to]); // gapirish doim boshidan: uy kadri
        speak.current.last = speak.current.staged[to];
        fadeMs = ENTER_FADE_MS;
      }
      if (greetChanged && greet) restart(v.greeting);
      exitSince.current = null;
      setView((s) => ({ front: to, prev: faceChanged ? from : s.prev, out: null, greet, fadeMs: faceChanged ? fadeMs : s.fadeMs, bodyFade: false }));
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
    setView((s) => ({ ...s, front: layer, prev: null, out: "idle", fadeMs: RESUME_FADE_MS, bodyFade: false }));
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
    sw.current = null;
    endPlan.current = null;
    speakSince.current = performance.now();
    restart(videos.current[nxt]);
    setView((st) => ({ ...st, front: nxt, prev: null, out: old, fadeMs: CHAIN_FADE_MS, bodyFade: true })); // yangi klip darhol (yuz), eski faqat tanada xira bo'lib ketadi
    startFadeTimer(BODY_FADE_MS + 80);
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
      const voice = now - lastVoice < (turnRef.current.active ? VOICE_HOLD_TURN_MS : VOICE_HOLD_MS);
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
        if (!sp || !variant || isHoldTime(variant.holds, sp.currentTime) || (now - exitSince.current > EXIT_HOLD_WAIT_MS && isExitTime(variant.exits, sp.currentTime, sp.duration)) || now - exitSince.current > EXIT_MAX_WAIT_MS) apply(false, false);
      }
      const dbgArr = (window as unknown as { __avatarDbg?: unknown[] }).__avatarDbg;
      if (dbgArr && now - dbgLast.current > 100) {
        dbgLast.current = now;
        const cv = videos.current[speak.current.cur];
        dbgArr.push({ ev: "st", at: now, voice: voiceRef.current, front: frontRef.current, greet: greetRef.current, t: cv?.currentTime, paused: cv?.paused, rate: cv?.playbackRate, active: turnRef.current.active, done: turnRef.current.done, rem: turnRef.current.audibleRemaining, level: levelRef.current });
      }
      // gapirish davom etyapti
      if (voiceRef.current && !greetRef.current && frontRef.current !== "idle") {
        const s = speak.current;
        const cur = videos.current[s.cur];
        const spareLayer = other(s.cur);
        const spare = videos.current[spareLayer];
        const variant = SPEAKING_VARIANTS[s.staged[s.cur]];
        const turn = turnRef.current;
        const remaining = turn.active && turn.done ? turn.audibleRemaining : Infinity; // oxirgi eshitiladigan tovush tugashigacha (oldindan ma'lum bo'lsa)
        const nearEnd = remaining < END_PLAN_S;
        if (cur && variant && Number.isFinite(cur.duration)) {
          const t = cur.currentTime;
          // 1) kadr-mos almashinuv: rejalangan bo'lsa bajariladi, bo'lmasa mos nuqta qidiriladi (ovoz tugashiga yaqin emas)
          let plan = sw.current;
          if (plan && (plan.to !== spareLayer || t > plan.t + 0.4 || now - plan.at > 3000 || (remaining < 3.8 && !(plan.started && t >= plan.t - 0.15)))) plan = sw.current = null;
          if (plan) {
            if (!spare || spare.seeking || spare.readyState < 2) {
              /* zaxira bufer surilmoqda / tayyor emas */
            } else if (!plan.started) {
              if (Math.abs(spare.currentTime - (plan.u - plan.pre)) > 0.15) sw.current = null; // zaxira bufer boshqa joyga qaytarilgan (qayta yuklangan) — reja bekor
              else if (t >= plan.t - plan.pre - 0.02) {
                play(spare); // ko'rinmas ijro: almashish paytida dekoder allaqachon ishlab turadi
                plan.started = true;
              }
            } else if (Math.abs(spare.currentTime - plan.u) > 0.2) {
              sw.current = null; // ijro rejadan chiqib ketdi (qotdi) — almashmaydi
              spare.pause();
            } else if (t >= plan.t - SWITCH_LEAD_S) {
              // A yopiq-og'iz kadrda: B (u dan, allaqachon ijro etilmoqda) ko'rinadi — bosh/yuz bir kadrda, tana 200 ms xira
              const old = s.cur;
              s.cur = plan.to;
              frontRef.current = plan.to;
              s.last = s.staged[plan.to];
              sw.current = null;
              endPlan.current = null;
              speakSince.current = now;
              cur.playbackRate = 1;
              setView((st) => ({ ...st, front: plan!.to, prev: null, out: old, fadeMs: SWITCH_FADE_MS, bodyFade: true }));
              startFadeTimer(BODY_FADE_MS + 80);
            }
          } else if (remaining > 5 && spare && spare.readyState >= 3 && !spare.seeking && now - speakSince.current > SWITCH_MIN_DWELL_MS && !exiting.current) {
            const tr = pickTransition(s.staged[s.cur], s.staged[spareLayer], t, SWITCH_MIN_AHEAD_S, SWITCH_MAX_AHEAD_S);
            if (tr) {
              try {
                const pre = Math.min(PRE_ROLL_S, tr.u);
                spare.pause();
                spare.currentTime = tr.u - pre; // zaxira bufer almashish kadridan 0.3 s oldingi joyga suriladi, keyin ko'rinmas ijro etib keladi
                sw.current = { to: spareLayer, t: tr.t, u: tr.u, pre, started: false, at: now };
              } catch {
                /* metadata hali yuklanmagan */
              }
            }
          }
          // 2) ovoz tugashi oldindan ma'lum: og'iz yopiladigan oyna ovoz tugagan paytga to'g'rilanadi
          if (nearEnd && !sw.current) {
            let ep = endPlan.current;
            if (ep && ep.layer !== s.cur) ep = endPlan.current = null;
            if (!ep) {
              const p = planExit(variant.holds, t, Math.max(0.06, remaining - END_LEAD_S), cur.duration);
              if (p) ep = endPlan.current = { layer: s.cur, target: p.target };
            }
            if (ep) {
              if (t >= ep.target - 0.01) {
                if (remaining <= 0.01) {
                  // oxirgi tovush tugadi, lablar yopiq kadrda: darhol kutishga o'tadi (og'iz ovoz bilan birga to'xtaydi)
                  const dbg = (window as unknown as { __avatarDbg?: unknown[] }).__avatarDbg;
                  if (dbg) dbg.push({ ev: "exit", at: now, t, target: ep.target });
                  endPlan.current = null;
                  apply(false, false);
                } else if (remaining <= HOLD_MAX_S) {
                  if (!cur.paused) cur.pause(); // oynada: oxirgi tovush tugaguncha (<=0.12 s) yopiq lablarda kutadi
                } else {
                  endPlan.current = null; // kadrga erta yetdik (ovoz hali bor): TO'XTAMAYDI, davom etadi va keyingi kadr qayta rejalanadi
                  if (cur.paused) play(cur);
                }
              } else {
                const rate = remaining > END_LEAD_S + 0.03 ? Math.min(MAX_TRACK_RATE, Math.max(MIN_TRACK_RATE, (ep.target - t) / (remaining - END_LEAD_S))) : 1;
                if (Math.abs(cur.playbackRate - rate) > 0.02) cur.playbackRate = rate;
              }
            } else if (cur.playbackRate !== 1) cur.playbackRate = 1;
          } else if (!nearEnd) {
            endPlan.current = null;
            if (cur.playbackRate !== 1) cur.playbackRate = 1;
          }
        }
        // variant tugayapti va mos nuqta topilmadi: klipning oxirgi (yopiq-og'iz) oynasiga kirganda keyingi variantning boshiga bir kadrda o'tadi (ikkalasi uy kadrida, og'iz yopiq)
        if (cur && variant && Number.isFinite(cur.duration) && !cur.paused && spare && spare.readyState >= 3 && !sw.current) {
          const last = variant.exits[variant.exits.length - 1];
          const inTail = !!last && last[1] >= cur.duration - 0.05 && cur.currentTime >= last[0] + Math.min(0.06, (last[1] - last[0]) / 2);
          if (inTail || cur.duration - cur.currentTime < CHAIN_LEAD_S / 4) chainNext();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, turnRef, apply, startGreeting, chainNext, resumeSpeaking, startFadeTimer]);

  // Yangi suhbat: salom kutiladi (ovoz kelmasa ham GREET_FALLBACK_MS dan keyin ijro etiladi).
  useEffect(() => {
    if (greetKey === 0) return;
    pendingGreet.current = true;
    window.clearTimeout(timers.current.greet);
    timers.current.greet = window.setTimeout(startGreeting, GREET_FALLBACK_MS);
  }, [greetKey, startGreeting]);

  // Salomning birinchi audiosi keldi: video darhol boshlanadi (ovoz liveAudio da kechiktirilgan — qo'l boshga yetib borguncha jim).
  useEffect(() => {
    if (greetStart === 0) return;
    if (pendingGreet.current) startGreeting();
  }, [greetStart, startGreeting]);

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
            className={`rig-face${view.front === name ? " on" : ""}${view.prev === name ? " prev" : ""}${view.out === name ? " out" : ""}${view.out === name && view.bodyFade ? " bodyfade" : ""}`}
            style={{ transitionDuration: `${view.out === name && view.bodyFade ? BODY_FADE_MS : view.fadeMs}ms` }}
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
