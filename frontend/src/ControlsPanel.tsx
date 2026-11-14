// Klavishlar paneli (o'ng chet, doim ko'rinadi): qaysi tugma qaysi funksiyani bajarishini ko'rsatadi — AI maslahatchi kioskidagi panel usulida
// (Obsidian spec «Avatar surish va zoom → Klavishlar paneli», Q2 = B). Faqat BojxonaAvatar klavishlari: surish, zoom, suhbat taymeri (joriy qiymat jonli).
// pointer-events: none — sichqoncha/klavish ishiga xalaqit bermaydi; avatar ustida (sahnaga to'liq balandlikda), W/S/A/D, R, Ctrl+R qatorlari yo'q.
import { useSyncExternalStore } from "react";
import { endLabel } from "./avatarView";
import { getView, subscribe } from "./avatarViewStore";

export function ControlsPanel() {
  const v = useSyncExternalStore(subscribe, getView);
  return (
    <aside className="controls-panel" aria-label="Klavishlar">
      <div className="cp-title">BOSHQARUV</div>
      <div className="cp-row">
        <div className="cp-keys cp-dpad">
          <kbd>↑</kbd>
          <div>
            <kbd>←</kbd>
            <kbd>↓</kbd>
            <kbd>→</kbd>
          </div>
        </div>
        <div className="cp-label">Surish</div>
      </div>
      <div className="cp-row">
        <div className="cp-keys">
          <kbd>+</kbd>
          <kbd>−</kbd>
        </div>
        <div className="cp-label">Zoom</div>
      </div>
      <div className="cp-row">
        <div className="cp-keys">
          <kbd>[</kbd>
          <kbd>]</kbd>
        </div>
        <div className="cp-label">Suhbat taymeri</div>
        <div className="cp-value" data-testid="end-value">
          {endLabel(v.endSec)}
        </div>
      </div>
      <div className="cp-hint">O'zgarishlar avtomatik saqlanadi</div>
    </aside>
  );
}
