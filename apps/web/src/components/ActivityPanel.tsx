import type { LogEntry, Side, Snapshot } from '../../../server/src/api/contract'
import { WIB_LABEL, hhmmss, price, prob, sideClass, sideLabel } from '../lib/format'

type Tab = 'sinyal' | 'log'

const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  info: 'text-mute',
  signal: 'text-cyan',
  trade: 'text-ink',
  warn: 'text-amber',
}

interface SignalRow {
  ts: number
  botId: string
  model: string
  side: Side
  price: number
  p: number[]
}

interface ActivityPanelProps {
  snapshot: Snapshot
  /** baris tambahan dari tombol "Cek WS" (hasil diagnostik di sisi browser) */
  extraLogs: LogEntry[]
  tab: Tab
  onTab: (tab: Tab) => void
}

export const ACTIVITY_TABS: Tab[] = ['sinyal', 'log']

export function ActivityPanel({ snapshot, extraLogs, tab, onTab }: ActivityPanelProps) {
  const signals: SignalRow[] = snapshot.signals
  const logs = [...extraLogs, ...snapshot.logs].slice(0, 120)

  return (
    <section className="flex min-h-0 flex-col border border-line bg-panel">
      <div className="flex items-center border-b border-line/70">
        {ACTIVITY_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors ${
              tab === t ? 'border-b-2 border-ink text-ink' : 'text-dim hover:text-mute'
            }`}
          >
            {t === 'sinyal' ? `sinyal ${signals.length ? `(${signals.length})` : ''}` : 'log sistem'}
          </button>
        ))}
        <span className="ml-auto px-3 label text-[9px]">{snapshot.mode === 'live' ? 'langsung' : 'replay'}</span>
      </div>

      <div className="max-h-[240px] min-h-[150px] flex-1 overflow-y-auto">
        {tab === 'sinyal' ? (
          <>
            <div className="flex items-center gap-2 border-b border-line/40 px-3 py-1 label text-[8.5px]">
              <span className="w-[70px] shrink-0">waktu ({WIB_LABEL})</span>
              <span className="w-9 shrink-0">arah</span>
              <span className="min-w-0 flex-1">model</span>
              <span className="shrink-0">harga</span>
              <span className="w-10 shrink-0 text-right">p</span>
            </div>
            {signals.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-dim">belum ada sinyal yang memicu entri</p>
            ) : (
              <ul className="divide-y divide-line/50">
                {signals.map((s, i) => (
                  <li key={`${s.botId}-${s.ts}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="num w-[70px] shrink-0 text-[10px] text-dim" title={`${WIB_LABEL} (UTC+7)`}>
                      {hhmmss(s.ts * 1000)}
                    </span>
                    <span className={`num w-9 shrink-0 text-[10px] font-semibold ${sideClass(s.side)}`}>
                      {sideLabel(s.side)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-mute">{s.model}</span>
                    <span className="num shrink-0 text-[10px] text-dim">{price(s.price)}</span>
                    <span className="num w-10 shrink-0 text-right text-[10px] text-dim">
                      p {prob(Math.max(s.p[1], s.p[2]))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : logs.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-dim">belum ada catatan</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {logs.map((l, i) => (
              <li key={`${l.ts}-${i}`} className="flex items-start gap-2 px-3 py-1.5">
                <span className="num shrink-0 text-[10px] text-dim">{hhmmss(l.ts)}</span>
                <span className={`text-[10.5px] leading-snug ${LEVEL_CLASS[l.level]}`}>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
