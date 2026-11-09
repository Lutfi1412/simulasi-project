/**
 * Fungsi angka kecil yang meniru semantik pandas yang dipakai notebook:
 * - NaN = nilai hilang
 * - rolling(w, min_periods=w): bila ada satu NaN di jendela -> hasil NaN
 * - .std() memakai ddof = 1 (varians sampel)
 */

export const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

export const nan = Number.NaN

/** a[i-k] atau NaN bila di luar batas */
export function lag(a: readonly number[], i: number, k: number): number {
  const j = i - k
  return j >= 0 && j < a.length ? a[j] : nan
}

/** Seluruh jendela [i-w+1 .. i] harus berisi angka; kalau tidak -> NaN */
function windowOk(a: readonly number[], i: number, w: number): boolean {
  if (i - w + 1 < 0) return false
  for (let j = i - w + 1; j <= i; j++) if (!Number.isFinite(a[j])) return false
  return true
}

export function rollSum(a: readonly number[], i: number, w: number): number {
  if (!windowOk(a, i, w)) return nan
  let s = 0
  for (let j = i - w + 1; j <= i; j++) s += a[j]
  return s
}

export function rollMean(a: readonly number[], i: number, w: number): number {
  const s = rollSum(a, i, w)
  return Number.isFinite(s) ? s / w : nan
}

/** std sampel (ddof=1), sama seperti pandas .std() */
export function rollStd(a: readonly number[], i: number, w: number): number {
  if (!windowOk(a, i, w) || w < 2) return nan
  const m = rollMean(a, i, w)
  let acc = 0
  for (let j = i - w + 1; j <= i; j++) {
    const d = a[j] - m
    acc += d * d
  }
  return Math.sqrt(acc / (w - 1))
}

export function rollMax(a: readonly number[], i: number, w: number): number {
  if (!windowOk(a, i, w)) return nan
  let m = -Infinity
  for (let j = i - w + 1; j <= i; j++) if (a[j] > m) m = a[j]
  return m
}

export function rollMin(a: readonly number[], i: number, w: number): number {
  if (!windowOk(a, i, w)) return nan
  let m = Infinity
  for (let j = i - w + 1; j <= i; j++) if (a[j] < m) m = a[j]
  return m
}

export function clip(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** log(a/b), NaN bila salah satu tidak valid atau <= 0 */
export function logRatio(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return nan
  return Math.log(a / b)
}

/** log(1+x) dengan x negatif/hilang tetap NaN */
export function log1pSafe(v: number): number {
  if (!Number.isFinite(v)) return nan
  return Math.log1p(Math.max(v, 0))
}

export function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return nan
  return a / b
}

export function softmax(z: readonly number[]): number[] {
  let max = -Infinity
  for (const v of z) if (v > max) max = v
  const e = z.map((v) => Math.exp(v - max))
  let s = 0
  for (const v of e) s += v
  return e.map((v) => v / s)
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}
