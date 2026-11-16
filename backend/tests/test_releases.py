"""Kiosk ilova reliz endpointlari testi (GEMINI/tarmoq kerak emas):  cd backend && python -m unittest discover -s tests -v

Tekshiradi: manifest 404 → yuklash (kalit, versiya, MZ, hajm) → manifest + fayl (sha256, size, Range) → pastga tushirishga yo'l qo'ymaslik → eskilarini tozalash → yo'l almashtirish (../) himoyasi.
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GEMINI_API_KEY", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app import releases as R  # noqa: E402

KEY = "test-admin-key"


def exe(n: int = 300_000, seed: int = 1) -> bytes:
    body = bytearray(b"MZ")
    x = seed
    while len(body) < n:  # takrorlanmaydigan ma'lumot (xesh har faylda boshqa)
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        body += x.to_bytes(4, "little")
    return bytes(body[:n])


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.s = get_settings()
        self.tmp = tempfile.mkdtemp(prefix="rel-test-")
        self.old = (self.s.releases_dir, self.s.release_admin_key, self.s.release_keep, self.s.public_base_url, self.s.release_max_mb)
        self.s.releases_dir = self.tmp
        self.s.release_admin_key = KEY
        self.s.release_keep = 3
        self.s.public_base_url = ""
        self.s.release_max_mb = 300
        self.c = TestClient(app, base_url="http://testserver")
        self.h = {"X-Admin-Key": KEY, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "bojxona.fintech-company.uz", "Content-Type": "application/octet-stream"}

    def tearDown(self):
        (self.s.releases_dir, self.s.release_admin_key, self.s.release_keep, self.s.public_base_url, self.s.release_max_mb) = self.old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def up(self, version="1.0.3", data=None, notes="", **kw):
        return self.c.post("/app/windows/release", params={"version": version, "notes": notes}, content=data if data is not None else exe(), headers=kw.pop("headers", self.h), **kw)

    def test_manifest_404_before_any_release(self):
        r = self.c.get("/app/windows/latest")
        self.assertEqual(r.status_code, 404)

    def test_upload_requires_configured_and_correct_key(self):
        self.s.release_admin_key = ""
        self.assertEqual(self.up().status_code, 503)  # kalit sozlanmagan — yuklash o'chiq
        self.s.release_admin_key = KEY
        self.assertEqual(self.up(headers={**self.h, "X-Admin-Key": "boshqa"}).status_code, 401)
        self.assertEqual(self.up(headers={k: v for k, v in self.h.items() if k != "X-Admin-Key"}).status_code, 401)
        self.assertEqual(self.c.get("/app/windows/latest").status_code, 404)  # rad etilgan urinishlar hech narsa yozmadi

    def test_upload_validation(self):
        self.assertEqual(self.up(version="abc").status_code, 422)
        self.assertEqual(self.up(version="1.0").status_code, 422)
        self.assertEqual(self.up(data=b"PK\x03\x04" + b"x" * 1000).status_code, 422)  # .exe emas (MZ yo'q)
        self.assertEqual(self.up(data=b"").status_code, 422)
        self.s.release_max_mb = 1
        self.assertEqual(self.up(data=exe(1_200_000)).status_code, 413)
        self.assertEqual(self.c.get("/app/windows/latest").status_code, 404)
        self.assertEqual([n for n in os.listdir(self.tmp) if n.startswith(".upload-")], [])  # vaqtinchalik fayllar qolmadi

    def test_upload_then_manifest_and_file_match(self):
        data = exe(700_000)
        r = self.up("1.0.3", data, notes="Birinchi reliz")
        self.assertEqual(r.status_code, 201, r.text)
        m = r.json()
        self.assertEqual(m["version"], "1.0.3")
        self.assertEqual(m["size"], len(data))
        self.assertEqual(m["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(m["notes"], "Birinchi reliz")
        self.assertEqual(m["url"], "https://bojxona.fintech-company.uz/api/downloads/bojxona_gologramma_setup_1.0.3.exe")
        got = self.c.get("/app/windows/latest")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.json(), m)
        self.assertIn("no-store", got.headers.get("cache-control", ""))
        self.assertTrue(R.valid_manifest(got.json()))  # ilova qoidalari: X.Y.Z, https .exe, sha256 64 hex, size > 0
        f = self.c.get("/downloads/bojxona_gologramma_setup_1.0.3.exe")  # tashqarida /api/downloads/…
        self.assertEqual(f.status_code, 200)
        self.assertEqual(f.content, data)
        self.assertEqual(int(f.headers["content-length"]), len(data))
        self.assertEqual(hashlib.sha256(f.content).hexdigest(), m["sha256"])

    def test_range_requests_for_resume(self):
        data = exe(500_000)
        self.up("1.2.0", data)
        r = self.c.get("/downloads/bojxona_gologramma_setup_1.2.0.exe", headers={"Range": "bytes=1000-1999"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.content, data[1000:2000])

    def test_public_base_url_override(self):
        self.s.public_base_url = "https://example.uz/"
        m = self.up("2.0.0").json()
        self.assertEqual(m["url"], "https://example.uz/api/downloads/bojxona_gologramma_setup_2.0.0.exe")

    def test_never_downgrades_unless_forced(self):
        self.assertEqual(self.up("1.0.10", exe(100_000, 1)).status_code, 201)
        r = self.up("1.0.9", exe(100_000, 2))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.c.get("/app/windows/latest").json()["version"], "1.0.10")  # sonlar bo'yicha: 1.0.10 > 1.0.9
        r = self.c.post("/app/windows/release", params={"version": "1.0.9", "force": "1"}, content=exe(100_000, 3), headers=self.h)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.c.get("/app/windows/latest").json()["version"], "1.0.9")

    def test_keeps_only_newest_installers(self):
        for i, v in enumerate(["1.0.1", "1.0.2", "1.0.3", "1.0.4", "1.1.0"]):
            self.assertEqual(self.up(v, exe(60_000, i + 1)).status_code, 201)
        left = sorted(os.listdir(os.path.join(self.tmp, "files")))
        self.assertEqual(left, ["bojxona_gologramma_setup_1.0.3.exe", "bojxona_gologramma_setup_1.0.4.exe", "bojxona_gologramma_setup_1.1.0.exe"])
        self.assertEqual(self.c.get("/downloads/bojxona_gologramma_setup_1.0.1.exe").status_code, 404)

    def test_download_blocks_path_tricks_and_other_files(self):
        self.up("1.0.3")
        open(os.path.join(self.tmp, "secret.txt"), "w").write("maxfiy")
        for name in ["../secret.txt", "..%2fsecret.txt", "secret.txt", "latest.json", "bojxona_gologramma_setup_1.0.3.exe.bak", "bojxona_gologramma_setup_9.9.9.exe", "x.exe"]:
            self.assertEqual(self.c.get(f"/downloads/{name}").status_code, 404, name)

    def test_hand_placed_manifest_is_served_and_invalid_one_is_hidden(self):
        os.makedirs(self.tmp, exist_ok=True)
        good = {"version": "1.0.3", "url": "https://x.uz/a/bojxona_gologramma_setup_1.0.3.exe", "sha256": "b" * 64, "size": 70800575, "notes": ""}
        json.dump(good, open(os.path.join(self.tmp, "latest.json"), "w"))
        self.assertEqual(self.c.get("/app/windows/latest").json(), good)
        for bad in [{**good, "url": "http://x.uz/a.exe"}, {**good, "url": "https://x.uz/a.zip"}, {**good, "sha256": "zz"}, {**good, "version": "1.0"}, {**good, "size": 0}]:
            json.dump(bad, open(os.path.join(self.tmp, "latest.json"), "w"))
            self.assertEqual(self.c.get("/app/windows/latest").status_code, 404, bad)  # ilova rad etadigan manifest mijozga berilmaydi
        open(os.path.join(self.tmp, "latest.json"), "w").write("{buzuq")
        self.assertEqual(self.c.get("/app/windows/latest").status_code, 404)

    def test_version_compare_is_numeric(self):
        self.assertGreater(R.vkey("1.0.10"), R.vkey("1.0.9"))
        self.assertGreater(R.vkey("2.0.0"), R.vkey("1.99.99"))
        self.assertEqual(R.vkey("x"), (-1, -1, -1))


if __name__ == "__main__":
    unittest.main()
