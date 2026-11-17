# Hasil Model SOLUSDT + BTC — 6 Model

Dibuat: 2026-11-17 15:46 (waktu lokal)

## Ringkasan

- Sumber data: `futures_signal_log_20261117_084949.zip`
- Grid: 29,884 menit · sampel valid: 14,145 · fitur terpilih: 40
- Model: 6 — Aturan dominasi, Regresi Logistik, XGBoost, Meta-label, GRU, Ensemble
- Perangkat latih: **cpu** · GRU: ya
- Konfigurasi: leverage 25x · TP 1.5% harga · SL 1.0% harga · horizon 720 menit

## Tabel validasi 3 lipatan (setara cell 12)

```text
           model  theta  ROI V1 %  ROI V2 %  ROI V3 %  trx V1  trx V2  trx V3  ROI min %  menang %    TP %  maxDD %  likuidasi LOLOS
 Aturan dominasi 0.5000  -48.3400  -27.9950   -3.1479       2       1       2   -48.3400   16.6667 16.6667  48.3400          0 tidak
      Meta-label 0.5000  215.7345  -54.8049  126.5490       6      10       7   -54.8049   64.9206 64.9206  75.0196          0 tidak
             GRU 0.5000  311.2833  -86.6472  127.3508       9       8       7   -86.6472   53.9021 53.9021  90.0728          0 tidak
        Ensemble 0.5000  311.2833  -86.6472  134.7663       9       8       5   -86.6472   56.7593 56.7593  90.0728          0 tidak
         XGBoost 0.5000  -34.8406  -92.8270  -51.6434       7       8       6   -92.8270   25.3968 25.3968  92.8270          0 tidak
Regresi Logistik 0.5000  311.2833  -92.8519   63.3770       9       8       8   -92.8519   46.7593 46.7593  92.8519          0 tidak
```

## Model terbaik menurut aturan notebook

- Model terpilih: **Aturan dominasi** · θ=0.5 · lolos semua kriteria: **BELUM**
- ROI minimum (lipatan terburuk): **-48.34%**
- **Tidak ada model yang memenuhi semua kriteria** (`ROI ≥ 60%`, `transaksi ≥ 10`, `drawdown ≤ 50%` di setiap lipatan). Ini informasi, bukan kegagalan alur.

## Detail lipatan model terpilih

```text
lipatan  ROI_pct  transaksi  menang_pct  kena_target_pct  rata2_ROI_per_trx  profit_factor  maxDD_pct  likuidasi
     V1 -48.3400          2      0.0000           0.0000           -28.1250         0.0000    48.3400          0
     V2 -27.9950          1      0.0000           0.0000           -27.9950         0.0000    27.9950          0
     V3  -3.1479          2     50.0000          50.0000             3.2563         1.2326    27.9950          0
```

## Uji statistik & kualitas sinyal

- Titik impas: **45.6%** transaksi harus kena target.
- Model terpilih: **1/4244** transaksi kena target = **0.0%** · uji binomial p = **0.952**.
- Presisi sinyal LONG **0.0%** / SHORT **25.0%**; recall LONG **0.0%** / SHORT **0.0%**.
- Jumlah sinyal validasi: LONG **5** · SHORT **4** dari **4,244** menit.

## Rekomendasi

Belum ada model yang benar-benar "lolos" semua kriteria. Kalau harus memilih, lihat **ROI min %**
(lipatan terburuk) **dan jumlah transaksi**, bukan rata-rata:
- **Aturan dominasi** — ROI min -48.34%; transaksi per lipatan 2,1,2. Paling sedikit rugi di
  lipatan terburuk, tetapi sampelnya terlalu kecil (5 transaksi) untuk dipercaya.
- **Meta-label** — ROI min -54.80%; transaksi per lipatan 6,10,7 (23 transaksi). Sampel lebih
  banyak, tetapi drawdown 75% dan V2 tetap rugi.
- **GRU** — ROI min -86.65%; transaksi 9,8,7 (24 transaksi), drawdown 90%. GRU baru dilatih
  **12 epoch di CPU**; hasil ini belum matang, bukan kesimpulan final.
- **Ensemble** — ROI min -86.65%; V1/V3 bagus tetapi V2 -86.65%, jadi belum stabil.

**Kesimpulan praktis:** untuk Auto 6 model, jangan mengandalkan satu model saja. Skema Auto
Anda yang menentukan kombinasi. Kalau harus memilih satu model untuk dipantau, **Meta-label**
lebih masuk akal daripada Aturan dominasi karena jumlah transaksinya lebih banyak; tetapi
keduanya belum "lolos". Untuk memperbaiki GRU, jalankan ulang notebook di GPU/Colab dengan
60 epoch, lalu ekspor dan verifikasi ulang.

Perhatikan juga: pemilihan θ memakai lipatan validasi yang sama, jadi hasilnya sedikit
optimistis. Penilaian tidak bias hanya dari data uji terpisah (bagian 14 notebook).

## Catatan 6 model

- GRU ikut dilatih dan diekspor (12 epoch, device cpu).
- GRU di CPU dibatasi 12 epoch oleh notebook. Untuk hasil GRU yang lebih matang, jalankan ulang di GPU/Colab dengan 60 epoch.
- Ensemble sekarang berisi XGBoost + Regresi Logistik + GRU.
- Model tetap diekspor semua (6) walau ada yang belum lolos validasi, supaya Auto tetap memakai 6 model.

## Berkas ekspor

| Model | Kind | θ | File | Ukuran | ROI min |
|---|---|---|---|---|---|
| Aturan dominasi | rule | 0.500 | `models/aturan_dominasi.json` | 0 KB | -48.34% |
| Regresi Logistik | logreg | 0.500 | `models/regresi_logistik.json` | 4 KB | -92.85% |
| XGBoost | xgb | 0.500 | `models/xgboost.json` | 122 KB | -92.83% |
| Meta-label | meta | 0.500 | `models/meta_label.json` | 38 KB | -54.80% |
| GRU | gru | 0.500 | `models/gru.json` | 555 KB | -86.65% |
| Ensemble | ensemble | 0.500 | `models/ensemble.json` | 0 KB | -86.65% |

Folder: `C:\Users\sawal fitah\Downloads\model\web_export_sol_btc`
