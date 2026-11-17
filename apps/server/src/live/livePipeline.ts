import { config } from '../config'
import { buildGrid, computeFeatureSeries, RUN_THRESHOLDS } from '../core/featureBuilder'
import { MinuteRecorder } from '../core/minuteRecorder'
import type { AuxMarketKey, MarketKey, MinuteContext, TradeTick } from '../core/types'
import { SignalEngine } from '../feed/signalEngine'
import type { ModelRuntime } from '../models/runtime'
import type { BotManager } from '../sim/bot'
import { MinuteStore, SignalStore } from '../state/minuteStore'

export interface LiveStatus {
  /** menit histori yang sudah terkumpul (butuh minHistoryMinutes) */
  historyMinutes: number
  neededMinutes: number
  ready: boolean
  lastMinuteTs: number
  lastComputeMs: number
  computeCount: number
  lastError: string | null
  /** transaksi futures per detik (10 detik terakhir) */
  ticksPerSec: number
  /** sisa menit sebelum sinyal pertama bisa dihitung */
  pendingMinutes: number
  /** perkiraan waktu (epoch ms) sinyal pertama siap */
  readyAtTs: number
}

/**
 * Jalur data langsung (Binance WS -> menit -> fitur -> model -> bot).
 *
 * Urutan kerjanya sama dengan notebook: satu menit selesai -> susun grid 1 menit ->
 * hitung 40 fitur (hanya data sampai menit itu) -> model memberi sinyal -> bot masuk
 * pada harga saat itu (setara open menit berikutnya).
 */
export class LivePipeline {
  private recorders: Record<MarketKey, MinuteRecorder>
  private engines: Record<MarketKey, SignalEngine>
  private stores: Record<MarketKey, MinuteStore>
  private signalStores: Record<MarketKey, SignalStore>
  /** BTCUSDT hanya konteks fitur (btc_*), tidak pernah dipakai membuka order. */
  private auxRecorders: Record<AuxMarketKey, MinuteRecorder>
  private auxStores: Record<AuxMarketKey, MinuteStore>
  private lastComputed = 0
  private computeCount = 0
  private lastComputeMs = 0
  private lastError: string | null = null
  lastContext: MinuteContext | null = null
  lastFeatures: Record<string, number> = {}
  lastPrice = 0
  lastBuyPct = { future: 50, spot: 50 }
  lastRuns = { future: { b: 0, s: 0 }, spot: { b: 0, s: 0 } }
  private tickStamps: number[] = []
  onMinute: ((ctx: MinuteContext) => void) | null = null
  onSignal: ((market: MarketKey, event: { ts: number; side: 1 | -1; domPct: number }) => void) | null = null

  constructor(
    private readonly models: ModelRuntime,
    private readonly bots: BotManager,
  ) {
    const seqLen = Number(this.models.bundle.manifest.trading?.SEQ_LEN) || 60
    const floor = config.lookbackMinutes + seqLen
    if (config.minHistoryMinutes < floor) {
      console.warn(
        `[peringatan] MIN_HISTORY_MINUTES=${config.minHistoryMinutes} di bawah minimum ${floor} ` +
          `(${config.lookbackMinutes} lookback + ${seqLen} urutan GRU) — dipakai ${floor}.`,
      )
    }
    const mkRecorder = () => new MinuteRecorder(config.tradeWindow)
    this.recorders = { future: mkRecorder(), spot: mkRecorder() }
    const mkEngine = () =>
      new SignalEngine({
        windowSize: config.tradeWindow,
        dominancePct: config.signal.dominancePct,
        streak: config.signal.streak,
        cooldownMs: config.signal.cooldownMs,
      })
    this.engines = { future: mkEngine(), spot: mkEngine() }
    this.stores = {
      future: new MinuteStore(`${config.dataDir}/minutes/future.jsonl`),
      spot: new MinuteStore(`${config.dataDir}/minutes/spot.jsonl`),
    }
    this.signalStores = {
      future: new SignalStore(`${config.dataDir}/signals/future`),
      spot: new SignalStore(`${config.dataDir}/signals/spot`),
    }
    this.auxRecorders = { btcFuture: mkRecorder(), btcSpot: mkRecorder() }
    this.auxStores = {
      btcFuture: new MinuteStore(`${config.dataDir}/minutes/btc_future.jsonl`),
      btcSpot: new MinuteStore(`${config.dataDir}/minutes/btc_spot.jsonl`),
    }
  }

  /** Muat histori dari disk (dipanggil sekali saat boot). */
  loadHistory(): { future: number; spot: number; btcFuture: number; btcSpot: number; signals: number } {
    const future = this.stores.future.load()
    const spot = this.stores.spot.load()
    const btcFuture = this.auxStores.btcFuture.load()
    const btcSpot = this.auxStores.btcSpot.load()
    const signals = this.signalStores.future.load() + this.signalStores.spot.load()
    this.stores.future.compact()
    this.stores.spot.compact()
    this.auxStores.btcFuture.compact()
    this.auxStores.btcSpot.compact()
    return { future, spot, btcFuture, btcSpot, signals }
  }

  /**
   * Menit histori minimum yang benar-benar dibutuhkan model:
   * lookback terpanjang (240) + panjang urutan GRU (SEQ_LEN). Nilai di bawah itu
   * membuat fitur ret_240/basis_z/vol_z kosong dan GRU kehabisan baris.
   */
  get neededMinutes(): number {
    const seqLen = Number(this.models.bundle.manifest.trading?.SEQ_LEN) || 60
    return Math.max(config.minHistoryMinutes, config.lookbackMinutes + seqLen)
  }

  get status(): LiveStatus {
    const usable = Math.min(
      this.stores.future.tailMinutes(),
      this.stores.spot.tailMinutes(),
      this.auxStores.btcFuture.tailMinutes(),
      this.auxStores.btcSpot.tailMinutes(),
    )
    const needed = this.neededMinutes
    return {
      historyMinutes: usable,
      neededMinutes: needed,
      ready: usable >= needed,
      lastMinuteTs: Math.min(
        this.stores.future.lastMinute,
        this.stores.spot.lastMinute,
        this.auxStores.btcFuture.lastMinute,
        this.auxStores.btcSpot.lastMinute,
      ),
      lastComputeMs: this.lastComputeMs,
      computeCount: this.computeCount,
      lastError: this.lastError,
      ticksPerSec: this.ticksPerSec,
      pendingMinutes: Math.max(0, needed - usable),
      readyAtTs: Date.now() + Math.max(0, needed - usable) * 60_000,
    }
  }

  /** Laju transaksi futures 10 detik terakhir — dipakai indikator "detak" di UI. */
  get ticksPerSec(): number {
    const cutoff = Date.now() - 10_000
    while (this.tickStamps.length && this.tickStamps[0] < cutoff) this.tickStamps.shift()
    return Math.round((this.tickStamps.length / 10) * 10) / 10
  }

  /** Isi awal dari REST (jendela 50 transaksi) — bukan bar menit. */
  seed(market: MarketKey, ticks: TradeTick[]): void {
    this.recorders[market].seed(ticks)
    for (const t of ticks.slice(-config.tradeWindow)) this.engines[market].onTrade(t)
  }

  /** Isi awal BTC: hanya jendela transaksi agar buy_pct/run langsung terisi. */
  seedAux(market: AuxMarketKey, ticks: TradeTick[]): void {
    this.auxRecorders[market].seed(ticks)
  }

  onAuxTrade(market: AuxMarketKey, tick: TradeTick): void {
    this.auxRecorders[market].onTrade(tick)
    this.drainAux(market)
  }

  onTrade(market: MarketKey, tick: TradeTick): void {
    const rec = this.recorders[market]
    rec.onTrade(tick)

    const ev = this.engines[market].onTrade(tick)
    if (ev) {
      this.signalStores[market].push(ev)
      this.onSignal?.(market, ev)
    }

    if (market === 'future') {
      this.tickStamps.push(tick.ts)
      if (this.tickStamps.length > 600) this.tickStamps.splice(0, 300)
      this.lastPrice = tick.price
      this.bots.onPrice(tick.price, tick.ts, Math.floor(tick.ts / 60_000))
    }

    const ping = rec.ping()
    this.lastBuyPct[market] = ping.lastBuyPct
    this.lastRuns[market] = { b: ping.runB[3] ?? 0, s: ping.runS[3] ?? 0 }

    this.drain(market)
  }

  /** Timer: tutup menit yang menggantung, cek timeout posisi, update grafik. */
  tick(nowMs = Date.now()): void {
    const nowSec = Math.floor(nowMs / 1000)
    for (const m of ['future', 'spot'] as MarketKey[]) {
      this.recorders[m].flushIdle(nowSec)
      this.drain(m)
    }
    for (const m of ['btcFuture', 'btcSpot'] as AuxMarketKey[]) {
      this.auxRecorders[m].flushIdle(nowSec)
      this.drainAux(m)
    }
    const minute = Math.floor(nowMs / 60_000)
    if (this.lastPrice > 0) this.bots.onMinuteTick(minute, nowMs, this.lastPrice)
    this.maybeCompute()
  }

  private drain(market: MarketKey): void {
    const rows = this.recorders[market].takeCompleted()
    if (!rows.length) return
    for (const row of rows) this.stores[market].add(row)
    this.maybeCompute()
  }

  private drainAux(market: AuxMarketKey): void {
    const rows = this.auxRecorders[market].takeCompleted()
    if (!rows.length) return
    for (const row of rows) this.auxStores[market].add(row)
    this.maybeCompute()
  }

  /** Hitung fitur & sinyal untuk menit terakhir yang lengkap di kedua pasar. */
  private maybeCompute(): void {
    const m = Math.min(
      this.stores.future.lastMinute,
      this.stores.spot.lastMinute,
      this.auxStores.btcFuture.lastMinute,
      this.auxStores.btcSpot.lastMinute,
    )
    if (!m || m <= this.lastComputed) return
    if (!this.status.ready) return

    const t0 = performance.now()
    try {
      const count = Math.min(
        config.bufferMinutes,
        this.stores.future.size,
        this.stores.spot.size,
        this.auxStores.btcFuture.size,
        this.auxStores.btcSpot.size,
      )
      const grid = buildGrid(this.stores.future.map, this.stores.spot.map, m, count, RUN_THRESHOLDS, {
        future: this.auxStores.btcFuture.map,
        spot: this.auxStores.btcSpot.map,
      })
      const X = computeFeatureSeries(grid, {
        signalsFuture: this.signalStores.future.events,
        signalsSpot: this.signalStores.spot.events,
      })

      const i = count - 1
      const features: Record<string, number> = {}
      for (const name of this.models.bundle.manifest.features) {
        const arr = X[name]
        const v = arr ? arr[i] : Number.NaN
        features[name] = typeof v === 'number' ? v : Number.NaN
      }

      const rawRuns: Record<string, number> = {}
      const thresholds = grid.thresholds
      for (let k = 0; k < thresholds.length; k++) {
        const T = thresholds[k]
        rawRuns[`run_b${T}_f`] = grid.f.runB[k][i]
        rawRuns[`run_s${T}_f`] = grid.f.runS[k][i]
        rawRuns[`run_b${T}_s`] = grid.s ? grid.s.runB[k][i] : 0
        rawRuns[`run_s${T}_s`] = grid.s ? grid.s.runS[k][i] : 0
      }

      const seqLen = Math.max(...[...this.models.bundle.models.values()].map((m2) => ('seq_len' in m2.file ? m2.file.seq_len : 0)), 1)
      const seq: Record<string, number>[] = []
      for (let r = Math.max(0, i - seqLen + 1); r <= i; r++) {
        const rowFeature: Record<string, number> = {}
        for (const name of this.models.bundle.manifest.features) {
          const arr = X[name]
          const v = arr ? arr[r] : Number.NaN
          rowFeature[name] = typeof v === 'number' ? v : Number.NaN
        }
        seq.push(rowFeature)
      }

      const bad = grid.bad[i]
      const ctx: MinuteContext = {
        ts: m,
        minuteIndex: Math.floor(m / 60),
        open: grid.f.open[i],
        high: grid.f.high[i],
        low: grid.f.low[i],
        close: grid.f.close[i],
        features,
        rawRuns,
        source: 'live',
      }
      this.lastContext = ctx
      this.lastFeatures = features
      this.lastComputed = m
      this.computeCount++
      this.lastError = null

      if (Number.isFinite(ctx.close) && ctx.close > 0) this.lastPrice = ctx.close
      if (!bad) {
        const outputs = this.models.predict(features, rawRuns, seq)
        this.bots.onMinute(ctx, outputs, 'live')
      }
      this.onMinute?.(ctx)
    } catch (e) {
      this.lastError = (e as Error).message
      console.error('[live] gagal menghitung fitur:', e)
    } finally {
      this.lastComputeMs = Math.round(performance.now() - t0)
    }
  }
}
