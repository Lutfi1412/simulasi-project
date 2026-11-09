/**
 * Uji paritas MODEL: jalankan inferensi TypeScript pada 3 lipatan validasi replay
 * dan bandingkan probabilitas + sinyal dengan golden_proba.json (hasil Python).
 *
 * Jalankan: bun run verify:models
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { signalFromProba } from '../apps/server/src/models/infer'
import { makePredictor } from './lib/predict'

const ROOT = join(import.meta.dir, '..')
const { bundle, names, entryOf, probAt } = makePredictor(ROOT)
const golden = JSON.parse(readFileSync(join(ROOT, 'apps/server/data/replay/golden_proba.json'), 'utf8')) as {
  class_order: string[]
  folds: { name: string; rows: number[] }[]
  proba: Record<string, (number | null)[][][]>
}

const margin = bundle.manifest.margin
console.log(`model: ${names.join(', ')}`)
console.log(
  `fitur: ${bundle.manifest.features.length} | margin: ${margin} | lipatan: ${golden.folds
    .map((f) => `${f.name}=${f.rows.length}`)
    .join(' ')}\n`,
)

let failures = 0

for (const name of names) {
  const e = entryOf(name)
  const ref = golden.proba[name]
  let maxDiff = 0
  let signalDiff = 0
  let total = 0

  for (let k = 0; k < golden.folds.length; k++) {
    const rows = golden.folds[k].rows
    for (let pos = 0; pos < rows.length; pos++) {
      const expected: (number | null)[] | undefined = ref[k]?.[pos]
      if (!expected) continue
      total++
      const p = probAt(name, rows[pos])
      for (let c = 0; c < 3; c++) {
        const d = Math.abs((expected[c] ?? 0) - (p[c] ?? 0))
        if (d > maxDiff) maxDiff = d
      }
      const mine = signalFromProba(p, e.theta, margin, e.hard)
      const theirs = signalFromProba(
        expected.map((v) => v ?? 0),
        e.theta,
        margin,
        e.hard,
      )
      if (mine !== theirs) signalDiff++
    }
  }

  const ok = maxDiff < 1e-4 && signalDiff <= Math.max(1, Math.floor(total / 1000))
  if (!ok) failures++
  console.log(
    `${ok ? 'OK  ' : 'CEK '} ${name.padEnd(18)} ${e.kind.padEnd(8)} maxΔ ${maxDiff.toExponential(2)}  sinyal beda ${signalDiff}/${total}`,
  )
}

console.log('')
if (!failures) console.log('PARITAS MODEL: 6 model menghasilkan probabilitas & sinyal yang sama dengan Python.')
else console.log('PARITAS MODEL: ada model yang perlu diperiksa — jangan dipakai dulu.')
process.exitCode = failures ? 1 : 0
