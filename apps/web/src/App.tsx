import { useCallback, useEffect, useState } from 'react'
import type { Diagnostics, LogEntry, Mode, Snapshot } from '../../server/src/api/contract'
import { ActivityPanel } from './components/ActivityPanel'
import { BotCard } from './components/BotCard'
import { EquityChart } from './components/EquityChart'
import { ModelMatrix } from './components/ModelMatrix'
import { StatusStrip } from './components/StatusStrip'
import { TopBar } from './components/TopBar'
import { TradeBlotter } from './components/TradeBlotter'
import { useSnapshot } from './lib/useSnapshot'
import { dayMonth, hhmm, money, pct, pnlClass } from './lib/format'

export default function App() {
  const { snapshot, connection } = useSnapshot()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [activityTab, setActivityTab] = useState<'sinyal' | 'log'>('sinyal')
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([])

  const post = useCallback(async (path: string, body?: unknown) => {
    setBusy(true)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `galat ${res.status}`)
      }
    } catch (e) {
      const message = (e as Error).message
      setError(message)
      setLocalLogs((prev) => [{ ts: Date.now(), level: 'warn' as const, text: `aksi gagal: ${message}` }, ...prev].slice(0, 80))
      setActivityTab('log')
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * Tombol "Cek WS": memanggil /api/diagnostics, lalu menulis hasilnya ke log sistem.
   * Tujuannya supaya kelihatan apakah socket hidup, feed Binance mengalir, dan REST terjangkau.
   */
  const diagnose = useCallback(async () => {
    setDiagnosing(true)
    const lines: LogEntry[] = []
    const push = (level: LogEntry['level'], text: string) => lines.push({ ts: Date.now(), level, text })
    try {
      const t0 = performance.now()
      const res = await fetch('/api/diagnostics', { cache: 'no-store' })
      const d = (await res.json()) as Diagnostics
      const ms = Math.round(performance.now() - t0)

      push(
        d.ws.lastBroadcastAgoMs !== null && d.ws.lastBroadcastAgoMs < 4_000 ? 'info' : 'warn',
        `snapshot terakhir ${d.ws.lastBroadcastAgoMs ?? '—'} ms lalu`,
      )
      for (const key of ['future', 'spot'] as const) {
        const f = d.feed[key]
        const fresh = f.connected && (f.ageSec ?? 999) < 30
        push(
          fresh ? 'info' : 'warn',
          `feed ${key}: ${f.connected ? 'tersambung' : 'terputus'} via ${f.transport} · ${f.messages} pesan · terakhir ${f.ageSec ?? '—'} s${f.error ? ` · ${f.error}` : ''}`,
        )
      }
      for (const r of d.rest) push(r.ok ? 'info' : 'warn', `${r.name}: ${r.ok ? 'ok' : 'gagal'} ${r.ms} ms${r.error ? ` · ${r.error}` : ''}`)
      push('info', `live: ${d.live.historyMinutes}/${d.live.neededMinutes} menit · ${d.live.ticksPerSec} tx/dtk · hitung ${d.live.computeCount}x`)
      if (d.problems.length === 0) push('info', 'tidak ada masalah terdeteksi')
      else for (const p of d.problems) push('warn', p)
      // ringkasan ditaruh terakhir supaya setelah dibalik (terbaru di atas) tetap paling atas
      push('info', `cek ws: socket ${connection === 'live' ? 'terbuka' : connection} · ${d.ws.clients} klien · ${d.ws.snapshotsSent} snapshot · REST ${ms} ms`)
    } catch (e) {
      push('warn', `cek ws gagal: ${(e as Error).message}`)
    }
    setLocalLogs((prev) => [...lines.reverse(), ...prev].slice(0, 80))
    setActivityTab('log')
    setDiagnosing(false)
  }, [connection])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  const togglePower = useCallback(() => {
    if (!snapshot) return
    void post('/api/system', { enabled: !snapshot.enabled })
  }, [post, snapshot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'p' || e.key === 'P') togglePower()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePower])

  if (!snapshot) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <div className="num mx-auto mb-3 grid h-10 w-10 place-items-center border border-line bg-panel text-[12px] font-semibold">
            S6
          </div>
          <p className="text-[12px] text-mute">menyambung ke server simulasi…</p>
          <p className="mt-1 num text-[10px] text-dim">{connection}</p>
        </div>
      </div>
    )
  }

  const { bots, models, trading, market, live, mode } = snapshot
  const futuresDown = mode === 'live' && !snapshot.feed.future.connected

  return (
    <div className="min-h-screen bg-shell">
      <TopBar
        snapshot={snapshot}
        connection={connection}
        busy={busy}
        diagnosing={diagnosing}
        onDiagnose={() => void diagnose()}
        onTogglePower={togglePower}
        onSetMode={(m: Mode) => void post('/api/mode', { mode: m })}
      />
      <StatusStrip
        snapshot={snapshot}
        busy={busy}
        onReplay={(action, value) => void post('/api/replay', { action, value })}
      />

      {(futuresDown || (!live.ready && mode === 'live')) && (
        <div className="border-b border-amber/25 bg-amber/5">
          <div className="mx-auto flex max-w-[1720px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 lg:px-5">
            <span className="label text-[9px] text-amber">{futuresDown ? 'peringatan' : 'pemanasan'}</span>
            <span className="text-[11px] text-mute">
              {futuresDown
                ? 'data futures Binance tidak tersambung. Model butuh futures + spot sekaligus (basis, dom_gap), jadi sinyal tidak dihitung sampai keduanya masuk.'
                : `mengumpulkan ${live.neededMinutes} menit histori pertama (ret_240 + urutan GRU). Data tersimpan, jadi restart tidak mengulang dari nol.`}
            </span>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1720px] space-y-3 px-3 py-3 lg:px-5">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 space-y-3 xl:col-span-8">
            <EquityChart bots={bots} label={mode === 'replay' ? 'data validasi historis' : 'modal awal 1.000.000 / bot'} />
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {bots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  model={models.find((m) => m.name === bot.model)}
                  trading={trading}
                  marketPrice={market.price}
                  busy={busy}
                  onReset={(id) => {
                    if (window.confirm(`Reset ${bot.model} ke modal awal 1.000.000? Riwayat trade dan statistik (trade/win/kalah/dd/pf) model ini akan dikosongkan.`)) {
                      void post('/api/bots/reset-one', { id })
                    }
                  }}
                  onNeutralize={(id) => void post('/api/bots/neutral', { id })}
                />
              ))}
            </div>
          </div>

          <div className="col-span-12 space-y-3 xl:col-span-4">
            <MarketFlow snapshot={snapshot} />
            <ModelMatrix models={models} />
            <ActivityPanel snapshot={snapshot} extraLogs={localLogs} tab={activityTab} onTab={setActivityTab} />
          </div>
        </div>

        <TradeBlotter
          trades={snapshot.trades}
          trading={trading}
          busy={busy}
          onReset={() => {
            if (window.confirm(`Reset semua model ${mode === 'replay' ? 'replay' : 'live'} ke modal awal? Riwayat trade dan statistik (trade/win/kalah/dd/pf) semua model dikosongkan.`)) {
              void post('/api/bots/reset')
            }
          }}
        />

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 pb-6">
          <span className="label text-[8.5px]">sumber</span>
          <span className="text-[10px] text-dim">
            Binance WebSocket · {market.symbol} futures <span className="num">aggTrade</span> + spot{' '}
            <span className="num">trade</span>
          </span>
          <span className="num text-[10px] text-dim">
            model v{live.modelVersion} · {dayMonth(Date.parse(live.modelCreatedUtc))} · {snapshot.models.length} model ·{' '}
            {snapshot.live.dominancePct}% × {snapshot.live.streak}
          </span>
          <span className="num text-[10px] text-dim">
            modal {money(trading.CAPITAL)} / bot · lev {trading.LEVERAGE}× · horizon {trading.HORIZON_MIN} mnt
          </span>
          <span className="ml-auto text-[10px] text-dim">
            paper trading — tidak ada order nyata.{' '}
            <span className="num text-mute">[P]</span> aktif/mati · server {hhmm(snapshot.serverTime)}
          </span>
        </footer>
      </main>

      {error && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-short/40 bg-[#1a1113] px-3 py-2">
          <span className="text-[11px] text-short">{error}</span>
        </div>
      )}
    </div>
  )
}

/** Arus transaksi pasar: porsi BUY jendela 50 transaksi + rangkaian dominasi. */
function MarketFlow({ snapshot }: { snapshot: Snapshot }) {
  const rows = [
    { key: 'future' as const, label: 'futures', buyPct: snapshot.market.buyPct.future, run: snapshot.market.run.future },
    { key: 'spot' as const, label: 'spot', buyPct: snapshot.market.buyPct.spot, run: snapshot.market.run.spot },
  ]

  return (
    <section className="border border-line bg-panel">
      <div className="flex items-baseline gap-2 border-b border-line/70 px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight">Arus transaksi</h2>
        <span className="label text-[9px]">jendela 50 transaksi</span>
        <span className="ml-auto num text-[10px] text-dim">{snapshot.live.dominancePct}% × {snapshot.live.streak}</span>
      </div>

      <div className="divide-y divide-line/50">
        {rows.map((row) => {
          const buy = Math.min(100, Math.max(0, row.buyPct))
          const hot = Math.abs(buy - 50) >= snapshot.live.dominancePct - 50
          return (
            <div key={row.key} className="px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="label text-[9px]">{row.label}</span>
                <span className={`num text-[11px] ${hot ? (buy >= 50 ? 'text-long' : 'text-short') : 'text-mute'}`}>
                  buy {buy.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 flex h-[4px] w-full overflow-hidden bg-line">
                <div className="h-full bg-long/80" style={{ width: `${buy}%` }} />
                <div className="h-full bg-short/80" style={{ width: `${100 - buy}%` }} />
              </div>
              <div className="mt-1 flex justify-between">
                <span className="num text-[9px] text-dim">
                  rangkaian beli {row.run.b} · jual {row.run.s}
                </span>
                <span className={`num text-[9px] ${snapshot.feed[row.key].connected ? 'text-dim' : 'text-short'}`}>
                  {snapshot.feed[row.key].connected ? `${snapshot.feed[row.key].messages.toLocaleString('id-ID')} tick` : 'terputus'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-line/70 px-3 py-1.5">
        <span className="label text-[8.5px]">harga</span>
        <span className="num text-[11px] text-ink">{marketLast(snapshot)}</span>
        <span className={`num text-[10px] ${pnlClass(snapshot.market.changePct ?? 0)}`}>
          {snapshot.market.changePct === null ? '—' : `${pct(snapshot.market.changePct)} 24j`}
        </span>
      </div>
    </section>
  )
}

function marketLast(snapshot: Snapshot): string {
  const p = snapshot.market.price
  return Number.isFinite(p) && p > 0 ? p.toFixed(2) : '—'
}
