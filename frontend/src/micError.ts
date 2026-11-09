// Mikrofon ochilmaganda foydalanuvchiga tushunarli (o'zbekcha) xabar.
// Brauzerning xom xabari ("The object can not be found here." — Firefox, mikrofon yo'q) odamga hech narsa demaydi.

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Mikrofon topilmadi. Mikrofonni kompyuterga ulang va qayta urinib ko'ring.";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Mikrofonga ruxsat berilmagan. Brauzer manzil satridagi qulf belgisidan mikrofonga ruxsat bering.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "Mikrofon ochilmadi — uni boshqa dastur band qilgan bo'lishi mumkin. Boshqa dasturni yoping va qayta urinib ko'ring.";
    case "OverconstrainedError":
      return "Mikrofon sozlamalari mos kelmadi. Boshqa mikrofon tanlab ko'ring.";
    case "TypeError":
      // navigator.mediaDevices yo'q: sayt HTTPS orqali ochilmagan yoki brauzer eski
      return "Brauzer mikrofonni ishlata olmadi. Sayt HTTPS orqali ochilganini tekshiring yoki brauzerni yangilang.";
    default:
      return "Mikrofon ochilmadi. Sahifani yangilab, qayta urinib ko'ring.";
  }
}
