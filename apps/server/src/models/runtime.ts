import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Manifest } from '../core/types'
import type {
  AnyModelFile,
  EnsembleModelFile,
  GruModelFile,
  LoadedModel,
  LogRegModelFile,
  MetaModelFile,
  ModelBundle,
  ModelOutput,
  RuleModelFile,
  XgbModelFile,
} from './types'
import { predictEnsemble, predictGru, predictLogReg, predictMeta, predictRule, predictXgb, signalFromProba } from './infer'

export function readJson<T>(path: string): T {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as T
}

/**
 * Muat satu bundel model (folder berisi manifest.json + models/*.json).
 * Validasi bentuk dilakukan di sini supaya kesalahan finetuning ketahuan saat load,
 * bukan saat pasar sedang berjalan.
 */
export function loadModelBundle(dir: string): ModelBundle {
  const root = resolve(dir)
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`manifest.json tidak ditemukan di ${root}`)
  const manifest = readJson<Manifest>(manifestPath)
  if (!Array.isArray(manifest.features) || manifest.features.length === 0) {
    throw new Error('manifest.features kosong')
  }
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    throw new Error('manifest.models kosong')
  }

  const models = new Map<string, LoadedModel>()
  for (const entry of manifest.models) {
    const path = join(root, entry.file)
    if (!existsSync(path)) throw new Error(`file model hilang: ${entry.file} (${entry.name})`)
    const file = readJson<AnyModelFile>(path)
    if (file.kind !== entry.kind) {
      throw new Error(`${entry.name}: kind di manifest "${entry.kind}" != kind file "${file.kind}"`)
    }
    validate(entry.name, file, manifest)
    models.set(entry.name, { entry, file })
  }
  for (const [name, m] of models) {
    if (m.file.kind === 'ensemble') {
      for (const member of (m.file as EnsembleModelFile).members) {
        if (!models.has(member)) throw new Error(`ensemble ${name}: anggota "${member}" tidak ada`)
      }
    }
  }
  if (!manifest.trading) throw new Error('manifest.trading tidak ada')
  return { manifest, models, dir: root, loadedAt: Date.now() }
}

function validate(name: string, file: AnyModelFile, manifest: Manifest): void {
  const hasFeatures = (f: string[]) => {
    for (const k of f) {
      if (!manifest.features.includes(k)) throw new Error(`${name}: fitur "${k}" tidak ada di manifest.features`)
    }
  }
  switch (file.kind) {
    case 'rule': {
      const f = file as RuleModelFile
      if (!Number.isFinite(f.T) || !Number.isFinite(f.N)) throw new Error(`${name}: T/N tidak valid`)
      break
    }
    case 'logreg': {
      const f = file as LogRegModelFile
      hasFeatures(f.features)
      const d = f.features.length
      if (f.coef.length !== f.classes.length || f.coef.some((r) => r.length !== d)) {
        throw new Error(`${name}: dimensi coef tidak cocok dengan features`)
      }
      if (f.mean.length !== d || f.std.length !== d) throw new Error(`${name}: mean/std tidak cocok`)
      break
    }
    case 'xgb': {
      const f = file as XgbModelFile
      hasFeatures(f.features)
      if (!f.trees?.length) throw new Error(`${name}: trees kosong`)
      if (!f.offset || f.offset.length !== Math.max(f.n_class, 1)) throw new Error(`${name}: offset tidak cocok`)
      break
    }
    case 'meta': {
      const f = file as MetaModelFile
      hasFeatures(f.features)
      if (!f.xgb?.trees?.length) throw new Error(`${name}: xgb.trees kosong`)
      if (f.xgb.n_class !== 1) throw new Error(`${name}: xgb meta harus n_class=1`)
      break
    }
    case 'gru': {
      const f = file as GruModelFile
      hasFeatures(f.features)
      const d = f.features.length
      if (!f.layers?.length) throw new Error(`${name}: layers kosong`)
      for (let i = 0; i < f.layers.length; i++) {
        const l = f.layers[i]
        const inDim = i === 0 ? d : f.hidden
        if (l.w_ih.length !== 3 * f.hidden || l.w_hh.length !== 3 * f.hidden) throw new Error(`${name}: dimensi GRU salah`)
        if (l.w_ih[0].length !== inDim || l.w_hh[0].length !== f.hidden) throw new Error(`${name}: bobot GRU tidak cocok`)
      }
      if (f.mean.length !== d || f.std.length !== d) throw new Error(`${name}: mean/std GRU tidak cocok`)
      if (f.head.fc_w.length !== 3) throw new Error(`${name}: kepala GRU harus 3 kelas`)
      break
    }
    case 'ensemble': {
      const f = file as EnsembleModelFile
      if (!f.members?.length) throw new Error(`${name}: members kosong`)
      break
    }
    default:
      throw new Error(`${name}: kind tidak dikenal`)
  }
}

/**
 * Runtime inferensi: satu baris fitur + urutan 60 baris terakhir -> probabilitas & sinyal
 * untuk setiap model sesuai ambang (theta) masing-masing.
 */
export class ModelRuntime {
  private prevRule = new Map<string, { long: boolean; short: boolean }>()
  private lastOutputs: ModelOutput[] = []

  constructor(public bundle: ModelBundle) {}

  get outputs(): ModelOutput[] {
    return this.lastOutputs
  }

  setBundle(bundle: ModelBundle): void {
    this.bundle = bundle
    this.prevRule.clear()
    this.lastOutputs = []
  }

  private parseState(bundle: ModelBundle): void {
    this.prevRule.clear()
    this.lastOutputs = []
    this.bundle = bundle
  }


  /**
   * @param features nilai 40 fitur (nama -> angka, NaN = hilang)
   * @param rawRuns nilai mentah run_b.. dan run_s.. (bukan log) untuk model aturan & meta
   * @param seq baris fitur seq_len terakhir (termasuk baris ini), untuk GRU
   */
  predict(
    features: Record<string, number>,
    rawRuns: Record<string, number>,
    seq: Record<string, number>[] | null,
  ): ModelOutput[] {
    const out: ModelOutput[] = []
    const probas = new Map<string, number[]>()

    const ordered = [...this.bundle.models.values()].sort((a, b) => {
      const rank = (k: string) => (k === 'ensemble' ? 9 : 0)
      return rank(a.file.kind) - rank(b.file.kind)
    })

    for (const { entry, file } of ordered) {
      const theta = entry.theta
      const hard = entry.hard
      let p: number[] = [1, 0, 0]
      let available = true

      if (file.kind === 'rule') {
        const key = entry.name
        const prev = this.prevRule.get(key) ?? null
        p = predictRule(file as RuleModelFile, rawRuns, prev)
        this.prevRule.set(key, {
          long: p[1] > 0.5,
          short: p[2] > 0.5,
        })
      } else if (file.kind === 'logreg') {
        const m = file as LogRegModelFile
        const x = m.features.map((k) => features[k] ?? Number.NaN)
        available = x.every((v) => Number.isFinite(v))
        p = available ? predictLogReg(m, x) : [1, 0, 0]
      } else if (file.kind === 'xgb') {
        const m = file as XgbModelFile
        const x = m.features.map((k) => features[k] ?? Number.NaN)
        available = x.every((v) => Number.isFinite(v))
        p = available ? predictXgb(m, [x], m.features)[0] : [1, 0, 0]
      } else if (file.kind === 'meta') {
        const m = file as MetaModelFile
        const val = (k: string) => {
          const v = rawRuns[k]
          return Number.isFinite(v) ? v : 0
        }
        let dir = 0
        if (val(`run_b${m.T}_f`) >= m.N) dir = 1
        if (val(`run_s${m.T}_f`) >= m.N) dir = -1 // SHORT menimpa LONG
        const x = m.features.map((k) => features[k] ?? Number.NaN)
        available = x.every((v) => Number.isFinite(v))
        p = available ? predictMeta(m, x, dir) : [1, 0, 0]
      } else if (file.kind === 'gru') {
        const m = file as GruModelFile
        if (!seq || seq.length < m.seq_len) {
          available = false
          p = [1, 0, 0]
        } else {
          const rows = seq.slice(-m.seq_len).map((r) => m.features.map((k) => r[k] ?? Number.NaN))
          available = rows.every((r) => r.every((v) => Number.isFinite(v)))
          p = available ? predictGru(m, rows) : [1, 0, 0]
        }
      } else if (file.kind === 'ensemble') {
        p = predictEnsemble(file as EnsembleModelFile, probas)
        available = true
      }

      probas.set(entry.name, p)
      const signal = signalFromProba(p, theta, this.bundle.manifest.margin, hard)
      out.push({
        name: entry.name,
        kind: entry.kind,
        theta,
        hard,
        p: [p[0], p[1], p[2]],
        signal: signal as -1 | 0 | 1,
        available,
      })
    }

    this.lastOutputs = out
    return out
  }
}
