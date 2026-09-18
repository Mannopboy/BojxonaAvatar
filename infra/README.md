# Deploy — Build-on-server + cron poller (ADR-007, 2-usul)

`git push` → server ~1 daqiqada avtomatik `docker compose up -d --build`. GHCR/Watchtower kerak emas.

```
Dasturchi → git push (GitHub)
   → serverda cron poll-deploy.sh (har daqiqa): git yangi commit bormi?
   → bo'lsa: git reset --hard + docker compose up -d --build
   → Host Nginx (TLS) → / → frontend(:8090)  ·  /api/ → backend(:8091)
```

## Serverda bir martalik sozlash (Ubuntu)

```bash
# 1. Docker (agar yo'q bo'lsa)
curl -fsSL https://get.docker.com | sh

# 2. Repo (private bo'lsa — PAT bilan)
sudo mkdir -p /opt/bojxonaavatar && sudo chown $USER /opt/bojxonaavatar
git clone https://github.com/Mannopboy/BojxonaAvatar.git /opt/bojxonaavatar
cd /opt/bojxonaavatar

# 3. .env (MAXFIY — GEMINI_API_KEY)
cp infra/.env.example infra/.env
nano infra/.env          # GEMINI_API_KEY + FRONTEND_ORIGIN (real domen)

# 4. Birinchi build/run
docker compose -f infra/compose.prod.yml up -d --build
docker compose -f infra/compose.prod.yml ps
curl -s http://127.0.0.1:8091/health     # backend
curl -sI http://127.0.0.1:8090/          # frontend

# 5. Host Nginx + TLS
sudo cp infra/nginx/bojxonaavatar.conf /etc/nginx/sites-available/bojxonaavatar
#   → server_name va sertifikat yo'lini real domenga o'zgartiring
sudo ln -s /etc/nginx/sites-available/bojxonaavatar /etc/nginx/sites-enabled/
sudo certbot --nginx -d bojxona.example.uz      # yoki Cloudflare Origin CA (Full strict)
sudo nginx -t && sudo systemctl reload nginx

# 6. Auto-deploy poller (cron)
chmod +x infra/poll-deploy.sh
( crontab -l 2>/dev/null; echo "* * * * * flock -n /tmp/bojxona-deploy.lock /opt/bojxonaavatar/infra/poll-deploy.sh >> /var/log/bojxona-deploy.log 2>&1" ) | crontab -
```

## Kundalik ish
| O'zgarish | Nima qilasiz |
|-----------|--------------|
| Backend/Frontend/infra kod | ✅ `git push` → ~1 daqiqada server avtomatik |
| `.env` (kalit) o'zgarishi | Serverda `infra/.env` ni qo'lda tahrirlang + `up -d` |

## Portlar (bir serverda ko'p sayt bo'lsa — to'qnashuvni tekshiring)
- frontend: `127.0.0.1:8090`
- backend:  `127.0.0.1:8091`
- ⚠️ Ikkalasi ham faqat `127.0.0.1` — internetga faqat host Nginx (TLS) chiqaradi.

## Loglar / debug
```bash
docker compose -f infra/compose.prod.yml logs -f backend
tail -f /var/log/bojxona-deploy.log        # poller
```

## Eslatma
- **HTTPS majburiy** — mikrofon (getUserMedia) faqat secure-context'da. Cloudflare orqasida bo'lsa origin sertifikat = **Full (strict)** (aks holda 526).
- Ma'lumot O'zbekistonda (O'RQ-547) — server O'zbekistonda.
