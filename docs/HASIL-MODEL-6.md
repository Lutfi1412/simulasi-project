# Hasil Model SOLUSDT + BTC — 6 Model (80/20, 1 Validasi)

Dibuat: 2026-11-19 (bundel `2026-11-19T07:32:19Z`)

## Ringkasan

- ZIP: `futures_signal_log_20261119_141947.zip`
- Replay: **33.094 baris** · sampel valid **16.458** (fit 10.915 + early-stop 2.032 + validasi 3.511)
- Split: **80% latih / 20% validasi** · satu validasi (`VAL`) · **3.511 baris validasi**
- Fitur terpilih: 40 · BTC: **14 fitur** (`btc_*`)
- Model: 6 — Aturan dominasi, Regresi Logistik, XGBoost, Meta-label, GRU, Ensemble
- Aturan dominasi: **T=85%, N=30, mode `all4`** (SOL futures+spot + BTC futures+spot)
- Konfigurasi: leverage 25x · **TP 25% ROI (1.0% harga)** · **SL 60% ROI (2.4% harga)** · **horizon 600 menit (10 jam)** · margin 50% · cooldown 30 menit

## Tabel validasi (setara cell 12)

```text
              model  theta  ROI VAL %  trx  menang %  maxDD %  LOLOS
  Aturan dominasi 0.5000    81.5774    3   100.0000   0.0000  tidak
  Regresi Logistik 0.7460   -19.9714   11    81.8182  70.1444  tidak
           XGBoost 0.5300   111.8751   11    81.8182  63.0122  tidak
        Meta-label 0.6000   -81.1317   12    58.3333  92.5177  tidak
               GRU 0.5000   -25.4359   20    75.0000  79.8163  tidak
          Ensemble 0.6070    25.0107   14    85.7143  79.8163  tidak
```

Kriteria lolos notebook: ROI ≥ 60%, transaksi ≥ 10, drawdown ≤ 50%.

## Model terpilih & rekomendasi

- Model terpilih (aturan notebook = ROI tertinggi): **XGBoost** · θ=0.53 · lolos: **BELUM**
- **Tidak ada model yang lolos** ketiga kriteria.

| Model | ROI validasi | Transaksi | MaxDD | Catatan |
|---|---:|---:|---:|---|
| **XGBoost** | **+111,88%** | 11 | 63,01% | ROI tertinggi, tapi DD > 50% |
| Aturan dominasi | +81,58% | **3** | 0,00% | sampel terlalu kecil |
| Ensemble | +25,01% | 14 | 79,82% | DD tinggi |
| Regresi Logistik | −19,97% | 11 | 70,14% | rugi |
| GRU | −25,44% | **20** | 79,82% | sampel paling banyak, tetap rugi |
| Meta-label | −81,13% | 12 | 92,52% | rugi terbesar |

**Catatan memilih:** ROI tinggi dengan 3 transaksi (Aturan dominasi) bukan bukti. XGBoost punya
ROI tertinggi dengan 11 transaksi, tetapi drawdown 63% berarti pernah kehilangan hampir
dua pertiga ekuitas — tidak lolos kriteria.

## Detail model terpilih (XGBoost)

```text
lipatan  ROI_pct   final        transaksi  menang_pct  maxDD_pct
    VAL 111.8751  2.118.751,43        11     81.8182    63.0122
```

## Uji statistik

- Titik impas dengan TP 1,0% vs SL 2,4% + biaya: **74,7%** transaksi harus kena target.
- Model terpilih mencapai **81,8%** menang, tetapi hanya **11 transaksi** → kesimpulan statistik lemah
  (idealnya ratusan).
- Karena TP jauh lebih kecil dari SL, kelas **NONE hampir hilang**; model hampir selalu memilih
  LONG/SHORT dan satu stop menghapus 60% margin. Ini risiko struktural dari rasio TP:SL terbalik.

## Berkas ekspor

| Model | Kind | θ | File | Ukuran |
|---|---|---|---|---|
| Aturan dominasi | rule | 0.500 | `models/aturan_dominasi.json` | <1 KB |
| Regresi Logistik | logreg | 0.746 | `models/regresi_logistik.json` | 3 KB |
| XGBoost | xgb | 0.530 | `models/xgboost.json` | 127 KB |
| Meta-label | meta | 0.600 | `models/meta_label.json` | 42 KB |
| GRU | gru | 0.500 | `models/gru.json` | 555 KB |
| Ensemble | ensemble | 0.607 | `models/ensemble.json` | <1 KB |

Folder: `C:\Users\sawal fitah\Downloads\model\web_export_sol_btc`
