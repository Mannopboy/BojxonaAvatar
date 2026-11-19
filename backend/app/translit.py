"""O'zbek kirill -> lotin (faqat QIDIRUV uchun: savol matnlarini bir yozuvga keltirish)."""
_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "'", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "ў": "o'", "қ": "q", "ғ": "g'", "ҳ": "h",
}


def to_latin(text: str) -> str:
    out = []
    for ch in text:
        lo = ch.lower()
        if lo in _MAP:
            r = _MAP[lo]
            out.append(r.capitalize() if ch != lo and r else r)
        else:
            out.append(ch)
    return "".join(out)
