import type { BotView, ModelView, TradingView } from '../../../server/src/api/contract'
import { compact, hhmm, kindStyle, money, pct, pnlClass, price, prob, sideLabel } from '../lib/format'

interface SparklineProps {
  points: { ts: number; equity: number }[]
  capital: number
  color: string
}

/** Garis ekuitas kecil; datar di modal awal kalau belum ada trade. */
function Sparkline({ points, capital, color }: SparklineProps) {
  const w = 92
  const h = 30
  if (points.length < 2) {
    return (
      <svg width={w} height={h} aria-hidden className="shrink-0">
        {/* tetap pakai warna model supaya GRU tidak tampak "hilang" saat curve baru 1 titik */}
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={color} strokeOpacity="0.65" strokeWidth="1.4" />
      </svg>
    )
  }
  const values = points.map((p) => p.equity / capital - 1)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (i: number) => (i / (points.length - 1)) * w
  const y = (v: number) => h - ((v - min) / span) * (h - 2) - 1
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const zeroY = y(0)
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 3" />
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} opacity="0.07" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

interface BotCardProps {
  bot: BotView
  model: ModelView | undefined
  trading: TradingView
  marketPrice: number
  busy: boolean
  onReset: (id: string) => void
  onNeutralize: (id: string) => void
  soundOn: boolean
  onToggleSound: () => void
}

export function BotCard({
  bot,
  model,
  trading,
  marketPrice,
  busy,
  onReset,
  onNeutralize,
  soundOn,
  onToggleSound,
}: BotCardProps) {
  const style = kindStyle(bot.kind)
  const active = Boolean(bot.position)
  const roi = bot.roiPct
  const barPct = bot.position ? Math.min(100, (bot.position.bars / trading.HORIZON_MIN) * 100) : 0
  const p = model?.p ?? [1, 0, 0]
  const available = model?.available ?? true
  const signal = model?.signal ?? 0

  return (
    <article
      className="relative flex flex-col border border-line bg-panel transition-colors hover:border-line/80"
      style={{ borderLeftColor: style.hex, borderLeftWidth: 2 }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <h3 className="truncate text-[12.5px] font-semibold tracking-tight">{bot.model}</h3>
        <span className={`border px-1 py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] ${style.chip}`}>
          {style.label}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              active ? 'bg-amber' : signal !== 0 ? 'bg-cyan' : available ? 'bg-dim' : 'bg-line'
            }`}
            aria-hidden
          />
          <span className="label text-[9px]">
            {active ? 'posisi' : bot.pending ? 'menunggu' : available ? 'memantau' : 'pemanasan'}
          </span>
        </span>
      </div>

      <div className="flex items-end justify-between gap-3 px-3 pt-2">
        <div className="min-w-0">
          <div className="num text-[19px] font-semibold leading-none tracking-tight">{money(bot.effectiveEquity)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`num text-[11px] font-medium ${pnlClass(roi)}`}>{pct(roi, 2)}</span>
            <span className="num text-[10px] text-dim">dari {compact(bot.capital)}</span>
            {bot.unrealized !== 0 && (
              <span className={`num text-[10px] ${pnlClass(bot.unrealized)}`}>· {compact(bot.unrealized)} terbuka</span>
            )}
          </div>
        </div>
        <Sparkline points={bot.curve} capital={bot.capital} color={style.hex} />
      </div>

      <div className="mt-2.5 border-t border-line/70 px-3 py-2">
        {bot.position ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span
                  className={`border px-1 py-[1px] text-[9px] font-bold tracking-wider ${
                    bot.position.side === 1 ? 'border-long/40 bg-long/10 text-long' : 'border-short/40 bg-short/10 text-short'
                  }`}
                >
                  {sideLabel(bot.position.side)}
                </span>
                <span className="num text-[10.5px] text-mute">
                  {price(bot.position.entry)} → <span className="text-ink">{price(marketPrice)}</span>
                </span>
              </span>
              <span className="num text-[10px] text-dim">
                {bot.position.bars}/{trading.HORIZON_MIN} mnt
              </span>
            </div>
            <div className="mt-1.5 h-[3px] w-full bg-line">
              <div
                className={`h-full ${bot.position.side === 1 ? 'bg-long/70' : 'bg-short/70'}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="num text-[9px] text-dim">
                TP +{trading.TP_PCT}% ROI · {price(bot.position.tp)}
              </span>
              <span className="num text-[9px] text-dim">
                SL −{trading.SL_PCT}% ROI · {price(bot.position.sl)}
              </span>
              <span className="num text-[10px] text-dim">
                margin {compact(bot.position.margin)} · notional {compact(bot.position.notional)}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="num text-[10px] text-dim">
              {bot.lastSignal
                ? `sinyal terakhir ${sideLabel(bot.lastSignal.side)} · ${hhmm(bot.lastSignal.ts * 1000)} WIB @ ${price(bot.lastSignal.price)}`
                : 'belum ada sinyal'}
            </span>
            <span className="num text-[10px] text-dim">{bot.pending ? `masuk ${sideLabel(bot.pending.side)}` : ''}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-6 gap-px border-t border-line/70 bg-line/60">
        {[
          ['trade', String(bot.stats.trades)],
          ['win', `${bot.stats.winRate.toFixed(0)}%`],
          ['kalah', String(bot.stats.losses)],
          ['reset', String(bot.stats.resets)],
          ['dd', `${bot.stats.maxDdPct.toFixed(1)}%`],
          ['pf', bot.stats.profitFactor >= 999 ? '∞' : bot.stats.profitFactor.toFixed(2)],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel px-2 py-1.5">
            <div className="label text-[8.5px]">{label}</div>
            <div className="num text-[11px] text-mute">{value}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-line/70 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="label text-[8.5px]">probabilitas</span>
          <span className={`num text-[9px] ${signal !== 0 ? 'text-ink' : 'text-dim'}`}>
            {available ? sideLabel(signal) : '—'}
          </span>
        </div>
        <div className="mt-1 flex h-[3px] w-full overflow-hidden bg-line">
          <div className="h-full bg-dim/50" style={{ width: `${p[0] * 100}%` }} />
          <div className="h-full bg-long" style={{ width: `${p[1] * 100}%` }} />
          <div className="h-full bg-short" style={{ width: `${p[2] * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between">
          <span className="num text-[9px] text-dim">netral {prob(p[0])}</span>
          <span className="num text-[9px] text-long">long {prob(p[1])}</span>
          <span className="num text-[9px] text-short">short {prob(p[2])}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line/70 px-3 py-1.5">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={soundOn}
            onChange={onToggleSound}
            className="h-3.5 w-3.5 accent-[var(--color-cyan)]"
            aria-label={`notif suara ${bot.model}`}
          />
          <span className="label text-[8.5px]">notif suara</span>
        </label>
        <span className={`num text-[9px] ${soundOn ? 'text-cyan' : 'text-dim'}`} title="suara saat model ini memberi sinyal entri">
          {soundOn ? 'ON' : 'OFF'}
        </span>
      </div>

      <div className="flex gap-2 border-t border-line/70 px-3 py-2">
        <button
          type="button"
          disabled={busy || !bot.neutralizable}
          onClick={() => onNeutralize(bot.id)}
          className="min-h-10 flex-1 border border-line px-2 text-[10px] font-semibold text-mute hover:border-amber/50 hover:text-amber focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          title={bot.neutralizable ? 'Tutup posisi atau batalkan entry tertunda' : 'Tidak ada posisi atau entry tertunda'}
        >
          Netral
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReset(bot.id)}
          className="min-h-10 flex-1 border border-line px-2 text-[10px] font-semibold text-dim hover:border-short/50 hover:text-short focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          title={`Reset saldo ${bot.model} ke modal awal`}
        >
          Reset
        </button>
      </div>
    </article>
  )
}
