import type { SignalEvent, TradeTick } from '../core/types'

export interface SignalEngineOptions {
  windowSize: number
  dominancePct: number
  streak: number
  cooldownMs: number
}

/**
 * Port dari `engine.ts` (repo mining-trade-master): satu pembaruan = satu transaksi.
 * Porsi BUY/SELL dihitung dari N transaksi terakhir; bila salah satu sisi >= ambang
 * selama `streak` pembaruan berturut-turut, sinyal terbit (lalu jeda `cooldownMs`).
 *
 * Inilah sinyal yang direkam ke signal log dan menjadi input fitur sig_* di model,
 * jadi pengaturannya harus sama: 85% dan 12 pembaruan.
 */
export class SignalEngine {
  private window: TradeTick[] = []
  private streaks = { buy: 0, sell: 0 }
  private lastFired = { buy: 0, sell: 0 }
  private sameTick = 0

  constructor(private readonly opts: SignalEngineOptions) {}

  onTrade(tick: TradeTick): SignalEvent | null {
    if (this.sameTick === tick.ts) {
      this.window[0] = tick
    } else {
      this.window.unshift(tick)
      if (this.window.length > this.opts.windowSize) this.window.pop()
    }
    this.sameTick = tick.ts

    let buy = 0
    let sell = 0
    for (const t of this.window) {
      if (t.isBuy) buy += t.qty
      else sell += t.qty
    }
    const total = buy + sell
    if (total <= 0) return null

    const buyShare = (buy / total) * 100
    const sellShare = 100 - buyShare
    const thr = this.opts.dominancePct

    return (
      this.check('buy', buyShare, thr, tick.ts, buyShare) ?? this.check('sell', sellShare, thr, tick.ts, sellShare)
    )
  }

  private check(side: 'buy' | 'sell', share: number, thr: number, ts: number, domPct: number): SignalEvent | null {
    if (share < thr) {
      this.streaks[side] = 0
      return null
    }
    const streak = this.streaks[side] + 1
    if (streak < this.opts.streak) {
      this.streaks[side] = streak
      return null
    }
    this.streaks[side] = 0
    if (ts - this.lastFired[side] < this.opts.cooldownMs) return null
    this.lastFired[side] = ts
    return { ts: Math.floor(ts / 1000), side: side === 'buy' ? 1 : -1, domPct }
  }

  /** Posisi saat ini untuk ditampilkan (tanpa mengubah state). */
  peek() {
    return { windowTrades: this.window.length, streaks: { ...this.streaks } }
  }
}
