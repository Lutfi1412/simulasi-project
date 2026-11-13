export type PatokanDirection = 'above' | 'below'
export type PatokanStatus = 'waiting' | 'reached'

/**
 * Patokan harga SOL. Arahnya yang menentukan kapan aktif:
 *  - below ("di bawah"): aktif saat harga <= patokan
 *  - above ("di atas"):  aktif saat harga >= patokan
 * Tidak perlu mengisi harga saat ini; status dihitung dari harga pasar yang masuk.
 *
 * Sejak 13 Nov 2026 patokan boleh lebih dari satu. Setiap baris punya status
 * sendiri, jadi beberapa patokan bisa menunggu sekaligus dan berbunyi satu per
 * satu saat harganya tersentuh.
 */
export interface Patokan {
  id: string
  value: number
  direction: PatokanDirection
  status: PatokanStatus
  createdAt: number
}

const KEY = 'sim-patokan-list'
const LEGACY_KEY = 'sim-patokan'
const MAX_ITEMS = 50

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeOne(raw: unknown): Patokan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<Patokan>
  if (typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value <= 0) return null
  if (p.direction !== 'above' && p.direction !== 'below') return null
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId(),
    value: p.value,
    direction: p.direction,
    status: p.status === 'reached' ? 'reached' : 'waiting',
    createdAt: typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
  }
}

/** Muat semua patokan. Format lama (satu objek di `sim-patokan`) ikut dimigrasikan. */
export function loadPatokans(): Patokan[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(normalizeOne)
        .filter((p): p is Patokan => p !== null)
        .slice(0, MAX_ITEMS)
    }

    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!legacy) return []
    const migrated = normalizeOne(JSON.parse(legacy) as unknown)
    if (!migrated) return []
    localStorage.setItem(KEY, JSON.stringify([migrated]))
    localStorage.removeItem(LEGACY_KEY)
    return [migrated]
  } catch {
    return []
  }
}

export function savePatokans(list: Patokan[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
    else localStorage.removeItem(KEY)
  } catch {
    /* localStorage bisa diblokir; patokan tetap berlaku untuk sesi ini */
  }
}

export function createPatokan(value: number, direction: PatokanDirection): Patokan {
  return { id: newId(), value, direction, status: 'waiting', createdAt: Date.now() }
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
