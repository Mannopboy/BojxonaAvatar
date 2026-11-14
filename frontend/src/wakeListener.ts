// Kutish rejimi: sahifa ochiq turganda mikrofon mahalliy tinglanadi (hech narsa serverga yuborilmaydi). Yo'lovchi gapirsa — birinchi gap (16 kHz PCM16) onSpeech ga beriladi;
// chaqiruvchi suhbatni boshlaydi (WebSocket ochiladi, gap backendga yuboriladi: salom bo'lsa avatar suhbatni boshlaydi). Gap qaysi tilda ekanini va salom/savol/shovqin ekanini backend LLM aniqlaydi.
import { createWakeVad } from "./wakeVad";

export interface WakeHandle {
  stop: () => void;
  /** AudioContext hali "suspended" (brauzer sahifa bosilmaguncha ovozni yoqmaydi) — kioskda `--autoplay-policy=no-user-gesture-required` bilan bo'lmaydi */
  suspended: () => boolean;
}

export interface WakeOpts {
  onSpeech: (pcm16k: Int16Array) => void;
  /** AudioContext holati o'zgarsa (suspended <-> running): UI «sahifani bosing» yozuvini ko'rsatadi */
  onSuspendedChange?: (suspended: boolean) => void;
  onLevel?: (rms: number) => void;
}

const TARGET_RATE = 16000;

export async function startWakeListener(opts: WakeOpts): Promise<WakeHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const vad = createWakeVad();
  let stopped = false;

  proc.onaudioprocess = (e) => {
    if (stopped) return;
    const f32 = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
    const rms = Math.sqrt(sum / f32.length);
    opts.onLevel?.(rms);
    // 16 kHz ga tushirish: har chiqish namunasi — mos oynadagi o'rtacha (oddiy past chastota filtri, takrorlanish buzilishi kam)
    const ratio = ctx.sampleRate / TARGET_RATE;
    const outLen = Math.floor(f32.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.max(a + 1, Math.min(f32.length, Math.floor((i + 1) * ratio)));
      let s = 0;
      for (let j = a; j < b; j++) s += f32[j];
      const v = Math.max(-1, Math.min(1, s / (b - a)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const speech = vad.push(rms, f32.length / ctx.sampleRate, out);
    if (speech) opts.onSpeech(speech);
  };
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  // Brauzer sahifa bosilmaguncha AudioContext ni "suspended" qoldirishi mumkin: darhol urinib ko'ramiz, bo'lmasa istalgan bosish/klavish yoqadi.
  const wake = () => {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  };
  const onState = () => opts.onSuspendedChange?.(ctx.state === "suspended");
  ctx.addEventListener("statechange", onState);
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  wake();
  onState();

  return {
    suspended: () => ctx.state === "suspended",
    stop: () => {
      if (stopped) return;
      stopped = true;
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      ctx.removeEventListener("statechange", onState);
      try {
        proc.disconnect();
        src.disconnect();
        mute.disconnect();
      } catch {
        /* allaqachon uzilgan */
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}
