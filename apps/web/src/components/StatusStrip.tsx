import type { Snapshot } from '../../../server/src/api/contract'
import { dayMonth, hhmm, money, spanMinutes } from '../lib/format'

interface MetaItemProps {
  label: string
  value: string
  tone?: 'normal' | 'warn' | 'good'
}

function MetaItem({ label, value, tone = 'normal' }: MetaItemProps) {
  const color = tone === 'warn' ? 'text-amber' : tone === 'good' ? 'text-long' : 'text-mute'
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="label text-[9px]">{label}</span>
      <span className={`num text-[10px] ${color}`}>{value}</span>
    </div>
  )
}

interface StatusStripProps {
  snapshot: Snapshot
  busy: boolean
  onReplay: (action: 'play' | 'pause' | 'reset' | 'speed' | 'seek', value?: number) => void
}

export function StatusStrip({ snapshot, busy, onReplay }: StatusStripProps) {
  const { live, trading, replay, mode, feed, enabled } = snapshot
  const warmupPct = Math.min(100, (live.historyMinutes / live.neededMinutes) * 100)
  const replayPct = replay ? (replay.index / replay.total) * 100 : 0
  const futuresDown = mode === 'live' && !feed.future.connected

  return (
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 lg:px-5">
        {mode === 'live' ? (
          <>
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  live.ready ? 'bg-long' : futuresDown ? 'bg-short' : 'bg-amber'
                } ${live.ready ? 'live-dot' : ''}`}
                aria-hidden
              />
              <span className={`label text-[9px] ${live.ready ? 'text-long' : futuresDown ? 'text-short' : 'text-amber'}`}>
                {live.ready ? 'siap' : futuresDown ? 'data futures putus' : 'mengumpulkan data'}
              </span>
            </div>

            {!live.ready && (
              <div className="flex items-center gap-2">
                <div className="h-[3px] w-28 bg-line">
                  <div className="h-full bg-amber transition-[width] duration-500" style={{ width: `${warmupPct}%` }} />
                </div>
                <span className="num text-[10px] text-mute" title="sisa menit sampai sinyal pertama bisa dihitung">
                  {live.historyMinutes}/{live.neededMinutes} mnt · sinyal ±{hhmm(live.readyAtTs)}
                </span>
              </div>
            )}

            <MetaItem label="detak" value={`${live.ticksPerSec.toFixed(1)} tx/dtk`} tone={live.ticksPerSec > 0 ? 'good' : 'warn'} />

            {live.ready && (
              <MetaItem
                label="hitung"
                value={`${live.computeMs} ms · ${live.computeCount}×`}
                tone={live.lastError ? 'warn' : 'good'}
              />
            )}
            {live.lastMinuteTs > 0 && <MetaItem label="menit" value={hhmm(live.lastMinuteTs * 1000)} />}
            {live.lastError && <MetaItem label="galat" value={live.lastError.slice(0, 48)} tone="warn" />}
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy || !replay}
                onClick={() => onReplay(replay?.playing ? 'pause' : 'play')}
                className="border border-line bg-raise px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink hover:bg-line disabled:opacity-40"
              >
                {replay?.playing ? 'pause' : 'putar'}
              </button>
              <button
                type="button"
                disabled={busy || !replay}
                onClick={() => onReplay('reset')}
                className="border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-mute hover:text-ink disabled:opacity-40"
              >
                ulang
              </button>
              <select
                disabled={busy || !replay}
                value={replay?.speed ?? 240}
                onChange={(e) => onReplay('speed', Number(e.target.value))}
                className="num border border-line bg-raise px-1.5 py-1 text-[10px] text-ink outline-none"
                title="kecepatan putar (menit data per detik); kecepatan aktual turun bila CPU tidak sanggup"
              >
                {[30, 60, 120, 240, 600, 1200].map((s) => (
                  <option key={s} value={s}>
                    {s} mnt/dtk
                  </option>
                ))}
              </select>
              {replay?.playing && replay.effectiveSpeed < replay.speed * 0.8 && (
                <span className="num text-[10px] text-amber" title="kecepatan aktual dibatasi CPU">
                  ≈{replay.effectiveSpeed}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {replay?.folds.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  disabled={busy}
                  onClick={() => onReplay('seek', f.startIndex)}
                  className="border border-line px-1.5 py-1 text-[10px] font-semibold text-mute hover:border-cyan/40 hover:text-cyan disabled:opacity-40"
                  title={`lompat ke lipatan validasi ${f.name} (${dayMonth(f.ts * 1000)})`}
                >
                  {f.name}
                </button>
              ))}
            </div>

            <div className="flex min-w-[150px] flex-1 items-center gap-2">
              <div className="h-[3px] flex-1 bg-line">
                <div className="h-full bg-cyan" style={{ width: `${replayPct}%` }} />
              </div>
              <span className="num whitespace-nowrap text-[10px] text-mute">
                {replay ? `${replay.index}/${replay.total}` : '—'} · {replay ? dayMonth(replay.currentTs * 1000) : '—'}{' '}
                {replay ? hhmm(replay.currentTs * 1000) : ''}
              </span>
            </div>
          </>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {!enabled && (
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-short" aria-hidden />
              <span className="label text-[9px] text-short">sistem mati · tanpa entri baru</span>
            </div>
          )}
          <MetaItem label="modal" value={`${money(trading.CAPITAL)} / bot`} />
          <MetaItem label="lev" value={`${trading.LEVERAGE}×`} />
          <MetaItem label="tp/sl" value={`${trading.TP_PCT}% / ${trading.SL_PCT}%`} />
          <MetaItem label="horizon" value={spanMinutes(trading.HORIZON_MIN)} />
          <MetaItem label="jeda" value={`${trading.COOLDOWN_MIN} mnt`} />
          <MetaItem label="model" value={`v${live.modelVersion}`} />
          <MetaItem label="sinyal" value={`${live.dominancePct}% × ${live.streak}`} />
        </div>
      </div>
    </div>
  )
}
