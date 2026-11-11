import { useEffect, useState } from 'react'
import type { Mode, Snapshot } from '../../../server/src/api/contract'
import { hhmmss, price, pct } from '../lib/format'
import type { Theme } from '../lib/theme'
import type { Connection } from '../lib/useSnapshot'

function describeLag(ms: number): string {
  if (ms < 0) return 'ws —'
  if (ms < 1_500) return `ws ${Math.round(ms)} ms`
  return `ws ${(ms / 1000).toFixed(1)} s`
}

interface FeedDotProps {
  label: string
  connected: boolean
  ageMs: number
}

function FeedDot({ label, connected, ageMs }: FeedDotProps) {
  const age = connected ? Math.max(0, Math.round(ageMs / 1000)) : null
  return (
    <div className="flex items-center gap-1.5" title={connected ? `pesan terakhir ${age} detik lalu` : 'tidak tersambung'}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-long live-dot' : 'bg-short'}`}
        aria-hidden
      />
      <span className="label text-[9px]">{label}</span>
      <span className={`num text-[10px] ${connected && age !== null && age < 90 ? 'text-dim' : 'text-short'}`}>
        {age === null ? 'OFF' : `${age}s`}
      </span>
    </div>
  )
}

interface TopBarProps {
  snapshot: Snapshot
  connection: Connection
  busy: boolean
  diagnosing: boolean
  onTogglePower: () => void
  onSetMode: (mode: Mode) => void
  onDiagnose: () => void
  theme: Theme
  onTheme: (theme: Theme) => void
  onTestSound: () => void
}

export function TopBar({
  snapshot,
  connection,
  busy,
  diagnosing,
  onTogglePower,
  onSetMode,
  onDiagnose,
  theme,
  onTheme,
  onTestSound,
}: TopBarProps) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const { market, feed, enabled, mode } = snapshot
  const change = market.changePct
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-shell/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:h-14 sm:flex-nowrap sm:py-0 lg:px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="num grid h-8 w-8 place-items-center border border-line bg-raise text-[11px] font-semibold tracking-wider">
            S6
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">Simulasi 6 Model</div>
            <div className="label text-[9px]">
              {market.symbol} · futures · paper
            </div>
          </div>
        </div>

        <div className="mx-1 hidden h-8 w-px bg-line sm:block" />

        <div className="flex items-baseline gap-2">
          <span className="num text-[18px] font-semibold leading-none tracking-tight sm:text-[21px]">{price(market.price)}</span>
          <span className={`num text-[11px] ${change === null ? 'text-dim' : change >= 0 ? 'text-long' : 'text-short'}`}>
            {change === null ? '—' : `${pct(change)} 24j`}
          </span>
        </div>

        {/* di layar kecil menu bisa digeser ke samping, tidak memaksa topbar melebar */}
        <div className="ml-auto flex w-full items-center gap-2 overflow-x-auto pb-0.5 sm:w-auto sm:gap-3 sm:overflow-visible sm:pb-0">
          <div className="hidden flex-col gap-0.5 sm:flex">
            <FeedDot label="fut" connected={feed.future.connected} ageMs={now - feed.future.lastMessageTs} />
            <FeedDot label="spot" connected={feed.spot.connected} ageMs={now - feed.spot.lastMessageTs} />
          </div>

          <div className="hidden flex-col items-end gap-0.5 md:flex" title="transaksi futures per detik dan jeda snapshot terakhir">
            <span className="num text-[10px] text-dim">{snapshot.live.ticksPerSec.toFixed(1)} tx/dtk</span>
            <span className={`num text-[10px] ${now - snapshot.serverTime > 6000 ? 'text-short' : 'text-dim'}`}>
              {describeLag(now - snapshot.serverTime)}
            </span>
          </div>

          <div className="hidden h-8 w-px bg-line sm:block" />

          <div className="flex shrink-0 items-center border border-line" role="group" aria-label="tema tampilan">
            {(['gelap', 'terang'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTheme(t)}
                aria-pressed={theme === t}
                className={`min-h-9 shrink-0 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors sm:min-h-0 ${
                  theme === t ? 'bg-raise text-ink' : 'text-dim hover:text-mute'
                }`}
              >
                {t === 'gelap' ? 'Gelap' : 'Terang'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onTestSound}
            className="min-h-9 shrink-0 border border-line px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-mute transition-colors hover:border-cyan/40 hover:text-cyan sm:min-h-0"
            title="bunyikan tes notifikasi suara (notif.mp3 + ucapan sinyal)"
          >
            Tes suara
          </button>

          <div
            className="flex shrink-0 items-center border border-line"
            role="group"
            aria-label="mode simulasi"
          >
            {(['live', 'replay'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => onSetMode(m)}
                className={`min-h-9 shrink-0 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-50 sm:min-h-0 ${
                  mode === m ? 'bg-raise text-ink' : 'text-dim hover:text-mute'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={diagnosing}
            onClick={onDiagnose}
            className="min-h-9 shrink-0 border border-line px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-mute transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-50 sm:min-h-0"
            title="cek sambungan WS, feed Binance, dan panggil REST — hasilnya masuk ke log sistem"
          >
            {diagnosing ? 'cek…' : 'Cek WS'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={onTogglePower}
            className={`flex min-h-9 shrink-0 items-center gap-2 border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-50 sm:min-h-0 ${
              enabled
                ? 'border-long/40 bg-long/10 text-long hover:bg-long/15'
                : 'border-short/40 bg-short/10 text-short hover:bg-short/15'
            }`}
            aria-pressed={enabled}
            title={enabled ? 'matikan sistem (tidak ada entri baru)' : 'nyalakan sistem'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-long' : 'bg-short'}`} aria-hidden />
            {enabled ? 'Aktif' : 'Mati'}
          </button>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <span className="num text-[11px] text-mute">{hhmmss(now)}</span>
            <span
              className={`num text-[9px] uppercase tracking-wider ${
                connection === 'live' ? 'text-dim' : connection === 'connecting' ? 'text-amber' : 'text-short'
              }`}
              title="status sambungan UI ke server"
            >
              {connection === 'live' ? 'ws ok' : connection === 'connecting' ? 'ws …' : 'ulang'}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
