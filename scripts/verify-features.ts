/**
 * Uji paritas FITUR: hitung 40 fitur dari CSV menit asli (data mining), lalu bandingkan
 * dengan nilai yang diekspor Python di data/replay.json. Ini membuktikan hitungan fitur
 * di server sama dengan bahan yang dipakai model saat dilatih.
 *
 * Jalankan: bun run verify:features
 */
import { join } from 'node:path'
import { buildGrid, computeFeatureSeries, RUN_THRESHOLDS } from '../apps/server/src/core/featureBuilder'
import { loadMinuteCsv, loadReplay, loadSignalsCsv } from './lib/load'

const ROOT = join(import.meta.dir, '..')
const FIX = join(ROOT, 'fixtures')
const MODEL = join(ROOT, 'apps/server/models/current')
const DATA = join(ROOT, 'apps/server/data/replay')

const manifest = JSON.parse(await Bun.file(join(MODEL, 'manifest.json')).text()) as {
  features: string[]
}

const fRows = loadMinuteCsv(join(FIX, 'menit/future_SOLUSDT_1m.csv'))
const sRows = loadMinuteCsv(join(FIX, 'menit/trade_SOLUSDT_1m.csv'))
const bfRows = loadMinuteCsv(join(FIX, 'menit/future_BTCUSDT_1m.csv'))
const bsRows = loadMinuteCsv(join(FIX, 'menit/trade_BTCUSDT_1m.csv'))
const sigF = loadSignalsCsv(join(FIX, 'signals/future_SOLUSDT.csv'))
const sigS = loadSignalsCsv(join(FIX, 'signals/trade_SOLUSDT.csv'))
const replay = loadReplay(join(DATA, 'replay.json'))

const t0 = Math.min(...fRows.keys())
const t1 = Math.max(...fRows.keys())
const count = Math.floor((t1 - t0) / 60) + 1
console.log(
  `CSV menit: ${fRows.size} futures SOL, ${sRows.size} spot SOL, ${bfRows.size} futures BTC, ${bsRows.size} spot BTC | grid ${count} menit`,
)
console.log(`sinyal: ${sigF.length} futures, ${sigS.length} spot`)
console.log(`replay: ${replay.rows.length} baris x ${replay.columns.length} kolom`)

const grid = buildGrid(fRows, sRows, t1, count, RUN_THRESHOLDS, { future: bfRows, spot: bsRows })
const replayIndex = new Map<number, number>()
for (let i = 0; i < replay.rows.length; i++) replayIndex.set(replay.rows[i][0] as number, i)
const overlap = grid.ts.filter((ts) => replayIndex.has(ts)).length
console.log(`tumpang tindih dengan replay: ${overlap} menit (CSV berhenti di ${new Date(t1 * 1000).toISOString()})`)
if (overlap < 1000) {
  console.error('Data CSV dan replay hampir tidak beririsan; tidak bisa membandingkan.')
  process.exit(1)
}

const t = performance.now()
const X = computeFeatureSeries(grid, { signalsFuture: sigF, signalsSpot: sigS })
console.log(`fitur dihitung dalam ${((performance.now() - t) / 1000).toFixed(2)} detik (${Object.keys(X).length} kolom)\n`)

const colIdx = new Map(replay.columns.map((c, i) => [c, i]))
let failures = 0

// ---- bandingkan 'bad' ----
{
  const iBad = colIdx.get('bad')!
  let diff = 0
  for (let i = 0; i < grid.length; i++) {
    const ri = replayIndex.get(grid.ts[i])
    if (ri === undefined) continue
    const ref = replay.rows[ri][iBad]
    const refBad = ref === null ? 1 : ref
    if ((refBad === 1) !== grid.bad[i]) diff++
  }
  const flag = diff === 0 ? 'OK' : `BEDA ${diff} baris`
  console.log(`bad             ${flag}`)
  if (diff) failures++
}

// ---- 40 fitur ----
const report: { name: string; maxDiff: number; mismatch: number; missing: number; extra: number }[] = []
for (const name of manifest.features) {
  const idx = colIdx.get(name)
  if (idx === undefined) {
    console.log(`!! kolom ${name} tidak ada di replay.json`)
    failures++
    continue
  }
  const mine = X[name]
  if (!mine) {
    console.log(`!! fitur ${name} tidak dihitung`)
    failures++
    continue
  }
  let maxDiff = 0
  let mismatch = 0
  let missing = 0
  let extra = 0
  for (let i = 0; i < grid.length; i++) {
    const ri = replayIndex.get(grid.ts[i])
    if (ri === undefined) continue
    const ref = replay.rows[ri][idx]
    const v = mine[i]
    const refNum = typeof ref === 'number' ? ref : null
    const mineNum = Number.isFinite(v) ? v : null
    if (refNum === null && mineNum === null) continue
    if (refNum !== null && mineNum === null) {
      missing++
      continue
    }
    if (refNum === null && mineNum !== null) {
      extra++
      continue
    }
    const d = Math.abs(refNum! - mineNum!)
    const tol = 1e-6 * Math.max(1, Math.abs(refNum!))
    if (d > maxDiff) maxDiff = d
    if (d > tol) mismatch++
  }
  report.push({ name, maxDiff, mismatch, missing, extra })
  const bad = mismatch || missing || extra
  const line = `${name.padEnd(18)} maxΔ ${maxDiff.toExponential(2)}  beda ${String(mismatch).padStart(5)}  kosong ${String(missing).padStart(4)}  lebih ${String(extra).padStart(4)}`
  console.log(`${bad ? 'CEK ' : 'OK  '} ${line}`)
  if (bad) failures++
}

console.log('')
if (failures === 0) {
  console.log('PARITAS FITUR: SEMUA COCOK — fitur server identik dengan bahan training model.')
} else {
  console.log(`PARITAS FITUR: ${failures} kolom perlu diperiksa.`)
  process.exit(1)
}
