// Gemini Live real-time audio — mikrofon → backend WS → Gemini → audio qaytadi.
// Lip-sync uchun ijro etilayotgan audio balandligini (level 0..1) beradi.

export type LiveState = "connecting" | "listening" | "speaking" | "error" | "stopped";

/** Javob (turn) holati: avatar videosi ovoz tugashini OLDINDAN biladi (TTS audiosi tez keladi, hamma audio chalinadiganlar navbatda). */
export interface TurnInfo {
  /** audio kelgan paytdan to turn_complete va hamma audio chalinguncha */
  active: boolean;
  /** turn_complete keldi: bu javobda boshqa audio kelmaydi */
  done: boolean;
  /** navbatdagi audio yana shuncha soniya chalinadi (oxiridagi jimlik bilan) */
  remaining: number;
  /** oxirgi ESHITILADIGAN tovush tugashiga shuncha soniya qoldi (oxiridagi jimliksiz; chiqish qurilmasi kechikishi hisobga olingan) */
  audibleRemaining: number;
  /** kelgusi ovoz pauzalari (>= 0.2 s jim, ichida/oldinda): in — pauza boshlanishiga soniya (<= 0: pauza davom etyapti), len — pauza uzunligi */
  pausesAhead: { in: number; len: number }[];
}
export const newTurnInfo = (): TurnInfo => ({ active: false, done: false, remaining: 0, audibleRemaining: 0, pausesAhead: [] });

export interface LiveHandle {
  stop: () => void;
  /** tayyor javob klipi (video o'z ovozi bilan) ijrosi tugadi — mikrofon qayta ochiladi */
  clipEnded: () => void;
}

export interface LiveOpts {
  onState: (s: LiveState) => void;
  onLevel: (level: number) => void; // 0..1 — avatar og'zi uchun
  onError: (msg: string) => void;
  /** birinchi (salom) audio kelganda — salom videosi shu paytda boshlanadi; audio esa greetDelayS dan keyin chalinadi */
  onGreetAudio?: () => void;
  /** salom audiosi qancha kechiktiriladi (soniya): salom videosida qo'l boshga yetib borguncha ovoz bo'lmasin */
  greetDelayS?: number;
  /** javob davomida true: audio kelgan paytdan to turn_complete va ijro tugaguncha — jumlalar orasidagi pauzada og'iz yopilib-ochilmasin */
  turnRef?: { current: TurnInfo };
  /** backend tayyor javob klipini tanladi (lab harakati o'z ovoziga mos video): pleyer uni ijro etadi, WS orqali audio kelmaydi */
  onClip?: (id: string) => void;
  /** suhbat boshida: mavjud tayyor javob kliplari (oldindan yuklash uchun) */
  onClips?: (ids: string[]) => void;
}

const PLAY_RATE = 1; // ijro tezligi (1 = asl)

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/live`;
}

export async function startLive(opts: LiveOpts): Promise<LiveHandle> {
  const { onState, onLevel, onError, onGreetAudio, greetDelayS = 0, turnRef, onClip, onClips } = opts;
  onState("connecting");

  // --- Playback (Gemini audio: PCM16 24kHz) ---
  const playCtx = new AudioContext();
  const analyser = playCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(playCtx.destination);
  const timeBuf = new Uint8Array(analyser.fftSize);
  let sources: AudioBufferSourceNode[] = [];
  let nextTime = 0;
  let busy = true; // javob (yoki boshlang'ich salom) tugamaguncha mikrofon VAD yopiq — ikki ovoz aralashmasin
  let busyUntil = performance.now() / 1000 + 15; // xavfsizlik: turn_complete kelmasa ham 15s dan keyin ochiladi
  let avatarSpeaking = false; // avatar gapirayotganda mikrofon VAD o'chiriladi (echo oldini olish)
  // Ijro boshlanishidan oldin shuncha audio to'planadi (yoki javob to'liq kelguncha / shuncha vaqt o'tguncha). Gemini Live audioni REAL VAQTDA beradi (oldinda atigi ~0.5 s):
  // bufersiz ovoz tugashi va pauzalar oldindan ma'lum bo'lmaydi — og'izni ovozga to'g'rilab bo'lmaydi (gap tugagach ham qimirlab turadi). TTS da audio tez keladi (~0.5 s qo'shimcha).
  const LOOKAHEAD_S = 2.0;
  let pend: Int16Array[] = [];
  let pendDur = 0;
  let pendTimer = 0;
  let turnPlaying = false; // joriy javobning ijrosi boshlandi
  let pendSince = 0;
  const FAST_WAIT_MS = 1200;
  let clipBusy = false; // tayyor javob klipi ijro etilyapti (mikrofon yopiq)
  let greeted = false; // birinchi audio keldimi (salom)
  let turnDone = false; // turn_complete keldi (ijro hali davom etayotgan bo'lishi mumkin)
  let lastAudioAt = 0;
  const pauses: { start: number; end: number }[] = []; // AudioContext vaqtida ovoz pauzalari (javob davomida jimlik >= 0.2 s)
  let silStart: number | null = null;
  let seenSound = false;
  let audibleEnd = 0; // AudioContext vaqtida: oxirgi eshitiladigan tovush tugaydigan payt (jimlik hisobga olinmaydi)

  function enqueue(int16: Int16Array) {
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = playCtx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const node = playCtx.createBufferSource();
    node.buffer = buf;
    node.connect(analyser);
    const now = playCtx.currentTime;
    // jitter buffer: javob boshida (yoki uzilishdan keyin) biroz oldindan to'plab, so'ng uzluksiz ijro
    if (nextTime < now) nextTime = now + 0.25;
    node.start(nextTime);
    // chunk ichidagi oxirgi eshitiladigan blok (10 ms, RMS >= 0.012): og'iz shu paytga yopilishi kerak (TTS audiosi oxirida ~0.2-0.3 s jimlik bor)
    for (let b = Math.floor(f32.length / 240) - 1; b >= 0; b--) {
      let sq = 0;
      for (let i = b * 240; i < (b + 1) * 240; i++) sq += f32[i] * f32[i];
      if (Math.sqrt(sq / 240) >= 0.012) {
        audibleEnd = Math.max(audibleEnd, nextTime + ((b + 1) * 240) / 24000 / PLAY_RATE);
        break;
      }
    }
    // pauzalar: 10 ms bloklar, RMS < 0.006 — jim. Javob boshidagi jimlik pauza emas (ovoz eshitilgandan keyingi jimlik >= 0.2 s)
    for (let b = 0; b < Math.floor(f32.length / 240); b++) {
      let sq = 0;
      for (let i = b * 240; i < (b + 1) * 240; i++) sq += f32[i] * f32[i];
      const bt = nextTime + (b * 240) / 24000 / PLAY_RATE;
      if (Math.sqrt(sq / 240) < 0.006) {
        if (silStart === null) silStart = bt;
      } else {
        if (silStart !== null && seenSound && bt - silStart >= 0.2) pauses.push({ start: silStart, end: bt });
        silStart = null;
        seenSound = true;
      }
    }
    nextTime += buf.duration / PLAY_RATE;
    node.onended = () => {
      sources = sources.filter((s) => s !== node);
    };
    sources.push(node);
  }

  function flush() {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    sources = [];
    nextTime = 0;
    audibleEnd = 0;
    pend = [];
    pendDur = 0;
    turnPlaying = false;
    window.clearTimeout(pendTimer);
    pauses.length = 0;
    silStart = null;
    seenSound = false;
  }

  function startTurnPlayback() {
    if (turnPlaying) return;
    turnPlaying = true;
    window.clearTimeout(pendTimer);
    if (!greeted) {
      greeted = true;
      nextTime = playCtx.currentTime + greetDelayS; // salom ovozi kechiktiriladi (video shu paytda boshlanadi)
      onGreetAudio?.();
      (window as unknown as { __avatarDbg?: unknown[] }).__avatarDbg?.push({ ev: "latency", outputLatency: playCtx.outputLatency, baseLatency: playCtx.baseLatency });
    } else nextTime = playCtx.currentTime + 0.05;
    const q = pend;
    pend = [];
    pendDur = 0;
    for (const c of q) enqueue(c);
  }

  /** Kelgan audio: javob boshida LOOKAHEAD_S to'planadi, keyin uzluksiz ijro. */
  function receive(int16: Int16Array) {
    if (turnPlaying) {
      enqueue(int16);
      return;
    }
    pend.push(int16);
    pendDur += int16.length / 24000;
    if (pend.length === 1) {
      pendSince = performance.now();
      pendTimer = window.setTimeout(startTurnPlayback, LOOKAHEAD_S * 1000);
    }
    // audio real vaqtdan tez kelyapti (TTS): javob to'liq kelishini (turn_complete) FAST_WAIT_MS gacha kutadi — qisqa javobda ovoz tugashi kirish paytidayoq ma'lum bo'ladi
    if (pendDur >= LOOKAHEAD_S && performance.now() - pendSince >= FAST_WAIT_MS) startTurnPlayback();
  }

  // --- Mikrofon (PCM16, 16kHz ga downsample) ---
  const micCtx = new AudioContext();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    // Mikrofon yo'q/ruxsat berilmagan: ochilgan audio kontekstlarni yopamiz, aks holda har qayta urinishda
    // 2 tadan to'planib, brauzer chegarasiga (~6) yetadi va keyin mikrofon ulansa ham ishlamay qoladi
    void micCtx.close().catch(() => {});
    void playCtx.close().catch(() => {});
    throw e;
  }
  const src = micCtx.createMediaStreamSource(stream);
  const proc = micCtx.createScriptProcessor(4096, 1, 1);
  const mute = micCtx.createGain();
  mute.gain.value = 0;

  const ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";

  // --- Client-side VAD: gapirish boshi/oxirini aniqlab activity_start/end yuboradi ---
  let talking = false;
  let lastVoice = 0;
  const START_RMS = 0.02; // gapirish boshlanishi (fon shovqinидan yuqori)
  const HANG_SEC = 1.3; // shuncha sukunatdan keyin "gapirib bo'ldi" (pauzada gapni kesmaslik uchun)

  proc.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const f32 = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
    const rms = Math.sqrt(sum / f32.length);
    const now = performance.now() / 1000;

    // Avatar gapirayotganda foydalanuvchi ovozini e'tiborsiz qoldiramiz (o'zini bo'lmasin)
    if (avatarSpeaking || (busy && now < busyUntil)) {
      if (talking) {
        talking = false;
        try { ws.send(JSON.stringify({ type: "activity_end" })); } catch { /* */ }
      }
      return;
    }

    if (rms > START_RMS) {
      if (!talking) {
        talking = true;
        try { ws.send(JSON.stringify({ type: "activity_start" })); } catch { /* */ }
      }
      lastVoice = now;
    }

    if (talking) {
      const ratio = micCtx.sampleRate / 16000;
      const outLen = Math.floor(f32.length / ratio);
      const i16 = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, f32[Math.floor(i * ratio)] || 0));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      ws.send(i16.buffer);
      if (now - lastVoice > HANG_SEC) {
        talking = false;
        try { ws.send(JSON.stringify({ type: "activity_end" })); } catch { /* */ }
      }
    }
  };
  src.connect(proc);
  proc.connect(mute);
  mute.connect(micCtx.destination);

  ws.onopen = () => {
    /* ready kutamiz */
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      if (turnRef && !turnRef.current.active) {
        pauses.length = 0; // yangi javob: pauza kuzatuvi boshidan
        silStart = null;
        seenSound = false;
      }
      turnDone = false;
      lastAudioAt = performance.now() / 1000;
      if (turnRef) {
        turnRef.current.active = true;
        turnRef.current.done = false;
      }
      receive(new Int16Array(ev.data));
    } else {
      try {
        const m = JSON.parse(ev.data as string);
        if (m.type === "ready") {
          onState("listening");
          if (Array.isArray(m.clips)) onClips?.(m.clips as string[]);
        } else if (m.type === "clip") {
          clipBusy = true; // klip tugaguncha mikrofon yopiq (clipEnded)
          onClip?.(String(m.id));
        }
        else if (m.type === "interrupted") flush();
        else if (m.type === "turn_complete") {
          turnDone = true;
          if (pend.length && !turnPlaying) startTurnPlayback(); // javob to'liq keldi: kutmasdan ijro
          if (turnRef) turnRef.current.done = true;
          // audio ijrosi tugagach + qisqa pauza (ovoz aks-sadosi mikrofonga tushmasin) mikrofon ochiladi
          const wait = Math.max(0, nextTime - playCtx.currentTime) + 0.8;
          busyUntil = performance.now() / 1000 + wait;
        }
        else if (m.type === "error") {
          (window as unknown as { __avatarDbg?: unknown[] }).__avatarDbg?.push({ ev: "ws-error", msg: m.msg });
          onError(m.msg || "xato");
        }
      } catch {
        /* ignore */
      }
    }
  };
  ws.onerror = () => onError("WebSocket xatosi");
  ws.onclose = () => onState("stopped");

  // --- Level loop (lip-sync) ---
  let raf = 0;
  function loop() {
    analyser.getByteTimeDomainData(timeBuf);
    let sum = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = (timeBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeBuf.length);
    const level = Math.min(1, rms * 3.2); // kuchaytirish
    onLevel(level);
    avatarSpeaking = sources.length > 0 || pend.length > 0 || clipBusy;
    if (turnRef?.current.active) {
      const t = performance.now() / 1000;
      turnRef.current.remaining = Math.max(0, nextTime - playCtx.currentTime);
      const outLat = Math.min(0.25, playCtx.outputLatency || playCtx.baseLatency || 0); // eshitilgan payt = rejalangan payt + qurilma kechikishi
      turnRef.current.audibleRemaining = Math.max(0, audibleEnd + outLat - playCtx.currentTime);
      const ct = playCtx.currentTime;
      while (pauses.length && pauses[0].end + outLat < ct - 1) pauses.shift();
      turnRef.current.pausesAhead = pauses.filter((p) => p.end + outLat > ct).slice(0, 6).map((p) => ({ in: p.start + outLat - ct, len: p.end - p.start }));
      const drained = sources.length === 0 && pend.length === 0 && nextTime <= playCtx.currentTime; // hamma kelgan audio chalib bo'lindi
      // javob tugadi (turn_complete + hamma audio chalindi) yoki audio kelmay qoldi va chalinadigani ham yo'q (xavfsizlik) — og'iz endi ovoz bo'yicha boshqariladi
      if (drained && (turnDone || t - lastAudioAt > 6)) {
        turnRef.current.active = false;
        turnPlaying = false; // keyingi javob yana oldindan to'planadi
        turnRef.current.remaining = 0;
        turnRef.current.audibleRemaining = 0;
        turnRef.current.pausesAhead = [];
      }
    }
    onState(avatarSpeaking || level > 0.02 ? "speaking" : "listening");
    raf = requestAnimationFrame(loop);
  }
  await playCtx.resume();
  await micCtx.resume();
  loop();

  const stop = () => {
    cancelAnimationFrame(raf);
    flush();
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    micCtx.close().catch(() => {});
    playCtx.close().catch(() => {});
    onLevel(0);
    if (turnRef) turnRef.current = newTurnInfo();
    onState("stopped");
  };

  const clipEnded = () => {
    clipBusy = false;
    busyUntil = performance.now() / 1000 + 0.8; // ovoz aks-sadosi mikrofonga tushmasin
  };

  return { stop, clipEnded };
}
