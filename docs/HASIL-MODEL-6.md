# Hasil Model SOLUSDT + BTC — 6 Model (80/20, 1 Validasi)

Dibuat: 2026-11-18 08:41 (lokal)

## Ringkasan

- ZIP: `futures_signal_log_20261118_083040.zip`
- Grid: 31,305 menit · sampel valid: 14,560
- Split: **80% latih / 20% validasi** · satu validasi (`VAL`) · 2,912 baris validasi
- Fitur terpilih: 40 · BTC: 18 fitur
- Model: 6 — Aturan dominasi, Regresi Logistik, XGBoost, Meta-label, GRU, Ensemble
- Perangkat: **cpu** · GRU: ya
- Aturan dominasi: **LONG bila porsi BUY >= 60% selama >= 50 pembaruan berturut-turut di SOL futures, SOL spot, BTC futures, dan BTC spot; SHORT sebaliknya**
- Konfigurasi: leverage 25x · TP 1.5% harga · SL 1.0% harga · horizon 720 menit
- Bug raw run: **diperbaiki** — kolom mentah diekspor sebagai `run_*__raw`, tidak bertabrakan dengan fitur log1p `run_*`.

## Tabel validasi (setara cell 12)

```text
           model  theta  ROI VAL %  trx VAL  ROI min %  menang %    TP %  maxDD %  likuidasi LOLOS
         XGBoost 0.5000   296.1716       11   296.1716   72.7273 72.7273  62.7970          0 tidak
Regresi Logistik 0.7570   195.0834       10   195.0834   70.0000 70.0000  62.7970          0 tidak
        Ensemble 0.5000   -18.8342       12   -18.8342   50.0000 50.0000  73.3124          0 tidak
      Meta-label 0.6240   -54.5756       10   -54.5756   40.0000 40.0000  66.2291          0 tidak
 Aturan dominasi 0.5000   -63.9832        5   -63.9832   20.0000 20.0000  73.2232          0 tidak
             GRU 0.6000   -87.5710       12   -87.5710   25.0000 25.0000  87.5710          0 tidak
```

## Model terpilih & rekomendasi

- Model terpilih (aturan notebook): **XGBoost** · θ=0.5 · lolos kriteria: **BELUM**
- **Tidak ada model yang lolos** semua kriteria (`ROI ≥ 60%`, transaksi ≥ 10, drawdown ≤ 50%). Ini informasi, bukan kegagalan alur.

- **XGBoost** — ROI validasi 296.17%; transaksi 11; maxDD 62.80%; LOLOS tidak
- **Regresi Logistik** — ROI validasi 195.08%; transaksi 10; maxDD 62.80%; LOLOS tidak
- **Ensemble** — ROI validasi -18.83%; transaksi 12; maxDD 73.31%; LOLOS tidak
- **Meta-label** — ROI validasi -54.58%; transaksi 10; maxDD 66.23%; LOLOS tidak

**Catatan memilih:** lihat ROI validasi + jumlah transaksi. ROI ratusan persen dengan 1–5 transaksi bisa kebetulan. Model dengan transaksi lebih banyak lebih bisa dinilai, walau ROI-nya lebih rendah.

## Detail model terpilih

```text
lipatan  ROI_pct  transaksi  menang_pct  kena_target_pct  rata2_ROI_per_trx  profit_factor  maxDD_pct  likuidasi
    VAL 296.1716         11     72.7273          72.7273            17.3636         3.2675    62.7970          0
```

## Uji statistik & kualitas sinyal

- Titik impas: **45.6%** transaksi harus kena target.
- Model terpilih: **8/11** transaksi kena target = **72.7%** · uji binomial p = **0.066**.
- Presisi sinyal LONG **26.1%** / SHORT **40.9%**; recall LONG **20.3%** / SHORT **0.9%**.
- Jumlah sinyal validasi: LONG **876** · SHORT **22** dari **2,912** menit.

## Catatan 6 model

- GRU dilatih **12 epoch** di **cpu**; di CPU hasilnya belum matang (GPU/Colab 60 epoch lebih baik).
- Ensemble = XGBoost + Regresi Logistik + GRU.
- Semua model tetap diekspor walau ada yang belum lolos, sesuai permintaan 6 model.

## Berkas ekspor

| Model | Kind | θ | File | Ukuran | ROI validasi |
|---|---|---|---|---|---|
| Aturan dominasi | rule | 0.500 | `models/aturan_dominasi.json` | 0 KB | -63.98% |
| Regresi Logistik | logreg | 0.757 | `models/regresi_logistik.json` | 4 KB | 195.08% |
| XGBoost | xgb | 0.500 | `models/xgboost.json` | 123 KB | 296.17% |
| Meta-label | meta | 0.624 | `models/meta_label.json` | 41 KB | -54.58% |
| GRU | gru | 0.600 | `models/gru.json` | 555 KB | -87.57% |
| Ensemble | ensemble | 0.500 | `models/ensemble.json` | 0 KB | -18.83% |

Folder: `C:\Users\sawal fitah\Downloads\model\web_export_sol_btc`
