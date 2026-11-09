#!/usr/bin/env python3
"""Asl (start) kadrdan odam konturi (matte) yasaydi — SOCH ham kiradi. build-avatar-clips.py shu kontur bo'yicha fonni almashtiradi.

Nega kerak: fonni rangi bo'yicha qoraytirish (yorqinlik/rang chegarasi) qop-qora sochni ham fon bilan bir xil qilib, soch "yo'qolib",
bosh kal ko'rinadi. Kontur esa sochni rangiga qarab emas, "odam" deb ajratadi.

  python scripts/make-avatar-matte.py <start-kadr.png> <kontur.png> [model]

Kerak: python3, opencv-python, rembg, onnxruntime, pymatting. Model (standart isnet-general-use) birinchi ishga tushganda yuklab olinadi.
"""
import sys

import cv2
from rembg import new_session, remove

if len(sys.argv) < 3:
    sys.exit(__doc__)
src = cv2.imread(sys.argv[1])
h, w = src.shape[:2]
# alpha matting 4 MP da juda og'ir: yarim o'lchamda hisoblab, keyin kattalashtiramiz
half = cv2.resize(src, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
mask = remove(
    cv2.cvtColor(half, cv2.COLOR_BGR2RGB),
    session=new_session(sys.argv[3] if len(sys.argv) > 3 else "isnet-general-use"),
    only_mask=True,
    alpha_matting=True,
    alpha_matting_foreground_threshold=235,
    alpha_matting_background_threshold=12,
    alpha_matting_erode_size=8,
)
cv2.imwrite(sys.argv[2], cv2.resize(mask, (w, h), interpolation=cv2.INTER_CUBIC))
print("kontur yozildi:", sys.argv[2])
