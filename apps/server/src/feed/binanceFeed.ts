import { config } from '../config'
import type { FeedMarket, MarketKey, TradeTick } from '../core/types'
import { ensureTunnel, fetchJson } from './net'

export interface MarketStatus {
  connected: boolean
  lastMessageTs: number
  lastPrice: number
  error: string | null
  reconnects: number
  messages: number
  /** jalur yang dipakai: langsung, terowongan DNS, atau gagal total */
  transport: 'direct' | 'tunnel' | 'blocked'
}

type Handler<M extends FeedMarket> = (market: M, tick: TradeTick) => void

interface StreamSpec<M extends FeedMarket> {
  market: M
  stream: string
  rest: string
  url: string
  fallbackUrl?: string
}

/**
 * Koneksi data Binance langsung: satu WebSocket untuk futures (aggTrade) dan satu untuk
 * spot/trade. Menyambung ulang otomatis dengan jeda bertahap, plus isi awal 50 transaksi
 * dari REST supaya jendela dominasi langsung terisi.
 *
 * Generik atas daftar pasar: feed SOL memakai `future/spot`, feed BTC memakai
 * `btcFuture/btcSpot` (hanya untuk fitur, tidak pernah dipakai order).
 */
export class BinanceFeed<M extends FeedMarket = MarketKey> {
  private sockets = new Map<M, WebSocket>()
  private watchdog: Timer | null = null
  private stopped = true
  private attempt = new Map<M, number>()
  private status = new Map<M, MarketStatus>()
  private handlers: Handler<M>[] = []
  private statusHandlers: ((s: Record<M, MarketStatus>) => void)[] = []

  constructor(
    private readonly symbol = config.symbol,
    private readonly markets: readonly M[] = ['future', 'spot'] as M[],
  ) {
    for (const m of markets) {
      this.status.set(m, {
        connected: false,
        lastMessageTs: 0,
        lastPrice: 0,
        error: null,
        reconnects: 0,
        messages: 0,
        transport: 'direct',
      })
    }
  }

  onTick(fn: Handler<M>): void {
    this.handlers.push(fn)
  }

  onStatus(fn: (s: Record<M, MarketStatus>) => void): void {
    this.statusHandlers.push(fn)
  }

  getStatus(): Record<M, MarketStatus> {
    const out = {} as Record<M, MarketStatus>
    for (const m of this.markets) out[m] = this.status.get(m)!
    return out
  }

  private spec(market: M): StreamSpec<M> {
    const s = this.symbol.toLowerCase()
    const futures = market === 'future' || market === 'btcFuture'
    return futures
      ? {
          market,
          stream: `${s}@aggTrade`,
          rest: `${config.future.rest}/fapi/v1/trades?symbol=${this.symbol}&limit=50`,
          url: `${config.future.ws}/${s}@aggTrade`,
          fallbackUrl: `wss://fstream.binance.com/ws/${s}@aggTrade`,
        }
      : {
          market,
          stream: `${s}@trade`,
          rest: `${config.spot.rest}/api/v3/trades?symbol=${this.symbol}&limit=50`,
          url: `${config.spot.ws}/${s}@trade`,
          fallbackUrl: `wss://stream.binance.com:9443/ws/${s}@trade`,
        }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    for (const m of this.markets) void this.connect(m)
    this.watchdog = setInterval(() => this.check(), 5_000)
  }

  stop(): void {
    this.stopped = true
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    for (const ws of this.sockets.values()) {
      try {
        ws.close()
      } catch {
        /* sudah tertutup */
      }
    }
    this.sockets.clear()
  }

  private report(): void {
    const s = this.getStatus()
    for (const fn of this.statusHandlers) fn(s)
  }

  private check(): void {
    const now = Date.now()
    for (const [market, st] of this.status) {
      if (!st.connected) continue
      // pasar sunyi sesaat itu normal; 90 dtk tanpa pesan berarti koneksi macet
      if (st.lastMessageTs && now - st.lastMessageTs > 90_000) {
        st.error = 'tidak ada data 90 detik — menyambung ulang'
        this.report()
        this.reconnect(market)
      }
    }
  }

  private reconnect(market: M): void {
    const ws = this.sockets.get(market)
    this.sockets.delete(market)
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    const st = this.status.get(market)!
    st.connected = false
    this.report()
    if (!this.stopped) {
      const n = (this.attempt.get(market) ?? 0) + 1
      this.attempt.set(market, n)
      const wait = Math.min(1000 * 2 ** Math.min(n, 5), 30_000)
      setTimeout(() => {
        if (!this.stopped) void this.connect(market)
      }, wait)
    }
  }

  private async connect(market: M): Promise<void> {
    if (this.stopped) return
    const spec = this.spec(market)
    const st = this.status.get(market)!
    const attempt = this.attempt.get(market) ?? 0
    const url = attempt >= 3 && spec.fallbackUrl ? spec.fallbackUrl : spec.url
    const target = new URL(url)
    const host = target.hostname

    // isi awal dari REST berjalan paralel dengan WebSocket
    void this.seed(spec)

    let ws: WebSocket
    let opened = false
    const useTunnel = st.transport === 'tunnel'
    try {
      if (useTunnel) {
        // DNS ISP membelokkan host: sambung ke terowongan lokal (SNI + Host tetap asli)
        const port = await ensureTunnel(host)
        ws = new WebSocket(`ws://127.0.0.1:${port}${target.pathname}`, {
          headers: { host },
        } as unknown as string[])
      } else {
        ws = new WebSocket(url)
      }
    } catch (e) {
      st.error = `gagal membuka WebSocket: ${(e as Error).message}`
      this.report()
      this.reconnect(market)
      return
    }
    this.sockets.set(market, ws)

    ws.onopen = () => {
      opened = true
      st.connected = true
      // status transport harus mengikuti jalur yang benar-benar berhasil; dulu
      // nilai 'blocked' dari kegagalan sebelumnya menempel walau data sudah mengalir.
      st.transport = useTunnel ? 'tunnel' : 'direct'
      st.error = null
      st.reconnects++
      this.attempt.set(market, 0)
      this.report()
    }
    ws.onmessage = (ev) => {
      try {
        const o = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as {
          p?: string
          q?: string
          T?: number
          E?: number
          m?: boolean
        }
        if (typeof o.p !== 'string' || typeof o.q !== 'string') return
        const price = Number(o.p)
        const base = Number(o.q)
        if (!Number.isFinite(price) || !Number.isFinite(base)) return
        const ts = typeof o.T === 'number' ? o.T : (o.E ?? Date.now())
        const tick: TradeTick = {
          ts,
          price,
          qty: Math.round(price * base * 100) / 100,
          isBuy: o.m !== true,
        }
        st.lastMessageTs = Date.now()
        st.lastPrice = price
        st.messages++
        for (const fn of this.handlers) fn(market, tick)
      } catch {
        /* pesan lain (konfirmasi langganan dsb.) diabaikan */
      }
    }
    ws.onerror = () => {
      st.error = st.error ?? 'kesalahan koneksi'
    }
    ws.onclose = () => {
      if (this.stopped) return
      st.connected = false

      if (!opened && st.transport !== 'tunnel') {
        // jalur langsung gagal (biasanya DNS dibelokkan ISP) -> coba terowongan
        st.transport = 'tunnel'
        st.error = 'jalur langsung gagal — mencoba terowongan DNS'
        this.report()
        this.sockets.delete(market)
        setTimeout(() => {
          if (!this.stopped) void this.connect(market)
        }, 300)
        return
      }
      if (!opened) {
        st.transport = 'blocked'
        st.error = st.error ?? 'tidak bisa tersambung (langsung & terowongan gagal)'
      }
      if (!st.error) st.error = 'koneksi terputus'
      this.report()
      this.reconnect(market)
    }
  }

  private async seed(spec: StreamSpec<M>): Promise<void> {
    try {
      const arr = await fetchJson<{ price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(spec.rest, 12_000)
      const ticks: TradeTick[] = []
      for (const o of arr) {
        const price = Number(o.price)
        const qty = Math.round(price * Number(o.qty) * 100) / 100
        if (!Number.isFinite(price) || !Number.isFinite(qty)) continue
        ticks.push({ ts: o.time, price, qty, isBuy: o.isBuyerMaker === false })
      }
      ticks.sort((a, b) => a.ts - b.ts)
      for (const fn of this.seedHandlers) fn(spec.market, ticks)
    } catch {
      /* isi awal opsional; WebSocket tetap berjalan */
    }
  }

  private seedHandlers: ((market: M, ticks: TradeTick[]) => void)[] = []

  onSeed(fn: (market: M, ticks: TradeTick[]) => void): void {
    this.seedHandlers.push(fn)
  }
}
