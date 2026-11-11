import { useMemo, useState } from 'react'
import type { TradeView, TradingView } from '../../../server/src/api/contract'
import { compact, hhmmss, money, pct, pnlClass, price, reasonLabel, sideClass, sideLabel, spanMinutes } from '../lib/format'

interface TradeBlotterProps {
  trades: TradeView[]
  trading: TradingView
  busy: boolean
  onReset: () => void
}

/**
 * Kolom buku transaksi. `mobile: false` = disembunyikan di layar < 640px supaya
 * enam kolom inti (waktu, model, arah, alasan, pnl, roi) tetap terbaca tanpa
 * menggeser tabel ke samping.
 */
const COLS = [
  { key: 'waktu', label: 'waktu', right: false },
  { key: 'model', label: 'model', right: false },
  { key: 'arah', label: 'arah', right: false },
  { key: 'masuk', label: 'masuk', right: true, mobile: false },
  { key: 'keluar', label: 'keluar', right: true, mobile: false },
  { key: 'alasan', label: 'alasan', right: true },
  { key: 'durasi', label: 'durasi', right: true, mobile: false },
  { key: 'pnl', label: 'pnl', right: true },
  { key: 'roi', label: 'roi', right: true },
  { key: 'ekuitas', label: 'ekuitas', right: true, mobile: false },
] as const

export function TradeBlotter({ trades, trading, busy, onReset }: TradeBlotterProps) {
  const [model, setModel] = useState('semua')
  const models = useMemo(() => Array.from(new Set(trades.map((t) => t.model))), [trades])
  const rows = model === 'semua' ? trades : trades.filter((t) => t.model === model)

  const wins = rows.filter((t) => t.pnl > 0).length
  const realized = rows.reduce((a, t) => a + t.pnl, 0)
  const winRate = rows.length ? (wins / rows.length) * 100 : 0

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight">Buku transaksi</h2>
        <span className="label text-[9px]">terbaru</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="num text-[10px] text-dim">
            {rows.length} trade · win {winRate.toFixed(0)}% ·{' '}
            <span className={pnlClass(realized)}>{compact(realized)}</span>
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="max-w-[140px] border border-line bg-raise px-1.5 py-1 text-[10px] text-mute outline-none"
            aria-label="filter model"
          >
            <option value="semua">semua model</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            className="border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-dim hover:border-short/40 hover:text-short disabled:opacity-40"
            title="kembalikan keenam bot ke modal awal"
          >
            reset
          </button>
        </div>
      </div>

      <div className="max-h-[260px] overflow-x-auto overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`label border-b border-line px-1.5 py-1.5 text-[8.5px] font-medium sm:px-2 ${
                    c.right ? 'text-right' : 'text-left'
                  } ${'mobile' in c && c.mobile === false ? 'hidden sm:table-cell' : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-[11px] text-dim">
                  belum ada transaksi. bot membuka posisi setelah sinyal pertama muncul.
                </td>
              </tr>
            ) : (
              rows.map((t) => (
                <tr key={t.id} className="border-b border-line/40 hover:bg-raise/40">
                  <td className="num px-1.5 py-1 text-[10px] text-dim sm:px-2">{hhmmss(t.exitTs)}</td>
                  <td className="max-w-[92px] truncate px-1.5 py-1 text-[10px] text-mute sm:max-w-[130px] sm:px-2 sm:text-[10.5px]">{t.model}</td>
                  <td className={`num px-1.5 py-1 text-[10px] font-semibold sm:px-2 ${sideClass(t.side)}`}>{sideLabel(t.side)}</td>
                  <td className="num hidden px-1.5 py-1 text-right text-[10px] text-mute sm:table-cell sm:px-2">{price(t.entry)}</td>
                  <td className="num hidden px-1.5 py-1 text-right text-[10px] text-mute sm:table-cell sm:px-2">{price(t.exit)}</td>
                  <td className={`px-1.5 py-1 text-right text-[10px] sm:px-2 ${t.reason === 'tp' ? 'text-long' : t.reason === 'sl' || t.reason === 'liq' ? 'text-short' : 'text-dim'}`}>
                    {reasonLabel[t.reason] ?? t.reason}
                  </td>
                  <td className="num hidden px-1.5 py-1 text-right text-[10px] text-dim sm:table-cell sm:px-2">{spanMinutes(t.bars)}</td>
                  <td className={`num px-1.5 py-1 text-right text-[10px] sm:px-2 ${pnlClass(t.pnl)}`} title={money(t.pnl)}>
                    {compact(t.pnl)}
                  </td>
                  <td className={`num px-1.5 py-1 text-right text-[10px] sm:px-2 ${pnlClass(t.roiPct)}`}>{pct(t.roiPct, 1)}</td>
                  <td className="num hidden px-1.5 py-1 text-right text-[10px] text-mute sm:table-cell sm:px-2">{compact(t.equityAfter)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 px-3 py-1.5">
        <span className="label text-[8.5px]">biaya</span>
        <span className="num text-[10px] text-dim">
          fee {trading.FEE_TAKER * 100}% · slippage {trading.SLIPPAGE * 100}% · funding {trading.FUNDING_8H * 100}%/8j
        </span>
        <span className="num ml-auto text-[10px] text-dim">
          margin {(trading.POSITION_FRACTION * 100).toFixed(0)}% ekuitas · 100% (all-in) jika saldo ≤100.000
        </span>
      </div>
    </section>
  )
}
