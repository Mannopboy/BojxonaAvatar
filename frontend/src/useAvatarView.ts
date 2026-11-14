// Avatarni joyiga moslash: klaviatura (strelkalar — surish, +/− — zoom) va avtomatik saqlash. Mantiq avatarView.ts da (sof funksiyalar, testlangan).
// Transform to'g'ridan-to'g'ri rig elementining style'iga yoziladi (React qayta chizmaydi: rig'da style prop yo'q, o'lchamni AvatarVideo.fit() beradi) —
// hamma video qatlam (kutish / gapirish a,b / salom / tayyor javob) bitta rig ichida, shuning uchun klip almashganda joy sakramaydi.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { DEFAULT_VIEW, SAVE_DEBOUNCE_MS, STORAGE_KEY, applyAction, isTypingTarget, keyAction, parseView, serializeView, viewTransform, type AvatarView } from "./avatarView";

function load(): AvatarView {
  try {
    return parseView(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_VIEW }; // localStorage yopiq (maxfiy rejim va h.k.) — asl joy
  }
}

export function useAvatarView(rigRef: RefObject<HTMLElement | null>) {
  const view = useRef<AvatarView>({ ...DEFAULT_VIEW });

  // Birinchi kadrdan OLDIN tiklash (useLayoutEffect): avatar avval asl joyda chiqib, keyin sakramasin.
  useLayoutEffect(() => {
    view.current = load();
    if (rigRef.current) rigRef.current.style.transform = viewTransform(view.current);
  }, [rigRef]);

  useEffect(() => {
    let timer = 0;
    let dirty = false;
    const save = () => {
      window.clearTimeout(timer);
      if (!dirty) return;
      dirty = false;
      try {
        localStorage.setItem(STORAGE_KEY, serializeView(view.current));
      } catch {
        /* saqlab bo'lmadi — joy shu sessiya uchun ishlaydi */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault(); // sahifa skroll bo'lmasin, brauzer zoomi ishlamasin
      view.current = applyAction(view.current, action);
      if (rigRef.current) rigRef.current.style.transform = viewTransform(view.current);
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_DEBOUNCE_MS); // oxirgi bosishdan 400 ms keyin bir marta
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", save); // oxirgi bosishdan so'ng 400 ms o'tmay sahifa yopilsa ham saqlanadi
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [rigRef]);
}
