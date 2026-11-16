# Format ekspor (dibuat otomatis)

Urutan kelas di semua model: [NONE, LONG, SHORT]. Tiap model xgb / logreg / gru / meta memakai daftar `features` MILIKNYA SENDIRI (ada di file modelnya;
nama kolom di data/replay.json, urutan penting!). Versi tiap model bisa dilatih dengan fitur yang berbeda, jadi `features` di manifest.json hanya gabungan
semua kolom yang ada di replay.json. Nilai hilang = null (di JS) / NaN. Semua rumus di bawah sudah diuji di notebook dengan pembaca Python yang meniru persis algoritma ini.
Tiap entri di manifest.models punya `source` (versi mana yang diekspor: lama asli / lama saja / fine-tune / latih ulang / rakitan) dan, bila ada, `log_loss_val`.
selection.json: kandidat dan alasan pemilihan versi tiap model.

## Sinyal dari probabilitas
soft: LONG bila pL>=theta && pL-pS>=margin; SHORT bila pS>=theta && pS-pL>=margin (SHORT menang bila keduanya benar), selain itu 0.
hard (aturan dominasi): LONG bila pL>=0.5; SHORT bila pS>=0.5.

## aturan_dominasi.json  {T,N,mode,has_spot,edge_only}
cb[i] = run_b{T}_f[i] >= N ; cs[i] = run_s{T}_f[i] >= N   (null dianggap 0; mode "both": juga kolom *_s)
sinyal hanya pada tepi naik: cb[i] && !cb[i-1] (baris pertama: sebelumnya false). SHORT menimpa LONG. Probabilitas = one-hot [0,1,0]/[0,0,1]/[1,0,0].

## regresi_logistik.json  {features, classes, coef, intercept, mean, std, clip}
z = clip((x-mean)/std, -clip, clip); logit = coef . z + intercept; P[classes[k]] = softmax(logit)[k]

## xgboost.json  {features, n_class=3, trees[], offset[3]}
tiap pohon: f (indeks fitur, -1 = daun), v (ambang atau nilai daun), l, r, m (anak kiri/kanan/hilang), cls (kelas pohon)
mulai node 0: selama f[node]>=0: x = X[f[node]]; node = x null ? m[node] : (Math.fround(x) < v[node] ? l[node] : r[node]); daun: margin[cls] += v[node]
P = softmax(offset + margin)

## meta_label.json  {T,N,features,xgb}
d[i] = +1 bila run_b{T}_f>=N ; -1 bila run_s{T}_f>=N (SHORT menimpa) ; selain itu 0 -> P=[1,0,0]
bila d!=0: x = [features..., d]; p = sigmoid(xgb.offset[0] + jumlah daun); LONG: P=[1-p,p,0] bila d=+1; SHORT: P=[1-p,0,p] bila d=-1

## gru.json  {features, seq_len, hidden, layers[], head, mean, std, clip}
jendela = seq_len baris terakhir (termasuk baris ini); z = clip((x-mean)/std,-clip,clip), null -> 0
tiap layer (h0=0): r=s(Wir x+bir+Whr h+bhr); z=s(Wiz x+biz+Whz h+bhz); n=tanh(Win x+bin+r*(Whn h+bhn)); h=(1-z)*n+z*h  (baris w_ih/w_hh: [r;z;n])
keluaran layer terakhir pada langkah terakhir -> LayerNorm(ln_w, ln_b, ln_eps; varians biasa) -> fc (fc_w . y + fc_b) -> softmax

## ensemble.json  {members}
rata-rata probabilitas model-model anggota (urutan kelas sama). Nama anggota = nama model lain di manifest.models (versi yang diekspor itu sendiri).

## data/
replay.json: {columns, rows} - ts, o,h,l,c, split (kode: lihat manifest.split_codes), bad, fitur, kolom run_* ; golden_proba.json: probabilitas Python per lipatan; golden_results.json: ROI & daftar transaksi Python per model.
