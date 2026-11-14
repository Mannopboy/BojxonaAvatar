// Operator sozlamalarining yagona manbai (surish, zoom, suhbat taymeri): xotirada bitta qiymat, localStorage ga avtomatik saqlanadi (400 ms debounce).
// Kim o'qiydi: useAvatarView (rig transformi), ControlsPanel (o'ng chetdagi panel), App (suhbat taymeri). React holati emas — AvatarVideo qayta chizilmasin
// (klavish ushlab turilganda soniyasiga ~30 marta o'zgaradi).
import { DEFAULT_VIEW, SAVE_DEBOUNCE_MS, STORAGE_KEY, applyAction, parseView, serializeView, type AvatarView, type ViewAction } from "./avatarView";

let view: AvatarView | null = null;
let dirty = false;
let timer = 0;
const subs = new Set<() => void>();

function load(): AvatarView {
  try {
    return parseView(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_VIEW }; // localStorage yopiq (maxfiy rejim va h.k.) — asl joy
  }
}

/** Joriy qiymat (birinchi chaqiruvda saqlangan qiymat o'qiladi). Har o'zgarishda yangi obyekt — useSyncExternalStore uchun mos. */
export function getView(): AvatarView {
  if (!view) view = load();
  return view;
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Saqlashni darhol bajaradi (sahifa yopilayotganda). */
export function flush(): void {
  window.clearTimeout(timer);
  if (!dirty || !view) return;
  dirty = false;
  try {
    localStorage.setItem(STORAGE_KEY, serializeView(view));
  } catch {
    /* saqlab bo'lmadi — qiymat shu sessiya uchun ishlaydi */
  }
}

/** Klavish amalini qo'llaydi, obunachilarga xabar beradi va 400 ms dan keyin saqlaydi. */
export function dispatch(action: ViewAction): AvatarView {
  view = applyAction(getView(), action);
  dirty = true;
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
  subs.forEach((fn) => fn());
  return view;
}
