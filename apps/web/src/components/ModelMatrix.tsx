import type { ModelView } from '../../../server/src/api/contract'
import { kindStyle, pct, pnlClass, prob, sideClass, sideLabel } from '../lib/format'

interface ModelMatrixProps {
  models: ModelView[]
}

/** Tabel ringkas: probabilitas & sinyal tiap model pada menit terakhir. */
export function ModelMatrix({ models }: ModelMatrixProps) {
  const avg = (m: ModelView) => m.roiFolds.reduce((a, b) => a + b, 0) / (m.roiFolds.length || 1)
  const best = models.reduce<ModelView | null>((acc, m) => (!acc || avg(m) > avg(acc) ? m : acc), null)

  return (
    <section className="border border-line bg-panel">
      <div className="flex items-baseline gap-2 border-b border-line/70 px-3 py-2">
        <h2 className="text-[12px] font-semibold tracking-tight">Matriks model</h2>
        <span className="label text-[9px]">menit terakhir</span>
        <span className="ml-auto label text-[9px]">validasi walk-forward</span>
      </div>

      <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left">
            <th className="label px-2 py-1.5 text-[8.5px] font-medium sm:px-3">model</th>
            <th className="label px-1 py-1.5 text-[8.5px] font-medium">sinyal</th>
            <th className="label px-1 py-1.5 text-right text-[8.5px] font-medium">long</th>
            <th className="label px-1 py-1.5 text-right text-[8.5px] font-medium">short</th>
            <th className="label hidden px-1 py-1.5 text-right text-[8.5px] font-medium sm:table-cell">θ</th>
            <th className="label px-2 py-1.5 text-right text-[8.5px] font-medium sm:px-3">v1 / v2 / v3</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const style = kindStyle(m.kind)
            return (
              <tr key={m.name} className="border-t border-line/50 hover:bg-raise/40">
                <td className="max-w-[110px] px-2 py-1.5 sm:max-w-none sm:px-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-[10px] w-[2px] shrink-0" style={{ background: style.hex }} aria-hidden />
                    <span className={`truncate text-[11px] ${m.available ? 'text-ink' : 'text-dim'}`}>{m.name}</span>
                    {best && best.name === m.name && (
                      <span className="border border-amber/40 bg-amber/10 px-1 text-[8px] font-semibold uppercase tracking-wide text-amber">
                        terbaik
                      </span>
                    )}
                  </div>
                </td>
                <td className={`num px-1 py-1.5 text-[10px] ${sideClass(m.signal)}`}>
                  {m.available ? sideLabel(m.signal) : '—'}
                </td>
                <td className="num px-1 py-1.5 text-right text-[10px] text-long">{m.available ? prob(m.p[1]) : '—'}</td>
                <td className="num px-1 py-1.5 text-right text-[10px] text-short">{m.available ? prob(m.p[2]) : '—'}</td>
                <td className="num hidden px-1 py-1.5 text-right text-[10px] text-dim sm:table-cell">{m.theta.toFixed(2)}</td>
                <td className="px-2 py-1.5 sm:px-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {m.roiFolds.map((r, i) => (
                      <span key={i} className={`num text-[10px] ${pnlClass(r)}`} title={`lipatan V${i + 1}`}>
                        {pct(r, 0)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </section>
  )
}
