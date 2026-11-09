/**
 * Menjalankan tiga verifikasi paritas berurutan:
 *   1. fitur  — TypeScript vs export Python (replay.json)
 *   2. model  — probabilitas & sinyal vs golden_proba.json
 *   3. sim    — ekuitas/ROI/trade vs golden_results.json
 * Keluar dengan kode 1 kalau ada yang gagal, supaya bisa dipakai di CI.
 */
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')

const steps = [
  ['fitur', ['bun', 'run', 'scripts/verify-features.ts']],
  ['model', ['bun', 'run', 'scripts/verify-models.ts']],
  ['simulator', ['bun', 'run', 'scripts/verify-sim.ts']],
] as const

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

if (failed.length) {
  console.error(`\nGAGAL: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nSemua verifikasi lulus.')
