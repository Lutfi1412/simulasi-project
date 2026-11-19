/**
 * Menjalankan verifikasi paritas berurutan:
 *   1. fitur  — TypeScript vs export Python (replay.json)
 *   2. model  — probabilitas & sinyal vs golden_proba.json
 *   3. sim    — ekuitas/ROI/trade vs golden_results.json (opsional)
 *
 * `verify:sim` dilewati secara default karena simulator website memakai TP/SL sebagai
 * ROI (25/60), sedangkan notebook memakai gerak harga (1.0%/2.4%). Perbedaan itu
 * disengaja; jalankan manual atau pakai `bun run verify -- --with-sim` bila ingin tetap
 * membandingkannya. Keluar dengan kode 1 kalau ada langkah yang gagal.
 */
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const withSim = process.argv.includes('--with-sim')

const steps: [string, string[]][] = [
  ['fitur', ['bun', 'run', 'scripts/verify-features.ts']],
  ['model', ['bun', 'run', 'scripts/verify-models.ts']],
  ...(withSim ? ([['simulator', ['bun', 'run', 'scripts/verify-sim.ts']]] as [string, string[]][]) : []),
]

const failed: string[] = []

for (const [label, cmd] of steps) {
  console.log(`\n=== verifikasi ${label} ===`)
  const proc = Bun.spawn([...cmd], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) failed.push(label)
}

if (!withSim) {
  console.log(
    '\n(verify:sim dilewati — TP/SL website 25/60 vs notebook 1.0%/2.4% memang berbeda. ' +
      'Jalankan `bun run verify:sim` atau `bun run verify -- --with-sim` bila perlu.)',
  )
}
if (failed.length) {
  console.error(`\nGAGAL: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nSemua verifikasi lulus.')
