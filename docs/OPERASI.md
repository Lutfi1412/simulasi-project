# Operasi 24 jam

## Yang perlu disiapkan

- VPS dengan Bun **atau** Docker. Binance memblokir sebagian IP datacenter/region;
  kalau feed tidak pernah tersambung, pindah region (Singapore/Tokyo paling aman).
- Port aplikasi tidak perlu dibuka ke publik: jalankan di `127.0.0.1` lalu ekspos lewat
  Cloudflare Quick Tunnel — langkah lengkap di `docs/DEPLOY-VPS.md`.
- Tidak ada API key. Server hanya membaca data pasar publik.

## Menjalankan dengan Docker (disarankan)

```bash
git clone <repo> simulasi-testing && cd simulasi-testing
cp .env.example .env            # sesuaikan SYMBOL / INITIAL_MODE
mkdir -p data/minutes data/signals data/state
docker compose up -d --build
docker compose logs -f --tail 50
```

Data yang bertahan saat container dibuat ulang:

| Host | Isi |
|---|---|
| `data/minutes/` | baris menit futures & spot (sumber pemanasan setelah restart) |
| `data/signals/` | log sinyal per menit |
| `data/state/` | posisi, histori trade, status ON/OFF tiap bot |
| `apps/server/models/` | bundel model aktif + cadangan |

Kalau `data/state` dihapus, bot mulai lagi dari modal 1.000.000.

## Menjalankan tanpa Docker (systemd)

```ini
# /etc/systemd/system/simulasi.service
[Unit]
Description=Simulasi 6 model SOLUSDT
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/simulasi-testing
EnvironmentFile=/home/ubuntu/simulasi-testing/.env
ExecStart=/home/ubuntu/.bun/bin/bun run apps/server/src/index.ts
Restart=always
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
bun install && bun run build          # UI harus di-build sekali
sudo systemctl daemon-reload
sudo systemctl enable --now simulasi
journalctl -u simulasi -f
```

## Pemeriksaan rutin

```bash
curl -s localhost:8080/api/health   # feed, pemanasan, uptime
curl -s localhost:8080/api/models   # versi model aktif
```

Yang perlu dilihat di `/api/health`:

- `feed.future.connected` dan `feed.spot.connected` → keduanya harus `true`.
  `transport: tunnel` berarti DNS ISP membelokkan domain Binance dan server memakai
  jalur DoH + terowongan; itu normal dan tidak menurunkan kualitas data.
- `live.ready` → `true` setelah `live.historyMinutes` mencapai `neededMinutes` (305 default,
  minimum keras 300 = 240 lookback + 60 urutan GRU). `historyMinutes` menghitung histori yang
  menyambung, jadi jeda >5 menit saat server mati akan menurunkan angka ini. Naikkan
  `MIN_HISTORY_MINUTES` kalau ingin pemanasan lebih panjang; nilai di bawah 300 diabaikan.
  Sebelum itu bot sengaja tidak membuka posisi.
- `live.lastError` → kosong. Kalau berisi pesan, biasanya feed terputus sesaat.

## Pemanasan setelah restart

Pemanasan tidak hilang selama `data/minutes/` utuh: server memuat kembali baris menit
terakhir saat boot. Dengan Docker, folder itu di-mount dari host; tanpa Docker, ada di
`apps/server/data/minutes/`. Jangan hapus folder ini kalau tidak ingin menunggu 5 jam lagi.

## ON/OFF

- Tombol **AKTIF** di kanan atas (hotkey `P`), atau `POST /api/system {"enabled":false}`.
- OFF = tidak ada entri baru; posisi berjalan tetap dikelola sampai TP/SL/timeout.
- Status ON/OFF disimpan, jadi tetap OFF setelah restart sampai dinyalakan lagi.

## Reset

`POST /api/bots/reset` mengembalikan semua bot ke modal 1.000.000 dan mengosongkan histori
trade. Bisa juga lewat tombol RESET di panel buku transaksi. Data menit tidak dihapus.

## Backup

Cukup folder `data/` dan `apps/server/models/`:

```bash
tar czf simulasi-$(date +%F).tar.gz data apps/server/models
```

## Troubleshooting

**Feed futures `connected: false`, `transport: blocked`**
Jaringan memblokir semua jalur. Cek dari dalam server:

```bash
curl -s -m 8 https://fapi.binance.com/fapi/v1/time
curl -s -m 8 https://data-api.binance.vision/api/v3/time
```

Kalau keduanya gagal, pindahkan server ke region lain atau pakai VPN/egress lain.
Simulasi akan tetap jalan tetapi tidak menghitung sinyal (input tidak lengkap).

**Handshake WebSocket 101 tetapi tidak ada data**
Jalur `/ws` standar bisa dihentikan di edge. Server default memakai
`fstream.binance.com/market/ws`; pastikan `BINANCE_FUTURES_WS` tidak diubah ke `/ws`.

**`live.ready` tidak pernah `true`**
Lihat `live.historyMinutes`. Kalau angkanya tidak naik, feed futures tidak mengirim
transaksi (cek `feed.future.messages`). Kalau naik tetapi lambat, itu wajar: satu baris
per menit.

**Sinyal tidak muncul padahal sudah 5 jam**
Cek `SIGNAL_DOMINANCE_PCT=85` dan `SIGNAL_STREAK=12`. Nilai lain membuat fitur `sig_*`
tidak sepadan dengan data latih, sehingga model cenderung menahan sinyal.

**Replay terasa lambat**
Kecepatan putar dibatasi CPU (inference 6 model per baris). UI menampilkan `≈N` saat
kecepatan aktual di bawah pilihan. Turunkan pilihan kecepatan atau jalankan di mesin
yang lebih cepat; data tidak terpengaruh.

**Port sudah dipakai**
`PORT=8090 docker compose up -d` atau ubah `.env`.

Di Windows, jangan jalankan dua hal sekaligus di port yang sama: server native (`bun run start`),
container Docker, dan `bun run dev` (dev sudah pindah ke 8081). Gejalanya di UI: WebSocket
putus-putus dan log Vite berbunyi `ws proxy error: write ECONNABORTED` — itu tanda proxy
mengirim ke server yang berbeda dari yang dipakai halaman.

**Docker CLI balas `500 Internal Server Error`**
Biasanya service Windows `com.docker.service` sedang berhenti. Keluar dari Docker Desktop
(tray → Quit), buka lagi dari Start Menu dan setujui UAC, tunggu status "Engine running".
Lalu `docker compose up -d`. Tidak ada hubungannya dengan data simulasi.
