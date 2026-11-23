// Bilim bazasi admin API (backend: app/kb_admin.py). Kalit X-Admin-Key sarlavhasida; faqat shu brauzer oynasida (sessionStorage) saqlanadi.

export interface KbItem {
  uid: number;
  id: string;
  q: string;
  quz: string;
  s: string;
  active: boolean;
  manual_s: boolean;
  langs: number;
  has_emb: boolean;
  a_short?: string;
  a?: string;
  t?: Record<string, string>;
}

export interface KbStats {
  total: number;
  active: number;
  ready: number;
  langs: number;
}

export interface KbList {
  total: number;
  offset: number;
  limit: number;
  items: KbItem[];
  stats: KbStats;
}

export interface KbInput {
  q: string;
  a: string;
  s: string;
  auto_s: boolean;
  active: boolean;
}

export interface KbTestResult {
  lang: string;
  quz: string;
  answer: string;
  source: string;
  ms: number;
  hits: { score: number; uid: number; q: string; ready: boolean }[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KEY_STORE = "kb-admin-key";
const BASE = "/api/admin/kb";

export const getKey = (): string => sessionStorage.getItem(KEY_STORE) || "";
export const setKey = (k: string): void => sessionStorage.setItem(KEY_STORE, k);
export const clearKey = (): void => sessionStorage.removeItem(KEY_STORE);

async function call<T>(path: string, init: RequestInit = {}, key = getKey()): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "X-Admin-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    });
  } catch {
    throw new ApiError(0, "Serverga ulanib bo'lmadi. Internetni tekshiring.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? "Maydonlar noto'g'ri to'ldirilgan (savol va javob kamida 3 belgi)." : "";
    } catch {
      /* JSON emas */
    }
    throw new ApiError(res.status, detail || `Xato (${res.status})`);
  }
  return (await res.json()) as T;
}

export const ping = (key: string) => call<KbStats & { ok: boolean }>("/ping", {}, key);

export const list = (p: { search: string; filter: string; offset: number; limit: number }) =>
  call<KbList>(`?search=${encodeURIComponent(p.search)}&filter=${p.filter}&offset=${p.offset}&limit=${p.limit}`);

export const getRow = (uid: number) => call<KbItem>(`/${uid}`);
export const createRow = (body: KbInput) => call<KbItem>("", { method: "POST", body: JSON.stringify(body) });
export const updateRow = (uid: number, body: KbInput) => call<KbItem>(`/${uid}`, { method: "PUT", body: JSON.stringify(body) });
export const deleteRow = (uid: number) => call<{ ok: boolean }>(`/${uid}`, { method: "DELETE" });
export const testQuestion = (q: string) => call<KbTestResult>("/test", { method: "POST", body: JSON.stringify({ q }) });

export async function downloadExport(): Promise<void> {
  const res = await fetch(BASE + "/export", { headers: { "X-Admin-Key": getKey() } });
  if (!res.ok) throw new ApiError(res.status, `Eksport xatosi (${res.status})`);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "bilim-bazasi.json";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
