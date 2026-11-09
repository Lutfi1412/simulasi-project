import { readFileSync } from 'node:fs'
import type { MinuteRow, SignalEvent } from '../../apps/server/src/core/types'

export function readCsv(path: string): { header: string[]; rows: string[][] } {
  const text = readFileSync(path, 'utf8').replace(/\r/g, '')
  const lines = text.split('\n').filter((l) => l.length > 0)
  const header = lines[0].split(',')
  const rows = lines.slice(1).map((l) => l.split(','))
  return { header, rows }
}

const numOr = (s: string | undefined): number => {
  if (s === undefined || s === '') return Number.NaN
  const v = Number(s)
  return Number.isFinite(v) ? v : Number.NaN
}

/** Baca CSV menit dan bersihkan seperti read_minute() di notebook. */
export function loadMinuteCsv(path: string): Map<number, MinuteRow> {
  const { header, rows } = readCsv(path)
  const col = (name: string) => header.indexOf(name)
  const iTs = col('ts')
  const iO = col('open')
  const iH = col('high')
  const iL = col('low')
  const iC = col('close')
  const runT = header
    .filter((h) => h.startsWith('run_b') && /^run_b\d+$/.test(h))
    .map((h) => Number(h.slice(5)))
    .sort((a, b) => a - b)

  const byTs = new Map<number, MinuteRow>()
  for (const r of rows) {
    const ts = numOr(r[iTs])
    const o = numOr(r[iO])
    const h = numOr(r[iH])
    const l = numOr(r[iL])
    const c = numOr(r[iC])
    if (![ts, o, h, l, c].every((v) => Number.isFinite(v) && v > 0)) continue
    const gt = (n: string) => numOr(r[col(n)])
    const row: MinuteRow = {
      ts,
      open: o,
      high: Math.max(h, o, c),
      low: Math.min(l, o, c),
      close: c,
      quoteVol: gt('quote_vol'),
      takerBuyQuote: gt('taker_buy_quote'),
      n: gt('n'),
      buyN: gt('buy_n'),
      maxTradeUsdt: gt('max_trade_usdt'),
      buyPctEnd: gt('buy_pct_end'),
      buyPctMean: gt('buy_pct_mean'),
      buyPctMin: gt('buy_pct_min'),
      buyPctMax: gt('buy_pct_max'),
      winN: gt('win_n'),
      winSec: gt('win_sec'),
      winRetPct: gt('win_ret_pct'),
      winRangePct: gt('win_range_pct'),
      vwapDevPct: gt('vwap_dev_pct'),
      ticks: gt('ticks'),
      src: gt('src'),
      runBuy: runT.map((t) => gt(`run_b${t}`)),
      runSell: runT.map((t) => gt(`run_s${t}`)),
      durBuy: runT.map((t) => gt(`dur_b${t}`)),
      durSell: runT.map((t) => gt(`dur_s${t}`)),
    }
    byTs.set(ts, row) // drop_duplicates(keep='last')
  }
  return byTs
}

export function loadSignalsCsv(path: string): SignalEvent[] {
  const { header, rows } = readCsv(path)
  const iTs = header.indexOf('ts')
  const iSide = header.indexOf('side')
  const iDom = header.indexOf('dom_pct')
  const out: SignalEvent[] = []
  for (const r of rows) {
    const ts = numOr(r[iTs])
    const side = numOr(r[iSide])
    if (!Number.isFinite(ts) || !Number.isFinite(side)) continue
    out.push({ ts, side: side > 0 ? 1 : -1, domPct: Number.isFinite(numOr(r[iDom])) ? numOr(r[iDom]) : 50 })
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

export function loadReplay(path: string): { columns: string[]; rows: (number | null)[][] } {
  return JSON.parse(readFileSync(path, 'utf8'))
}
