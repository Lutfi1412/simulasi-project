# Update model setelah fine-tuning

Simulasi memuat model dari `apps/server/models/current/`. Selama itu masih bundel hasil
export notebook (`manifest.json` + `models/*.json`), model bisa diganti kapan saja tanpa
mengubah kode — asalkan daftar fiturnya sama.

## 1. Export ulang dari notebook

Jalankan bagian export di `futures_signal_model.ipynb` seperti saat pertama. Hasilnya
struktur yang sama dengan `web_export`:

```
web_export/
├── FORMAT.md
├── manifest.json          # versi, fitur, model, theta, pengaturan trading
├── models/                # aturan_dominasi, regresi_logistik, xgboost, meta_label, gru, ensemble
└── data/                  # replay.json, golden_proba.json, golden_results.json
```

Yang penting untuk kompatibilitas:

| Bagian manifest | Syarat |
|---|---|
| `features` | daftar 40 fitur **identik** dengan bundel aktif. Fitur dihasilkan `src/core/featureBuilder.ts`; kalau berubah, kode builder harus ikut diubah dan diverifikasi |
| `signal_rule` | 85% × 12 (sama dengan `SIGNAL_DOMINANCE_PCT` / `SIGNAL_STREAK`) |
| `trading` | `LEVERAGE`, `CAPITAL`, `TP_PCT`, `SL_PCT`, `HORIZON_MIN`, `SEQ_LEN`, fee/slippage/funding; dipakai apa adanya oleh simulator |
| `symbol` | harus sama dengan `SYMBOL` di `.env` |

`models:install` menolak bundel yang daftar fiturnya berbeda, kecuali dipaksa `--force`.

## 2. Pasang bundel baru

```bash
bun run models:install "C:/Users/sawal fitah/Downloads/web_export"
```

Skrip ini memvalidasi manifest, mencadangkan bundel aktif ke `models/backup-YYYYMMDD-HHMMSS`,
lalu menyalin bundel baru ke `models/current`.

Dengan Docker, folder `apps/server/models` di-mount dari host, jadi cukup jalankan perintah
di atas di host lalu reload — tidak perlu rebuild image.

## 3. Muat ulang tanpa restart

```bash
curl -X POST http://localhost:8080/api/models/reload
```

`/api/models/reload` memuat ulang manifest dan bobot model, mengosongkan state internal model
(riwayat rule & urutan GRU), **tanpa** mereset bot, posisi, atau histori trade.
Posisi yang sedang berjalan tetap memakai sinyal lama sampai ditutup — ini disengaja.

Kalau lebih suka bersih: `docker compose restart` (state bot tetap dipulihkan dari
`data/state/bots.json`), atau `POST /api/bots/reset` untuk mengembalikan semua bot ke modal awal.

## 4. Periksa setelah update

```bash
curl -s http://localhost:8080/api/models | head -c 600      # versi + daftar model
curl -s http://localhost:8080/api/health | head -c 400      # feed + pemanasan
```

Di UI: panel kanan bawah menampilkan `model v<versi> · <jumlah> model · <ambang>% × <streak>`.
Kalau angka itu berubah, model baru sudah aktif.

## 5. Verifikasi paritas (disarankan)

Kalau `data/replay.json`, `golden_proba.json`, dan `golden_results.json` ikut di-export ulang:

```bash
cp <web_export>/data/*.json apps/server/data/replay/
bun run verify
```

Tiga skrip itu membandingkan implementasi TypeScript dengan hasil Python baris per baris.
Kalau lolos, perilaku model di simulasi sama dengan di notebook.

## Rollback

```bash
ls apps/server/models                     # cari folder backup-*
rm -rf apps/server/models/current
cp -r apps/server/models/backup-20261108-031500 apps/server/models/current
curl -X POST http://localhost:8080/api/models/reload
```

## Kalau model dilatih dengan fitur berbeda

Model baru dengan fitur berbeda **tidak** bisa langsung dipakai: `featureBuilder.ts`
menghasilkan daftar fitur tetap dari notebook. Langkahnya:

1. ubah `apps/server/src/core/featureBuilder.ts` mengikuti sel feature notebook yang baru
2. sesuaikan `manifest.features` (nama dan urutan)
3. jalankan `bun run verify:features` terhadap `replay.json` hasil export baru — harus 100%
4. baru pasang bundelnya dengan `--force`

Tanpa langkah 3, sinyal akan tampak wajar tetapi berasal dari input yang tidak sama
dengan data latih.
