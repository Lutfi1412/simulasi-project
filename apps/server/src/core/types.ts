/**
 * Tipe data inti. Semua nilai fitur boleh NaN (pandas: NaN = fitur belum tersedia),
 * dan setiap pembaca model harus memperlakukan NaN sebagai null.
 */

export type MarketKey = 'future' | 'spot'

export interface TradeTick {
  /** milidetik epoch (UTC) */
  ts: number
  price: number
  /** nilai transaksi dalam USDT (quote) */
  qty: number
  /** true = pembeli agresif (taker buy) */
  isBuy: boolean
}

/**
 * Satu baris data per menit per pasar. Sama persis dengan kolom CSV "menit/*_1m.csv"
 * yang dipakai notebook untuk melatih model.
 */
export interface MinuteRow {
  /** detik epoch, awal menit (UTC) */
  ts: number
  open: number
  high: number
  low: number
  close: number
  quoteVol: number
  takerBuyQuote: number
  n: number
  buyN: number
  maxTradeUsdt: number
  buyPctEnd: number
  buyPctMean: number
  buyPctMin: number
  buyPctMax: number
  winN: number
  winSec: number
  winRetPct: number
  winRangePct: number
  vwapDevPct: number
  ticks: number
  src: number
  runBuy: number[]
  runSell: number[]
  durBuy: number[]
  durSell: number[]
}

/** Sinyal gaya aplikasi (dominasi >= X% selama >= N pembaruan) */
export interface SignalEvent {
  ts: number
  side: 1 | -1
  domPct: number
}

export interface TradingConfig {
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
  EXIT_ON_OPPOSITE: boolean
  SEQ_LEN: number
}

export type ModelKind = 'rule' | 'logreg' | 'xgb' | 'meta' | 'gru' | 'ensemble'

export interface ModelEntry {
  name: string
  kind: ModelKind
  file: string
  theta: number
  hard: boolean
  passed_validation: boolean
  roi_pct_folds: number[]
  trades_folds: number[]
}

export interface Manifest {
  version: number
  created_utc: string
  symbol: string
  class_order: string[]
  features: string[]
  margin: number
  best_model: string
  trading: TradingConfig
  models: ModelEntry[]
  signal_rule?: Record<string, string>
  replay?: { file: string; note: string }
  golden?: { proba: string; results: string }
}

/** Satu menit konteks yang masuk ke mesin bot (live maupun replay). */
export interface MinuteContext {
  /** detik epoch awal menit */
  ts: number
  /** indeks menit global (untuk hitung horizon/cooldown) */
  minuteIndex: number
  open: number
  high: number
  low: number
  close: number
  /** 40 fitur sesuai urutan manifest; NaN = tidak tersedia */
  features: Record<string, number>
  /** nilai mentah run_b.. dan run_s.. yang dipakai model aturan & meta-label */
  rawRuns: Record<string, number>
  source: 'live' | 'replay'
}
