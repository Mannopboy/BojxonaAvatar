"""Bilim bazasi seed — docx'dagi 3 asosiy savol.

Manba: САВОЛ ВА ЖАВОБ БОЖХОНАГА ОИД.docx
Obsidian: 03 - Database (Baza)/01 - faq_items (Bilim bazasi - 3 savol).md
"""
from .db import Base, SessionLocal, engine
from .models import FaqItem

FAQ_SEED = [
    {
        "id": 1,
        "question": "Men o'zim bilan qancha AQSh dollari ekvivalenti miqdoridagi tovarlarni bojsiz olib kirishim mumkin?",
        "answer": (
            "Hurmatli yo'lovchi!\n"
            "Agar Siz respublikamizga:\n"
            "• xalqaro aeroportlar orqali kirib kelayotgan bo'lsangiz — 1 000 AQSh dollari;\n"
            "• temir yo'l va daryo o'tkazish punktlari orqali — 500 AQSh dollari;\n"
            "• avtomobilda yoki piyoda — 300 AQSh dollari\n"
            "ekvivalenti miqdoridagi tovarlarni bojsiz olib kirishingiz mumkin."
        ),
        "keywords": ["boj", "bojsiz", "limit", "tovar", "aeroport", "temir yo'l",
                     "daryo", "avtomobil", "piyoda", "olib kir", "necha dollar", "qancha dollar"],
    },
    {
        "id": 2,
        "question": ("Yuridik va jismoniy shaxslar uchun xalqaro pochta va kuryerlik jo'natmalari "
                     "orqali qancha AQSh dollariga teng tovarlardan bojxona to'lovlari undirilmaydi?"),
        "answer": (
            "Hurmatli yo'lovchi!\n"
            "• Xalqaro pochta va kuryerlik jo'natmalari orqali O'zbekiston Respublikasi hududiga "
            "yuridik shaxslar nomiga kelayotgan qiymati 100 (yuz) AQSh dollariga teng bo'lgan "
            "tovarlardan bojxona to'lovlari undirilmaydi.\n"
            "• Xalqaro kuryerlik jo'natmalari orqali jismoniy shaxslar nomiga kelayotgan "
            "tovarlarning boj undirilmaydigan miqdori bir kalendar oyda 200 (ikki yuz) AQSh "
            "dollarini tashkil qiladi."
        ),
        "keywords": ["pochta", "kuryer", "jo'natma", "yuridik shaxs", "jismoniy shaxs",
                     "posilka", "jonatma", "100 dollar", "200 dollar"],
    },
    {
        "id": 3,
        "question": "Valyuta olib kirish va olib chiqish miqdori qancha?",
        "answer": (
            "Hurmatli yo'lovchi!\n"
            "• Olib kirish: O'zbekiston hududiga jismoniy shaxslar tomonidan naqd xorijiy "
            "valyutani olib kirish cheklanmagan. Ammo ekvivalenti 100 million so'mdan oshsa, "
            "uni yo'lovchi bojxona deklaratsiyasida ko'rsatishi majburiy.\n"
            "• Olib chiqish: jismoniy shaxslar ekvivalenti 100 million so'mgacha bo'lgan naqd "
            "valyutani hech qanday hujjatsiz olib chiqishlari mumkin. Bu summadan ortig'ini olib "
            "chiqish uchun tegishli ruxsatnoma yoki deklaratsiya talab etiladi."
        ),
        "keywords": ["valyuta", "naqd pul", "olib kir", "olib chiq", "deklaratsiya",
                     "million so'm", "dollar olib", "pul olib", "ruxsatnoma"],
    },
]


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for item in FAQ_SEED:
            existing = db.get(FaqItem, item["id"])
            if existing:
                existing.question = item["question"]
                existing.answer = item["answer"]
                existing.keywords = item["keywords"]
            else:
                db.add(FaqItem(
                    id=item["id"], question=item["question"], answer=item["answer"],
                    keywords=item["keywords"], source="docx", lang="uz",
                ))
        db.commit()
        print(f"Seed OK — {len(FAQ_SEED)} ta FAQ.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
