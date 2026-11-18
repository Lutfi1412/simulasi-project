import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BotView } from '../../../server/src/api/contract'
import { WIB_LABEL, hhmm, kindStyle, pct, pnlClass } from '../lib/format'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

interface EquityChartProps {
  bots: BotView[]
  label: string
}

interface ViewWindow {
  /** posisi awal jendela, 0..1 dari seluruh rentang waktu */
  start: number
  /** posisi akhir jendela, 0..1 */
  end: number
}

const MIN_WINDOW = 0.02

/**
 * Grafik ekuitas 6 bot sebagai % terhadap modal.
 *
 * - Responsif: lebar & tinggi mengikuti kontainer.
 * - Zoom: scroll di atas grafik, atau tombol + / −.
 * - Geser: drag horizontal (mouse/sentuh).
 * - Sumbu Y otomatis mengikuti data yang sedang terlihat, jadi garis tidak
 *   mengecil saat histori sudah panjang.
 */
export function EquityChart({ bots, label }: EquityChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const height = Math.max(190, Math.min(320, Math.round(width * 0.26)))
  const padTop = 12
  const padRight = 52
  const padBottom = 22
  const padLeft = 8

  const series = useMemo(
    () =>
      bots.map((bot) => ({
        bot,
        color: kindStyle(bot.kind).hex,
        // live memakai milidetik, replay memakai detik — samakan ke ms untuk sumbu waktu
        points: bot.curve.map((p) => ({
          ts: p.ts > 1e11 ? p.ts : p.ts * 1000,
          value: (p.equity / bot.capital - 1) * 100,
        })),
      })),
    [bots],
  )

  const all = useMemo(() => series.flatMap((s) => s.points), [series])
  const hasData = all.length > 1
  const fullMin = hasData ? Math.min(...all.map((p) => p.ts)) : Date.now() - 3600_000
  const fullMax = hasData ? Math.max(...all.map((p) => p.ts)) : Date.now()
  const fullSpan = Math.max(1, fullMax - fullMin)

  const [view, setView] = useState<ViewWindow>({ start: 0, end: 1 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; start: number; end: number } | null>(null)

  const innerW = Math.max(40, width - padLeft - padRight)
  const innerH = height - padTop - padBottom

  const t0 = fullMin + view.start * fullSpan
  const t1 = fullMin + view.end * fullSpan

  const visible = series.map((s) => {
    const inside = s.points.filter((p) => p.ts >= t0 && p.ts <= t1)
    if (inside.length === 0) return { ...s, points: [] as { ts: number; value: number }[] }
    // Setiap garis ditarik sampai tepi jendela memakai nilai terdekat. Tanpa ini,
    // model yang baru mulai (atau baru direset) hanya tampil sebagai segmen pendek
    // di ujung kanan, sementara sumbu X mengikuti model dengan histori terpanjang.
    const points: { ts: number; value: number }[] = [...inside]
    if (inside[0].ts > t0) points.unshift({ ts: t0, value: inside[0].value })
    const last = inside[inside.length - 1]
    if (last.ts < t1) points.push({ ts: t1, value: last.value })
    return { ...s, points }
  })
  const visibleValues = visible.flatMap((s) => s.points.map((p) => p.value))

  // Garis datar (mis. bot baru / belum ada trade) semuanya berada di 0% dan saling
  // menimpa, sehingga warna yang digambar terakhir menutupi model lain — GRU bisa
  // terlihat "hilang". Kelompokkan garis datar per nilai lalu geser beberapa piksel
  // hanya untuk tampilan; nilai di legenda/tooltip tetap nilai sebenarnya.
  const flatGroups = new Map<string, string[]>()
  for (const s of visible) {
    if (s.points.length < 2) continue
    const v = s.points[0].value
    if (!s.points.every((p) => Math.abs(p.value - v) < 1e-9)) continue
    const key = v.toFixed(6)
    const arr = flatGroups.get(key)
    if (arr) arr.push(s.bot.id)
    else flatGroups.set(key, [s.bot.id])
  }
  const flatOffset = (id: string): number => {
    for (const arr of flatGroups.values()) {
      if (arr.length < 2) continue
      const i = arr.indexOf(id)
      if (i >= 0) return (i - (arr.length - 1) / 2) * 2
    }
    return 0
  }

  let yMin = -1
  let yMax = 1
  if (visibleValues.length) {
    const lo = Math.min(...visibleValues)
    const hi = Math.max(...visibleValues)
    if (hi - lo < 0.2) {
      const mid = (hi + lo) / 2
      yMin = mid - 0.5
      yMax = mid + 0.5
    } else {
      const padY = (hi - lo) * 0.12
      yMin = lo - padY
      yMax = hi + padY
    }
  }

  const x = (ts: number) => padLeft + ((ts - t0) / Math.max(1, t1 - t0)) * innerW
  const y = (v: number) => padTop + innerH - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * innerH

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i)
  const showZero = yMin < 0 && yMax > 0

  const zoomAt = useCallback((factor: number, center: number) => {
    setView((v) => {
      const widthNow = v.end - v.start
      const next = Math.min(1, Math.max(MIN_WINDOW, widthNow * factor))
      const anchor = v.start + Math.min(1, Math.max(0, center)) * widthNow
      let start = anchor - center * next
      let end = start + next
      if (start < 0) {
        start = 0
        end = next
      }
      if (end > 1) {
        end = 1
        start = 1 - next
      }
      return { start: Math.max(0, start), end: Math.min(1, end) }
    })
  }, [])

  // Scroll = zoom di sekitar posisi kursor. Listener native supaya preventDefault bekerja.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!hasData) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const center = (event.clientX - rect.left - padLeft) / Math.max(1, innerW)
      zoomAt(event.deltaY < 0 ? 0.8 : 1.25, center)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasData, innerW, padLeft, zoomAt, ref])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!hasData) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, start: view.start, end: view.end }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const windowSize = drag.end - drag.start
    const shift = (-(event.clientX - drag.x) / Math.max(1, innerW)) * windowSize
    let start = drag.start + shift
    let end = drag.end + shift
    if (start < 0) {
      end -= start
      start = 0
    }
    if (end > 1) {
      start -= end - 1
      end = 1
    }
    setView({ start: Math.max(0, start), end: Math.min(1, end) })
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const windowMinutes = Math.max(1, Math.round((t1 - t0) / 60_000))

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight">Kurva ekuitas</h2>
        <span className="label text-[9px]">{label}</span>
        <span className="num text-[9.5px] text-dim">
          {hhmm(t0)}–{hhmm(t1)} {WIB_LABEL} · {windowMinutes >= 60 ? `${(windowMinutes / 60).toFixed(1)} j` : `${windowMinutes} m`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomAt(0.65, 0.5)}
            className="grid h-6 w-6 place-items-center border border-line text-[12px] leading-none text-mute hover:border-cyan/50 hover:text-cyan"
            title="zoom in"
            aria-label="zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomAt(1 / 0.65, 0.5)}
            className="grid h-6 w-6 place-items-center border border-line text-[12px] leading-none text-mute hover:border-cyan/50 hover:text-cyan"
            title="zoom out"
            aria-label="zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setView({ start: 0, end: 1 })}
            className="grid h-6 px-1.5 place-items-center border border-line text-[9px] uppercase tracking-wider text-dim hover:border-cyan/50 hover:text-cyan"
            title="tampilkan semua data"
          >
            semua
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map(({ bot, color, points }) => {
            const roi = points.length ? points[points.length - 1].value : 0
            return (
              <span key={bot.id} className="flex items-center gap-1.5" title={`${bot.model} · ${pct(roi, 2)}`}>
                <span className="h-[2px] w-3" style={{ background: color }} aria-hidden />
                <span className="text-[10px] text-mute">{shortModel(bot.model)}</span>
                <span className={`num text-[10px] ${pnlClass(roi)}`}>{pct(roi, 1)}</span>
              </span>
            )
          })}
        </div>
      </div>

      <div ref={ref} className="relative px-0 pt-1">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="kurva ekuitas enam model, bisa di-zoom dan digeser"
          style={{ touchAction: 'none', cursor: hasData ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setView({ start: 0, end: 1 })}
        >
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--color-line)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft + innerW + 6}
                y={y(v) + 3}
                fill="var(--color-dim)"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
              >
                {v > 0 ? '+' : ''}
                {v.toFixed(1)}%
              </text>
            </g>
          ))}

          {showZero && (
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--color-dim)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          )}

          {visible.map(({ bot, color, points }) => {
            if (points.length < 2) return null
            const d = points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
              .join(' ')
            const offset = flatOffset(bot.id)
            return (
              <path
                key={bot.id}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.95"
                transform={offset ? `translate(0, ${offset.toFixed(1)})` : undefined}
              />
            )
          })}

          {!hasData && (
            <text
              x={padLeft + innerW / 2}
              y={padTop + innerH / 2}
              textAnchor="middle"
              fill="var(--color-dim)"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              belum ada transaksi — kurva muncul setelah trade pertama
            </text>
          )}

          <text x={padLeft} y={height - 5} fill="var(--color-dim)" fontSize="9" fontFamily="ui-monospace, monospace">
            {hhmm(t0)}
          </text>
          <text
            x={padLeft + innerW}
            y={height - 5}
            textAnchor="end"
            fill="var(--color-dim)"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            {hhmm(t1)} {WIB_LABEL}
          </text>
        </svg>
      </div>
    </section>
  )
}

/** nama model dipendekkan untuk legenda: "Regresi Logistik" -> "Regresi" */
function shortModel(name: string): string {
  const map: Record<string, string> = {
    'Aturan dominasi': 'Aturan',
    'Regresi Logistik': 'Logreg',
    XGBoost: 'XGB',
    'Meta-label': 'Meta',
    GRU: 'GRU',
    Ensemble: 'Ensemble',
  }
  return map[name] ?? name.split(' ')[0]
}
