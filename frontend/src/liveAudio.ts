// Gemini Live real-time audio — mikrofon → backend WS → Gemini → audio qaytadi.
// Lip-sync uchun ijro etilayotgan audio balandligini (level 0..1) beradi.

export type LiveState = "connecting" | "listening" | "speaking" | "error" | "stopped";

export interface LiveHandle {
  stop: () => void;
}

export interface LiveOpts {
  onState: (s: LiveState) => void;
  onLevel: (level: number) => void; // 0..1 — avatar og'zi uchun
  onError: (msg: string) => void;
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/live`;
}

export async function startLive(opts: LiveOpts): Promise<LiveHandle> {
  const { onState, onLevel, onError } = opts;
  onState("connecting");

  // --- Playback (Gemini audio: PCM16 24kHz) ---
  const playCtx = new AudioContext();
  const analyser = playCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(playCtx.destination);
  const timeBuf = new Uint8Array(analyser.fftSize);
  let sources: AudioBufferSourceNode[] = [];
  let nextTime = 0;

  function enqueue(int16: Int16Array) {
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = playCtx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const node = playCtx.createBufferSource();
    node.buffer = buf;
    node.connect(analyser);
    const now = playCtx.currentTime;
    if (nextTime < now) nextTime = now + 0.03;
    node.start(nextTime);
    nextTime += buf.duration;
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
  }

  // --- Mikrofon (PCM16, 16kHz ga downsample) ---
  const micCtx = new AudioContext();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const src = micCtx.createMediaStreamSource(stream);
  const proc = micCtx.createScriptProcessor(4096, 1, 1);
  const mute = micCtx.createGain();
  mute.gain.value = 0;

  const ws = new WebSocket(wsUrl());
  ws.binaryType = "arraybuffer";

  proc.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const f32 = e.inputBuffer.getChannelData(0);
    const inRate = micCtx.sampleRate;
    const ratio = inRate / 16000;
    const outLen = Math.floor(f32.length / ratio);
    const i16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, f32[Math.floor(i * ratio)] || 0));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    ws.send(i16.buffer);
  };
  src.connect(proc);
  proc.connect(mute);
  mute.connect(micCtx.destination);

  ws.onopen = () => {
    /* ready kutamiz */
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      enqueue(new Int16Array(ev.data));
    } else {
      try {
        const m = JSON.parse(ev.data as string);
        if (m.type === "ready") onState("listening");
        else if (m.type === "interrupted") flush();
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
    onState(sources.length > 0 || level > 0.02 ? "speaking" : "listening");
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
    onState("stopped");
  };

  return { stop };
}
