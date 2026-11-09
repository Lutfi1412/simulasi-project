import type { MinuteRow, TradeTick } from './types'

/**
 * Port dari `MinuteRecorder` + `BarAggregator` di repo mining (shared/src/minute.ts, bars.ts).
 *
 * Satu "pembaruan" (tick) = daftar transaksi berubah = satu transaksi masuk ke jendela
 * (jendela = N transaksi terakhir, bawaan 50 — sama dengan pengaturan aplikasi).
 * Porsi BUY dihitung dari SELURUH jendela (nilai USDT), lalu:
 *  - rangkaian (run) per ambang T = jumlah pembaruan berturut-turut dengan porsi >= T%
 *  - OHLC/volume per menit dari transaksi mentah di menit itu
 *
 * Catatan: aplikasi mengirim snapshot tiap 200 ms, jadi ticks di sini bisa sedikit lebih
 * banyak (satu per transaksi) pada pasar yang sangat ramai. Perbedaan ini hanya
 * memengaruhi beberapa fitur halus (ticks, run) dan tidak mengubah bentuk data.
 */

const THRESHOLDS = [60, 70, 80, 85, 90] as const
const GAP_RESET_MS = 120_000

interface WTrade {
  ts: number
  price: number
  qty: number
  isBuy: boolean
}

class Acc {
  ticks = 0
  sumBuy = 0
  minBuy = Infinity
  maxBuy = -Infinity
  lastBuy = 0
  readonly maxRunB: number[]
  readonly maxRunS: number[]
  readonly maxDurB: number[]
  readonly maxDurS: number[]

  openTs = Infinity
  open = 0
  closeTs = -Infinity
  close = 0
  high = -Infinity
  low = Infinity

  winN = 0
  winSec = 0
  winRet = 0
  winRange = 0
  vwapDev = 0

  quoteVol = 0
  takerBuyQuote = 0
  n = 0
  buyN = 0
  maxTradeUsdt = 0

  constructor(
    readonly minute: number,
    k: number,
  ) {
    this.maxRunB = new Array<number>(k).fill(0)
    this.maxRunS = new Array<number>(k).fill(0)
    this.maxDurB = new Array<number>(k).fill(0)
    this.maxDurS = new Array<number>(k).fill(0)
  }
}

export class MinuteRecorder {
  private window: WTrade[] = []
  private runB: number[]
  private runS: number[]
  private startB: number[]
  private startS: number[]
  private lastTs = 0
  private cur: Acc | null = null
  private completed: MinuteRow[] = []

  constructor(
    readonly windowSize = 50,
    readonly thresholds: readonly number[] = THRESHOLDS,
  ) {
    const k = thresholds.length
    this.runB = new Array<number>(k).fill(0)
    this.runS = new Array<number>(k).fill(0)
    this.startB = new Array<number>(k).fill(0)
    this.startS = new Array<number>(k).fill(0)
  }

  /** Isi jendela awal dari REST (hanya untuk porsi BUY; bukan untuk bar menit). */
  seed(trades: TradeTick[]): void {
    for (const t of trades.slice(-this.windowSize)) {
      this.window.unshift({ ts: t.ts, price: t.price, qty: t.qty, isBuy: t.isBuy })
      if (this.window.length > this.windowSize) this.window.pop()
      this.lastTs = Math.max(this.lastTs, t.ts)
    }
  }

  onTrade(t: TradeTick): void {
    const newest = { ts: t.ts, price: t.price, qty: t.qty, isBuy: t.isBuy }
    this.window.unshift(newest)
    if (this.window.length > this.windowSize) this.window.pop()
    this.update(newest)
  }

  /** Baris yang menitnya sudah lewat (dipanggil setelah transaksi baru / timer). */
  takeCompleted(): MinuteRow[] {
    const out = this.completed
    this.completed = []
    return out
  }

  /**
   * Tutup menit yang sudah berjalan padahal tidak ada transaksi baru
   * (pasar sepi / koneksi putus). Dipanggil timer tiap beberapa detik.
   */
  flushIdle(nowSec: number): void {
    if (!this.cur) return
    const minuteNow = Math.floor(nowSec / 60)
    if (minuteNow > this.cur.minute) {
      this.completed.push(this.toRow(this.cur))
      this.cur = null
    }
  }

  /** Posisi tick terakhir untuk ditampilkan di UI. */
  ping(): { windowTrades: number; lastBuyPct: number; runB: number[]; runS: number[] } {
    return {
      windowTrades: this.window.length,
      lastBuyPct: this.window.length ? this.buyPct() : 50,
      runB: [...this.runB],
      runS: [...this.runS],
    }
  }

  private buyPct(): number {
    let buy = 0
    let sell = 0
    for (const t of this.window) {
      if (t.isBuy) buy += t.qty
      else sell += t.qty
    }
    const total = buy + sell
    return total > 0 ? (buy / total) * 100 : 50
  }

  private update(t: WTrade): void {
    let buy = 0
    let sell = 0
    let hi = -Infinity
    let lo = Infinity
    let totalUsdt = 0
    let coins = 0
    for (const w of this.window) {
      if (w.isBuy) buy += w.qty
      else sell += w.qty
      if (w.price > hi) hi = w.price
      if (w.price < lo) lo = w.price
      totalUsdt += w.qty
      if (w.price > 0) coins += w.qty / w.price
    }
    let total = buy + sell
    if (total <= 0) return

    const buyPct = (buy / total) * 100
    const sellPct = 100 - buyPct

    if (this.lastTs !== 0 && t.ts - this.lastTs > GAP_RESET_MS) {
      this.runB.fill(0)
      this.runS.fill(0)
    }
    this.lastTs = t.ts

    let minute = Math.floor(t.ts / 60_000)
    if (this.cur) {
      if (minute > this.cur.minute) {
        this.completed.push(this.toRow(this.cur))
        this.cur = null
      } else {
        minute = this.cur.minute // waktu mundur sedikit dilipat ke menit berjalan
      }
    }
    if (!this.cur) this.cur = new Acc(minute, this.thresholds.length)
    const acc = this.cur

    for (let i = 0; i < this.thresholds.length; i++) {
      const thr = this.thresholds[i]
      if (buyPct >= thr) {
        if (this.runB[i] === 0) this.startB[i] = t.ts
        this.runB[i]++
      } else this.runB[i] = 0
      if (sellPct >= thr) {
        if (this.runS[i] === 0) this.startS[i] = t.ts
        this.runS[i]++
      } else this.runS[i] = 0

      if (this.runB[i] > acc.maxRunB[i]) acc.maxRunB[i] = this.runB[i]
      if (this.runS[i] > acc.maxRunS[i]) acc.maxRunS[i] = this.runS[i]
      const dB = this.runB[i] > 0 ? (t.ts - this.startB[i]) / 1000 : 0
      const dS = this.runS[i] > 0 ? (t.ts - this.startS[i]) / 1000 : 0
      if (dB > acc.maxDurB[i]) acc.maxDurB[i] = dB
      if (dS > acc.maxDurS[i]) acc.maxDurS[i] = dS
    }

    acc.ticks++
    acc.sumBuy += buyPct
    if (buyPct < acc.minBuy) acc.minBuy = buyPct
    if (buyPct > acc.maxBuy) acc.maxBuy = buyPct
    acc.lastBuy = buyPct
    acc.winN = this.window.length
    const oldest = this.window[this.window.length - 1]
    acc.winSec = Math.max(0, (t.ts - oldest.ts) / 1000)
    acc.winRet = oldest.price > 0 ? ((t.price - oldest.price) / oldest.price) * 100 : 0
    acc.winRange = lo > 0 ? ((hi - lo) / lo) * 100 : 0
    const vwap = coins > 0 ? totalUsdt / coins : t.price
    acc.vwapDev = vwap > 0 ? ((t.price - vwap) / vwap) * 100 : 0

    // bar mentah menit ini (OHLC + volume) dari transaksi di menit yang sama
    const mStart = acc.minute * 60_000
    const mEnd = mStart + 60_000
    for (const w of this.window) {
      if (w.ts < mStart || w.ts >= mEnd) continue
      if (w.ts <= acc.openTs) {
        acc.openTs = w.ts
        acc.open = w.price
      }
      if (w.ts > acc.closeTs) {
        acc.closeTs = w.ts
        acc.close = w.price
      }
      if (w.price > acc.high) acc.high = w.price
      if (w.price < acc.low) acc.low = w.price
    }
    // volume & jumlah transaksi menit ini: akumulasi transaksi yang benar-benar masuk
    if (t.ts >= mStart && t.ts < mEnd) {
      acc.quoteVol += t.qty
      if (t.isBuy) acc.takerBuyQuote += t.qty
      acc.n++
      if (t.isBuy) acc.buyN++
      if (t.qty > acc.maxTradeUsdt) acc.maxTradeUsdt = t.qty
    }
  }

  private toRow(a: Acc): MinuteRow {
    const half = (v: number) => (Number.isFinite(v) && a.ticks > 0 ? v : 0)
    return {
      ts: a.minute * 60,
      open: a.open,
      high: a.high,
      low: a.low,
      close: a.close,
      quoteVol: a.quoteVol,
      takerBuyQuote: a.takerBuyQuote,
      n: a.n,
      buyN: a.buyN,
      maxTradeUsdt: a.maxTradeUsdt,
      buyPctEnd: a.lastBuy,
      buyPctMean: a.ticks > 0 ? a.sumBuy / a.ticks : 50,
      buyPctMin: half(a.minBuy),
      buyPctMax: half(a.maxBuy),
      winN: a.winN,
      winSec: a.winSec,
      winRetPct: a.winRet,
      winRangePct: a.winRange,
      vwapDevPct: a.vwapDev,
      ticks: a.ticks,
      src: a.ticks > 0 ? 1 : 0,
      runBuy: [...a.maxRunB],
      runSell: [...a.maxRunS],
      durBuy: [...a.maxDurB],
      durSell: [...a.maxDurS],
    }
  }
}
