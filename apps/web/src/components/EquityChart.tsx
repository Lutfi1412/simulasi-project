import { useEffect, useRef, useState } from 'react'
import type { BotView } from '../../../server/src/api/contract'
import { hhmm, kindStyle, pct, pnlClass } from '../lib/format'

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

/** Grafik ekuitas 6 bot sebagai % terhadap modal (satu sumbu, warna per model). */
export function EquityChart({ bots, label }: EquityChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const height = 210
  const pad = { top: 12, right: 46, bottom: 20, left: 6 }

  const series = bots.map((bot) => ({
    bot,
    color: kindStyle(bot.kind).hex,
    points: bot.curve.map((p) => ({ ts: p.ts, value: (p.equity / bot.capital - 1) * 100 })),
  }))

  const all = series.flatMap((s) => s.points)
  const hasData = all.length > 1
  const tsMin = hasData ? Math.min(...all.map((p) => p.ts)) : Date.now() - 3600_000
  const tsMax = hasData ? Math.max(...all.map((p) => p.ts)) : Date.now()
  const spanX = Math.max(1, tsMax - tsMin)

  const rawMin = hasData ? Math.min(0, ...all.map((p) => p.value)) : -1
  const rawMax = hasData ? Math.max(0, ...all.map((p) => p.value)) : 1
  const padY = Math.max((rawMax - rawMin) * 0.12, 0.8)
  const yMin = rawMin - padY
  const yMax = rawMax + padY

  const innerW = Math.max(40, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const x = (ts: number) => pad.left + ((ts - tsMin) / spanX) * innerW
  const y = (v: number) => pad.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) / ticks) * i)

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight">Kurva ekuitas</h2>
        <span className="label text-[9px]">{label}</span>
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
        <svg width={width} height={height} role="img" aria-label="kurva ekuitas enam model">
          {yTicks.map((v, i) => (
            <g key={i}>
              <line
                x1={pad.left}
                x2={pad.left + innerW}
                y1={y(v)}
                y2={y(v)}
                stroke={Math.abs(v) < 1e-9 ? '#3a4048' : '#1a1e23'}
                strokeWidth="1"
                strokeDasharray={Math.abs(v) < 1e-9 ? '3 3' : undefined}
              />
              <text x={pad.left + innerW + 6} y={y(v) + 3} fill="#5b636d" fontSize="9" fontFamily="ui-monospace, monospace">
                {v > 0 ? '+' : ''}
                {v.toFixed(1)}%
              </text>
            </g>
          ))}

          {series.map(({ bot, color, points }) => {
            if (points.length < 2) return null
            const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
            return (
              <path
                key={bot.id}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="1.3"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.95"
              />
            )
          })}

          {!hasData && (
            <text
              x={pad.left + innerW / 2}
              y={pad.top + innerH / 2}
              textAnchor="middle"
              fill="#5b636d"
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              belum ada transaksi — kurva muncul setelah trade pertama
            </text>
          )}

          <text x={pad.left} y={height - 5} fill="#5b636d" fontSize="9" fontFamily="ui-monospace, monospace">
            {hhmm(tsMin)}
          </text>
          <text
            x={pad.left + innerW}
            y={height - 5}
            textAnchor="end"
            fill="#5b636d"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            {hhmm(tsMax)}
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
    'XGBoost': 'XGB',
    'Meta-label': 'Meta',
    'GRU': 'GRU',
    'Ensemble': 'Ensemble',
  }
  return map[name] ?? name.split(' ')[0]
}
