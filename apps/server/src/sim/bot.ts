import type { MinuteContext, TradingConfig } from '../core/types'
import type { ModelOutput } from '../models/types'

/**
 * Feed live memberi timestamp dalam milidetik, sedangkan reel/replay memakai detik.
 * Normalisasi ke detik supaya perhitungan funding (periode 8 jam) tidak meleset 1000x.
 */
const asSeconds = (ts: number): number => (ts > 1e11 ? Math.floor(ts / 1000) : Math.floor(ts))

export type Side = 1 | -1
export type ExitReason = 'tp' | 'sl' | 'liq' | 'timeout' | 'end' | 'neutral'

export interface Position {
  side: Side
  entry: number
  entryTs: number
  entryMinute: number
  margin: number
  notional: number
  tpPrice: number
  slPrice: number
  stopPrice: number
  stopReason: 'sl' | 'liq'
  bars: number
}

export interface BotTrade {
  id: string
  botId: string
  model: string
  side: Side
  entryTs: number
  exitTs: number
  entry: number
  exit: number
  reason: ExitReason
  bars: number
  movePct: number
  roiPct: number
  pnl: number
  equityAfter: number
  margin: number
  notional: number
}

export interface EquityPoint {
  ts: number
  equity: number
}

export class Bot {
  equity: number
  peak: number
  maxDd = 0
  position: Position | null = null
  trades: BotTrade[] = []
  curve: EquityPoint[] = []
  cooldownUntilMinute = -Infinity
  pending: { side: Side; minute: number; ts: number } | null = null
  lastSignal: { side: Side; ts: number; price: number; p: number[] } | null = null
  lastPrice = 0
  wins = 0
  losses = 0
  tpCount = 0
  liqCount = 0
  /** Dipanggil saat modal habis (equity 0) dan bot direset otomatis. */
  onBankrupt: ((bot: Bot, trade: BotTrade | undefined) => void) | null = null
  private seq = 0

  constructor(
    readonly id: string,
    readonly modelName: string,
    readonly kind: string,
    readonly trading: TradingConfig,
    readonly capital: number,
  ) {
    this.equity = capital
    this.peak = capital
  }

  get roiPct(): number {
    return (this.equity / this.capital - 1) * 100
  }

  get unrealized(): number {
    if (!this.position || !this.lastPrice) return 0
    const p = this.position
    const move = p.side * (this.lastPrice / p.entry - 1)
    return p.notional * move
  }

  get effectiveEquity(): number {
    return Math.max(0, this.equity + this.unrealized)
  }

  /** Terima sinyal di akhir menit (belum membuka posisi). */
  queueEntry(side: Side, minute: number, ts: number, p: number[], price: number): boolean {
    if (this.position || this.pending) return false
    if (minute < this.cooldownUntilMinute) return false
    if (this.equity <= 0) return false
    this.pending = { side, minute, ts }
    this.lastSignal = { side, ts, price, p }
    return true
  }

  /** Buka posisi pada harga tertentu (live: harga sekarang; replay: open menit berikutnya). */
  openAt(price: number, ts: number, minute: number): void {
    if (!this.pending || this.position) return
    const side = this.pending.side
    const entry = price * (1 + this.trading.SLIPPAGE * side)
    if (!Number.isFinite(entry) || entry <= 0) {
      this.pending = null
      return
    }
    // 50% ekuitas sebagai margin; kalau sisa modal <= 100.000, all-in sisa terakhir.
    const fraction = this.equity <= 100_000 ? 1 : this.trading.POSITION_FRACTION
    const margin = this.equity * fraction
    const notional = margin * this.trading.LEVERAGE
    const liq = 1 / this.trading.LEVERAGE - this.trading.MMR
    const tpPrice = this.targetPrice(entry, side, this.trading.TP_PCT, 0)
    const slPrice = this.targetPrice(entry, side, -this.trading.SL_PCT, 0)
    const liqPrice = side === 1 ? entry * (1 - liq) : entry * (1 + liq)
    const stopPrice = side === 1 ? Math.max(slPrice, liqPrice) : Math.min(slPrice, liqPrice)
    this.position = {
      side,
      entry,
      entryTs: ts,
      entryMinute: minute,
      margin,
      notional,
      tpPrice,
      slPrice,
      stopPrice,
      stopReason: side === 1 ? (slPrice >= liqPrice ? 'sl' : 'liq') : (slPrice <= liqPrice ? 'sl' : 'liq'),
      bars: 0,
    }
    this.pending = null
    this.lastPrice = price
  }

  private targetPrice(entry: number, side: Side, roiPct: number, fundingPeriods: number): number {
    const net = roiPct / (100 * this.trading.LEVERAGE)
      + 2 * this.trading.FEE_TAKER
      + fundingPeriods * this.trading.FUNDING_8H
    return entry * (1 + side * net) / (1 - this.trading.SLIPPAGE * side)
  }

  private targets(p: Position, ts: number) {
    const fundingPeriods = Math.floor(asSeconds(ts) / 28800) - Math.floor(asSeconds(p.entryTs) / 28800)
    const liqMove = 1 / this.trading.LEVERAGE - this.trading.MMR
    const liqPrice = p.side === 1 ? p.entry * (1 - liqMove) : p.entry * (1 + liqMove)
    const tpPrice = this.targetPrice(p.entry, p.side, this.trading.TP_PCT, fundingPeriods)
    const slPrice = this.targetPrice(p.entry, p.side, -this.trading.SL_PCT, fundingPeriods)
    return {
      tpPrice,
      slPrice,
      liqPrice,
      stopPrice: p.side === 1 ? Math.max(slPrice, liqPrice) : Math.min(slPrice, liqPrice),
      stopReason: p.side === 1 ? (slPrice >= liqPrice ? 'sl' : 'liq') as 'sl' | 'liq' : (slPrice <= liqPrice ? 'sl' : 'liq') as 'sl' | 'liq',
    }
  }

  targetPrices(ts: number): { tpPrice: number; slPrice: number } | null {
    if (!this.position) return null
    const { tpPrice, slPrice } = this.targets(this.position, ts)
    return { tpPrice, slPrice }
  }

  /** Cek TP/SL dari satu harga (mode live, tiap transaksi). */
  onPrice(price: number, ts: number, minute: number): void {
    this.lastPrice = price
    const p = this.position
    if (!p) return
    const targets = this.targets(p, ts)
    if (p.side === 1) {
      if (price <= targets.stopPrice) return this.close(targets.stopPrice, ts, minute, targets.stopReason)
      if (price >= targets.tpPrice) return this.close(targets.tpPrice, ts, minute, 'tp')
    } else {
      if (price >= targets.stopPrice) return this.close(targets.stopPrice, ts, minute, targets.stopReason)
      if (price <= targets.tpPrice) return this.close(targets.tpPrice, ts, minute, 'tp')
    }
  }

  neutralize(price: number, ts: number, minute: number): boolean {
    if (!this.position && !this.pending) return false
    if (this.position && (!Number.isFinite(price) || price <= 0)) return false
    this.pending = null
    if (this.position) this.close(price, ts, minute, 'neutral')
    this.cooldownUntilMinute = -Infinity
    return true
  }

  reset(_manual = false): void {
    this.equity = this.capital
    this.peak = this.capital
    this.maxDd = 0
    this.position = null
    this.pending = null
    this.trades = []
    this.curve = []
    this.cooldownUntilMinute = -Infinity
    this.wins = 0
    // kalah ikut dikosongkan supaya header (trade/win/kalah/dd/pf) benar-benar bersih
    this.losses = 0
    this.tpCount = 0
    this.liqCount = 0
    this.lastSignal = null
    this.lastPrice = 0
  }

  /**
   * Cek satu bar menit penuh (mode replay, sama dengan notebook): stop dulu, lalu target,
   * terakhir waktu habis.
   */
  onBar(bar: { high: number; low: number; close: number }, minute: number, ts: number): void {
    const p = this.position
    if (!p) return
    p.bars++
    const targets = this.targets(p, ts)
    if (p.side === 1) {
      if (bar.low <= targets.stopPrice) return this.close(targets.stopPrice, ts, minute, targets.stopReason)
      if (bar.high >= targets.tpPrice) return this.close(targets.tpPrice, ts, minute, 'tp')
    } else {
      if (bar.high >= targets.stopPrice) return this.close(targets.stopPrice, ts, minute, targets.stopReason)
      if (bar.low <= targets.tpPrice) return this.close(targets.tpPrice, ts, minute, 'tp')
    }
    this.lastPrice = bar.close
    // Notebook: sinyal di akhir menit t, masuk di open t+1, waktu habis di tutup menit t+HORIZON.
    if (minute - p.entryMinute >= this.trading.HORIZON_MIN - 1) {
      this.close(bar.close, ts, minute, 'timeout')
    }
  }

  /** Waktu habis di mode live (dicek tiap menit). */
  checkTimeout(minute: number, ts: number, price: number): void {
    const p = this.position
    if (!p) return
    this.lastPrice = price
    if (minute - p.entryMinute >= this.trading.HORIZON_MIN - 1) {
      this.close(price, ts, minute, 'timeout')
    }
  }

  close(exitPrice: number, ts: number, minute: number, reason: ExitReason): void {
    const p = this.position
    if (!p) return
    const side = p.side
    const exitEff = exitPrice * (1 - this.trading.SLIPPAGE * side)
    const gross = side * (exitEff / p.entry - 1)
    const fundingPeriods = Math.floor(asSeconds(ts) / 28800) - Math.floor(asSeconds(p.entryTs) / 28800)
    const net = gross - 2 * this.trading.FEE_TAKER - fundingPeriods * this.trading.FUNDING_8H
    const pnl = reason === 'liq' ? -p.margin : p.margin * this.trading.LEVERAGE * net
    this.equity = Math.max(0, this.equity + pnl)
    this.peak = Math.max(this.peak, this.equity)
    if (this.peak > 0) this.maxDd = Math.max(this.maxDd, (this.peak - this.equity) / this.peak)
    const trade: BotTrade = {
      id: `${this.id}-${++this.seq}`,
      botId: this.id,
      model: this.modelName,
      side,
      entryTs: p.entryTs,
      exitTs: ts,
      entry: p.entry,
      exit: exitEff,
      reason,
      bars: Math.max(1, minute - p.entryMinute),
      movePct: gross * 100,
      roiPct: p.margin > 0 ? (pnl / p.margin) * 100 : 0,
      pnl,
      equityAfter: this.equity,
      margin: p.margin,
      notional: p.notional,
    }
    this.trades.push(trade)
    if (this.trades.length > 4000) this.trades.splice(0, this.trades.length - 4000)
    if (pnl > 0) this.wins++
    if (pnl < 0) this.losses++
    if (reason === 'tp') this.tpCount++
    if (reason === 'liq') this.liqCount++
    this.position = null
    this.cooldownUntilMinute = reason === 'neutral' ? -Infinity : minute + this.trading.COOLDOWN_MIN
    this.curve.push({ ts, equity: this.equity })
    if (this.curve.length > 1440) this.curve.splice(0, this.curve.length - 1440)
    // Modal habis: paksa netral, kembalikan modal, dan hitung satu kalah.
    if (this.equity <= 0) this.bankrupt()
  }

  /**
   * Modal 0 → posisi/entry dipaksa netral, modal dikembalikan ke awal, siklus baru.
   * `losses` sengaja tidak dikosongkan: trade yang menghabiskan modal sudah menambah
   * hitungan kalah, dan hitungan itu ikut terlihat di header sebagai "kalah".
   */
  private bankrupt(): void {
    const last = this.trades[this.trades.length - 1]
    this.equity = this.capital
    this.peak = this.capital
    this.maxDd = 0
    this.position = null
    this.pending = null
    this.cooldownUntilMinute = -Infinity
    this.wins = 0
    this.tpCount = 0
    this.liqCount = 0
    this.trades = []
    this.curve = []
    this.onBankrupt?.(this, last)
  }

  /** Catat titik ekuitas berkala untuk grafik. */
  sample(minute: number, ts: number, price: number): void {
    this.lastPrice = price
    if (this.trades.length && this.curve.length) {
      const last = this.curve[this.curve.length - 1]
      if (ts - last.ts < 300_000) return
    }
    this.curve.push({ ts, equity: this.effectiveEquity })
    if (this.curve.length > 1440) this.curve.splice(0, this.curve.length - 1440)
  }

  stats() {
    const n = this.trades.length
    const winRate = n ? (this.wins / n) * 100 : 0
    const tps = this.trades.filter((t) => t.reason === 'tp').length
    const sumWin = this.trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0)
    const sumLoss = this.trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0)
    return {
      trades: n,
      winRate,
      losses: this.losses,
      tpRate: n ? (tps / n) * 100 : 0,
      liqCount: this.liqCount,
      maxDdPct: this.maxDd * 100,
      profitFactor: sumLoss < 0 ? Math.min(sumWin / -sumLoss, 999) : sumWin > 0 ? 999 : 0,
    }
  }
}

/** Kelola 6 bot + sinyal terbaru. */
export class BotManager {
  readonly bots: Bot[]
  readonly trading: TradingConfig
  /** tombol ON/OFF sistem: OFF = tidak ada entri baru, posisi berjalan tetap dikelola */
  entriesEnabled = true
  recentSignals: { ts: number; botId: string; model: string; side: Side; price: number; p: number[] }[] = []
  lastOutputs: ModelOutput[] = []
  lastContext: MinuteContext | null = null

  constructor(
    models: { name: string; kind: string }[],
    trading: TradingConfig,
    capital: number,
  ) {
    this.trading = trading
    this.bots = models.map(
      (m, i) => new Bot(`bot-${i + 1}-${slug(m.name)}`, m.name, m.kind, trading, capital),
    )
  }

  botForModel(name: string): Bot | undefined {
    return this.bots.find((b) => b.modelName === name)
  }

  botForId(id: string): Bot | undefined {
    return this.bots.find((b) => b.id === id)
  }

  /** Kembalikan semua bot ke modal awal (dipakai awal replay). */
  reset(manual = false): void {
    for (const bot of this.bots) bot.reset(manual)
    this.recentSignals = []
    this.lastOutputs = []
    this.lastContext = null
  }

  /** Satu menit selesai: simpan sinyal & (mode live) buka posisi pada harga penutupan. */
  onMinute(ctx: MinuteContext, outputs: ModelOutput[], mode: 'live' | 'replay'): void {
    this.lastContext = ctx
    this.lastOutputs = outputs
    for (const out of outputs) {
      const bot = this.botForModel(out.name)
      if (!bot) continue
      if (out.signal !== 0 && this.entriesEnabled) {
        const side = out.signal as Side
        const ok = bot.queueEntry(side, ctx.minuteIndex, ctx.ts, out.p, ctx.close)
        if (ok) {
          this.recentSignals.unshift({
            ts: ctx.ts,
            botId: bot.id,
            model: bot.modelName,
            side,
            price: ctx.close,
            p: out.p,
          })
          if (this.recentSignals.length > 60) this.recentSignals.length = 60
        }
      }
      if (mode === 'live' && bot.pending) {
        // masuk di batas menit; hitung horizon dari menit berikutnya (seperti open t+1)
        bot.openAt(ctx.close, ctx.ts, ctx.minuteIndex + 1)
      }
    }
  }

  /** Mode replay: buka pending di open menit berjalan, lalu cek bar. */
  onReplayBar(ctx: MinuteContext): void {
    for (const bot of this.bots) {
      if (bot.pending) bot.openAt(ctx.open, ctx.ts, ctx.minuteIndex)
      bot.onBar({ high: ctx.high, low: ctx.low, close: ctx.close }, ctx.minuteIndex, ctx.ts)
      bot.sample(ctx.minuteIndex, ctx.ts, ctx.close)
    }
  }

  onPrice(price: number, ts: number, minute: number): void {
    for (const bot of this.bots) bot.onPrice(price, ts, minute)
  }

  onMinuteTick(minute: number, ts: number, price: number): void {
    for (const bot of this.bots) {
      bot.checkTimeout(minute, ts, price)
      bot.sample(minute, ts, price)
    }
  }

  allTrades(limit = 50): BotTrade[] {
    const all = this.bots.flatMap((b) => b.trades)
    all.sort((a, b) => b.exitTs - a.exitTs)
    return all.slice(0, limit)
  }

  snapshot() {
    return {
      trading: this.trading,
      bots: this.bots.map((b) => ({
        id: b.id,
        model: b.modelName,
        kind: b.kind,
        capital: b.capital,
        equity: b.equity,
        effectiveEquity: b.effectiveEquity,
        roiPct: b.roiPct,
        unrealized: b.unrealized,
        position: b.position
          ? {
              side: b.position.side,
              entry: b.position.entry,
              ts: b.position.entryTs,
              margin: b.position.margin,
              notional: b.position.notional,
              tp: b.position.tpPrice,
              sl: b.position.slPrice,
              bars: b.position.bars,
            }
          : null,
        pending: b.pending ? { side: b.pending.side, minute: b.pending.minute } : null,
        cooldownUntilMinute: b.cooldownUntilMinute,
        lastSignal: b.lastSignal,
        stats: b.stats(),
        curve: b.curve.slice(-120),
        tradeCount: b.trades.length,
      })),
      recentSignals: this.recentSignals.slice(0, 20),
      trades: this.allTrades(30),
    }
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
