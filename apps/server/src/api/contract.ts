/**
 * Kontrak data antara server dan UI (satu sumber kebenaran).
 * Berkas ini hanya berisi tipe — tidak mengimpor apa pun saat runtime,
 * jadi aman dipakai bersama oleh Bun (server) dan Vite (web).
 */

export type Mode = 'live' | 'replay'
export type Side = 1 | -1
export type ExitReason = 'tp' | 'sl' | 'liq' | 'timeout' | 'end' | 'neutral'

export interface TradingView {
  LEVERAGE: number
  CAPITAL: number
  TP_PCT: number
  SL_PCT: number
  HORIZON_MIN: number
  FEE_TAKER: number
  SLIPPAGE: number
  FUNDING_8H: number
  MMR: number
  POSITION_FRACTION: number
  COOLDOWN_MIN: number
}

export interface PositionView {
  side: Side
  entry: number
  ts: number
  margin: number
  notional: number
  tp: number
  sl: number
  bars: number
}

export interface BotStatsView {
  trades: number
  winRate: number
  losses: number
  /** jumlah reset manual ke modal awal (dipisah dari kalah) */
  resets: number
  tpRate: number
  liqCount: number
  maxDdPct: number
  profitFactor: number
}

export interface BotView {
  id: string
  model: string
  kind: string
  capital: number
  neutralizable: boolean
  equity: number
  effectiveEquity: number
  roiPct: number
  unrealized: number
  position: PositionView | null
  pending: { side: Side; minute: number } | null
  stats: BotStatsView
  curve: { ts: number; equity: number }[]
  tradeCount: number
  lastSignal: { side: Side; ts: number; price: number; p: number[] } | null
}

export interface ModelView {
  name: string
  kind: string
  theta: number
  hard: boolean
  available: boolean
  p: number[]
  signal: Side | 0
  passedValidation: boolean
  roiFolds: number[]
  tradesFolds: number[]
}

export interface TradeView {
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
}

export interface FeedView {
  connected: boolean
  lastMessageTs: number
  lastPrice: number
  error: string | null
  reconnects: number
  messages: number
  transport: 'direct' | 'tunnel' | 'blocked'
}

export interface MarketView {
  symbol: string
  price: number
  buyPct: { future: number; spot: number }
  run: { future: { b: number; s: number }; spot: { b: number; s: number } }
  changePct: number | null
  source: 'binance' | 'replay'
}

export interface ReplayView {
  playing: boolean
  index: number
  total: number
  speed: number
  effectiveSpeed: number
  currentTs: number
  startTs: number
  endTs: number
  folds: { name: string; startIndex: number; ts: number }[]
}

export interface RestProbe {
  name: string
  host: string
  ok: boolean
  ms: number
  status: number | null
  error: string | null
}

export interface Diagnostics {
  now: number
  uptimeSec: number
  mode: Mode
  enabled: boolean
  symbol: string
  modelVersion: number
  ws: {
    clients: number
    peak: number
    snapshotsSent: number
    lastBroadcastAgoMs: number | null
  }
  api: {
    requests: number
    errors: number
    lastError: string | null
    lastErrorAgoMs: number | null
  }
  feed: Record<'future' | 'spot', FeedView & { ageSec: number | null }>
  btcFeed: Record<'btcFuture' | 'btcSpot', FeedView & { ageSec: number | null }>
  live: {
    ready: boolean
    historyMinutes: number
    neededMinutes: number
    pendingMinutes: number
    readyAtTs: number
    ticksPerSec: number
    computeCount: number
    computeMs: number
    lastError: string | null
    lastMinuteTs: number
  }
  rest: RestProbe[]
  problems: string[]
}

export interface LogEntry {
  ts: number
  level: 'info' | 'signal' | 'trade' | 'warn'
  text: string
}

export interface Snapshot {
  serverTime: number
  startedAt: number
  mode: Mode
  enabled: boolean
  market: MarketView
  feed: { future: FeedView; spot: FeedView }
  /** Konteks BTC: hanya fitur, bukan pasar yang ditradingkan. */
  btcFeed: { btcFuture: FeedView; btcSpot: FeedView }
  trading: TradingView
  models: ModelView[]
  bots: BotView[]
  trades: TradeView[]
  signals: { ts: number; botId: string; model: string; side: Side; price: number; p: number[] }[]
  replay: ReplayView | null
  live: {
    ready: boolean
    historyMinutes: number
    neededMinutes: number
    lastMinuteTs: number
    computeCount: number
    computeMs: number
    lastError: string | null
    ticksPerSec: number
    pendingMinutes: number
    readyAtTs: number
    modelVersion: number
    modelCreatedUtc: string
    symbol: string
    dominancePct: number
    streak: number
  }
  logs: LogEntry[]
}

export interface TradesResponse {
  trades: TradeView[]
  total: number
}

/** Payload ringan untuk aplikasi mobile: harga + sinyal terbaru saja. */
export interface SignalFeed {
  serverTime: number
  mode: Mode
  enabled: boolean
  price: number
  signals: Snapshot['signals']
}
