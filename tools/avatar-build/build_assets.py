"""Qabul qilingan xom klipalardan sayt fayllari (work/higgsfield/v7/out/):

  python build_assets.py idle=<gen/idle_a.mp4>:24:120 greeting=<gen/greeting_a.mp4> speak=<gen/speak_01.mp4> speak=<gen/speak_02.mp4> ...

idle: berilgan kadr oralig'i (etalon, moslashsiz). greeting, speak: butun klip, doimiy afin moslash (align.py) bilan.
Natija: idle.mp4, greeting.mp4, speaking-01.mp4 ... va avatarClips.json (variants: file, duration, exits).
"""
import json, os, subprocess, sys
import cv2
import numpy as np
import align as A
import exits as E

FF = "C:/av/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
ENC = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-g", "24", "-movflags", "+faststart", "-r", "24"]


def encode(frames, dst, crf="18"):
    h, w = frames[0].shape[:2]
    p = subprocess.Popen([FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", "24", "-i", "-"] + ENC[:ENC.index("-crf") + 1] + [crf] + ENC[ENC.index("-crf") + 2:] + [dst], stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    if p.wait():
        raise SystemExit("ffmpeg xatosi: " + dst)



FACE = (110, 260, 290, 430)   # tiniqlik o'lchanadigan hudud (ko'z..iyak), 720x1280


def _lapvar(frames, box):
    import numpy as np
    y0, y1, x0, x1 = box
    return float(np.median([cv2.Laplacian(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1].astype(np.float32), cv2.CV_32F).var() for f in frames[::3]]))


def tone_match(frames, ref_frames):
    """Klipning yorqinlik taqsimotini kutish klipiga moslaydi (Y kanalida gistogramma moslash; rang o'zgarmaydi). Foydalanuvchi: kutish tiniq,
    gapirish xira — AI klipni boshqacha ekspozitsiyada chizadi (shapka ~8% qoraroq)."""
    def luma(fr):
        ys = np.concatenate([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[::2, ::2].ravel() for f in fr[::4]])
        return ys[ys > 20]
    a, b = luma(frames), luma(ref_frames)
    ca = np.cumsum(np.bincount(a, minlength=256)) / len(a)
    cb = np.cumsum(np.bincount(b, minlength=256)) / len(b)
    lut = np.zeros(256, np.uint8)
    for v in range(256):
        lut[v] = int(np.searchsorted(cb, ca[v]).clip(0, 255)) if v > 20 else v
    # 20 dan past (fon) o'zgarmaydi; tekis o'tish uchun 14..30 oralig'ida aralashtiriladi
    for v in range(14, 31):
        t = (v - 14) / 16.0
        lut[v] = int(round((1 - t) * v + t * lut[v]))
    out = []
    for f in frames:
        ycc = cv2.cvtColor(f, cv2.COLOR_BGR2YCrCb)
        ycc[..., 0] = cv2.LUT(ycc[..., 0], lut)
        out.append(cv2.cvtColor(ycc, cv2.COLOR_YCrCb2BGR))
    return out


REGIONS = {"yuz": (110, 260, 290, 430), "kamzul": (330, 700, 250, 470), "shapka": (40, 120, 300, 420)}


def sharp_match(frames, ref_frames):
    """Tiniqlikni (Laplasian dispersiyasi) kutish klipiga tenglaydi: unsharp mask, miqdori butun klip uchun BITTA. Miqdor uch hudud (yuz,
    kamzul, shapka) bo'yicha eng katta og'ishni kamaytiradigan qilib tanlanadi (faqat yuz bo'yicha tanlansa, shapka qirralari haddan o'tkir bo'ladi)."""
    ref = {k: _lapvar(ref_frames, b) for k, b in REGIONS.items()}
    sample = frames[::6]
    blur = lambda f: cv2.GaussianBlur(f, (0, 0), 1.0)
    base = [f.astype(np.float32) for f in sample]
    soft = [blur(f).astype(np.float32) for f in sample]
    best = (9e9, 0.0, None)
    for amt in np.linspace(0.0, 0.5, 11):
        test = [np.clip(f + amt * (f - sb), 0, 255).astype(np.uint8) for f, sb in zip(base, soft)]
        dev = {k: _lapvar(test, b) / ref[k] - 1 for k, b in REGIONS.items()}
        worst = max(abs(v) for v in dev.values())
        if worst < best[0]:
            best = (worst, float(amt), dev)
    amt = best[1]
    print("   tiniqlik: unsharp miqdori %.2f; kutish klipiga nisbatan og'ish: %s" % (amt, {k: f"{v * 100:+.0f}%" for k, v in best[2].items()}))
    if amt == 0.0:
        return frames
    return [np.clip(f.astype(np.float32) + amt * (f.astype(np.float32) - blur(f).astype(np.float32)), 0, 255).astype(np.uint8) for f in frames]


def ramp_fix(frames, ramp=12):
    """AI klipning birinchi ~12 kadri qorong'iroq (asl rasm yorqinligidan o'z yorqinligiga o'tadi, ~3-5%): klip boshidagi yorqinlik "pulsi"
    bo'lmasin deb shu kadrlar ko'paytirgich bilan tekislanadi. Faqat yorqinlik (mazmun, joylashuv, ifoda o'zgarmaydi)."""
    import numpy as np

    def fig(f):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        m = g > 20
        return float(g[m].mean()) if m.any() else float(g.mean())

    ms = np.array([fig(f) for f in frames])
    settled = float(np.median(ms[ramp:ramp + 18]))
    out = []
    gains = []
    for i, f in enumerate(frames):
        gain = min(1.08, max(1.0, settled / ms[i])) if i < ramp else 1.0
        gains.append(gain)
        out.append(np.clip(f.astype(np.float32) * gain, 0, 255).astype(np.uint8) if gain > 1.0005 else f)
    print(f"   yorqinlik rampasi: boshida x{gains[0]:.3f} (kadr 0: {ms[0]:.1f} -> {settled:.1f})")
    return out

FACE_BOX = (60, 300, 270, 450)   # kadrlarni solishtirish hududi (shapka..iyak)
SOFT_MOUTH_K = 0.94             # chiqish oynasi uchun yumshoq chegara: lablar deyarli yopiq (kutish tezroq: gap tugagach og'iz uzoq harakatlanmasin)
SOFT_POSE_MAX = 2.5
HOLD_K = 0.88                    # klipni to'xtatib turish kadri: og'iz farqi chegaradan ham kichik (lablar aniq yopiq; ~9.4)
CLOSE_POSE_MAX = 4.0             # kesish uchun bosh o'rni sharti (chiqish sharti POSE_MAX=2.5 dan yumshoqroq)
KEEP_FRAMES = tuple(range(4, 13))   # yopiq og'iz oralig'ida qoladigan kadrlar soni (~0.17-0.33 s); tikuv yaxshi bo'lsa kam, bo'lmasa ko'proq


def _face(f):
    y0, y1, x0, x1 = FACE_BOX
    return cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[y0:y1, x0:x1].astype(np.float32)


def trim_pauses(frames, md, pose, thr, ok):
    """Gap o'rtasida og'iz uzoq yopiq turmasin (foydalanuvchi: ovoz gapirib turganda videoda og'iz ~1 s yopiladi, keyin yana ochiladi).
    AI klipda audio pauzalariga mos uzun yopiq-og'iz oraliqlari bor; jonli ovozda esa bu pauzalar boshqa joyda. Har yopiq-og'iz oralig'i
    (og'iz yopiq, bosh uy o'rnida) 4-6 kadrga (~0.2 s) qisqartiriladi: oraliq o'rtasidan kadrlar olib tashlanadi, tikuv joyi — oraliqning
    ichidan eng o'xshash ikki kadr (yuz hududi farqi eng kichik) va ularni ikki kadrli aralashtirish. Klip uchlari o'zgarmaydi (birinchi va
    oxirgi kadr joyida). Qaytaradi: yangi kadrlar, yangi ok (chiqish) massivi, nechta kadr olib tashlangani."""
    n = len(frames)
    closed = [(md[i] <= thr and pose[i] <= CLOSE_POSE_MAX) for i in range(n)]
    face = [_face(f) for f in frames]
    adj = float(np.median([np.abs(face[i] - face[i + 1]).mean() for i in range(n - 1)]))
    runs, a = [], None
    for i, v in enumerate(closed + [False]):
        if v and a is None:
            a = i
        if not v and a is not None:
            runs.append((a, i))
            a = None
    cut = set()
    blend = {}
    for a, b in runs:
        L = b - a
        boundary = a == 0 or b == n   # klip boshi/oxiridagi yopiq oraliq: ulanishda ikkisi ketma-ket keladi, shuning uchun ayniqsa qisqa bo'lsin
        if L <= (3 if boundary else 6):   # tabiiy nafas/so'z orasidagi pauza, tegilmaydi
            continue
        keep_opts = (2, 3) if boundary else KEEP_FRAMES
        thr_mult = 6.0 if boundary else 4.0
        best = None
        for R in keep_opts:
            if L <= R + 1:
                continue
            for k1 in range(1, R):
                i, j = a + k1 - 1, b - (R - k1)
                if j <= i + 1:
                    continue
                raw = float(np.abs(face[i] - face[j]).mean())
                d = raw + 0.35 * (R - 2)
                if best is None or d < best[0]:
                    best = (d, i, j, raw)
        if best is None or best[3] > thr_mult * adj + 1.0:
            print(f"   kesish: {a}-{b} oralig'i ({L} kadr) kesilmadi (tikuv farqi {best[3] if best else -1:.1f} > {thr_mult * adj + 1.0:.1f})")
            continue
        _, i, j, _ = best
        cut.update(range(i + 1, j))
        blend[i] = (j, 0.33)
        blend[j] = (i, 0.33)
    out, out_ok, out_soft, out_md = [], [], [], []
    for i in range(n):
        if i in cut:
            continue
        f = frames[i]
        if i in blend:
            o, w = blend[i]
            f = np.clip(f.astype(np.float32) * (1 - w) + frames[o].astype(np.float32) * w, 0, 255).astype(np.uint8)
        out.append(f)
        out_ok.append(bool(md[i] <= thr * HOLD_K and pose[i] <= 2.5))   # aniq YOPIQ lablar (o'tish nuqtalari va ushlab turish kadrlari uchun)
        out_md.append(float(md[i]))
        out_soft.append(bool(md[i] <= thr * SOFT_MOUTH_K and pose[i] <= SOFT_POSE_MAX))
    left = max([sum(1 for _ in g) for g in []] + [0])
    print(f"   kesish: {len(runs)} yopiq oraliq, {len(cut)} kadr ({len(cut) / 24:.2f} s) olib tashlandi, klip {n / 24:.2f} -> {len(out) / 24:.2f} s")
    return out, out_soft, out_ok, out_md, len(cut)


def ok_intervals(ok, fps=24.0):
    iv, a = [], None
    for i, v in enumerate(list(ok) + [False]):
        if v and a is None:
            a = i
        if not v and a is not None:
            iv.append([round(a / fps, 3), round(i / fps, 3)])
            a = None
    return iv


GRAPH_MAXC = 3.0   # o'tish nuqtasi (4.5 da bir kadrli almashishda bosh/yuz sakrashi sezilardi): ikki klipning YOPIQ-OG'IZ kadrlarida yuz hududi farqi (60x80 kulrang, o'rtacha |farq|) shundan oshmasin


def _centers(strict):
    """Yopiq-og'iz (og'iz yopiq, bosh uy o'rnida) oraliqlarining markaziy kadrlari."""
    out, a = [], None
    for i, v in enumerate(list(strict) + [False]):
        if v and a is None:
            a = i
        if not v and a is not None:
            out.append((a + i - 1) // 2)
            a = None
    return out


def build_graph(finals, stricts, maxc=GRAPH_MAXC):
    """Gapirish variantlari orasida almashinish nuqtalari — FAQAT og'iz YOPIQ paytda. Foydalanuvchi: og'iz ochiq turganda klip almashsa bilinadi (xira-o'tishda
    lablar "bijirlaydi"); og'iz yopiq paytda esa ikki kadr deyarli bir xil, shuning uchun xira-o'tishsiz, bir kadrda almashtirish ko'rinmaydi.
    A klipning yopiq-og'iz oralig'i markazi (i) va B klipning yopiq-og'iz oralig'i markazi (u; B da kamida 1.2 s qolsin) — yuz hududi bo'yicha eng o'xshashlari
    (ko'z pirpiraganda farq katta — chiqarib tashlanadi). Natija: {"a-b": [[i, u, narx], ...]}, har i uchun eng yaxshi 2 ta u."""
    feats = []
    for fr in finals:
        feats.append(np.array([cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[60:300, 270:450], (60, 80), interpolation=cv2.INTER_AREA).astype(np.float32).ravel() for f in fr]))
    cent = [_centers(st) for st in stricts]
    pairs = {}
    for a, FA in enumerate(feats):
        for b, FB in enumerate(feats):
            if a == b:
                continue
            nB = len(FB)
            ub = [u for u in cent[b] if nB - u >= 29]          # B da kamida ~1.2 s qolsin
            ent = []
            for i in cent[a]:
                if i < 3:
                    continue
                cs = sorted((float(np.abs(FB[u] - FA[i]).mean()), u) for u in ub)[:2]
                ent.extend([i, u, round(c, 2)] for c, u in cs if c <= maxc)
            pairs[f"{a}-{b}"] = ent
            print(f"   o'tish nuqtalari {a}->{b}: {len(ent)} ta (eng arzoni {min([e[2] for e in ent], default=-1)})")
    return pairs

def stabilize(frames, capoff, limit=4.0):
    """Bosh (furajka) joyini HAR KADRDA kutish klipidagi o'rniga qulflaydi. AI klipda bosh 1-3 px suzadi: chiqishda (gapirish -> kutish) bosh "sakraydi" va
    odam o'zgargandek ko'rinadi; foydalanuvchi ham gapirganda bosh qimirlamasin degan edi. Siljish faqat bosh va yelkagacha (y <= 330 to'liq, 470 gacha
    silliq so'nadi) qo'llanadi; tana (jaket) o'z joyida qoladi. capoff — exits.py o'lchagan furajka hududi siljishi (kutish o'rtachasiga nisbatan)."""
    h, w = frames[0].shape[:2]
    ys = np.arange(h, dtype=np.float32)
    wy = np.where(ys <= 330, 1.0, np.where(ys >= 470, 0.0, 0.5 * (1 + np.cos(np.pi * (ys - 330) / 140)))).astype(np.float32)
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), ys)
    out, moved = [], []
    for f, (dx, dy) in zip(frames, capoff):
        dx = float(np.clip(dx, -limit, limit))
        dy = float(np.clip(dy, -limit, limit))
        if abs(dx) < 0.1 and abs(dy) < 0.1:
            out.append(f)
            continue
        moved.append(max(abs(dx), abs(dy)))
        out.append(cv2.remap(f, gx + dx * wy[:, None], gy + dy * wy[:, None], cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT))
    print(f"   bosh qulflandi: {len(moved)}/{len(frames)} kadr siljitildi, o'rtacha {np.mean(moved) if moved else 0:.2f} px, eng katta {max(moved) if moved else 0:.2f} px")
    return out


def flow_align(frames, home_gray, ok, sigma=6.0, limit=3.0):
    """Yopiq-og'iz kadrlari o'rtachasini kutish klipining uy kadriga (DIS optik oqim) moslaydi — klip bo'yicha BITTA doimiy, silliq siljish maydoni.
    Qosh, ko'z, burun, lablar va furajka qirralari kutish klipidagi o'rniga tushadi (ular 1-3 px farq qilardi: gapirishdan kutishga o'tganda "odam o'zgardi").
    Faqat bosh/yoqa hududida (y <= 380 to'liq, 520 gacha so'nadi). O'lchangan: yuz hududi |dLab| ~25% kamayadi."""
    idx = [i for i, v in enumerate(ok) if v][:80] or list(range(min(40, len(frames))))
    S = np.mean([frames[i].astype(np.float32) for i in idx], axis=0).astype(np.uint8)
    sg = cv2.cvtColor(S, cv2.COLOR_BGR2GRAY)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(home_gray, sg, None)
    fl = np.stack([cv2.GaussianBlur(flow[..., c], (0, 0), sigma) for c in (0, 1)], axis=-1)
    h, w = sg.shape
    ys = np.arange(h, dtype=np.float32)
    wy = np.where(ys <= 380, 1.0, np.where(ys >= 520, 0.0, 0.5 * (1 + np.cos(np.pi * (ys - 380) / 140)))).astype(np.float32)
    fl = np.clip(fl * wy[:, None, None], -limit, limit)
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), ys)
    face = fl[60:300, 270:450]
    print(f"   yuz moslash (optik oqim): o'rtacha siljish {np.abs(face).mean():.2f} px, eng katta {np.abs(fl).max():.1f} px ({len(idx)} yopiq kadr asosida)")
    n = len(frames)
    out = []
    for i, f in enumerate(frames):
        # klip boshi va oxiri AYNAN uy kadri (start_image = end_image): u yerda tuzatish 0; ~0.5 s ichida to'liq kuchga kiradi (AI yuzi asta uy kadridan "uzoqlashadi")
        a = max(0.0, min(1.0, i / 12.0, (n - 1 - i) / 12.0))
        a = a * a * (3 - 2 * a)
        if a < 0.02:
            out.append(f)
            continue
        out.append(cv2.remap(f, gx + a * fl[..., 0], gy + a * fl[..., 1], cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT))
    return out



def load(path, lo=0, hi=None):
    c = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = c.read()
        if not ok:
            break
        out.append(f)
    return out[lo:(hi + 1 if hi is not None else None)]


def main():
    os.makedirs(OUT, exist_ok=True)
    idle = greet = None
    speaks = []
    for a in sys.argv[1:]:
        k, v = a.split("=", 1)
        if k == "idle":
            pth, s, e = v.rsplit(":", 2)
            idle = (pth, int(s), int(e))
        elif k == "greeting":
            greet = v
        elif k == "speak":
            speaks.append(v)
    r = subprocess.run([sys.executable, os.path.join(HERE, "exits.py"), idle[0], str(idle[1]), str(idle[2])] + speaks + [greet], capture_output=True, text=True)
    print(r.stderr)
    res = {x["file"]: x for x in json.loads(r.stdout.strip().splitlines()[-1])}
    idle_frames = load(idle[0], idle[1], idle[2])
    encode(idle_frames, os.path.join(OUT, "idle.mp4"))
    xg = res[os.path.basename(greet)]
    g_fr = ramp_fix([A.warp(f, xg["align"]) for f in load(greet)])
    g_fr = sharp_match(tone_match(g_fr, idle_frames), idle_frames)
    start = 0
    if os.environ.get("GREETING_HEAD", "keep") == "cut":   # eski salom klipi (og'iz va qo'l bir vaqtda): boshidagi jim kutish kesiladi
        f0 = next((i for i, v in enumerate(xg["md"]) if i > 0 and v > xg["thr"]), 0)
        start = max(0, f0 - 2)
        print(f"   salom: og'iz {f0}-kadrda ochiladi, boshidan {start} kadr ({start / 24:.2f} s) kesildi")
        g_fr = g_fr[start:]
    # og'iz birinchi harakatlanadigan payt: qo'l ko'tarilayotganda (6 kadrdan keyin) lablar birinchi ochiladigan kadr
    sp_frame = next((i for i, v in enumerate(xg["md"]) if i >= start + 2 and v > xg["thr"]), start + 2) - start
    speech_start = float(os.environ.get("GREETING_SPEECH", round(sp_frame / 24.0, 3)))
    print(f"   salom: og'iz {speech_start:.3f} s da boshlanadi (ovoz shu paytga kechiktiriladi)")
    encode(g_fr, os.path.join(OUT, "greeting.mp4"))
    variants = []
    finals = []
    stricts = []
    ctx = E.prepare(idle[0], idle[1], idle[2])
    for i, pth in enumerate(speaks, 1):
        x = res[os.path.basename(pth)]
        name = f"speaking-{i:02d}.mp4"
        aff = [A.warp(f, x["align"]) for f in load(pth)]
        stab = stabilize(aff, x["capoff"])                                   # bosh kutish o'rniga qulflanadi
        _, _, _, ok0 = E.measure(ctx, [A.gray(f) for f in stab])             # barqarorlashdan keyingi yopiq-og'iz kadrlari
        s_fr = ramp_fix(flow_align(stab, ctx["home"], ok0))                  # doimiy yuz moslash
        s_fr = sharp_match(tone_match(s_fr, idle_frames), idle_frames)
        _, pose, md, okm = E.measure(ctx, [A.gray(f) for f in s_fr])         # YAKUNIY tahlil (chiqish oynalari, kesish, o'tish nuqtalari shu kadrlar bo'yicha)
        x = dict(x, poseStart=float(pose[0]), poseEnd=float(pose[-1]))
        print(f"   yakuniy: bosh o'rni o'rtacha {pose.mean():.2f} px (eng katta {pose.max():.2f}), yopiq kadrlar {int(okm.sum())}/{len(okm)}")
        s_fr, s_ok, s_strict, s_md, _ = trim_pauses(s_fr, md, pose, ctx["thr"], okm)
        encode(s_fr, os.path.join(OUT, name))
        dur = round(len(s_fr) / 24.0, 3)
        iv = ok_intervals(s_ok)
        gaps, last = [], 0.0
        for a_, b_ in iv:
            gaps.append(a_ - last)
            last = b_
        gaps.append(dur - last)
        mw = round(max(gaps), 2)
        ok = x["poseStart"] <= 1.5 and x["poseEnd"] <= 1.5 and iv and iv[0][0] == 0.0 and abs(iv[-1][1] - dur) < 0.1
        print(f"{name}: {dur} s, chiqish oraliqlari {len(iv)}, eng uzun kutish {mw} s, uchlari mos: {'HA' if ok else 'YOQ (qabul qilinmaydi!)'}")
        holds = []
        for a_, b_ in iv:
            idx = range(int(round(a_ * 24)), min(len(s_md), int(round(b_ * 24))))
            if idx:
                j = min(idx, key=lambda q: s_md[q])
                if s_md[j] <= ctx["thr"] * HOLD_K:
                    holds.append(round(j / 24.0, 3))
        print(f"   ushlab turish kadrlari (lablar aniq yopiq): {len(holds)} ta")
        variants.append({"file": name, "duration": dur, "exits": iv, "holds": holds})
        finals.append(s_fr)
        stricts.append(s_strict)
    json.dump({"fps": 24, "greeting": {"speechStart": speech_start}, "speaking": {"variants": variants}, "graph": {"maxCost": GRAPH_MAXC, "pairs": build_graph(finals, stricts)}}, open(os.path.join(OUT, "avatarClips.json"), "w"))
    print("tayyor:", OUT)


main()
