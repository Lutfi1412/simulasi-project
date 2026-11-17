# Simulasi Model · SOLUSDT

Simulasi paper trading realtime untuk model sinyal hasil export notebook
(`futures_signal_model_sol_btc_local.ipynb`). Bundel aktif 17 Nov 2026 berisi **6 model**
(Aturan dominasi, Regresi Logistik, XGBoost, Meta-label, **GRU**, Ensemble) dan 40 fitur — termasuk
16 fitur konteks `btc_*` (dari 18 kolom baru; 2 kolom lainnya fitur SOL `tb_ratio_60` dan
`netflow_15`). Harga dan arus transaksi diambil langsung dari WebSocket publik
Binance, bukan data dummy. Setiap model punya bot sendiri dengan modal simulasi 1.000.000
dan aturan eksekusi yang sama, jadi perbedaan hasil murni berasal dari sinyalnya.

```
┌─ Binance ─────────────┐        ┌─ server Bun ──────────────────────────────────┐
│ SOL futures aggTrade  │──┐     │  minuteRecorder → featureBuilder (40 fitur)   │
│ SOL spot trade        │──┤     │  + konteks BTC futures/spot (fitur btc_*)     │
│ BTC futures/spot      │──┴────▶│  → model (TS murni) → bot manager (paper)     │
└───────────────────────┘        │  → snapshot 2 dtk → HTTP + WebSocket          │
                                 └───────────────────────────────────────────────┘
                                                    │
                                    React + Vite + Tailwind (apps/web)
```

## Isi repo

| Path | Isi |
|---|---|
| `apps/server/src/core/` | pencatat menit (port `MinuteRecorder`), 40 fitur (`build_features()` notebook, termasuk `btc_*`) |
| `apps/server/src/models/` | inferensi murni TypeScript: rule, logreg, xgb, meta, gru, ensemble |
| `apps/server/src/sim/bot.ts` | simulator posisi: entry open menit berikutnya, TP/SL/timeout, fee, slippage, funding |
| `apps/server/src/feed/` | Binance WS SOL futures/spot + BTC futures/spot, aturan sinyal 85% × 12, jaringan (DoH + terowongan) |
| `apps/server/src/live/` | pipeline live: transaksi → menit → fitur → model → bot |
| `apps/server/src/replay/` | pemutar data validasi historis (`data/replay/replay.json`) |
| `apps/server/src/api/` | `Bun.serve`: REST + WebSocket + serve UI statis |
| `apps/web/src/` | UI terminal trading (React 19 + Tailwind 4) |
| `scripts/` | verifikasi paritas + pemasang model |
| `docs/` | deploy VPS + Cloudflare Tunnel, operasi 24 jam, cara update model |

## Menjalankan

Butuh **Bun ≥ 1.4** (Node tidak dipakai).

```bash
bun install
cp .env.example .env          # Windows: copy .env.example .env
bun run dev                   # UI dev :5173 + API :8081 (proxy /api /ws)
bun run dev -- --host         # sama, plus bisa dibuka dari HP di Wi-Fi yang sama
```

Dev memakai port **8081** supaya tidak berebut dengan container Docker di 8080.
Kalau 8081 juga dipakai, ganti: `PORT=8082 bun run dev`.

Mode produksi (UI di-build, satu port):

```bash
bun run build                 # build apps/web/dist
bun run start                 # http://localhost:8080
```

Docker:

```bash
docker compose up -d --build
docker compose logs -f
```

UI: `http://localhost:8080` · API health: `/api/health` · WebSocket: `/ws`.

## Buka dari HP (jaringan yang sama)

Cukup satu port, tanpa Vite:

1. Pastikan HP dan komputer di Wi-Fi yang sama.
2. Cari IP komputer: `ipconfig` (IPv4, mis. `192.168.100.11`).
3. Buka di browser HP: `http://192.168.100.11:8080`.

Server mengikat `HOST=0.0.0.0`, jadi alamat LAN langsung melayani UI + API + WebSocket.
Kalau halaman tidak terbuka, izinkan port di firewall Windows (jalankan sekali, butuh admin):

```powershell
New-NetFirewallRule -DisplayName "Simulasi 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Mode dev (hot reload) untuk dibuka dari HP: `bun run dev -- --host` → buka `http://<ip>:5173`.
Alamat LAN-nya dicetak otomatis oleh skrip dev. Jangan menyalakan dev di port 8080 saat
container Docker hidup — skrip dev akan menolak dan memberi tahu pilihan port lain.

## Aplikasi Android

Aplikasi Kotlin + Jetpack Compose + WebView ada di
`C:\Users\sawal fitah\AndroidStudioProjects\simulasi-trading` (di luar repo). UI-nya memuat
dashboard yang sama, dengan foreground service untuk sinyal + patokan + notifikasi suara
saat aplikasi tidak dibuka. Detail, hasil build, dan cara update: `docs/MOBILE-APP.md`.

## Dua mode

**live** — data Binance realtime. Harga di header mengikuti transaksi terakhir (bukan ticker 24 jam),
jadi angkanya bergerak tiap detik; indikator `detak` menunjukkan transaksi futures per detik. Server mencatat transaksi per menit, dan sinyal baru
keluar setelah histori cukup: **305 menit** = 240 menit lookback fitur (`ret_240`, `basis_z`,
`vol_z`) + 60 baris cadangan urutan + 5 menit cadangan untuk celah grid. Batas bawah kerasnya **300**;
`MIN_HISTORY_MINUTES` boleh diperbesar, nilai lebih kecil otomatis dinaikkan. Sejak model
BTC (17 Nov 2026), pemanasan menunggu **empat seri** (SOL futures/spot + BTC futures/spot),
jadi data SOL lama tetap utuh tetapi BTC harus mengumpulkan 305 menitnya sendiri. Histori
harus menyambung (celah ≤5 menit diisi ffill) — itu sebabnya angka pemanasan bisa turun
setelah server mati lama. Selama pemanasan, UI menampilkan progres dan bot tidak membuka
posisi. Histori menit disimpan ke `apps/server/data/minutes/` sehingga restart tidak
menghapus pemanasan (`btc_future.jsonl` dan `btc_spot.jsonl` terpisah dari berkas SOL).

**replay** — memutar ulang data validasi yang sama dengan lipatan walk-forward notebook
(V1/V2/V3). Berguna untuk melihat semua model aktif bekerja dalam hitungan detik tanpa menunggu
pemanasan. Kecepatan putar dibatasi CPU: kalau inference tidak sanggup, replay melambat
sendiri dan UI menampilkan kecepatan aktual (`≈120`).

Tombol **Cek WS** memanggil `/api/diagnostics` dan menulis hasilnya ke tab **log sistem**:
status socket, jumlah snapshot, umur pesan tiap feed, latensi REST Binance, sisa pemanasan,
dan daftar masalah. Kalau tampilan terasa "tidak bergerak", tombol ini yang menjawab sebabnya.

Tombol **AKTIF/OFF** (atau tombol `P`) menghentikan *entri baru*; posisi yang sudah berjalan
tetap dikelola sampai TP/SL/timeout. State bot, histori trade, dan status ON/OFF disimpan
tiap 30 detik dan dipulihkan saat server hidup lagi.

## Verifikasi paritas

Port TypeScript ini diuji terhadap export Python-nya:

```bash
bun run verify:features   # 40 fitur TS (termasuk btc_*) vs replay.json
bun run verify:models     # probabilitas + sinyal vs golden_proba.json
bun run verify:sim        # ekuitas/ROI/jumlah trade vs golden_results.json (opsional)
bun run verify            # fitur + model (sim dilewati; lihat catatan di bawah)
```

Hasil bundel 17 Nov 2026 (6 model): fitur **SEMUA COCOK** (selisih ≤2,5e-14, 0 baris
beda); selisih probabilitas maksimum **2,7e-7** (GRU); sinyal berbeda **0/4244** di 6 model.
`verify:sim` sengaja berbeda: simulator website memakai TP/SL sebagai ROI (35/55),
notebook memakai gerak harga (1,5%/1,0%). Fokus pada `verify:features` + `verify:models`.

Hasil validasi lengkap 6 model (tabel 3 lipatan, rekomendasi, catatan GRU CPU):
`docs/HASIL-MODEL-6.md`.

## SOL trading vs BTC features (tidak ambigu)

Ini penting supaya tidak salah baca:

| Hal | Memakai apa |
|---|---|
| Label / target model | **SOLUSDT futures** (`open_f/high_f/low_f/close_f` di notebook) |
| Simulasi/backtest | harga **SOLUSDT** |
| Bot/order di website | **SOLUSDT** |
| Fitur `btc_*` | **BTCUSDT futures + spot** — hanya konteks, tidak pernah menjadi order |
| Data latih | ZIP berisi **4 CSV menit**: SOL futures, SOL spot, BTC futures, BTC spot |

Jadi model memprediksi arah **SOL** dengan bantuan konteks **BTC**. Ini bukan model yang
trading BTC. Di website, status **`arus 4/4`** dan titik `btc-f`/`btc-s` di topbar
menunjukkan keempat feed hidup. `/api/health` juga memuat `btcFeed`,
`feedsConnected`, dan `feedsTotal`.

Kalau salah satu dari 4 arus mati atau fitur BTC belum lengkap, server menandai baris
`bad`/`ready=false` dan **tidak** memanggil model — jadi tidak ada sinyal dari input
setengah-setengah. Data 305 menit di `data/minutes/` adalah pemanasan **live**, bukan data
latih; data latih berasal dari ZIP 4 CSV. Tidak perlu menghapus/menambang ulang data 305
menit untuk memakai BTC.

## Realtime Binance

Server memakai **empat feed** tanpa API key:

- SOL futures: `wss://fstream.binance.com/market/ws/<symbol>@aggTrade` + REST `fapi.binance.com`
- SOL spot: `wss://data-stream.binance.vision/ws/<symbol>@trade` + REST `data-api.binance.vision`
- BTC futures + BTC spot: endpoint sama dengan simbol `BTC_SYMBOL` (`manifest.btc_symbol`)

Keempatnya wajib: fitur `basis_bps`, `basis_z`, `dom_gap_15` membandingkan SOL futures/spot,
sedangkan fitur `btc_*` membandingkan BTC futures/spot dan SOL. Kalau salah satu feed mati,
UI/diagnostik menandainya dan sinyal tidak dihitung dari input yang tidak lengkap.

Jalur `fstream.binance.com/market/ws` dipakai karena jalur standar `/ws` bisa dihentikan
di edge Binance untuk sebagian jaringan (handshake 101 tetapi tanpa frame data).
Kalau DNS ISP membelokkan domain Binance, `src/feed/net.ts` menyelesaikannya lewat
DNS-over-HTTPS Cloudflare lalu menyambung via terowongan TCP lokal dengan SNI dan header
`Host` asli. Status per feed (`transport: direct | tunnel | blocked`) tampil di `/api/health`.

## Konfigurasi

Semua lewat `.env` (lihat `.env.example`): port, `SYMBOL`, `BTC_SYMBOL`, endpoint Binance,
ambang sinyal, `AUTO_START`, `INITIAL_MODE`. `SIGNAL_DOMINANCE_PCT` dan `SIGNAL_STREAK`
**harus** tetap 85 dan 12 — nilainya harus sama dengan saat data mining direkam, karena
fitur `sig_*` dilatih dari aturan itu. `BTC_SYMBOL` hanya konteks fitur; order tetap SOL.

## API

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/health` | status feed, pemanasan, uptime |
| GET | `/api/snapshot` | seluruh state UI (bot, posisi, trade, log, replay) |
| GET | `/api/signals` | payload ringan: harga + sinyal terbaru (dipakai aplikasi mobile) |
| GET | `/api/trades?model=<nama>&limit=<n>` | histori trade |
| GET | `/api/models` | manifest model aktif |
| GET | `/api/diagnostics` | cek WS, feed, REST Binance, pemanasan (dipakai tombol **Cek WS**) |
| POST | `/api/system` | `{"enabled": true\|false}` — ON/OFF sistem |
| POST | `/api/mode` | `{"mode": "live"\|"replay"}` |
| POST | `/api/replay` | `{"action": "play\|pause\|reset\|seek\|speed", "value": n}` |
| POST | `/api/bots/reset` | semua bot kembali ke modal 1.000.000 |
| POST | `/api/feed/reconnect` | menyambung ulang feed Binance tanpa restart |
| POST | `/api/models/reload` | muat ulang bundel model tanpa restart |
| WS | `/ws` | snapshot tiap 2 detik |

## Update model setelah fine-tuning

Ringkas: export ulang dari notebook → `bun run models:install <folder>` → `POST /api/models/reload`.
Langkah lengkap, termasuk syarat kompatibilitas fitur dan rollback: `docs/UPDATE-MODEL.md`.

## Operasi 24 jam

Perilaku runtime, log, backup, pemulihan, dan troubleshooting harian: `docs/OPERASI.md`.

Status deploy VPS yang sedang berjalan, path file `.service`, prosedur update tanpa
kehilangan data, dan **link akses publik**: `docs/DEPLOY-VPS.md`.

Link akses saat ini (Cloudflare Quick Tunnel; berubah bila tunnel di-restart):

```
https://marking-lit-alice-sustainable.trycloudflare.com
```

## Catatan

Paper trading murni — tidak ada order, API key, atau dana nyata yang dikirim ke Binance.
Data dan model di `apps/server/` berasal dari export notebook; `_reference/` (kalau ada)
hanya bahan referensi dan tidak dipakai saat runtime.
