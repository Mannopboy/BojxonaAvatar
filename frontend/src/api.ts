// Backend API klient — barcha AI chaqiruv backend orqali (ADR-003).
const BASE = (import.meta.env.VITE_BACKEND_URL as string) || "/api";

export interface Source {
  title: string;
  url: string;
}

export interface AskResponse {
  answer: string;
  source_type: "faq" | "web" | "redirect";
  sources: Source[];
  faq_id: number | null;
  grounded: boolean;
  lang: string;
  disclaimer: string;
}

export interface FaqItem {
  id: number;
  question: string;
  answer: string;
  lang: string;
}

export async function getFaq(): Promise<FaqItem[]> {
  const r = await fetch(`${BASE}/faq`);
  if (!r.ok) throw new Error("faq yuklanmadi");
  const d = await r.json();
  return d.items as FaqItem[];
}

export async function ask(
  question: string,
  lang = "uz",
  sessionId = ""
): Promise<AskResponse> {
  const r = await fetch(`${BASE}/avatar/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, lang, session_id: sessionId }),
  });
  if (!r.ok) throw new Error(`server xatosi: ${r.status}`);
  return (await r.json()) as AskResponse;
}
