# Update model setelah fine-tuning

Simulasi memuat model dari `apps/server/models/current/`. Selama itu masih bundel hasil
export notebook (`manifest.json` + `models/*.json`), model bisa diganti kapan saja tanpa
mengubah kode — **asalkan daftar fiturnya sama dan semua fitur itu sudah dihitung
`src/core/featureBuilder.ts`**.

Bundel aktif sejak 17 Nov 2026 berisi **6 model** (termasuk GRU) dan memakai **konteks
BTCUSDT**: 40 fiturnya campuran fitur SOL dan **16 fitur `btc_*`** (18 kolom baru, 2 di
antaranya fitur SOL `tb_ratio_60`/`netflow_15`).
Server karena itu menjalankan **empat stream** (SOL futures, SOL spot,
BTC futures, BTC spot). Data BTC hanya menjadi fitur; order tetap untuk SOL.

## 1. Export ulang dari notebook

Jalankan bagian export di `futures_signal_model_sol_btc_local.ipynb`. Hasilnya struktur yang
sama dengan `web_export_sol_btc`:

```
web_export_sol_btc/
├── FORMAT.md
├── manifest.json          # versi, btc_symbol, fitur, model, theta, pengaturan trading
├── models/                # aturan_dominasi, regresi_logistik, xgboost, meta_label, ensemble
└── data/                  # replay.json, golden_proba.json, golden_results.json
```

Yang penting untuk kompatibilitas:

| Bagian manifest | Syarat |
|---|---|
| `features` | daftar fitur **identik** dengan hasil `featureBuilder.ts`. Model tanpa BTC butuh builder versi lama; model dengan `btc_*` butuh feed BTC (sudah ada sejak 17 Nov 2026) |
| `btc_symbol` | `BTCUSDT` (dipakai feed konteks; fallback `BTC_SYMBOL` di `.env`) |
| `signal_rule` | 85% × 12 (sama dengan `SIGNAL_DOMINANCE_PCT` / `SIGNAL_STREAK`) |
| `trading` | **tidak dipakai apa adanya** — `models:install` mempertahankan angka dari bundel lama (TP 35 / SL 55 / margin 0.5 / lev 25 / cooldown 30). Pakai `--reset-trading` hanya kalau memang ingin memakai angka backtest ekspor (TP 1.5% / SL 1.0% harga) |
| `symbol` | harus sama dengan `SYMBOL` di `.env` |

`models:install` menolak bundel yang daftar fiturnya berbeda, kecuali dipaksa `--force`.
Angka `trading` dan tiga berkas `data/` (replay + golden) diurus otomatis oleh skrip.

## 2. Pasang bundel baru

```bash
bun run models:install "C:/Users/sawal fitah/Downloads/model/web_export_sol_btc"
```

Skrip ini:

1. memvalidasi manifest dan daftar fitur,
2. mencadangkan bundel aktif ke `models/backup-YYYYMMDD-HHMMSS`,
3. menyalin bundel baru ke `models/current`,
4. **mempertahankan `trading`** dari bundel lama,
5. **menyalin `data/*.json`** (replay + golden) ke `apps/server/data/replay`.

Dengan Docker, folder `apps/server/models` di-mount dari host. `data/replay` **tidak**
di-mount, jadi kalau hanya mengganti model (tanpa mengubah fitur/kode), cukup salin replay
di host lalu `POST /api/models/reload`. Kalau **fitur atau kode berubah** (seperti BTC pada
17 Nov 2026), rebuild image wajib karena `featureBuilder.ts` ikut berubah.

Hapus folder `backup-*` setelah verifikasi lolos supaya repo bersih.

## 3. Muat ulang tanpa restart

```bash
curl -X POST http://localhost:8090/api/models/reload
```

`/api/models/reload` memuat ulang manifest dan bobot model, mengosongkan state internal model
(riwayat rule & urutan GRU), **tanpa** mereset bot, posisi, atau histori trade.
Posisi yang sedang berjalan tetap memakai sinyal lama sampai ditutup — ini disengaja.

Kalau lebih suka bersih: `docker compose restart` (state bot tetap dipulihkan dari
`data/state/bots.json`), atau `POST /api/bots/reset` untuk mengembalikan semua bot ke modal awal.

## 4. Periksa setelah update

```bash
curl -s http://localhost:8090/api/models | head -c 600      # versi + daftar model
curl -s http://localhost:8090/api/health | head -c 500      # feed + pemanasan
curl -s http://localhost:8090/api/diagnostics | head -c 800 # feed BTC juga ikut diperiksa
```

Di UI: panel kanan bawah menampilkan `model v<versi> · <jumlah> model · <ambang>% × <streak>`.
Kalau angka itu berubah, model baru sudah aktif.

> **Model dengan fitur BTC butuh pemanasan BTC sendiri.** `historyMinutes` dan `ready`
> sekarang menunggu **empat** seri: SOL futures, SOL spot, BTC futures, BTC spot. Data SOL
> 305 menit tetap utuh, tetapi BTC mulai dari nol saat pertama kali feed BTC dinyalakan,
> jadi sinyal pertama bisa tertunda sampai ±305 menit. Ini normal, bukan data hilang.
> Berkas BTC ditulis terpisah: `data/minutes/btc_future.jsonl` dan `btc_spot.jsonl`.

## 5. Verifikasi paritas (wajib kalau fitur berubah)

`models:install` sudah menyalin replay + golden otomatis. Lalu:

```bash
bun run verify:models     # probabilitas & sinyal vs golden Python — harus semua OK
bun run verify:features   # 40 fitur dari CSV/BTC vs replay.json — harus SEMUA COCOK
```

`verify:sim` sengaja **tidak** dipakai sebagai syarat: simulator website memakai TP/SL
sebagai ROI (35/55), sedangkan notebook memakai gerak harga (1.5%/1.0%). Perbedaannya
bukan bug implementasi, jadi fokus pada dua skrip di atas.

Laporan hasil validasi 6 model terbaru: `docs/HASIL-MODEL-6.md`.

## Rollback

```bash
ls apps/server/models                     # cari folder backup-*
rm -rf apps/server/models/current
cp -r apps/server/models/backup-20261108-031500 apps/server/models/current
curl -X POST http://localhost:8090/api/models/reload
```

## Kalau model dilatih dengan fitur berbeda

Model baru dengan fitur berbeda **tidak** bisa langsung dipakai: `featureBuilder.ts`
harus menghasilkan semua fitur itu dari data mentah yang tersedia di server. Langkahnya:

1. ubah `apps/server/src/core/featureBuilder.ts` mengikuti sel feature notebook yang baru
2. kalau fitur butuh pasar baru (contoh 17 Nov 2026: `btc_*` butuh BTCUSDT futures + spot),
   tambahkan feed & penyimpanan menitnya seperti `BinanceFeed`/`LivePipeline` sekarang
3. sesuaikan `manifest.features` (nama dan urutan)
4. ganti CSV di `fixtures/menit/` dengan ekspor baru (termasuk BTC) agar `verify:features`
   membandingkan rentang data yang sama
5. jalankan `bun run verify:features` terhadap `replay.json` hasil export baru — harus 100%
6. baru pasang bundelnya dengan `--force`

Tanpa langkah 5, sinyal akan tampak wajar tetapi berasal dari input yang tidak sama
dengan data latih.
