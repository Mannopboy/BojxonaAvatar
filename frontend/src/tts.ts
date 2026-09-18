// Ovoz (TTS) — brauzer Web Speech API. Avatar lip-sync `speaking` holatiga bog'lanadi.
// Eslatma: o'zbek ovozi kam — mavjud bo'lmasa yaqin ovozga fallback. Keyin backend
// Gemini TTS bilan almashtirilishi mumkin (ADR-003 / API 03).

let currentUtterance: SpeechSynthesisUtterance | null = null;

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return undefined;
  const want = lang === "ru" ? ["ru"] : ["uz", "ru", "tr"]; // uz yo'q bo'lsa ru/tr
  for (const code of want) {
    const v = voices.find((v) => v.lang.toLowerCase().startsWith(code));
    if (v) return v;
  }
  return voices[0];
}

export function speak(
  text: string,
  lang: string,
  onStart?: () => void,
  onEnd?: () => void
): void {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd?.();
    return;
  }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.lang = v?.lang || (lang === "ru" ? "ru-RU" : "uz-UZ");
  u.rate = 0.98;
  u.pitch = 1.0;
  u.onstart = () => onStart?.();
  u.onend = () => {
    currentUtterance = null;
    onEnd?.();
  };
  u.onerror = () => {
    currentUtterance = null;
    onEnd?.();
  };
  currentUtterance = u;
  synth.speak(u);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
  currentUtterance = null;
}

// Ovozlar asinxron yuklanadi — oldindan chaqiramiz.
export function warmupVoices(): void {
  window.speechSynthesis?.getVoices();
}
