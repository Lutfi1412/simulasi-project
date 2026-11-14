import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { price } from '../lib/format'
import {
  createPatokan,
  isPatokanReached,
  loadPatokans,
  patokanLabel,
  savePatokans,
  type Patokan,
  type PatokanDirection,
} from '../lib/patokan'
import { alertPatokan, primeAudio } from '../lib/sound'

interface PatokanControlProps {
  currentPrice: number
}

function parsePrice(text: string): number {
  const raw = text.trim().replace(/\s/g, '')
  if (!raw) return Number.NaN
  // terima "88,5" (koma desimal) maupun "88.5"/"1.234,56"
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : Number.NaN
}

function speechValue(value: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(value)
}

/**
 * Patokan harga SOL di topbar. Bisa lebih dari satu baris; setiap patokan punya
 * arah (di bawah / di atas) dan status sendiri. Sistem membandingkan dengan harga
 * pasar yang masuk dan berbunyi sekali per patokan saat harganya tersentuh.
 */
export function PatokanControl({ currentPrice }: PatokanControlProps) {
  const [items, setItems] = useState<Patokan[]>(() => loadPatokans())
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [direction, setDirection] = useState<PatokanDirection>('below')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const announced = useRef<Set<string>>(new Set())

  const waiting = useMemo(() => items.filter((p) => p.status === 'waiting'), [items])
  const reachedCount = items.length - waiting.length

  useEffect(() => {
    if (!open || editingId) return
    setInput('')
    setDirection('below')
    setError(null)
  }, [open, editingId])

  // Aplikasi Android bisa menambah/mengubah patokan dari dialog native. Dialog itu
  // menulis ke localStorage lalu mengirim event ini supaya daftar di halaman ikut segar.
  useEffect(() => {
    const reload = () => {
      announced.current.clear()
      setItems(loadPatokans())
    }
    window.addEventListener('sim-patokan-changed', reload)
    return () => window.removeEventListener('sim-patokan-changed', reload)
  }, [])

  // Bunyikan sekali per patokan saat harga menyentuh angkanya, lalu statusnya "tercapai".
  useEffect(() => {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return
    const hits = items.filter(
      (p) => p.status === 'waiting' && !announced.current.has(p.id) && isPatokanReached(currentPrice, p),
    )
    if (!hits.length) return
    for (const p of hits) announced.current.add(p.id)
    const hitIds = new Set(hits.map((p) => p.id))
    const next = items.map((p) => (hitIds.has(p.id) ? { ...p, status: 'reached' as const } : p))
    setItems(next)
    savePatokans(next)
    for (const p of hits) {
      void alertPatokan(3, `patokan ${speechValue(p.value)} sudah di tercapai`)
    }
  }, [currentPrice, items])

  const update = (next: Patokan[]) => {
    setItems(next)
    savePatokans(next)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = parsePrice(input)
    if (!Number.isFinite(value)) {
      setError('isi angka harga yang valid (contoh 88 atau 90,5)')
      return
    }
    primeAudio()
    if (editingId) {
      announced.current.delete(editingId)
      update(
        items.map((p) =>
          p.id === editingId ? { ...p, value, direction, status: 'waiting' as const } : p,
        ),
      )
      setEditingId(null)
    } else {
      update([createPatokan(value, direction), ...items])
    }
    setInput('')
    setDirection('below')
    setError(null)
  }

  const startEdit = (p: Patokan) => {
    setEditingId(p.id)
    setInput(String(p.value))
    setDirection(p.direction)
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setInput('')
    setDirection('below')
    setError(null)
  }

  const remove = (id: string) => {
    announced.current.delete(id)
    update(items.filter((p) => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  const clearReached = () => {
    for (const p of items) {
      if (p.status === 'reached') announced.current.delete(p.id)
    }
    update(items.filter((p) => p.status !== 'reached'))
    if (editingId && items.some((p) => p.id === editingId && p.status === 'reached')) cancelEdit()
  }

  const statusText =
    items.length === 0 ? 'kosong' : waiting.length > 0 ? `${waiting.length} menunggu` : 'tercapai'
  const statusColor =
    items.length === 0 ? 'text-dim' : waiting.length > 0 ? 'text-amber' : 'text-long'

  return (
    <div className="relative flex shrink-0 items-center border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-pressed={open}
        className={`flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors sm:min-h-0 ${
          open ? 'bg-raise text-ink' : 'text-mute hover:text-ink'
        }`}
        title="patokan harga: beri tahu saat harga menyentuh angka tertentu (bisa lebih dari satu)"
      >
        Patokan
        {items.length > 0 && (
          <span className="num normal-case tracking-normal text-[9px] text-dim">
            {waiting.length}/{items.length}
          </span>
        )}
      </button>
      <span
        className={`border-l border-line px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${statusColor}`}
        title={
          items.length
            ? `${waiting.length} menunggu · ${reachedCount} tercapai`
            : 'belum ada patokan'
        }
      >
        {statusText}
      </span>

      {open &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="tutup patokan"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-black/40"
            />
            <form
              onSubmit={submit}
              className="fixed left-2 right-2 top-2 z-50 max-h-[calc(100dvh-1rem)] overflow-y-auto border border-line bg-panel p-3 shadow-xl sm:left-auto sm:right-3 sm:top-16 sm:max-h-[calc(100vh-5rem)] sm:w-[360px]"
            >
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-semibold tracking-tight">Patokan harga</span>
              <span className="num text-[10px] text-dim">harga {price(currentPrice)}</span>
            </div>

            {items.length > 0 ? (
              <ul className="mt-2 divide-y divide-line/60 border border-line">
                {items.map((p) => {
                  const reached = p.status === 'reached'
                  return (
                    <li key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="num text-[12px] text-ink">{patokanLabel(p)}</div>
                        <div
                          className={`text-[8.5px] font-semibold uppercase tracking-[0.08em] ${
                            reached ? 'text-long' : 'text-amber'
                          }`}
                        >
                          {reached ? 'tercapai' : 'menunggu'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="min-h-7 border border-line px-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-mute hover:border-cyan/40 hover:text-cyan"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p.id)}
                        className="min-h-7 border border-line px-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-dim hover:border-short/50 hover:text-short"
                      >
                        hapus
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 border border-dashed border-line px-2 py-2 text-[10px] text-dim">
                belum ada patokan. tambahkan satu atau beberapa angka di bawah.
              </p>
            )}

            <label className="mt-3 block">
              <span className="label text-[8.5px]">
                {editingId ? 'ubah harga patokan (USDT)' : 'tambah harga patokan (USDT)'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setError(null)
                }}
                placeholder="mis. 88 atau 90,5"
                autoFocus
                className="num mt-1 w-full border border-line bg-raise px-2 py-1.5 text-[12px] text-ink outline-none focus:border-cyan/60"
              />
            </label>

            <div className="mt-2">
              <span className="label text-[8.5px]">arah</span>
              <div className="mt-1 flex border border-line">
                {(
                  [
                    ['below', 'di bawah'],
                    ['above', 'di atas'],
                  ] as [PatokanDirection, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDirection(value)}
                    aria-pressed={direction === value}
                    className={`flex-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                      direction === value ? 'bg-raise text-ink' : 'text-dim hover:text-mute'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-2 text-[10px] leading-snug text-dim">
              {direction === 'below'
                ? 'aktif saat harga ≤ patokan (harga turun menyentuh angka).'
                : 'aktif saat harga ≥ patokan (harga naik menyentuh angka).'}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-dim">
              tiap patokan berbunyi 3× sekali saat tercapai, lalu diam. tambah patokan lain kapan saja;
              menunggu dan tercapai dihitung per baris.
            </p>

            {error && <p className="mt-2 text-[10px] text-short">{error}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="submit"
                className="min-h-9 flex-1 border border-cyan/40 bg-cyan/10 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan hover:bg-cyan/15"
              >
                {editingId ? 'simpan perubahan' : 'tambah patokan'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="min-h-9 border border-line px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-mute hover:text-ink"
                >
                  batal
                </button>
              )}
            </div>

            {reachedCount > 0 && (
              <button
                type="button"
                onClick={clearReached}
                className="mt-2 w-full border border-line px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-dim hover:border-short/50 hover:text-short"
              >
                hapus semua yang tercapai ({reachedCount})
              </button>
            )}
          </form>
          </>,
          document.body,
        )}
    </div>
  )
}
