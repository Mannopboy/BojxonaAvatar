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
}
export const newTurnInfo = (): TurnInfo => ({ active: false, done: false, remaining: 0, audibleRemaining: 0 });

export interface LiveHandle {
  stop: () => void;
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
}

const PLAY_RATE = 1; // ijro tezligi (1 = asl)

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/live`;
}

export async function startLive(opts: LiveOpts): Promise<LiveHandle> {
  const { onState, onLevel, onError, onGreetAudio, greetDelayS = 0, turnRef } = opts;
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
  let greeted = false; // birinchi audio keldimi (salom)
  let turnDone = false; // turn_complete keldi (ijro hali davom etayotgan bo'lishi mumkin)
  let lastAudioAt = 0;
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
      if (!greeted) {
        greeted = true;
        nextTime = playCtx.currentTime + greetDelayS; // salom ovozi kechiktiriladi (video shu paytda boshlanadi)
        onGreetAudio?.();
        (window as unknown as { __avatarDbg?: unknown[] }).__avatarDbg?.push({ ev: "latency", outputLatency: playCtx.outputLatency, baseLatency: playCtx.baseLatency });
      }
      turnDone = false;
      lastAudioAt = performance.now() / 1000;
      if (turnRef) {
        turnRef.current.active = true;
        turnRef.current.done = false;
      }
      enqueue(new Int16Array(ev.data));
    } else {
      try {
        const m = JSON.parse(ev.data as string);
        if (m.type === "ready") onState("listening");
        else if (m.type === "interrupted") flush();
        else if (m.type === "turn_complete") {
          turnDone = true;
          if (turnRef) turnRef.current.done = true;
          // audio ijrosi tugagach + qisqa pauza (ovoz aks-sadosi mikrofonga tushmasin) mikrofon ochiladi
          const wait = Math.max(0, nextTime - playCtx.currentTime) + 0.8;
          busyUntil = performance.now() / 1000 + wait;
        }
        else if (m.type === "error") onError(m.msg || "xato");
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
    avatarSpeaking = sources.length > 0;
    if (turnRef?.current.active) {
      const t = performance.now() / 1000;
      turnRef.current.remaining = Math.max(0, nextTime - playCtx.currentTime);
      const outLat = Math.min(0.25, playCtx.outputLatency || playCtx.baseLatency || 0); // eshitilgan payt = rejalangan payt + qurilma kechikishi
      turnRef.current.audibleRemaining = Math.max(0, audibleEnd + outLat - playCtx.currentTime);
      const drained = sources.length === 0 && nextTime <= playCtx.currentTime; // hamma kelgan audio chalib bo'lindi
      // javob tugadi (turn_complete + hamma audio chalindi) yoki audio kelmay qoldi va chalinadigani ham yo'q (xavfsizlik) — og'iz endi ovoz bo'yicha boshqariladi
      if (drained && (turnDone || t - lastAudioAt > 6)) {
        turnRef.current.active = false;
        turnRef.current.remaining = 0;
        turnRef.current.audibleRemaining = 0;
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

  return { stop };
}
