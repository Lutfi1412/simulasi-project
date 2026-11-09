import { join } from 'node:path'
import { loadModelBundle } from '../../apps/server/src/models/runtime'
import { predictGru, predictLogReg, predictMeta, predictXgb } from '../../apps/server/src/models/infer'
import type {
  EnsembleModelFile,
  GruModelFile,
  LogRegModelFile,
  MetaModelFile,
  RuleModelFile,
  XgbModelFile,
} from '../../apps/server/src/models/types'
import { loadReplay } from './load'

export interface ReplayData {
  columns: string[]
  rows: (number | null)[][]
}

export function replayPath(root: string): string {
  return join(root, 'apps/server/data/replay/replay.json')
}

/** Prediktor per baris replay (dengan cache), dipakai bersama oleh uji model & uji simulator. */
export function makePredictor(root: string) {
  const bundle = loadModelBundle(join(root, 'apps/server/models/current'))
  const replay = loadReplay(replayPath(root))
  const col = new Map(replay.columns.map((c, i) => [c, i]))
  const featureNames = bundle.manifest.features
  const rows = replay.rows

  const featRows: Record<string, number>[] = rows.map((r) => {
    const o: Record<string, number> = {}
    for (const f of featureNames) {
      const v = r[col.get(f)!]
      o[f] = typeof v === 'number' ? v : Number.NaN
    }
    return o
  })
  const rawRows: Record<string, number>[] = rows.map((r) => {
    const o: Record<string, number> = {}
    for (const c of replay.columns) {
      if (c.startsWith('run_b') || c.startsWith('run_s')) {
        const v = r[col.get(c)!]
        o[c] = typeof v === 'number' ? v : 0
      }
    }
    return o
  })

  const modelOf = (n: string) => bundle.models.get(n)!.file
  const entryOf = (n: string) => bundle.manifest.models.find((m) => m.name === n)!
  const names = bundle.manifest.models.map((m) => m.name)

  // sinyal aturan sepanjang seri (edge 0->1)
  const ruleName = names.find((n) => modelOf(n).kind === 'rule')!
  const ruleFile = modelOf(ruleName) as RuleModelFile
  const ruleSignal = new Int8Array(rows.length)
  {
    let prevB = false
    let prevS = false
    for (let i = 0; i < rows.length; i++) {
      const r = rawRows[i]
      let cb = (r[`run_b${ruleFile.T}_f`] ?? 0) >= ruleFile.N
      let cs = (r[`run_s${ruleFile.T}_f`] ?? 0) >= ruleFile.N
      if (ruleFile.mode === 'both' && ruleFile.has_spot) {
        cb = cb && (r[`run_b${ruleFile.T}_s`] ?? 0) >= ruleFile.N
        cs = cs && (r[`run_s${ruleFile.T}_s`] ?? 0) >= ruleFile.N
      }
      if (cb && !prevB) ruleSignal[i] = 1
      if (cs && !prevS) ruleSignal[i] = -1
      prevB = cb
      prevS = cs
    }
  }

  const cache = new Map<string, Map<number, number[]>>()
  for (const name of names) cache.set(name, new Map())

  function probAt(name: string, idx: number): number[] {
    const memo = cache.get(name)!
    const hit = memo.get(idx)
    if (hit) return hit
    const file = modelOf(name)
    let p: number[]
    if (file.kind === 'rule') {
      const s = ruleSignal[idx]
      p = s === 1 ? [0, 1, 0] : s === -1 ? [0, 0, 1] : [1, 0, 0]
    } else if (file.kind === 'logreg') {
      const m = file as LogRegModelFile
      p = predictLogReg(m, m.features.map((k) => featRows[idx][k] ?? Number.NaN))
    } else if (file.kind === 'xgb') {
      const m = file as XgbModelFile
      p = predictXgb(m, [m.features.map((k) => featRows[idx][k] ?? Number.NaN)], m.features)[0]
    } else if (file.kind === 'meta') {
      const m = file as MetaModelFile
      const r = rawRows[idx]
      let dir = 0
      if ((r[`run_b${m.T}_f`] ?? 0) >= m.N) dir = 1
      if ((r[`run_s${m.T}_f`] ?? 0) >= m.N) dir = -1
      p = predictMeta(m, m.features.map((k) => featRows[idx][k] ?? Number.NaN), dir)
    } else if (file.kind === 'gru') {
      const m = file as GruModelFile
      const seq = featRows
        .slice(Math.max(0, idx - m.seq_len + 1), idx + 1)
        .map((fr) => m.features.map((k) => fr[k] ?? Number.NaN))
      p = predictGru(m, seq)
    } else {
      const m = file as EnsembleModelFile
      const acc = [0, 0, 0]
      let k = 0
      for (const member of m.members) {
        const q = probAt(member, idx)
        for (let c = 0; c < 3; c++) acc[c] += q[c]
        k++
      }
      p = k ? acc.map((v) => v / k) : [1, 0, 0]
    }
    memo.set(idx, p)
    return p
  }

  const price = (c: string, i: number): number => {
    const v = rows[i][col.get(c)!]
    return typeof v === 'number' ? v : Number.NaN
  }

  return { bundle, replay, names, entryOf, probAt, price, featRows, rawRows }
}
