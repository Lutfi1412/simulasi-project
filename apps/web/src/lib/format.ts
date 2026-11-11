export const nf = (digits = 0) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function money(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nf(digits).format(value)
}

/** angka besar jadi ringkas: 1.240.000 -> "1,24 jt" */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${nf(2).format(value / 1e9)} m`
  if (abs >= 1e6) return `${nf(2).format(value / 1e6)} jt`
  if (abs >= 1e4) return `${nf(1).format(value / 1e3)} rb`
  return nf(0).format(value)
}

export function price(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return nf(digits).format(value)
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const s = nf(digits).format(value)
  return `${value > 0 ? '+' : ''}${s}%`
}

export function prob(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(0)}%`
}

export function hhmm(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

export function hhmmss(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function dayMonth(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

/** durasi menit -> "3j 12m" */
export function spanMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h >= 24) return `${Math.floor(h / 24)}h ${h % 24}j`
  return h ? `${h}j ${m}m` : `${m}m`
}

export interface KindStyle {
  label: string
  chip: string
  hex: string
}

export const KIND_STYLE: Record<string, KindStyle> = {
  rule: { label: 'RULE', chip: 'text-amber border-amber/40 bg-amber/10', hex: '#d29922' },
  logreg: { label: 'LOGREG', chip: 'text-blue border-blue/40 bg-blue/10', hex: '#58a6ff' },
  xgb: { label: 'XGB', chip: 'text-violet border-violet/40 bg-violet/10', hex: '#a371f7' },
  meta: { label: 'META', chip: 'text-cyan border-cyan/40 bg-cyan/10', hex: '#39c5cf' },
  gru: { label: 'GRU', chip: 'text-pink border-pink/40 bg-pink/10', hex: '#f778ba' },
  ensemble: { label: 'ENSEMBLE', chip: 'text-long border-long/40 bg-long/10', hex: '#3fb950' },
}

export const kindStyle = (kind: string): KindStyle =>
  KIND_STYLE[kind] ?? { label: kind.toUpperCase(), chip: 'text-mute border-line bg-raise', hex: '#8b949e' }

export const sideLabel = (side: number): string => (side === 1 ? 'LONG' : side === -1 ? 'SHORT' : 'NETRAL')

export const sideClass = (side: number): string =>
  side === 1 ? 'text-long' : side === -1 ? 'text-short' : 'text-mute'

export const pnlClass = (value: number): string => (value > 0 ? 'text-long' : value < 0 ? 'text-short' : 'text-mute')

export const reasonLabel: Record<string, string> = {
  tp: 'TARGET',
  sl: 'STOP',
  liq: 'LIKUIDASI',
  timeout: 'WAKTU',
  end: 'AKHIR DATA',
  neutral: 'NETRAL',
}
