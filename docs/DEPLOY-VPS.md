# Deploy ke VPS + jalan 24 jam (Cloudflare Quick Tunnel)

Panduan ini memasang simulasi 6 model di VPS tanpa IP publik: aplikasi hanya mendengarkan
di `127.0.0.1`, lalu Cloudflare Quick Tunnel yang membukanya ke internet.

```
browser ──https──▶ https://<acak>.trycloudflare.com
                        │ (cloudflared, koneksi keluar)
                        ▼
                  127.0.0.1:8090  ── Bun server (UI + REST + WS)
                        │
                        ├── WS Binance (futures + spot)
                        └── apps/server/data/{minutes,signals,state}
```

Target yang dipakai di dokumen ini:

| Hal | Nilai |
|---|---|
| VPS | `202.155.143.190`, SSH port `21031`, user `ubuntu` (Ubuntu 22.04) |
| Folder aplikasi | `/home/ubuntu/simulasi-project` |
| Port aplikasi | `8090` di `127.0.0.1` |
| Runtime aplikasi | Docker Compose (container `simulasi-6-model`), **bukan** systemd |
| Service tunnel | `/etc/systemd/system/cloudflared-simulasi.service` |
| Data runtime | `/home/ubuntu/simulasi-project/data/{minutes,signals,state}` |
| Link akses | `https://vegetation-rated-boston-promised.trycloudflare.com` |

**Kenapa 8090, bukan 8080.** `futures-signal` di VPS ini sudah memakai 8080 (unit
cloudflared lamanya menunjuk `http://127.0.0.1:8080`). Jangan mengubah unit itu dan jangan
memakai port 8080 untuk proyek ini. Kalau 8090 pun ternyata terpakai, ganti angka port di
tiga tempat: `.env`, unit aplikasi, dan perintah `cloudflared --url`.

---

## Status deploy yang berjalan (VPS Lutfi, diperbarui 11 Nov 2026)

Yang benar-benar terpasang dan sudah diuji, bukan rencana.

### Link akses publik

```
https://vegetation-rated-boston-promised.trycloudflare.com
```

Dibuka lewat Cloudflare Quick Tunnel karena VPS **tidak punya IP publik**. URL ini hanya
hidup selama `cloudflared-simulasi.service` jalan; kalau tunnel di-restart/reboot, URL
berubah — ambil yang terbaru dari `/home/ubuntu/simulasi-url.txt` (lihat bagian 7).

### Inventaris yang terpasang

| Hal | Nilai nyata |
|---|---|
| Folder aplikasi | `/home/ubuntu/simulasi-project` |
| Runtime | **Docker Compose** (project `simulasi-project`), container `simulasi-6-model` |
| Image | `simulasi-6-model:latest` dibangun dari `Dockerfile` di folder yang sama |
| Restart policy | `unless-stopped` (hidup lagi otomatis saat reboot selama tidak di-`stop`) |
| Port | `127.0.0.1:8090 -> 8080` (hanya localhost, tidak terbuka ke jaringan) |
| Service tunnel | `/etc/systemd/system/cloudflared-simulasi.service` (salinan: `/home/ubuntu/cloudflared-simulasi.service`) |
| Service aplikasi (systemd) | **tidak ada** — aplikasi dijalankan Docker, bukan systemd |
| URL aktif | `/home/ubuntu/simulasi-url.txt` (diperbarui `~/simulasi-url.sh` tiap 2 menit + `@reboot`) |
| Data runtime | `/home/ubuntu/simulasi-project/data/{minutes,signals,state}` (bind mount, persist) |
| Model | `/home/ubuntu/simulasi-project/apps/server/models` (bind mount) |
| Data replay | `/home/ubuntu/simulasi-project/apps/server/data/replay` (dari image, 8,9 MB) |
| Log | `journalctl -u cloudflared-simulasi` + `docker compose logs` / `docker logs simulasi-6-model` |
| Layanan lain | `futures-signal` 8080, `rekapan-narsum-rest` 3001, `rekapan-narsum-db` 21051 — jangan disentuh |

### Letak file service (systemd)

```
/etc/systemd/system/cloudflared-simulasi.service   <- unit yang aktif dipakai systemd
/home/ubuntu/cloudflared-simulasi.service          <- salinan untuk arsip/edit
```

Tidak ada `simulasi-6-model.service`: percobaan systemd lama sudah dihapus dan aplikasi
berjalan sebagai container Docker. Karena itu `After=simulasi-6-model.service` pada unit
tunnel hanya menunggu unit yang tidak ada (tidak berbahaya, langsung lanjut). Kalau nanti
ingin merapikan, ganti `After/Wants` menjadi `docker.service` **saat tunnel memang mau
di-restart** — restart tunnel akan mengganti URL.

### Catatan penting

1. **Data runtime jangan pernah dihapus.** `data/minutes` adalah histori menit yang dipakai
   pemanasan 305 menit. Saat update 11 Nov 2026 data mentah berisi 2.802 baris futures /
   2.735 spot (±2.739 menit rentang); setelah boot kode baru memuat 2.000 baris terakhir dan
   memadatkan file, menyisakan **1.810 menit histori menyambung** (`historyMinutes`) — tetap
   jauh di atas 305 dan `ready=true`. `data/state` menyimpan posisi/trade ekuitas bot.
2. **VPS ini tidak punya IPv6 global.** Wajib `--edge-ip-version 4` pada cloudflared, kalau
   tidak tunnel gagal daftar (`Register tunnel error ... context deadline exceeded`).
3. **URL quick tunnel berubah setiap cloudflared restart/reboot.** Bukan bug. Pakai
   `~/simulasi-url.sh` atau `cat ~/simulasi-url.txt`.
4. **Repo GitHub sekarang sudah lengkap** (`apps/server/models` 9,6 MB + `apps/server/data/replay`
   8,9 MB ikut ter-commit), jadi `git clone` langsung bisa dijalankan tanpa overlay dari laptop.
5. **Dockerfile** memakai `ENV NODE_ENV=production` sebelum build UI (bundel produksi, bukan dev).

### Prosedur update kode tanpa kehilangan data (yang dipakai 11 Nov 2026)

Kunci: `data/` dan `.env` **tidak** ikut diganti. Clone baru, salin data, tukar folder,
rebuild image. Downtime hanya saat tukar folder (±10 detik) supaya histori menit tidak putus.

```bash
cd /home/ubuntu
TS=$(date +%F-%H%M)

# 1. backup penuh (kode + data + .env) sebelum menyentuh apa pun
tar czf ~/simulasi-backup-$TS.tgz -C /home/ubuntu simulasi-project

# 2. clone kode terbaru ke folder sementara
git clone https://github.com/Lutfi1412/simulasi-project.git simulasi-project-new

# 3. bangun image baru DULU (container lama masih hidup, downtime belum mulai)
cd simulasi-project-new && docker compose build

# 4. hentikan container, pindahkan data + .env ke folder baru
cd /home/ubuntu/simulasi-project && docker compose down
cp -a /home/ubuntu/simulasi-project/.env /home/ubuntu/simulasi-project-new/.env
mkdir -p /home/ubuntu/simulasi-project-new/data
cp -a /home/ubuntu/simulasi-project/data/. /home/ubuntu/simulasi-project-new/data/

# 5. tukar folder: lama -> arsip, baru -> nama resmi
cd /home/ubuntu
mv simulasi-project simulasi-project-backup-$TS
mv simulasi-project-new simulasi-project

# 6. hidupkan dari folder resmi
cd simulasi-project && docker compose up -d
curl -s http://127.0.0.1:8090/api/health   # historyMinutes harus tetap ±1.800, bukan 0

# 7. setelah yakin sehat & data utuh, buang arsip supaya tidak jadi sampah
rm -rf /home/ubuntu/simulasi-project-backup-$TS ~/simulasi-backup-$TS.tgz
```

Tunnel tidak disentuh sama sekali, jadi URL tetap. Kalau `historyMinutes` jatuh ke 0,
jangan hapus arsip apa pun — kembalikan dengan `mv simulasi-project ...backup` dan ulangi.

---

## 0. Ringkas: urutan kerjanya

1. Cek VPS (RAM, disk, port, bun, cloudflared).
2. Kirim kode dari Windows (tanpa `node_modules`, tanpa data runtime lokal).
3. `bun install` + `bun run build`.
4. Buat `.env` VPS (`PORT=8090`, `HOST=127.0.0.1`).
5. Uji manual sebentar, lalu matikan.
6. Pasang `simulasi-6-model.service`, enable, start.
7. Pasang `cloudflared-simulasi.service`, ambil URL tunnel.
8. Verifikasi end-to-end dari browser.
9. Biarkan jalan; pemanasan sinyal butuh ±305 menit setelah start pertama.

---

## 1. Cek VPS dulu

```bash
ssh -p 21031 ubuntu@202.155.143.190

free -h
df -h /
nproc
ss -ltnp | grep -E ':(8080|8090)\b'
command -v bun; command -v cloudflared; command -v docker
timedatectl | head -3
```

Yang perlu diperhatikan:

- **RAM.** Build UI (Vite) butuh ±500–800 MB. Kalau RAM 1 GB atau kurang, lihat catatan di
  langkah 3 (build di lokal lalu kirim hasilnya). Untuk runtime sendiri, aplikasi ringan:
  buffer 900 menit × 40 fitur hanya beberapa MB.
- **Disk.** Minimal 1 GB bebas; proyek ±50 MB (model 9,6 MB + data replay 8,9 MB). Data
  runtime kecil: `minutes` ±0,3 MB/hari. Saat boot `MinuteStore` memuat **2000 baris
  terakhir** lalu memadatkan file ke jendela itu (jauh di atas 305 menit yang dibutuhkan),
  `signals` menyimpan 26 jam terakhir — tidak tumbuh tanpa batas.
- **Port 8080/8090.** Kalau 8080 listen, itu `futures-signal` — biarkan.
- **Jam.** `timedatectl` harus sinkron (`System clock synchronized: yes`). Jam VPS yang
  meleset membuat bar menit tidak cocok dengan Binance.
- Kalau `cloudflared` belum ada, lihat lampiran di bawah.

---

## 2. Pilih cara kirim kode

Repo ini **sudah** punya remote GitHub (`Lutfi1412/simulasi-project`), jadi cara paling rapi
adalah `git clone` langsung di VPS (lihat prosedur update di bagian Status deploy). Cara
`tar` lewat SSH di bawah tetap bisa dipakai sebagai alternatif manual. Jalankan dari
**git-bash di Windows**:

```bash
cd "/c/Users/sawal fitah/Downloads/project_simulasi"

tar czf - \
  --exclude='simulasi-testing/node_modules' \
  --exclude='simulasi-testing/apps/*/node_modules' \
  --exclude='simulasi-testing/apps/web/dist' \
  --exclude='simulasi-testing/apps/server/data/minutes' \
  --exclude='simulasi-testing/apps/server/data/signals' \
  --exclude='simulasi-testing/apps/server/data/state' \
  --exclude='simulasi-testing/data' \
  --exclude='simulasi-testing/.env' \
  simulasi-testing | ssh -p 21031 ubuntu@202.155.143.190 'tar xzf - -C ~'
```

Hasilnya ±9,8 MB (sudah diuji: 114 entri, tanpa `node_modules`, `models/` dan
`data/replay/` ikut). Kalau `data/` di root dikecualikan untuk jalur Docker, biarkan saja —
Docker/compose akan membuatnya sendiri saat mount.

Yang sengaja tidak dikirim:

- `node_modules` (145 MB) — dipasang ulang di VPS.
- **data runtime lokal** (`minutes`, `signals`, `state`) — histori menit di laptop berhenti
  di waktu terakhir laptop hidup, jadi di VPS tetap dianggap berlubang (celah > 5 menit) dan
  pemanasan harus mulai dari nol. Mengirimnya tidak mempercepat apa pun kecuali selisih
  waktunya kurang dari 5 menit.
- `.env` — dibuat khusus VPS di langkah 4, karena port dan `HOST` berbeda.

Yang **ikut** terkirim dan wajib ada: `apps/server/models/` (9,6 MB) dan
`apps/server/data/replay/` (8,9 MB). Tanpa replay, tab REPLAY tidak bisa memutar data validasi.

Alternatif kalau nanti repo sudah di-push ke GitHub (akun `Lutfi1412`):

```bash
git clone https://github.com/Lutfi1412/simulasi-testing.git
cd simulasi-testing
```

---

## 3. Pasang Bun dan dependensi

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"      # tambahkan juga ke ~/.bashrc
bun --version                            # harus >= 1.4

cd ~/simulasi-testing
bun install --frozen-lockfile
bun run build
ls apps/web/dist/index.html              # harus ada
```

Kalau RAM VPS kecil dan `bun run build` mati (OOM/killed), build di laptop lalu kirim
hasilnya — hasil build hanya 281 KB:

```bash
# di Windows
cd "/c/Users/sawal fitah/Downloads/project_simulasi/simulasi-testing"
bun run build
scp -P 21031 -r apps/web/dist ubuntu@202.155.143.190:~/simulasi-testing/apps/web/
```

Cek cepat setelah build (opsional, ±1 menit): `bun run verify` memastikan fitur dan model
masih paritas dengan Python. Tidak wajib di VPS, tapi murah dilakukan sekali.

---

## 4. Buat `.env` untuk VPS

```bash
cat > ~/simulasi-testing/.env <<'EOF'
# ---- server (khusus VPS) ----
PORT=8090
HOST=127.0.0.1
DATA_DIR=apps/server/data
MODELS_DIR=apps/server/models/current
WEB_DIST=apps/web/dist

# ---- pasar ----
SYMBOL=SOLUSDT
BINANCE_SPOT_WS=wss://data-stream.binance.vision/ws
BINANCE_SPOT_REST=https://data-api.binance.vision
BINANCE_FUTURES_WS=wss://fstream.binance.com/market/ws
BINANCE_FUTURES_REST=https://fapi.binance.com

# ---- sinyal (jangan diubah, harus sama dengan data latih) ----
SIGNAL_DOMINANCE_PCT=85
SIGNAL_STREAK=12
TRADE_WINDOW=50

# ---- simulasi ----
MIN_HISTORY_MINUTES=305
BUFFER_MINUTES=900
AUTO_START=true
INITIAL_MODE=live

TZ=Asia/Jakarta
```

`HOST=127.0.0.1` itu disengaja: port tidak terbuka ke jaringan VPS, satu-satunya jalan masuk
adalah tunnel. `PORT=8090` menghindari bentrok dengan `futures-signal`.

---

## 5. Uji manual sebelum dijadikan service

```bash
cd ~/simulasi-testing
set -a; . ./.env; set +a
/usr/bin/env bun run apps/server/src/index.ts
```

Banner harus menampilkan `UI / API http://localhost:8090`, mode `live`, 6 model, 40 fitur.
Di terminal kedua:

```bash
curl -s -m 8 http://127.0.0.1:8090/api/health | python3 -m json.tool | head -40
```

Yang dibaca: `feed.future.connected`, `feed.spot.connected`, `feed.*.transport`
(`direct` atau `tunnel`, bukan `blocked`), dan `live.ready=false` (normal, masih
pemanasan). Setelah itu `Ctrl-C` — proses manual ini hanya untuk memastikan tidak ada error
sebelum dijalankan permanen.

---

## 6. Service systemd untuk aplikasi

Buat berkas unit:

```bash
sudo tee /etc/systemd/system/simulasi-6-model.service > /dev/null <<'EOF'
[Unit]
Description=Simulasi 6 Model SOLUSDT (paper trading)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/simulasi-testing
EnvironmentFile=/home/ubuntu/simulasi-testing/.env
ExecStart=/home/ubuntu/.bun/bin/bun run apps/server/src/index.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=simulasi-6-model

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now simulasi-6-model
systemctl status simulasi-6-model --no-pager
journalctl -u simulasi-6-model -n 30 --no-pager
```

Catatan penting:

- `ExecStart` memakai **path absolut** Bun (`/home/ubuntu/.bun/bin/bun`). systemd tidak
  membaca `~/.bashrc`, jadi `bun` saja akan gagal dengan `status=203/EXEC`.
- `StartLimitIntervalSec=0` mencegah systemd menyerah restart setelah beberapa kali gagal.
- Aplikasi mengabaikan `Ctrl-C`/`SIGTERM` dengan menutup rapi, jadi `systemctl restart`
  aman untuk data.
- Log tidak ditulis ke berkas sendiri: semuanya masuk journald (`journalctl`).

---

## 7. Cloudflare Quick Tunnel

Pastikan binary-nya ada dan catat path-nya (biasanya `/usr/bin/cloudflared`):

```bash
command -v cloudflared
cloudflared --version
```

Cek dulu tunnel lain yang sudah jalan supaya tidak bingung saat membaca log:

```bash
systemctl list-units --type=service | grep -i cloudflared
```

Buat unit terpisah untuk proyek ini:

```bash
sudo tee /etc/systemd/system/cloudflared-simulasi.service > /dev/null <<'EOF'
[Unit]
Description=Cloudflare Quick Tunnel untuk Simulasi 6 Model
After=network-online.target simulasi-6-model.service
Wants=network-online.target simulasi-6-model.service
# jangan menyerah restart: jaringan VPS kadang menolak sesaat ke edge Cloudflare
StartLimitIntervalSec=0

[Service]
Type=simple
# VPS Lutfi tidak punya IPv6 global -> paksa edge IPv4 (QUIC tetap dipakai).
# Tanpa flag ini cloudflared memilih AAAA dan gagal: "Register tunnel error ... context deadline exceeded".
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --edge-ip-version 4 --url http://127.0.0.1:8090
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-simulasi
```

**Kenapa `Wants=`, bukan `Requires=` seperti contoh unit futures-signal.** Dengan
`Requires=`, setiap `systemctl restart simulasi-6-model` ikut mematikan tunnel, dan quick
tunnel selalu mendapat **subdomain baru** setiap kali hidup — bookmarkmu mati. Dengan
`Wants=` + `After=`, tunnel tetap hidup saat aplikasi restart; beberapa detik pertama
pengunjung melihat 502, lalu normal lagi di URL yang sama. Urutan start tetap benar karena
`After=`.

Ambil URL-nya:

```bash
journalctl -u cloudflared-simulasi -n 300 --no-pager \
  | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

Supaya tidak perlu mengingat perintah itu (URL berubah tiap restart), pasang pembantu di
VPS. Berkasnya menyimpan URL terbaru dan diperbarui cron tiap 2 menit serta saat reboot:

```bash
cat > ~/simulasi-url.sh <<'EOF'
#!/usr/bin/env bash
# Simpan URL Quick Tunnel simulasi 6 model yang sedang aktif.
set -euo pipefail
URL=$(journalctl -u cloudflared-simulasi --no-pager -n 400 2>/dev/null \
  | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
[ -n "${URL:-}" ] && echo "$URL" > "$HOME/simulasi-url.txt"
cat "$HOME/simulasi-url.txt" 2>/dev/null || echo "URL belum ada (cloudflared belum tersambung)"
EOF
chmod +x ~/simulasi-url.sh
( crontab -l 2>/dev/null | grep -v 'simulasi-url' ;
  echo '*/2 * * * * /home/ubuntu/simulasi-url.sh >/dev/null 2>&1' ;
  echo '@reboot sleep 45; /home/ubuntu/simulasi-url.sh >/dev/null 2>&1' ) | crontab -
~/simulasi-url.sh          # cetak URL aktif
cat ~/simulasi-url.txt     # berkas yang sama, tanpa hitung ulang
```

Saat pertama start, URL juga muncul di `journalctl -u cloudflared-simulasi -f`
(baris `Your quick Tunnel has been created! Visit it at ...`). Simpan URL itu — itulah
satu-satunya alamat aplikasi, karena VPS tidak punya IP publik.

---

## 8. Verifikasi end-to-end

```bash
# 1. aplikasi sehat di dalam VPS
curl -s -m 8 http://127.0.0.1:8090/api/health | python3 -c "
import sys,json; d=json.load(sys.stdin); l=d['live']; f=d['feed']
print('histori', l['historyMinutes'], '/', l['neededMinutes'], '| siap', l['ready'])
print('futures', f['future']['connected'], f['future']['transport'], '| spot', f['spot']['connected'], f['spot']['transport'])
print('harga terakhir', d.get('lastPrice'))
"

# 2. tunnel hidup
systemctl is-active cloudflared-simulasi simulasi-6-model

# 3. dari laptop: ganti dengan URL tunnelmu
curl -s -o /dev/null -w "%{http_code}\n" https://<acak>.trycloudflare.com/api/health
```

Lalu buka URL di browser:

- Harga di header bergerak (bukan 0 dan bukan beku).
- `FUT`/`SPOT` hijau, `ws xx ms` wajar.
- Panel kiri atas: `mengumpulkan data h/305` → berubah `siap` setelah ±5 jam.
- Tab REPLAY tetap bisa memutar data validasi (bukti `data/replay` ikut terkirim).
- WebSocket lewat tunnel: indikator snapshot di UI terus diperbarui; kalau UI diam padahal
  `curl` sehat, cek `journalctl -u cloudflared-simulasi` (WS diblokir biasanya terlihat
  sebagai error 502/`websocket: bad handshake` di sisi server).

Tombol **Cek WS** di UI memanggil `/api/diagnostics` dan menulis hasilnya ke log sistem —
cara tercepat memastikan feed, REST, dan socket browser semuanya sehat dari sisi aplikasi.

---

## 9. Menjaga jalan 24 jam

Yang sudah otomatis:

- `Restart=always` di kedua unit → crash/putus jaringan pulih dalam 5 detik.
- `systemctl enable` → hidup lagi setelah VPS reboot.
- Data menit ditulis ke disk setiap menit, jadi restart singkat tidak menghapus progres.

Yang harus dijaga manusia:

- **Jangan restart tanpa alasan.** Pemanasan butuh 305 menit kontinu. Downtime lebih dari
  5 menit memutus ekor histori (`tailMinutes`), dan angkanya turun — kalau downtime panjang,
  pemanasan mulai dari nol. Update kode beberapa detik aman.
- **Jangan hapus `apps/server/data/`.** Folder `replay` berasal dari repo (bisa dikirim
  ulang), tapi `minutes`/`signals`/`state` tidak bisa dipulihkan.
- **Jam VPS.** Pastikan NTP aktif; jam meleset membuat bar menit tidak cocok dengan Binance
  dan `historyMinutes` tidak naik seperti seharusnya.
- **URL tunnel berubah** setiap `cloudflared-simulasi` di-restart atau VPS reboot. Ambil
  ulang dengan perintah di langkah 7 dan kirim ke yang membutuhkan.
- **Disk dan journal.** `journalctl --disk-usage` sesekali; kalau membesar,
  `sudo journalctl --vacuum-time=7d`.

Update kode (tanpa menyentuh data, tunnel tetap hidup):

```bash
# dari Windows: kirim ulang hanya yang berubah (langkah 2), lalu di VPS:
cd ~/simulasi-testing
bun install --frozen-lockfile
bun run build
sudo systemctl restart simulasi-6-model
```

Backup harian data runtime (opsional, ukurannya kecil):

```bash
mkdir -p ~/backup
tar czf ~/backup/simulasi-$(date +%F).tgz -C ~/simulasi-testing/apps/server data/minutes data/signals data/state
find ~/backup -name 'simulasi-*.tgz' -mtime +14 -delete
```

Monitoring ringan tanpa agent (cron tiap 10 menit):

```bash
crontab -e
# tambahkan:
*/10 * * * * curl -fsS -m 8 http://127.0.0.1:8090/api/health -o /dev/null || echo "$(date -Is) health gagal" >> ~/simulasi-health.log
```

Kalau nanti ingin notifikasi Telegram saat health gagal, itu bisa ditambahkan di skrip cron
yang sama (kirim ke Bot API) — tidak perlu mengubah aplikasi.

---

## 10. Keamanan — baca ini

- Aplikasi ini **tanpa login**. Siapa pun yang punya URL bisa membuka panel dan memanggil
  `POST /api/system` (ON/OFF), `/api/bots/reset`, `/api/mode`, `/api/replay`. Perlakukan URL
  tunnel sebagai kunci rahasia; jangan ditempel di grup publik.
- Quick Tunnel **tidak mendukung Cloudflare Access**. Kalau butuh proteksi, dua pilihan:
  1. Named tunnel dengan domain sendiri + Cloudflare Access (login Google/email) — langkah
     upgrade yang paling rapi.
  2. Taruh reverse proxy ber-basic-auth (Caddy/nginx) di depan `127.0.0.1:8090`, lalu tunnel
     diarahkan ke proxy itu.
- Jangan mengubah `HOST` menjadi `0.0.0.0` kalau tidak perlu. Kalau terpaksa, batasi dengan
  firewall VPS.
- Jangan menyentuh `futures-signal.service` maupun unit cloudflared miliknya.

---

## 11. Alternatif: Docker Compose

Kalau lebih suka container (Docker sudah terpasang di VPS), aplikasi tidak perlu Bun di host:

```bash
cd ~/simulasi-testing
# ubah baris ports di docker-compose.yml menjadi:
#   - "127.0.0.1:${PORT:-8090}:8080"
PORT=8090 docker compose up -d --build
docker compose ps
docker compose logs -f --tail=50
```

- `restart: unless-stopped` dan `healthcheck` sudah ada di `docker-compose.yml`.
- Data runtime di-mount dari `./data/{minutes,signals,state}`; model dari
  `./apps/server/models`. Jangan hapus folder itu saat rebuild.
- Unit `cloudflared-simulasi` tetap sama, targetnya `http://127.0.0.1:8090`.
- Jangan pakai `docker stop` untuk "istirahat" — pakai `docker compose stop`; efeknya sama
  pada pemanasan (downtime > 5 menit memutus histori).

Kalau memilih Docker, unit `simulasi-6-model.service` di langkah 6 tidak dipakai; ganti
`Requires/Wants` pada unit cloudflared menjadi `docker.service`.

---

## 12. Troubleshooting

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| `status=203/EXEC` | path Bun salah / bukan absolut | `command -v bun`, pakai `/home/ubuntu/.bun/bin/bun` |
| Service langsung mati, log `EADDRINUSE` | port 8090 dipakai proses lain | `ss -ltnp \| grep 8090`, pilih port lain (ubah `.env` + unit + `--url`) |
| `curl` di VPS sehat, URL tunnel 502 | `--url` menunjuk port salah (8080 vs 8090) atau app mati | cek `ExecStart` unit tunnel dan `systemctl status simulasi-6-model` |
| URL tunnel balas **530** "Cloudflare Tunnel error" | cloudflared belum terdaftar ke edge (atau memilih IPv6 yang tidak ada) | `journalctl -u cloudflared-simulasi \| grep Registered`; kalau kosong tambahkan `--edge-ip-version 4` lalu restart |
| `Register tunnel error ... context deadline exceeded` | VPS tanpa IPv6 global, cloudflared memilih AAAA; sesekali juga jaringan ISP menolak sesaat | pakai `--edge-ip-version 4`, `StartLimitIntervalSec=0`, tunggu restart otomatis |
| Model `available:false` / tab REPLAY kosong | `apps/server/models` atau `data/replay` tidak ikut ter-deploy (repo GitHub belum lengkap) | salin `apps/server/models` (9,6 MB) + `apps/server/data/replay` (8,9 MB) dari laptop |
| UI lebih lambat / bundel ~495 KB | build UI dengan `NODE_ENV=development` | Dockerfile harus `ENV NODE_ENV=production` sebelum `bun run --cwd apps/web build` |
| URL tidak pernah muncul | outbound 7844 diblokir, DNS VPS rusak | `journalctl -u cloudflared-simulasi -f`, tes `curl -I https://1.1.1.1` |
| UI terbuka tapi harga diam | WS Binance bermasalah | `curl .../api/health` → lihat `feed.*.transport`; kalau `blocked`, cek DNS Binance di VPS (aplikasi punya DoH + tunnel otomatis) |
| `historyMinutes` tidak naik | jam VPS meleset, feed futures mati, atau celah menit | `timedatectl`, `api/health`, lihat `data/minutes/*.jsonl` 3 baris terakhir |
| Pemanasan turun setelah restart | downtime > 5 menit | normal; biarkan jalan sampai 305 lagi |
| `hitung 0x`, ekuitas tetap 1.000.000 | masih pemanasan | bukan bug — sinyal baru keluar setelah `ready=true` |
| Service OOM-killed saat build | RAM VPS kecil | build di lokal + `scp apps/web/dist`, atau tambah swap 1 GB |

Cek cepat semua sekaligus:

```bash
systemctl is-active simulasi-6-model cloudflared-simulasi
curl -s http://127.0.0.1:8090/api/health | head -c 600; echo
journalctl -u simulasi-6-model -n 15 --no-pager
journalctl -u cloudflared-simulasi -n 15 --no-pager
```

---

## 13. Lampiran

### Memasang cloudflared (kalau belum ada)

```bash
# Ubuntu/Debian x86_64
curl -fsSL -o /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### Menambah swap kalau RAM 1 GB

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### Alias SSH (opsional, di laptop)

`~/.ssh/config`:

```
Host simulasi-vps
    HostName 202.155.143.190
    Port 21031
    User ubuntu
```

Setelah itu cukup `ssh simulasi-vps`.

---

## 14. Checklist go-live

```
[ ] port 8090 bebas, futures-signal (8080) tidak disentuh
[ ] bun >= 1.4 dan cloudflared terpasang
[ ] kode terkirim, bun install sukses, apps/web/dist/index.html ada
[ ] .env VPS: PORT=8090, HOST=127.0.0.1, TZ=Asia/Jakarta
[ ] uji manual: banner tampil, /api/health ok, feed direct/tunnel
[ ] simulasi-6-model.service enabled + active
[ ] cloudflared-simulasi.service enabled + active
[ ] URL tunnel dicatat, UI terbuka dari luar, harga bergerak
[ ] pemanasan berjalan menuju 305/305 (siap ±5 jam)
[ ] data/ tidak akan dihapus, jam VPS sinkron
[ ] URL diperlakukan sebagai rahasia (aplikasi tanpa login)
```
