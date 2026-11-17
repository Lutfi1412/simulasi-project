import type { MinuteRow, SignalEvent } from './types'
import { clip, isNum, lag, log1pSafe, logRatio, nan, rollMax, rollMean, rollMin, rollStd, rollSum } from './num'

/**
 * Port TypeScript dari `build_features()` di futures_signal_model.ipynb.
 *
 * Semua fitur hanya memakai data sampai akhir menit t (tanpa melihat masa depan).
 * Grid disusun ulang per menit seperti notebook: celah <= 5 menit diisi
 * (harga di-ffill, volume/ticks/rangkaian = 0), celah lebih panjang = data hilang (bad).
 */

export interface MarketGrid {
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  quoteVol: number[]
  takerBuyQuote: number[]
  n: number[]
  buyN: number[]
  maxTradeUsdt: number[]
  buyPctEnd: number[]
  buyPctMean: number[]
  buyPctMin: number[]
  buyPctMax: number[]
  winN: number[]
  winSec: number[]
  winRetPct: number[]
  winRangePct: number[]
  vwapDevPct: number[]
  ticks: number[]
  src: number[]
  runB: number[][]
  runS: number[][]
  durB: number[][]
  durS: number[][]
}

export interface Grid {
  ts: number[]
  length: number
  f: MarketGrid
  s: MarketGrid | null
  /** BTCUSDT futures/spot sejajar grid SOL; null = tidak tersedia */
  btcF: MarketGrid | null
  btcS: MarketGrid | null
  bad: boolean[]
  thresholds: number[]
}

export interface BtcRows {
  future: Map<number, MinuteRow>
  spot: Map<number, MinuteRow> | null
}

export const RUN_THRESHOLDS = [60, 70, 80, 85, 90] as const
export const MAX_FFILL_MIN = 5

function emptyMarket(n: number, k: number): MarketGrid {
  const zeros = () => new Array<number>(n).fill(nan)
  const arrays = () => new Array<number[]>(k)
  return {
    open: zeros(),
    high: zeros(),
    low: zeros(),
    close: zeros(),
    quoteVol: zeros(),
    takerBuyQuote: zeros(),
    n: zeros(),
    buyN: zeros(),
    maxTradeUsdt: zeros(),
    buyPctEnd: zeros(),
    buyPctMean: zeros(),
    buyPctMin: zeros(),
    buyPctMax: zeros(),
    winN: zeros(),
    winSec: zeros(),
    winRetPct: zeros(),
    winRangePct: zeros(),
    vwapDevPct: zeros(),
    ticks: zeros(),
    src: zeros(),
    runB: Array.from({ length: k }, zeros),
    runS: Array.from({ length: k }, zeros),
    durB: Array.from({ length: k }, zeros),
    durS: Array.from({ length: k }, zeros),
  }
}

/**
 * Susun grid 1 menit dari baris mentah.
 * @param rows peta detik-awal-menit -> MinuteRow
 * @param endMinute menit terakhir (detik, kelipatan 60)
 * @param count jumlah menit ke belakang (termasuk menit terakhir)
 */
export function buildGrid(
  fRows: Map<number, MinuteRow>,
  sRows: Map<number, MinuteRow> | null,
  endMinute: number,
  count: number,
  thresholds: readonly number[] = RUN_THRESHOLDS,
  btcRows?: BtcRows | null,
): Grid {
  const k = thresholds.length
  const ts: number[] = []
  for (let i = count - 1; i >= 0; i--) ts.push(endMinute - i * 60)

  const fill = (rows: Map<number, MinuteRow>): MarketGrid => {
    const n = count
    const g = emptyMarket(n, k)
    const fillable: boolean[] = new Array(n).fill(false)
    const missing: boolean[] = new Array(n).fill(false)
    for (let i = 0; i < n; i++) missing[i] = !rows.has(ts[i])
    // panjang celah berurutan
    let i = 0
    while (i < n) {
      if (!missing[i]) {
        i++
        continue
      }
      let j = i
      while (j < n && missing[j]) j++
      const gapLen = j - i
      for (let q = i; q < j; q++) fillable[q] = gapLen <= MAX_FFILL_MIN
      i = j
    }

    let lastRow: MinuteRow | null = null
    let lastClose = nan
    for (let idx = 0; idx < n; idx++) {
      const row = rows.get(ts[idx])
      if (row) {
        g.open[idx] = row.open
        g.high[idx] = row.high
        g.low[idx] = row.low
        g.close[idx] = row.close
        g.quoteVol[idx] = row.quoteVol
        g.takerBuyQuote[idx] = row.takerBuyQuote
        g.n[idx] = row.n
        g.buyN[idx] = row.buyN
        g.maxTradeUsdt[idx] = row.maxTradeUsdt
        g.buyPctEnd[idx] = row.buyPctEnd
        g.buyPctMean[idx] = row.buyPctMean
        g.buyPctMin[idx] = row.buyPctMin
        g.buyPctMax[idx] = row.buyPctMax
        g.winN[idx] = row.winN
        g.winSec[idx] = row.winSec
        g.winRetPct[idx] = row.winRetPct
        g.winRangePct[idx] = row.winRangePct
        g.vwapDevPct[idx] = row.vwapDevPct
        g.ticks[idx] = row.ticks
        g.src[idx] = row.src
        for (let t = 0; t < k; t++) {
          g.runB[t][idx] = row.runBuy[t] ?? 0
          g.runS[t][idx] = row.runSell[t] ?? 0
          g.durB[t][idx] = row.durBuy[t] ?? 0
          g.durS[t][idx] = row.durSell[t] ?? 0
        }
        lastRow = row
        lastClose = row.close
      } else if (fillable[idx] && isNum(lastClose)) {
        // harga di-ffill; volume & rangkaian = 0; kolom dominasi/jendela di-ffill
        g.open[idx] = lastClose
        g.high[idx] = lastClose
        g.low[idx] = lastClose
        g.close[idx] = lastClose
        g.quoteVol[idx] = 0
        g.takerBuyQuote[idx] = 0
        g.n[idx] = 0
        g.buyN[idx] = 0
        g.maxTradeUsdt[idx] = 0
        g.ticks[idx] = 0
        g.src[idx] = lastRow ? lastRow.src : 0
        if (lastRow) {
          g.buyPctEnd[idx] = lastRow.buyPctEnd
          g.buyPctMean[idx] = lastRow.buyPctMean
          g.buyPctMin[idx] = lastRow.buyPctMin
          g.buyPctMax[idx] = lastRow.buyPctMax
          g.winN[idx] = lastRow.winN
          g.winSec[idx] = lastRow.winSec
          g.winRetPct[idx] = lastRow.winRetPct
          g.winRangePct[idx] = lastRow.winRangePct
          g.vwapDevPct[idx] = lastRow.vwapDevPct
        }
        for (let t = 0; t < k; t++) {
          g.runB[t][idx] = 0
          g.runS[t][idx] = 0
          g.durB[t][idx] = 0
          g.durS[t][idx] = 0
        }
      }
    }
    return g
  }

  const f = fill(fRows)
  const s = sRows ? fill(sRows) : null
  const btcF = btcRows?.future ? fill(btcRows.future) : null
  const btcS = btcRows?.spot ? fill(btcRows.spot) : null
  const bad: boolean[] = new Array(count)
  for (let i = 0; i < count; i++) {
    // notebook: REQUIRE_RAW=True -> menit dengan src != 1 juga dianggap tidak layak.
    // Konteks BTC wajib: usia BTC > 1 menit atau data mentah BTC tidak ada = baris tidak layak.
    bad[i] =
      !isNum(f.close[i]) ||
      (s !== null && !isNum(s.close[i])) ||
      f.src[i] !== 1 ||
      (s !== null && s.src[i] !== 1) ||
      (btcF !== null && (!isNum(btcF.close[i]) || btcF.src[i] !== 1)) ||
      (btcS !== null && (!isNum(btcS.close[i]) || btcS.src[i] !== 1))
  }
  return { ts, length: count, f, s, btcF, btcS, bad, thresholds: [...thresholds] }
}

export function buildGridFromRows(
  fRows: Map<number, MinuteRow>,
  sRows: Map<number, MinuteRow> | null,
  endMinute: number,
  count: number,
  thresholds: readonly number[] = RUN_THRESHOLDS,
  btcRows?: BtcRows | null,
): Grid {
  return buildGrid(fRows, sRows, endMinute, count, thresholds, btcRows)
}

/** sinyal aplikasi -> fitur sig_* (dihitung sampai akhir menit, cut = ts + 59 dtk) */
export function signalFeatures(events: readonly SignalEvent[], ts: number) {
  const cut = ts + 59
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].ts <= cut) lo = mid + 1
    else hi = mid
  }
  const j = lo - 1
  const has = j >= 0
  const last = has ? events[j] : null
  const age = has ? Math.min((cut - last!.ts) / 60, 1440) : 1440
  const fresh = has && age < 1440

  let from = 0
  let to = events.length
  const cutoff = cut - 3600
  while (from < to) {
    const mid = (from + to) >> 1
    if (events[mid].ts < cutoff) from = mid + 1
    else to = mid
  }
  const j2 = from
  const cnt = has ? j + 1 - j2 : 0
  let net = 0
  if (has) for (let q = j2; q <= j; q++) net += events[q].side

  return {
    age,
    side: fresh ? last!.side : 0,
    dom: fresh ? last!.domPct : 50,
    n1h: has ? cnt : 0,
    net1h: has ? net : 0,
  }
}

export interface FeatureOptions {
  signalsFuture?: readonly SignalEvent[]
  signalsSpot?: readonly SignalEvent[]
  thresholds?: readonly number[]
}

/**
 * Hitung seluruh matriks fitur (satu array per nama fitur) untuk grid.
 * Nama & rumus mengikuti notebook; hanya sebagian yang dipakai model (manifest.features).
 */
export function computeFeatureSeries(g: Grid, opts: FeatureOptions = {}): Record<string, number[]> {
  const n = g.length
  const cf = g.f.close
  const f = g.f
  const s = g.s
  const thresholds = opts.thresholds ?? g.thresholds
  const tRef = thresholds.includes(85) ? 85 : thresholds[Math.floor(thresholds.length / 2)]
  const X: Record<string, number[]> = {}
  const put = (name: string, arr: number[]) => {
    X[name] = arr
  }
  const nanArr = () => new Array<number>(n).fill(nan)

  const lr = nanArr()
  for (let i = 1; i < n; i++) lr[i] = logRatio(cf[i], cf[i - 1])

  for (const w of [1, 5, 15, 30, 60, 240]) {
    const a = nanArr()
    for (let i = 0; i < n; i++) a[i] = logRatio(cf[i], lag(cf, i, w))
    put(`ret_${w}`, a)
  }
  for (const w of [15, 60]) {
    const a = nanArr()
    for (let i = 0; i < n; i++) a[i] = rollStd(lr, i, w)
    put(`vol_${w}`, a)
  }
  const rg = nanArr()
  for (let i = 0; i < n; i++) {
    const c = cf[i]
    rg[i] = Number.isFinite(c) && c !== 0 ? (f.high[i] - f.low[i]) / c : nan
  }
  put('range_1', rg)
  for (const w of [15, 60]) {
    const a = nanArr()
    for (let i = 0; i < n; i++) a[i] = rollMean(rg, i, w)
    put(`range_${w}`, a)
  }
  {
    const a = nanArr()
    for (let i = 0; i < n; i++) {
      const hi = rollMax(f.high, i, 60)
      const lo = rollMin(f.low, i, 60)
      a[i] = Number.isFinite(hi) && Number.isFinite(lo) ? (cf[i] - lo) / (hi - lo + 1e-12) : nan
    }
    put('pos_60', a)
  }

  const flow = (m: 'f' | 's', gm: MarketGrid) => {
    const sfx = m === 'f' ? '' : '_s'
    const qv = gm.quoteVol
    const tb = gm.takerBuyQuote
    const net = nanArr()
    for (let i = 0; i < n; i++) net[i] = 2 * tb[i] - qv[i]

    const tbr1 = nanArr()
    for (let i = 0; i < n; i++) tbr1[i] = Number.isFinite(qv[i]) && qv[i] > 0 ? tb[i] / qv[i] : 0.5
    put(`tb_ratio_1${sfx}`, tbr1)

    for (const w of [5, 15, 60]) {
      const nf = nanArr()
      const tr = nanArr()
      for (let i = 0; i < n; i++) {
        const den0 = rollSum(qv, i, w)
        const den = Number.isFinite(den0) && den0 > 0 ? den0 : nan
        nf[i] = Number.isFinite(den) ? rollSum(net, i, w) / den : nan
        tr[i] = Number.isFinite(den) ? rollSum(tb, i, w) / den : nan
      }
      put(`netflow_${w}${sfx}`, nf)
      put(`tb_ratio_${w}${sfx}`, tr)
    }

    const lv = nanArr()
    for (let i = 0; i < n; i++) lv[i] = Number.isFinite(qv[i]) ? Math.log1p(Math.max(qv[i], 0)) : nan
    const vz = nanArr()
    for (let i = 0; i < n; i++) {
      const mu = rollMean(lv, i, 240)
      const sd = rollStd(lv, i, 240)
      vz[i] = Number.isFinite(mu) && Number.isFinite(sd) ? (lv[i] - mu) / (sd + 1e-9) : nan
    }
    put(`volz${sfx}`, vz)

    const mt = nanArr()
    for (let i = 0; i < n; i++) {
      const v = gm.maxTradeUsdt[i] / (qv[i] + 1e-9)
      mt[i] = Number.isFinite(v) ? clip(v, 0, 1) : nan
    }
    put(`maxtrade${sfx}`, mt)
  }

  const dom = (m: 'f' | 's', gm: MarketGrid) => {
    const bp = nanArr()
    for (let i = 0; i < n; i++) bp[i] = (gm.buyPctMean[i] - 50) / 50
    put(`dom_1_${m}`, bp)
    const de = nanArr()
    for (let i = 0; i < n; i++) de[i] = (gm.buyPctEnd[i] - 50) / 50
    put(`domend_${m}`, de)
    for (const w of [5, 15, 60]) {
      const a = nanArr()
      for (let i = 0; i < n; i++) a[i] = rollMean(bp, i, w)
      put(`dom_${w}_${m}`, a)
    }
    const dr = nanArr()
    for (let i = 0; i < n; i++) dr[i] = (gm.buyPctMax[i] - gm.buyPctMin[i]) / 100
    put(`domrange_${m}`, dr)

    for (let t = 0; t < thresholds.length; t++) {
      const thr = thresholds[t]
      const rbRaw = gm.runB[t]
      const rsRaw = gm.runS[t]
      const rb = nanArr()
      const rs = nanArr()
      const db = nanArr()
      const ds = nanArr()
      for (let i = 0; i < n; i++) {
        rb[i] = log1pSafe(rbRaw[i])
        rs[i] = log1pSafe(rsRaw[i])
        db[i] = log1pSafe(gm.durB[t][i])
        ds[i] = log1pSafe(gm.durS[t][i])
      }
      put(`run_b${thr}_${m}`, rb)
      put(`run_s${thr}_${m}`, rs)
      put(`dur_b${thr}_${m}`, db)
      put(`dur_s${thr}_${m}`, ds)
    }

    const ti = thresholds.indexOf(tRef)
    const rbRef = nanArr()
    const rsRef = nanArr()
    for (let i = 0; i < n; i++) {
      rbRef[i] = log1pSafe(gm.runB[ti][i])
      rsRef[i] = log1pSafe(gm.runS[ti][i])
    }
    const rn = nanArr()
    for (let i = 0; i < n; i++) rn[i] = rbRef[i] - rsRef[i]
    put(`runnet_${m}`, rn)
    for (const w of [5, 15]) {
      const a = nanArr()
      for (let i = 0; i < n; i++) a[i] = rollMax(rbRef, i, w) - rollMax(rsRef, i, w)
      put(`runnet_max${w}_${m}`, a)
    }

    const ws = nanArr()
    const wr = nanArr()
    const wrg = nanArr()
    const vd = nanArr()
    const tk = nanArr()
    for (let i = 0; i < n; i++) {
      ws[i] = log1pSafe(gm.winSec[i])
      wr[i] = gm.winRetPct[i]
      wrg[i] = gm.winRangePct[i]
      vd[i] = gm.vwapDevPct[i]
      tk[i] = log1pSafe(gm.ticks[i])
    }
    put(`winsec_${m}`, ws)
    put(`winret_${m}`, wr)
    put(`winrange_${m}`, wrg)
    put(`vwapdev_${m}`, vd)
    put(`ticks_${m}`, tk)
  }

  flow('f', f)
  dom('f', f)
  if (s) {
    flow('s', s)
    dom('s', s)
    const basis = nanArr()
    for (let i = 0; i < n; i++) {
      basis[i] = Number.isFinite(f.close[i]) && Number.isFinite(s.close[i]) && s.close[i] !== 0
        ? (f.close[i] / s.close[i] - 1) * 1e4
        : nan
    }
    put('basis_bps', basis)
    const bz = nanArr()
    for (let i = 0; i < n; i++) {
      const mu = rollMean(basis, i, 240)
      const sd = rollStd(basis, i, 240)
      bz[i] = Number.isFinite(mu) && Number.isFinite(sd) ? (basis[i] - mu) / (sd + 1e-9) : nan
    }
    put('basis_z', bz)
    const bc = nanArr()
    for (let i = 0; i < n; i++) bc[i] = basis[i] - lag(basis, i, 15)
    put('basis_chg_15', bc)
    const dg1 = nanArr()
    const dg15 = nanArr()
    const tg15 = nanArr()
    const rgap = nanArr()
    for (let i = 0; i < n; i++) {
      dg1[i] = X['dom_1_f'][i] - X['dom_1_s'][i]
      dg15[i] = X['dom_15_f'][i] - X['dom_15_s'][i]
      tg15[i] = X['tb_ratio_15'][i] - X['tb_ratio_15_s'][i]
      rgap[i] = X['runnet_f'][i] - X['runnet_s'][i]
    }
    put('dom_gap_1', dg1)
    put('dom_gap_15', dg15)
    put('tb_gap_15', tg15)
    put('run_gap', rgap)
  }

  if (g.btcF && g.btcS) {
    const cbf = g.btcF.close
    const cbs = g.btcS.close
    const lrBtc = nanArr()
    for (let i = 1; i < n; i++) lrBtc[i] = logRatio(cbf[i], cbf[i - 1])

    for (const w of [1, 5, 15, 30, 60, 240]) {
      const ret = nanArr()
      const rel = nanArr()
      for (let i = 0; i < n; i++) {
        ret[i] = logRatio(cbf[i], lag(cbf, i, w))
        const sol = X[`ret_${w}`][i]
        rel[i] = Number.isFinite(ret[i]) && Number.isFinite(sol) ? ret[i] - sol : nan
      }
      put(`btc_ret_${w}`, ret)
      put(`btc_rel_ret_${w}`, rel)
    }

    const rgBtc = nanArr()
    for (let i = 0; i < n; i++) {
      const c = cbf[i]
      rgBtc[i] = Number.isFinite(c) && c !== 0 ? (g.btcF.high[i] - g.btcF.low[i]) / c : nan
    }
    put('btc_range_1', rgBtc)
    for (const w of [15, 60]) {
      const vol = nanArr()
      const range = nanArr()
      for (let i = 0; i < n; i++) {
        vol[i] = rollStd(lrBtc, i, w)
        range[i] = rollMean(rgBtc, i, w)
      }
      put(`btc_vol_${w}`, vol)
      put(`btc_range_${w}`, range)
    }

    const btcFlow = (tag: 'f' | 's', gm: MarketGrid) => {
      const qv = gm.quoteVol
      const tb = gm.takerBuyQuote
      const net = nanArr()
      for (let i = 0; i < n; i++) net[i] = 2 * tb[i] - qv[i]

      const tbr1 = nanArr()
      for (let i = 0; i < n; i++) tbr1[i] = Number.isFinite(qv[i]) && qv[i] > 0 ? tb[i] / qv[i] : 0.5
      put(`btc_tb_ratio_1_${tag}`, tbr1)

      for (const w of [5, 15, 60]) {
        const nf = nanArr()
        const tr = nanArr()
        for (let i = 0; i < n; i++) {
          const den0 = rollSum(qv, i, w)
          const den = Number.isFinite(den0) && den0 > 0 ? den0 : nan
          nf[i] = Number.isFinite(den) ? rollSum(net, i, w) / den : nan
          tr[i] = Number.isFinite(den) ? rollSum(tb, i, w) / den : nan
        }
        put(`btc_netflow_${w}_${tag}`, nf)
        put(`btc_tb_ratio_${w}_${tag}`, tr)
      }

      const lv = nanArr()
      for (let i = 0; i < n; i++) lv[i] = Number.isFinite(qv[i]) ? Math.log1p(Math.max(qv[i], 0)) : nan
      const vz = nanArr()
      for (let i = 0; i < n; i++) {
        const mu = rollMean(lv, i, 240)
        const sd = rollStd(lv, i, 240)
        vz[i] = Number.isFinite(mu) && Number.isFinite(sd) ? (lv[i] - mu) / (sd + 1e-9) : nan
      }
      put(`btc_volz_${tag}`, vz)

      const mt = nanArr()
      for (let i = 0; i < n; i++) {
        const v = gm.maxTradeUsdt[i] / (qv[i] + 1e-9)
        mt[i] = Number.isFinite(v) ? clip(v, 0, 1) : nan
      }
      put(`btc_maxtrade_${tag}`, mt)

      const bp = nanArr()
      const de = nanArr()
      for (let i = 0; i < n; i++) {
        bp[i] = (gm.buyPctMean[i] - 50) / 50
        de[i] = (gm.buyPctEnd[i] - 50) / 50
      }
      put(`btc_dom_1_${tag}`, bp)
      put(`btc_domend_${tag}`, de)
      for (const w of [15, 60]) {
        const a = nanArr()
        for (let i = 0; i < n; i++) a[i] = rollMean(bp, i, w)
        put(`btc_dom_${w}_${tag}`, a)
      }

      for (let t = 0; t < thresholds.length; t++) {
        const thr = thresholds[t]
        const rb = nanArr()
        const rs = nanArr()
        const db = nanArr()
        const ds = nanArr()
        for (let i = 0; i < n; i++) {
          rb[i] = log1pSafe(gm.runB[t][i])
          rs[i] = log1pSafe(gm.runS[t][i])
          db[i] = log1pSafe(gm.durB[t][i])
          ds[i] = log1pSafe(gm.durS[t][i])
        }
        put(`btc_run_b${thr}_${tag}`, rb)
        put(`btc_run_s${thr}_${tag}`, rs)
        put(`btc_dur_b${thr}_${tag}`, db)
        put(`btc_dur_s${thr}_${tag}`, ds)
      }
    }

    btcFlow('f', g.btcF)
    btcFlow('s', g.btcS)

    const btcBasis = nanArr()
    for (let i = 0; i < n; i++) {
      btcBasis[i] =
        Number.isFinite(cbf[i]) && Number.isFinite(cbs[i]) && cbs[i] !== 0 ? (cbf[i] / cbs[i] - 1) * 1e4 : nan
    }
    put('btc_basis_bps', btcBasis)
    const btcBasisChg = nanArr()
    for (let i = 0; i < n; i++) btcBasisChg[i] = btcBasis[i] - lag(btcBasis, i, 15)
    put('btc_basis_chg_15', btcBasisChg)
  }

  {
    const hs = nanArr()
    const hc = nanArr()
    for (let i = 0; i < n; i++) {
      const d = new Date(g.ts[i] * 1000)
      const hr = d.getUTCHours() + d.getUTCMinutes() / 60
      hs[i] = Math.sin((2 * Math.PI * hr) / 24)
      hc[i] = Math.cos((2 * Math.PI * hr) / 24)
    }
    put('hour_sin', hs)
    put('hour_cos', hc)
  }

  if (opts.signalsFuture) {
    const ev = opts.signalsFuture
    const cols: Record<string, number[]> = {
      sig_age_f: nanArr(), sig_side_f: nanArr(), sig_dom_f: nanArr(), sig_n1h_f: nanArr(), sig_net1h_f: nanArr(),
    }
    for (let i = 0; i < n; i++) {
      const v = signalFeatures(ev, g.ts[i])
      cols.sig_age_f[i] = v.age
      cols.sig_side_f[i] = v.side
      cols.sig_dom_f[i] = v.dom
      cols.sig_n1h_f[i] = v.n1h
      cols.sig_net1h_f[i] = v.net1h
    }
    for (const [k, v] of Object.entries(cols)) put(k, v)
  } else {
    for (const k of ['sig_age_f', 'sig_side_f', 'sig_dom_f', 'sig_n1h_f', 'sig_net1h_f']) put(k, new Array(n).fill(nan))
  }
  if (s) {
    if (opts.signalsSpot) {
      const ev = opts.signalsSpot
      const cols: Record<string, number[]> = {
        sig_age_s: nanArr(), sig_side_s: nanArr(), sig_dom_s: nanArr(), sig_n1h_s: nanArr(), sig_net1h_s: nanArr(),
      }
      for (let i = 0; i < n; i++) {
        const v = signalFeatures(ev, g.ts[i])
        cols.sig_age_s[i] = v.age
        cols.sig_side_s[i] = v.side
        cols.sig_dom_s[i] = v.dom
        cols.sig_n1h_s[i] = v.n1h
        cols.sig_net1h_s[i] = v.net1h
      }
      for (const [k, v] of Object.entries(cols)) put(k, v)
    } else {
      for (const k of ['sig_age_s', 'sig_side_s', 'sig_dom_s', 'sig_n1h_s', 'sig_net1h_s']) put(k, new Array(n).fill(nan))
    }
  }

  return X
}
