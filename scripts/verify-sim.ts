/**
 * Uji paritas SIMULATOR: jalankan 6 bot di 3 lipatan validasi replay dengan aturan
 * `simulate()` notebook, lalu bandingkan ekuitas/trade dengan golden_results.json.
 *
 * Jalankan: bun run verify:sim
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Bot } from '../apps/server/src/sim/bot'
import { signalFromProba } from '../apps/server/src/models/infer'
import { makePredictor } from './lib/predict'

const ROOT = join(import.meta.dir, '..')
const { bundle, replay, names, entryOf, probAt, price } = makePredictor(ROOT)
const golden = JSON.parse(readFileSync(join(ROOT, 'apps/server/data/replay/golden_results.json'), 'utf8')) as Record<
  string,
  { folds: { fold: string; roi_pct: number; final: number; n_trades: number; trades: any[] }[] }
>
const folds = (
  JSON.parse(readFileSync(join(ROOT, 'apps/server/data/replay/golden_proba.json'), 'utf8')) as {
    folds: { name: string; rows: number[] }[]
  }
).folds

const N = replay.rows.length
const trading = bundle.manifest.trading
const ts = (i: number) => price('ts', i)
const open = (i: number) => price('o', i)
const high = (i: number) => price('h', i)
const low = (i: number) => price('l', i)
const close = (i: number) => price('c', i)

console.log(
  `modal ${trading.CAPITAL.toLocaleString('id-ID')} | leverage ${trading.LEVERAGE}x | TP ${trading.TP_PCT}% SL ${trading.SL_PCT}% | horizon ${trading.HORIZON_MIN}m\n`,
)

let failures = 0

for (const name of names) {
  const e = entryOf(name)
  const g = golden[name]
  let worstEquity = 0
  let worstRoi = 0
  let worstTrades = 0
  let checks = 0
  const detail: string[] = []

  for (const fold of g.folds) {
    const foldRows = folds.find((f) => f.name === fold.fold)!.rows
    const startRow = foldRows[0]
    const endRow = foldRows[foldRows.length - 1]

    // Sinyal hanya ada di baris lipatan; bar harga tetap berjalan menerus.
    const signals = new Int8Array(N)
    for (const i of foldRows) {
      const s = signalFromProba(probAt(name, i), e.theta, bundle.manifest.margin, e.hard)
      if (s !== 0) signals[i] = s
    }

    const bot = new Bot(`fold-${fold.fold}`, name, e.kind, trading, trading.CAPITAL)
    const barEnd = Math.min(N - 1, endRow + trading.HORIZON_MIN)
    for (let i = startRow; i <= barEnd; i++) {
      if (bot.pending) bot.openAt(open(i), ts(i), i)
      bot.onBar({ high: high(i), low: low(i), close: close(i) }, i, ts(i))
      if (i <= endRow && signals[i] !== 0) bot.queueEntry(signals[i] as 1 | -1, i, ts(i), [], close(i))
    }

    const expected = fold.trades
    const actual = bot.trades
    let tradeMismatch = Math.abs(actual.length - expected.length)
    const n = Math.min(actual.length, expected.length)
    for (let k = 0; k < n; k++) {
      if (actual[k].exitTs !== expected[k].exit_ts || actual[k].reason !== expected[k].reason) tradeMismatch++
    }
    const dEquity = Math.abs(bot.equity - fold.final)
    const dRoi = Math.abs(bot.roiPct - fold.roi_pct)
    worstEquity = Math.max(worstEquity, dEquity)
    worstRoi = Math.max(worstRoi, dRoi)
    worstTrades = Math.max(worstTrades, tradeMismatch)
    checks++
    detail.push(`${fold.fold}: ${actual.length}/${expected.length} trade`)
  }

  const ok = worstTrades === 0 && worstEquity < 1e-3 && worstRoi < 1e-6
  if (!ok) failures++
  console.log(
    `${ok ? 'OK  ' : 'CEK '} ${name.padEnd(18)} ${detail.join('  ')}  ekuitas Δ ${worstEquity.toExponential(1)}  roi Δ ${worstRoi.toExponential(1)}  trade beda ${worstTrades}`,
  )
}

console.log('')
if (!failures) console.log('PARITAS SIMULATOR: ekuitas, ROI, dan trade sama dengan golden Python untuk 6 model x 3 lipatan.')
else console.log(`PARITAS SIMULATOR: ${failures} model belum cocok — periksa aturan eksekusi.`)
process.exitCode = failures ? 1 : 0
