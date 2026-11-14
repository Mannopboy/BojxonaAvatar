// Operator sozlamalari: klaviatura (strelkalar — surish, +/− — zoom, [ ] — suhbat taymeri) va avtomatik saqlash. Mantiq avatarView.ts da (sof funksiyalar, testlangan),
// qiymat avatarViewStore.ts da. Bu hook rig transformini qo'llaydi va klavishlarni ushlaydi.
// Transform to'g'ridan-to'g'ri rig elementining style'iga yoziladi (React qayta chizmaydi: rig'da style prop yo'q, o'lchamni AvatarVideo.fit() beradi) —
// hamma video qatlam (kutish / gapirish a,b / salom / tayyor javob) bitta rig ichida, shuning uchun klip almashganda joy sakramaydi.
import { useEffect, useLayoutEffect, type RefObject } from "react";
import { isTypingTarget, keyAction, viewTransform } from "./avatarView";
import { dispatch, flush, getView, subscribe } from "./avatarViewStore";

export function useAvatarView(rigRef: RefObject<HTMLElement | null>) {
  // Birinchi kadrdan OLDIN tiklash (useLayoutEffect): avatar avval asl joyda chiqib, keyin sakramasin.
  useLayoutEffect(() => {
    const apply = () => {
      if (rigRef.current) rigRef.current.style.transform = viewTransform(getView());
    };
    apply();
    return subscribe(apply);
  }, [rigRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault(); // sahifa skroll bo'lmasin, brauzer zoomi ishlamasin
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", flush); // oxirgi bosishdan so'ng 400 ms o'tmay sahifa yopilsa ham saqlanadi
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
}
