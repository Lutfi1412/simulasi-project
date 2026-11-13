import { useEffect, useRef, useState, type FormEvent } from 'react'
import { price } from '../lib/format'
import {
  isPatokanReached,
  loadPatokan,
  patokanLabel,
  savePatokan,
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

/**
 * Patokan harga SOL di topbar. Cukup isi angka + arah (di bawah / di atas);
 * sistem membandingkan dengan harga pasar yang masuk dan berbunyi sekali saat tercapai.
 */
export function PatokanControl({ currentPrice }: PatokanControlProps) {
  const [patokan, setPatokan] = useState<Patokan | null>(() => loadPatokan())
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [direction, setDirection] = useState<PatokanDirection>('below')
  const [error, setError] = useState<string | null>(null)
  const announced = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setInput(patokan ? String(patokan.value) : '')
    setDirection(patokan?.direction ?? 'below')
    setError(null)
  }, [open, patokan])

  // Bunyikan sekali saat harga menyentuh patokan, lalu status menjadi "tercapai".
  useEffect(() => {
    if (!patokan || patokan.status !== 'waiting') return
    if (!isPatokanReached(currentPrice, patokan)) return
    const key = `${patokan.direction}:${patokan.value}`
    if (announced.current === key) return
    announced.current = key
    const next: Patokan = { ...patokan, status: 'reached' }
    setPatokan(next)
    savePatokan(next)
    void alertPatokan(3)
  }, [currentPrice, patokan])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = parsePrice(input)
    if (!Number.isFinite(value)) {
      setError('isi angka harga yang valid (contoh 88 atau 90,5)')
      return
    }
    primeAudio()
    const next: Patokan = { value, direction, status: 'waiting' }
    announced.current = null
    setPatokan(next)
    savePatokan(next)
    setOpen(false)
  }

  const remove = () => {
    announced.current = null
    setPatokan(null)
    savePatokan(null)
    setOpen(false)
  }

  const reached = patokan?.status === 'reached'
  const statusText = !patokan ? 'kosong' : reached ? 'tercapai' : 'menunggu'
  const statusColor = !patokan ? 'text-dim' : reached ? 'text-long' : 'text-amber'

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
        title="patokan harga: beri tahu saat harga menyentuh angka tertentu"
      >
        Patokan
        {patokan && <span className="num normal-case tracking-normal text-[9px] text-dim">{patokanLabel(patokan)}</span>}
      </button>
      <span
        className={`border-l border-line px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${statusColor}`}
        title={
          patokan
            ? `${patokanLabel(patokan)} · ${reached ? 'sudah tercapai, tidak akan berbunyi lagi' : 'menunggu harga menyentuh patokan'}`
            : 'belum ada patokan'
        }
      >
        {statusText}
      </span>

      {open && (
        <>
          <button
            type="button"
            aria-label="tutup patokan"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40"
          />
          <form
            onSubmit={submit}
            className="fixed right-3 top-16 z-50 w-[300px] max-w-[calc(100vw-1.5rem)] border border-line bg-panel p-3 shadow-xl"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-semibold tracking-tight">Patokan harga</span>
              <span className="num text-[10px] text-dim">harga {price(currentPrice)}</span>
            </div>

            <label className="mt-2 block">
              <span className="label text-[8.5px]">harga patokan (USDT)</span>
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
              sekali tercapai: notif 3× lalu diam. Buat/perbarui patokan supaya menunggu lagi.
            </p>

            {error && <p className="mt-2 text-[10px] text-short">{error}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="submit"
                className="min-h-9 flex-1 border border-cyan/40 bg-cyan/10 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan hover:bg-cyan/15"
              >
                {patokan ? 'perbarui' : 'simpan'}
              </button>
              {patokan && (
                <button
                  type="button"
                  onClick={remove}
                  className="min-h-9 border border-line px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim hover:border-short/50 hover:text-short"
                >
                  hapus
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}
