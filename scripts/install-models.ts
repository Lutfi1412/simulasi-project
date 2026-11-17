/**
 * Memasang bundel model hasil export notebook (web_export) ke models/current.
 *
 *   bun run models:install "C:/path/ke/web_export"
 *   bun run models:install ../web_export --force
 *
 * Langkah:
 *   1. validasi manifest.json (fitur harus sama dengan pipeline di repo ini)
 *   2. cadangkan models/current -> models/backup-YYYYMMDD-HHMMSS
 *   3. salin bundel baru
 *   4. ingatkan untuk POST /api/reload (atau restart)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2).filter((a) => a !== '--')
const source = args.find((a) => !a.startsWith('--'))
const force = args.includes('--force')

if (!source) {
  console.error('pakai: bun run models:install <folder-export> [--force]')
  process.exit(1)
}

const root = resolve(import.meta.dir, '..')
const modelsDir = join(root, 'apps/server/models')
const currentDir = join(modelsDir, 'current')
const srcDir = resolve(source)

function fail(msg: string): never {
  console.error(`gagal: ${msg}`)
  process.exit(1)
}

if (!existsSync(srcDir)) fail(`folder tidak ditemukan: ${srcDir}`)
if (!existsSync(join(srcDir, 'manifest.json'))) fail('manifest.json tidak ada di folder itu')

type Manifest = {
  version?: number
  created_utc?: string
  symbol?: string
  features?: string[]
  models?: { name: string; kind: string; theta?: number }[]
  trading?: Record<string, number>
}

const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const next = readManifest(srcDir)
const prev = existsSync(join(currentDir, 'manifest.json')) ? readManifest(currentDir) : null

if (!next.models?.length) fail('manifest.model belum berisi model apa pun')
if (!next.features?.length) fail('manifest.features kosong')
if (!existsSync(join(srcDir, 'models'))) fail('folder models/ tidak ada di bundel')

// Fitur harus identik: feature builder di repo ini menghasilkan daftar tetap
// sesuai notebook. Model yang dilatih dengan fitur berbeda tidak boleh dipakai.
if (prev?.features?.length) {
  const missing = prev.features.filter((f) => !next.features!.includes(f))
  const extra = next.features.filter((f) => !prev.features!.includes(f))
  if (missing.length || extra.length) {
    console.error('daftar fitur berbeda dari bundel yang sedang aktif:')
    if (missing.length) console.error('  hilang :', missing.join(', '))
    if (extra.length) console.error('  tambahan:', extra.join(', '))
    if (!force) fail('pakai --force hanya kalau pipeline fitur di repo ini ikut diubah')
  }
}

if (prev && prev.symbol && next.symbol && prev.symbol !== next.symbol) {
  fail(`simbol berbeda: aktif ${prev.symbol}, bundel baru ${next.symbol} (atur SYMBOL di .env)` )
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
if (existsSync(currentDir)) {
  const backup = join(modelsDir, `backup-${stamp}`)
  cpSync(currentDir, backup, { recursive: true })
  console.log(`cadangan  : ${backup}`)
}

mkdirSync(currentDir, { recursive: true })
for (const entry of readdirSync(srcDir)) {
  const from = join(srcDir, entry)
  const to = join(currentDir, entry)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}

// Angka trading (TP/SL/margin/leverage/cooldown) sengaja dipertahankan dari bundel
// sebelumnya. Ekspor notebook membawa TP_PCT/SL_PCT versi backtest yang jauh lebih
// sempit; memakainya akan mengubah perilaku simulasi tanpa diminta.
if (prev?.trading && !args.includes('--reset-trading')) {
  const installed = readManifest(currentDir)
  installed.trading = { ...installed.trading, ...prev.trading }
  writeFileSync(join(currentDir, 'manifest.json'), JSON.stringify(installed))
  console.log('trading  : dipertahankan dari bundel sebelumnya (pakai --reset-trading untuk memakai angka ekspor)')
}

// Data replay/golden ikut dipasang ke apps/server/data/replay supaya verify:* dan
// mode replay memakai bahan yang sama dengan model baru (bukan sisa bundel lama).
const replaySrc = join(srcDir, 'data')
const replayDst = join(root, 'apps/server/data/replay')
const replayFiles = ['replay.json', 'golden_proba.json', 'golden_results.json']
if (replayFiles.some((f) => existsSync(join(replaySrc, f)))) {
  mkdirSync(replayDst, { recursive: true })
  let copied = 0
  for (const f of replayFiles) {
    if (!existsSync(join(replaySrc, f))) continue
    cpSync(join(replaySrc, f), join(replayDst, f))
    copied++
  }
  console.log(`replay   : ${copied} berkas data validasi disalin ke apps/server/data/replay`)
}

console.log(`dipasang : ${basename(srcDir)} -> apps/server/models/current`)
console.log(`versi    : ${next.version ?? '?'} (${next.created_utc ?? 'tanpa tanggal'})`)
console.log(`simbol   : ${next.symbol ?? '?'} · ${next.models.length} model · ${next.features.length} fitur`)
console.log('\nselanjutnya:')
console.log('  POST /api/models/reload   (server yang sedang jalan akan memuat model baru tanpa restart)')
console.log('  atau restart proses; simulasi bot tidak direset.')
