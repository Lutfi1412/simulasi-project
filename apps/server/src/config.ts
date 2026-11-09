import { resolve } from 'node:path'

/** Akar repo (folder simulasi-testing) */
export const ROOT = resolve(import.meta.dir, '../../..')

const num = (v: string | undefined, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
const str = (v: string | undefined, d: string) => (v && v.trim() ? v.trim() : d)

export const config = {
  port: num(process.env.PORT, 8080),
  hostname: str(process.env.HOST, '0.0.0.0'),
  dataDir: resolve(ROOT, str(process.env.DATA_DIR, 'apps/server/data')),
  modelsDir: resolve(ROOT, str(process.env.MODELS_DIR, 'apps/server/models/current')),
  webDist: resolve(ROOT, str(process.env.WEB_DIST, 'apps/web/dist')),

  symbol: str(process.env.SYMBOL, 'SOLUSDT').toUpperCase(),

  /**
   * Pengaturan sinyal gaya aplikasi mining. Nilai ini HARUS sama dengan pengaturan
   * yang dipakai saat data mining direkam (log sinyal: thr_pct=85, thr_streak=12),
   * karena fitur sig_* di model dilatih dari sinyal dengan aturan tersebut.
   */
  signal: {
    dominancePct: num(process.env.SIGNAL_DOMINANCE_PCT, 85),
    streak: num(process.env.SIGNAL_STREAK, 12),
    cooldownMs: 60_000,
  },

  /** jumlah transaksi di jendela dominasi (sama dengan aplikasi: 50) */
  tradeWindow: num(process.env.TRADE_WINDOW, 50),

  /**
   * Fitur terpanjang butuh 240 menit ke belakang (ret_240, basis_z, vol_z).
   * Angka ini mengikuti featureBuilder; jangan diubah tanpa melatih ulang model.
   */
  lookbackMinutes: 240,
  /**
   * Ambang pemanasan. Minimum sebenarnya = lookbackMinutes + SEQ_LEN (60) = 300;
   * nilai di bawah itu otomatis dinaikkan oleh LivePipeline supaya model tidak
   * diam-diam tidak pernah memberi sinyal. Boleh diperbesar (mis. 1440).
   */
  minHistoryMinutes: num(process.env.MIN_HISTORY_MINUTES, 305),
  /** buffer menit yang disimpan di memori */
  bufferMinutes: num(process.env.BUFFER_MINUTES, 900),

  /** nyalakan bot otomatis saat server hidup */
  autoStart: str(process.env.AUTO_START, 'true') !== 'false',

  /** mode awal: live | replay */
  initialMode: str(process.env.INITIAL_MODE, 'live') === 'replay' ? ('replay' as const) : ('live' as const),

  spot: {
    // data-stream.binance.vision = endpoint data pasar publik Binance (tanpa API key)
    ws: str(process.env.BINANCE_SPOT_WS, 'wss://data-stream.binance.vision/ws'),
    rest: str(process.env.BINANCE_SPOT_REST, 'https://data-api.binance.vision'),
  },
  future: {
    // /market/ws = jalur data pasar futures (yang dipakai aplikasi mining)
    ws: str(process.env.BINANCE_FUTURES_WS, 'wss://fstream.binance.com/market/ws'),
    rest: str(process.env.BINANCE_FUTURES_REST, 'https://fapi.binance.com'),
  },
} as const

export type AppConfig = typeof config
