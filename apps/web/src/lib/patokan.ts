export type PatokanDirection = 'above' | 'below'
export type PatokanStatus = 'waiting' | 'reached'

/**
 * Patokan harga SOL. Arahnya yang menentukan kapan aktif:
 *  - below ("di bawah"): aktif saat harga <= patokan
 *  - above ("di atas"):  aktif saat harga >= patokan
 * Tidak perlu mengisi harga saat ini; status dihitung dari harga pasar yang masuk.
 */
export interface Patokan {
  value: number
  direction: PatokanDirection
  status: PatokanStatus
}

const KEY = 'sim-patokan'

export function loadPatokan(): Patokan | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<Patokan>
    if (typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value <= 0) return null
    if (p.direction !== 'above' && p.direction !== 'below') return null
    return {
      value: p.value,
      direction: p.direction,
      status: p.status === 'reached' ? 'reached' : 'waiting',
    }
  } catch {
    return null
  }
}

export function savePatokan(p: Patokan | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p))
    else localStorage.removeItem(KEY)
  } catch {
    /* localStorage bisa diblokir; patokan tetap berlaku untuk sesi ini */
  }
}

export function isPatokanReached(price: number, p: Patokan): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  return p.direction === 'below' ? price <= p.value : price >= p.value
}

/** teks arah patokan, mis. "≤ 88,00" atau "≥ 90,00" */
export function patokanLabel(p: Patokan, digits = 2): string {
  const n = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(p.value)
  return `${p.direction === 'below' ? '≤' : '≥'} ${n}`
}
