import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config'
import type { Diagnostics, LogEntry, Mode, ReplayView, RestProbe, Snapshot, TradeView } from './api/contract'
import { BinanceFeed, type MarketStatus } from './feed/binanceFeed'
import { fetchJson } from './feed/net'
import { metrics } from './metrics'
import { LivePipeline } from './live/livePipeline'
import { loadModelBundle, ModelRuntime } from './models/runtime'
import { ReplaySource, type ReplayData } from './replay/replaySource'
import { BotManager, compactCurve, type Bot, type BotTrade } from './sim/bot'

interface PersistedBot {
  model: string
  equity: number
  peak: number
  maxDd: number
  wins: number
  losses?: number
  resetCount?: number
  tpCount: number
  liqCount: number
  cooldownUntilMinute: number
  position: unknown
  pending: unknown
  lastSignal: unknown
  trades: unknown[]
  curve: { ts: number; equity: number }[]
}

interface PersistedState {
  savedAt: number
  enabled: boolean
  bots: PersistedBot[]
  replayLosses?: { model: string; losses: number }[]
}

/**
 * Orkestrator tunggal: model, feed Binance, jalur live, pemutar replay, 6 bot,
 * tombol ON/OFF, dan penyimpanan status ke disk.
 */
export class SimulationRuntime {
  readonly models: ModelRuntime
  readonly feed: BinanceFeed
  readonly live: LivePipeline
  readonly liveBots: BotManager
  replayBots: BotManager
  replay: ReplaySource | null = null
  private replayData: ReplayData | null = null

  mode: Mode = config.initialMode
  enabled = config.autoStart
  readonly startedAt = Date.now()

  private logs: LogEntry[] = []
  private tradeSeen = new Map<string, number>()
  private ticker: { price: number; changePct: number; ts: number } = { price: 0, changePct: 0, ts: 0 }
  private timers: Timer[] = []
  private savePath = `${config.dataDir}/state/bots.json`
  private subscribers: ((s: Snapshot) => void)[] = []

  constructor() {
    this.models = new ModelRuntime(loadModelBundle(config.modelsDir))
    const modelsMeta = this.models.bundle.manifest.models.map((m) => ({ name: m.name, kind: m.kind }))
    this.liveBots = new BotManager(modelsMeta, this.models.bundle.manifest.trading, this.models.bundle.manifest.trading.CAPITAL)
    this.replayBots = new BotManager(modelsMeta, this.models.bundle.manifest.trading, this.models.bundle.manifest.trading.CAPITAL)
    this.live = new LivePipeline(this.models, this.liveBots)
    this.feed = new BinanceFeed(config.symbol)

    const onBankrupt = (bot: Bot, trade: BotTrade | undefined) => {
      const detail = trade ? ` · trade terakhir ${Math.round(trade.pnl).toLocaleString('id-ID')} (${trade.roiPct.toFixed(1)}%)` : ''
      this.log(
        'warn',
        `${bot.modelName}: modal habis — posisi dipaksa netral, modal dikembalikan ke ${bot.capital.toLocaleString('id-ID')}, kalah +1${detail}`,
      )
    }
    for (const b of [...this.liveBots.bots, ...this.replayBots.bots]) b.onBankrupt = onBankrupt

    this.live.onMinute = () => this.publish()
    this.live.onSignal = (market, ev) => {
      this.log('signal', `${market === 'future' ? 'Futures' : 'Spot'}: dominasi ${ev.side === 1 ? 'BUY' : 'SELL'} ${ev.domPct.toFixed(1)}%`)
      this.publish()
    }
  }

  // ---------------------------------------------------------------- bootstrap

  start(): { history: { future: number; spot: number; signals: number }; restored: number } {
    const history = this.live.loadHistory()
    const restored = this.restore()
    this.liveBots.entriesEnabled = this.enabled

    this.feed.onTick((market, tick) => {
      if (this.mode !== 'live') return
      this.live.onTrade(market, tick)
    })
    this.feed.onSeed((market, ticks) => {
      if (this.mode !== 'live') return
      this.live.seed(market, ticks)
      this.log('info', `isi awal ${market === 'future' ? 'futures' : 'spot'}: ${ticks.length} transaksi`)
    })
    this.feed.onStatus((s) => this.reportFeed(s))
    this.feed.start()

    if (this.mode === 'replay') this.enterReplay()

    this.timers.push(setInterval(() => this.live.tick(), 2_000))
    this.timers.push(setInterval(() => void this.refreshTicker(), 60_000))
    this.timers.push(setInterval(() => this.publish(), 2_000))
    this.timers.push(setInterval(() => this.persist(), 30_000))
    void this.refreshTicker()

    this.log('info', `model v${this.models.bundle.manifest.version} dimuat: ${this.models.bundle.manifest.models.length} model`)
    this.log('info', `feed Binance ${config.symbol} disambungkan (futures + spot)`)
    return { history, restored }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.feed.stop()
    this.replay?.dispose()
    this.persist()
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.subscribers.push(fn)
    return () => {
      const i = this.subscribers.indexOf(fn)
      if (i >= 0) this.subscribers.splice(i, 1)
    }
  }

  // ------------------------------------------------------------------ control

  setEnabled(on: boolean): boolean {
    this.enabled = on
    this.liveBots.entriesEnabled = on
    this.replayBots.entriesEnabled = on
    this.log(on ? 'info' : 'warn', on ? 'sistem DINYALAKAN — bot boleh membuka posisi baru' : 'sistem DIMATIKAN — tidak ada entri baru, posisi berjalan tetap dikelola')
    this.persist()
    this.publish()
    return this.enabled
  }

  setMode(mode: Mode): Mode {
    if (mode === this.mode) return this.mode
    this.mode = mode
    if (mode === 'replay') {
      this.enterReplay()
      this.log('info', 'mode REPLAY: memutar data validasi (status live disimpan)')
    } else {
      this.replay?.pause()
      this.log('info', 'mode LIVE: kembali ke data Binance langsung')
    }
    this.publish()
    return this.mode
  }

  private enterReplay(): void {
    if (!this.replayData) this.replayData = ReplaySource.load()
    if (!this.replay) {
      this.replay = new ReplaySource(this.replayData, this.models, this.replayBots, () => this.publish())
    }
    this.replayBots.entriesEnabled = this.enabled
  }

  replayAction(action: 'play' | 'pause' | 'reset' | 'speed' | 'seek', value?: number): ReplayView | null {
    if (this.mode !== 'replay') return null
    this.enterReplay()
    const r = this.replay!
    if (action === 'play') {
      r.play()
      this.log('info', 'replay diputar')
    } else if (action === 'pause') r.pause()
    else if (action === 'reset') r.reset(0)
    else if (action === 'speed' && value) r.setSpeed(value)
    else if (action === 'seek' && typeof value === 'number') r.reset(value)
    this.publish()
    return r.status
  }

  resetBots(target: Mode = this.mode): void {
    const mgr = target === 'replay' ? this.replayBots : this.liveBots
    mgr.reset(true)
    this.tradeSeen.clear()
    this.log('warn', target === 'replay' ? 'simulasi replay direset ke modal awal (reset +1 per model)' : 'simulasi live direset ke modal awal (reset +1 per model)')
    this.persist()
    this.publish()
  }

  resetBot(id: string): boolean {
    const mgr = this.manager()
    const bot = mgr.botForId(id) ?? mgr.botForModel(id)
    if (!bot) return false
    bot.reset(true)
    this.tradeSeen.set(bot.id, 0)
    this.log('warn', `${bot.modelName}: saldo + statistik direset ke modal awal, reset ke-${bot.resetCount} (trade/win/kalah/dd/pf dikosongkan, bukan kalah)`)
    this.persist()
    this.publish()
    return true
  }

  neutralizeBot(id: string): boolean {
    const mgr = this.manager()
    const bot = mgr.botForId(id) ?? mgr.botForModel(id)
    if (!bot) return false
    const price = this.mode === 'replay' ? this.replay?.currentPrice ?? 0 : this.live.lastPrice || this.ticker.price || this.feed.getStatus().future.lastPrice
    const ts = this.mode === 'replay' ? this.replay?.status.currentTs ?? Math.floor(Date.now() / 1000) : Math.floor(Date.now() / 1000)
    const currentMinute = this.mode === 'replay' ? this.replay?.status.index ?? 0 : Math.floor(ts / 60)
    const minute = Math.max(currentMinute, bot.position?.entryMinute ?? bot.pending?.minute ?? 0)
    if (!bot.neutralize(price, ts, minute)) return false
    this.log('info', `${bot.modelName}: posisi dipaksa netral`)
    this.persist()
    this.publish()
    return true
  }

  reloadModels(): { version: number; models: number } {
    const next = loadModelBundle(config.modelsDir)
    this.models.setBundle(next)
    this.log('info', `model dimuat ulang: v${next.manifest.version} (${next.manifest.models.length} model)`)
    this.publish()
    return { version: next.manifest.version, models: next.manifest.models.length }
  }

  // ---------------------------------------------------------------- snapshot

  private manager(): BotManager {
    return this.mode === 'replay' ? this.replayBots : this.liveBots
  }

  get activeBots(): BotManager {
    return this.manager()
  }

  private log(level: LogEntry['level'], text: string): void {
    this.logs.unshift({ ts: Date.now(), level, text })
    if (this.logs.length > 60) this.logs.length = 60
  }

  private reportFeed(status: Record<'future' | 'spot', MarketStatus>): void {
    for (const [market, st] of Object.entries(status) as ['future' | 'spot', MarketStatus][]) {
      const key = `${market}`
      const prev = this.feedState.get(key)
      if (prev !== st.connected) {
        this.feedState.set(key, st.connected)
        this.log(st.connected ? 'info' : 'warn', `${market === 'future' ? 'Futures' : 'Spot'} ${st.connected ? 'tersambung' : 'terputus'}`)
      }
      if (st.error && this.lastFeedError.get(key) !== st.error) {
        this.lastFeedError.set(key, st.error)
        this.log('warn', `${market}: ${st.error}`)
      }
    }
  }

  private feedState = new Map<string, boolean>()
  private lastFeedError = new Map<string, string>()

  private async refreshTicker(): Promise<void> {
    try {
      const o = await fetchJson<{ lastPrice: string; priceChangePercent: string }>(
        `${config.spot.rest}/api/v3/ticker/24hr?symbol=${config.symbol}`,
        8_000,
      )
      this.ticker = { price: Number(o.lastPrice), changePct: Number(o.priceChangePercent), ts: Date.now() }
    } catch {
      /* opsional: header tetap memakai harga dari WebSocket */
    }
  }

  /** Diagnostik satu kali klik: kondisi WS, feed, REST Binance, dan pemanasan. */
  async diagnostics(): Promise<Diagnostics> {
    const now = Date.now()
    const feed = this.feed.getStatus()
    const live = this.live.status

    const probe = async (name: string, url: string): Promise<RestProbe> => {
      const t0 = performance.now()
      try {
        await fetchJson<unknown>(url, 5_000)
        return { name, host: new URL(url).host, ok: true, ms: Math.round(performance.now() - t0), status: 200, error: null }
      } catch (e) {
        return {
          name,
          host: new URL(url).host,
          ok: false,
          ms: Math.round(performance.now() - t0),
          status: null,
          error: (e as Error).message.slice(0, 120),
        }
      }
    }

    const rest = await Promise.all([
      probe('spot REST', `${config.spot.rest}/api/v3/time`),
      probe('futures REST', `${config.future.rest}/fapi/v1/time`),
    ])

    const ageSec = (ts: number) => (ts > 0 ? Math.round((now - ts) / 1000) : null)
    const problems: string[] = []

    for (const market of ['future', 'spot'] as const) {
      const st = feed[market]
      if (!st.connected) problems.push(`feed ${market} terputus${st.error ? `: ${st.error}` : ''}`)
      const age = ageSec(st.lastMessageTs)
      if (st.connected && (age === null || age > 30)) {
        problems.push(`feed ${market} tersambung tetapi tidak ada transaksi ${age ?? '?'} detik`)
      }
    }
    if (!live.ready) {
      const sisa = Math.max(0, live.neededMinutes - live.historyMinutes)
      problems.push(`pemanasan ${live.historyMinutes}/${live.neededMinutes} menit — sinyal pertama ±${sisa} menit lagi`)
    }
    if (live.lastError) problems.push(`galat perhitungan terakhir: ${live.lastError}`)
    for (const r of rest) if (!r.ok) problems.push(`${r.name} gagal: ${r.error}`)
    if (metrics.lastApiError && now - metrics.lastApiErrorTs < 120_000) {
      problems.push(`galat API terakhir: ${metrics.lastApiError}`)
    }

    return {
      now,
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      mode: this.mode,
      enabled: this.enabled,
      symbol: this.models.bundle.manifest.symbol,
      modelVersion: this.models.bundle.manifest.version,
      ws: {
        clients: metrics.wsClients,
        peak: metrics.wsPeak,
        snapshotsSent: metrics.snapshotsSent,
        lastBroadcastAgoMs: metrics.lastBroadcastTs ? now - metrics.lastBroadcastTs : null,
      },
      api: {
        requests: metrics.apiRequests,
        errors: metrics.apiErrors,
        lastError: metrics.lastApiError,
        lastErrorAgoMs: metrics.lastApiErrorTs ? now - metrics.lastApiErrorTs : null,
      },
      feed: {
        future: { ...feed.future, ageSec: ageSec(feed.future.lastMessageTs) },
        spot: { ...feed.spot, ageSec: ageSec(feed.spot.lastMessageTs) },
      },
      live: {
        ready: live.ready,
        historyMinutes: live.historyMinutes,
        neededMinutes: live.neededMinutes,
        pendingMinutes: live.pendingMinutes,
        readyAtTs: live.readyAtTs,
        ticksPerSec: live.ticksPerSec,
        computeCount: live.computeCount,
        computeMs: live.lastComputeMs,
        lastError: live.lastError,
        lastMinuteTs: live.lastMinuteTs,
      },
      rest,
      problems,
    }
  }

  /** Paksa feed Binance menyambung ulang tanpa restart proses. */
  restartFeed(): void {
    this.log('warn', 'menyambung ulang feed Binance atas permintaan')
    this.feed.stop()
    setTimeout(() => this.feed.start(), 400)
  }

  snapshot(): Snapshot {
    const mgr = this.manager()
    const mode = this.mode
    const feed = this.feed.getStatus()
    const manifest = this.models.bundle.manifest
    const outputs = mgr.lastOutputs
    const replayPrice = mode === 'replay' ? (this.replay?.currentPrice ?? 0) : 0
    const targetTs = mode === 'replay' ? this.replay?.status.currentTs ?? Math.floor(Date.now() / 1000) : Math.floor(Date.now() / 1000)
    const price =
      mode === 'replay'
        ? replayPrice || this.live.lastPrice
        : this.live.lastPrice || this.ticker.price || feed.future.lastPrice
    const curveLimit = mode === 'replay' ? 160 : 120

    for (const bot of mgr.bots) {
      const seen = this.tradeSeen.get(bot.id) ?? 0
      if (bot.trades.length > seen) {
        for (const t of bot.trades.slice(seen)) {
          this.log(
            'trade',
            `${t.model}: ${t.side === 1 ? 'LONG' : 'SHORT'} ditutup ${t.reason.toUpperCase()} ${t.pnl >= 0 ? '+' : ''}${Math.round(t.pnl).toLocaleString('id-ID')} (${t.roiPct.toFixed(1)}%)`,
          )
        }
        this.tradeSeen.set(bot.id, bot.trades.length)
      } else if (bot.trades.length < seen) {
        this.tradeSeen.set(bot.id, bot.trades.length)
      }
    }

    return {
      serverTime: Date.now(),
      startedAt: this.startedAt,
      mode,
      enabled: this.enabled,
      market: {
        symbol: manifest.symbol,
        price,
        buyPct: { future: this.live.lastBuyPct.future, spot: this.live.lastBuyPct.spot },
        run: this.live.lastRuns,
        changePct: mode === 'replay' ? null : this.ticker.ts ? this.ticker.changePct : null,
        source: mode === 'replay' ? 'replay' : 'binance',
      },
      feed: { future: feed.future, spot: feed.spot },
      trading: {
        LEVERAGE: manifest.trading.LEVERAGE,
        CAPITAL: manifest.trading.CAPITAL,
        TP_PCT: manifest.trading.TP_PCT,
        SL_PCT: manifest.trading.SL_PCT,
        HORIZON_MIN: manifest.trading.HORIZON_MIN,
        FEE_TAKER: manifest.trading.FEE_TAKER,
        SLIPPAGE: manifest.trading.SLIPPAGE,
        FUNDING_8H: manifest.trading.FUNDING_8H,
        MMR: manifest.trading.MMR,
        POSITION_FRACTION: manifest.trading.POSITION_FRACTION,
        COOLDOWN_MIN: manifest.trading.COOLDOWN_MIN,
      },
      models: manifest.models.map((m) => {
        const out = outputs.find((o) => o.name === m.name)
        return {
          name: m.name,
          kind: m.kind,
          theta: m.theta,
          hard: m.hard,
          available: out?.available ?? false,
          p: out?.p ?? [0, 0, 0],
          signal: out?.signal ?? 0,
          passedValidation: m.passed_validation,
          roiFolds: m.roi_pct_folds,
          tradesFolds: m.trades_folds,
        }
      }),
      bots: mgr.bots.map((b) => ({
        id: b.id,
        model: b.modelName,
        kind: b.kind,
        capital: b.capital,
        neutralizable: Boolean(b.position || b.pending),
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
              tp: b.targetPrices(targetTs)?.tpPrice ?? b.position.tpPrice,
              sl: b.targetPrices(targetTs)?.slPrice ?? b.position.slPrice,
              bars: b.position.bars,
            }
          : null,
        pending: b.pending ? { side: b.pending.side, minute: b.pending.minute } : null,
        stats: b.stats(),
        curve: b.curve.slice(-curveLimit),
        tradeCount: b.trades.length,
        lastSignal: b.lastSignal,
      })),
      trades: mgr.allTrades(30) as TradeView[],
      signals: mgr.recentSignals.slice(0, 12),
      replay: this.replay ? this.replay.status : null,
      live: {
        ready: this.live.status.ready,
        historyMinutes: this.live.status.historyMinutes,
        neededMinutes: this.live.status.neededMinutes,
        lastMinuteTs: this.live.status.lastMinuteTs,
        computeCount: this.live.status.computeCount,
        computeMs: this.live.status.lastComputeMs,
        ticksPerSec: this.live.ticksPerSec,
        pendingMinutes: this.live.status.pendingMinutes,
        readyAtTs: this.live.status.readyAtTs,
        lastError: this.live.status.lastError,
        modelVersion: manifest.version,
        modelCreatedUtc: manifest.created_utc,
        symbol: manifest.symbol,
        dominancePct: config.signal.dominancePct,
        streak: config.signal.streak,
      },
      logs: this.logs,
    }
  }

  private publish(): void {
    if (!this.subscribers.length) return
    const snap = this.snapshot()
    for (const fn of this.subscribers) {
      try {
        fn(snap)
      } catch {
        /* klien lambat/terputus */
      }
    }
  }

  // ------------------------------------------------------------- persistence

  private persist(): void {
    try {
      const state: PersistedState = {
        savedAt: Date.now(),
        enabled: this.enabled,
        replayLosses: this.replayBots.bots.map((b) => ({ model: b.modelName, losses: b.losses })),
        bots: this.liveBots.bots.map((b) => ({
          model: b.modelName,
          equity: b.equity,
          peak: b.peak,
          maxDd: b.maxDd,
          wins: b.wins,
          losses: b.losses,
          resetCount: b.resetCount,
          tpCount: b.tpCount,
          liqCount: b.liqCount,
          cooldownUntilMinute: b.cooldownUntilMinute,
          position: b.position,
          pending: b.pending,
          lastSignal: b.lastSignal,
          trades: b.trades.slice(-300),
          curve: b.curve.slice(-300),
        })),
      }
      mkdirSync(dirname(this.savePath), { recursive: true })
      writeFileSync(this.savePath, JSON.stringify(state))
    } catch (e) {
      console.error('[state] gagal menyimpan:', e)
    }
  }

  private restore(): number {
    if (!existsSync(this.savePath)) return 0
    try {
      const state = JSON.parse(readFileSync(this.savePath, 'utf8')) as PersistedState
      let restored = 0
      for (const saved of state.bots) {
        const bot = this.liveBots.bots.find((b) => b.modelName === saved.model)
        if (!bot) continue
        bot.equity = saved.equity
        bot.peak = saved.peak
        bot.maxDd = saved.maxDd
        bot.wins = saved.wins
        bot.resetCount = saved.resetCount ?? 0
        bot.tpCount = saved.tpCount
        bot.liqCount = saved.liqCount
        bot.cooldownUntilMinute = saved.cooldownUntilMinute
        bot.position = (saved.position as typeof bot.position) ?? null
        bot.pending = (saved.pending as typeof bot.pending) ?? null
        bot.lastSignal = (saved.lastSignal as typeof bot.lastSignal) ?? null
        bot.trades = (saved.trades as typeof bot.trades) ?? []
        bot.losses = saved.losses ?? bot.trades.filter((t) => t.pnl < 0).length
        bot.curve = saved.curve ? compactCurve(saved.curve) : []
        this.tradeSeen.set(bot.id, bot.trades.length)
        restored++
      }
      for (const saved of state.replayLosses ?? []) {
        const bot = this.replayBots.botForModel(saved.model)
        if (bot) bot.losses = saved.losses
      }
      this.enabled = state.enabled
      this.liveBots.entriesEnabled = state.enabled
      if (restored) this.log('info', `status simulasi dipulihkan: ${restored} bot (disimpan ${new Date(state.savedAt).toLocaleString('id-ID')})`)
      return restored
    } catch {
      return 0
    }
  }
}
