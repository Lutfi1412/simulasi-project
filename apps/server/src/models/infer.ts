import { isNum, sigmoid, softmax } from '../core/num'
import type {
  EnsembleModelFile,
  GruModelFile,
  LogRegModelFile,
  MetaModelFile,
  RuleModelFile,
  XgbModelFile,
} from './types'

/**
 * Inferensi murni TypeScript untuk 6 model hasil ekspor.
 * Rumus mengikuti FORMAT.md di folder model (ditulis ulang dari notebook).
 * Semua fungsi menerima nilai fitur yang mungkin NaN (= null di JSON).
 */

export function predictLogReg(m: LogRegModelFile, x: number[]): number[] {
  const k = m.classes.length
  const logits = new Array<number>(k).fill(0)
  for (let c = 0; c < k; c++) {
    let z = m.intercept[c]
    for (let j = 0; j < m.features.length; j++) {
      const v = x[j]
      if (!isNum(v)) continue // NaN * koefisien = NaN -> sklearn menganggap baris tidak valid; di sini dianggap 0
      const mean = m.mean[j]
      const std = m.std[j]
      const sd = Number.isFinite(std) && std !== 0 ? std : 1
      const zc = Math.min(m.clip, Math.max(-m.clip, (v - mean) / sd))
      z += m.coef[c][j] * zc
    }
    logits[c] = z
  }
  const p = softmax(logits)
  const out = new Array<number>(3).fill(0)
  for (let c = 0; c < k; c++) out[m.classes[c]] = p[c]
  return out
}

/** Margin pohon XGBoost (jumlah nilai daun per kelas). */
export function treeMargin(m: XgbModelFile, X: number[][], features: string[]): number[][] {
  const nClass = Math.max(m.n_class, 1)
  const out: number[][] = X.map(() => new Array<number>(nClass).fill(0))
  for (const tree of m.trees) {
    const cls = nClass > 1 ? tree.cls : 0
    const f = tree.f
    const v = tree.v
    const l = tree.l
    const r = tree.r
    const mi = tree.m
    for (let row = 0; row < X.length; row++) {
      const xr = X[row]
      let node = 0
      for (let guard = 0; guard < 128; guard++) {
        const fi = f[node]
        if (fi < 0) break
        const x = fi < xr.length ? xr[fi] : Number.NaN
        node = !Number.isFinite(x)
          ? mi[node]
          : Math.fround(x) < Math.fround(v[node])
            ? l[node]
            : r[node]
      }
      out[row][cls] += v[node]
    }
  }
  return out
}

export function predictXgb(m: XgbModelFile, X: number[][], features: string[]): number[][] {
  const marg = treeMargin(m, X, features)
  return marg.map((row, i) => {
    const z = row.map((v, c) => v + (m.offset[c] ?? 0))
    return softmax(z)
  })
}

export function predictMeta(m: MetaModelFile, x: number[], direction: number): number[] {
  if (direction === 0) return [1, 0, 0]
  const marg = treeMargin(m.xgb, [[...x, direction]], m.features)[0]
  const p = sigmoid(marg[0] + (m.xgb.offset[0] ?? 0))
  return direction === 1 ? [1 - p, p, 0] : [1 - p, 0, p]
}

/** GRU: seq = matriks (seq_len x fitur) sudah dalam urutan fitur model. */
export function predictGru(m: GruModelFile, seq: number[][]): number[] {
  const H = m.hidden
  const L = seq.length
  let cur: number[][] = seq.map((row) => {
    const z = new Array<number>(row.length)
    for (let j = 0; j < row.length; j++) {
      const v = row[j]
      const mean = m.mean[j]
      const std = m.std[j]
      const sd = Number.isFinite(std) && std !== 0 ? std : 1
      const raw = isNum(v) ? (v - mean) / sd : 0
      z[j] = Math.min(m.clip, Math.max(-m.clip, raw))
    }
    return z
  })

  for (const layer of m.layers) {
    let h = new Array<number>(H).fill(0)
    const outs: number[][] = []
    for (let t = 0; t < L; t++) {
      const x = cur[t]
      const gi = new Array<number>(3 * H)
      const gh = new Array<number>(3 * H)
      for (let r = 0; r < 3 * H; r++) {
        let a = layer.b_ih[r]
        let b = layer.b_hh[r]
        const wi = layer.w_ih[r]
        const wh = layer.w_hh[r]
        for (let j = 0; j < x.length; j++) a += wi[j] * x[j]
        for (let j = 0; j < H; j++) b += wh[j] * h[j]
        gi[r] = a
        gh[r] = b
      }
      const next = new Array<number>(H)
      for (let j = 0; j < H; j++) {
        const rr = sigmoid(gi[j] + gh[j])
        const zz = sigmoid(gi[H + j] + gh[H + j])
        const nn = Math.tanh(gi[2 * H + j] + rr * gh[2 * H + j])
        next[j] = (1 - zz) * nn + zz * h[j]
      }
      h = next
      outs.push([...h])
    }
    cur = outs
  }

  const last = cur[cur.length - 1]
  let mean = 0
  for (const v of last) mean += v
  mean /= last.length
  let variance = 0
  for (const v of last) variance += (v - mean) * (v - mean)
  variance /= last.length
  const eps = m.head.ln_eps
  const y = last.map((v, j) => {
    const norm = (v - mean) / Math.sqrt(variance + eps)
    return norm * m.head.ln_w[j] + m.head.ln_b[j]
  })
  const logits = m.head.fc_w.map((row) => {
    let z = 0
    for (let j = 0; j < y.length; j++) z += row[j] * y[j]
    return z
  })
  for (let c = 0; c < logits.length; c++) logits[c] += m.head.fc_b[c]
  return softmax(logits)
}

/** Sinyal dari probabilitas (aturan di manifest). SHORT menang bila keduanya terpenuhi. */
export function signalFromProba(p: number[], theta: number, margin: number, hard: boolean): -1 | 0 | 1 {
  const pl = p[1]
  const ps = p[2]
  let s: -1 | 0 | 1 = 0
  if (hard) {
    if (pl >= 0.5) s = 1
    if (ps >= 0.5) s = -1
  } else {
    if (pl >= theta && pl - ps >= margin) s = 1
    if (ps >= theta && ps - pl >= margin) s = -1
  }
  return s
}

/** Aturan dominasi: tepi naik (0->1) dari run_bT_f >= N (mode both: juga spot). */
export function ruleState(m: RuleModelFile, rawRuns: Record<string, number>): { long: boolean; short: boolean } {
  const val = (k: string) => {
    const v = rawRuns[k]
    return Number.isFinite(v) ? v : 0
  }
  let cb = val(`run_b${m.T}_f`) >= m.N
  let cs = val(`run_s${m.T}_f`) >= m.N
  if (m.mode === 'both' && m.has_spot) {
    cb = cb && val(`run_b${m.T}_s`) >= m.N
    cs = cs && val(`run_s${m.T}_s`) >= m.N
  }
  return { long: cb, short: cs }
}

export function predictRule(m: RuleModelFile, rawRuns: Record<string, number>, prev: { long: boolean; short: boolean } | null): number[] {
  const cur = ruleState(m, rawRuns)
  const before = prev ?? { long: false, short: false }
  const longEdge = cur.long && !before.long
  const shortEdge = cur.short && !before.short
  let p = [1, 0, 0]
  if (longEdge) p = [0, 1, 0]
  if (shortEdge) p = [0, 0, 1] // SHORT menimpa LONG
  return p
}

export function predictEnsemble(m: EnsembleModelFile, outputs: Map<string, number[]>): number[] {
  const acc = [0, 0, 0]
  let n = 0
  for (const name of m.members) {
    const p = outputs.get(name)
    if (!p) continue
    for (let i = 0; i < 3; i++) acc[i] += p[i]
    n++
  }
  return n ? acc.map((v) => v / n) : [1, 0, 0]
}
