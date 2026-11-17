import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { config } from '../config'
import { metrics, noteApiError, noteSnapshot } from '../metrics'
import type { Mode } from './contract'
import type { SimulationRuntime } from '../runtime'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json',
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  })
}

interface WsClient {
  send(data: string): void
}

/**
 * Server HTTP + WebSocket. Semua perubahan status dikirim ke UI lewat /ws
 * (satu pesan snapshot utuh, ±2 detik sekali + segera setelah ada kejadian).
 */
export function startServer(runtime: SimulationRuntime) {
  const clients = new Set<WsClient>()

  runtime.subscribe((snapshot) => {
    if (!clients.size) return
    const payload = JSON.stringify({ type: 'snapshot', data: snapshot })
    noteSnapshot()
    for (const ws of clients) {
      try {
        ws.send(payload)
      } catch {
        clients.delete(ws)
      }
    }
  })

  const serveStatic = async (pathname: string): Promise<Response | null> => {
    if (!existsSync(config.webDist)) return null
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '')
    const file = join(config.webDist, rel)
    if (!file.startsWith(config.webDist)) return null
    if (existsSync(file) && !file.endsWith('/')) {
      const bunFile = Bun.file(file)
      if (await bunFile.exists()) {
        return new Response(bunFile, { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } })
      }
    }
    // SPA fallback
    const index = Bun.file(join(config.webDist, 'index.html'))
    if (await index.exists()) return new Response(index, { headers: { 'content-type': MIME['.html'] } })
    return null
  }

  return Bun.serve<{ id: string }>({
    port: config.port,
    hostname: config.hostname,
    idleTimeout: 60,

    async fetch(req, server) {
      const url = new URL(req.url)
      const { pathname } = url
      metrics.apiRequests++

      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

      if (pathname === '/ws') {
        const ok = server.upgrade(req, { data: { id: crypto.randomUUID() } })
        return ok ? undefined : json({ error: 'websocket upgrade gagal' }, 400)
      }

      if (pathname === '/api/health') {
        const feed = runtime.feed.getStatus()
        const btcFeed = runtime.btcFeed.getStatus()
        const feeds = [feed.future, feed.spot, btcFeed.btcFuture, btcFeed.btcSpot]
        return json({
          ok: true,
          uptimeSec: Math.round((Date.now() - runtime.startedAt) / 1000),
          mode: runtime.mode,
          enabled: runtime.enabled,
          models: runtime.models.bundle.manifest.models.length,
          modelVersion: runtime.models.bundle.manifest.version,
          live: runtime.live.status,
          feed,
          btcFeed,
          feedsConnected: feeds.filter((f) => f.connected).length,
          feedsTotal: feeds.length,
        })
      }

      if (pathname === '/api/snapshot') return json(runtime.snapshot())

      // ringan untuk aplikasi mobile: harga + sinyal terbaru (tanpa bot/trade/log penuh)
      if (pathname === '/api/signals') return json(runtime.signalFeed())

      if (pathname === '/api/diagnostics') return json(await runtime.diagnostics())

      if (pathname === '/api/trades') {
        const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 100) || 100)
        const bot = url.searchParams.get('bot')
        const all = runtime.activeBots.allTrades(2000).map((t) => ({ ...t }))
        const filtered = bot ? all.filter((t) => t.botId === bot || t.model === bot) : all
        return json({ trades: filtered.slice(0, limit), total: filtered.length })
      }

      if (pathname === '/api/models') {
        const m = runtime.models.bundle.manifest
        return json({
          version: m.version,
          createdUtc: m.created_utc,
          symbol: m.symbol,
          bestModel: m.best_model,
          features: m.features.length,
          signalRule: m.signal_rule ?? null,
          models: m.models,
        })
      }

      if (pathname.startsWith('/api/') && req.method === 'POST') {
        let body: Record<string, unknown> = {}
        try {
          body = (await req.json()) as Record<string, unknown>
        } catch {
          body = {}
        }

        if (pathname === '/api/system') {
          const enabled = Boolean(body.enabled)
          return json({ enabled: runtime.setEnabled(enabled) })
        }

        if (pathname === '/api/mode') {
          const mode = body.mode === 'replay' ? 'replay' : body.mode === 'live' ? 'live' : null
          if (!mode) return json({ error: "mode harus 'live' atau 'replay'" }, 400)
          return json({ mode: runtime.setMode(mode as Mode), replay: runtime.replay?.status ?? null })
        }

        if (pathname === '/api/replay') {
          const action = String(body.action ?? '') as 'play' | 'pause' | 'reset' | 'speed' | 'seek'
          const value = typeof body.value === 'number' ? body.value : undefined
          const status = runtime.replayAction(action, value)
          if (!status) return json({ error: 'replay hanya tersedia di mode replay' }, 400)
          return json({ replay: status })
        }

        if (pathname === '/api/bots/reset') {
          runtime.resetBots(runtime.mode)
          return json({ ok: true })
        }

        // Aplikasi memanggil ini saat Automation ON: semua model kembali netral
        // (posisi/entry tertunda ditutup) tanpa mengubah modal atau statistik.
        if (pathname === '/api/bots/neutralize-all') {
          return json({ ok: true, ...runtime.neutralizeAllBots() })
        }

        if (pathname === '/api/bots/reset-one' || pathname === '/api/bots/neutral') {
          const id = typeof body.id === 'string' ? body.id : ''
          if (!id) return json({ error: 'id bot wajib diisi' }, 400)
          const ok = pathname.endsWith('/reset-one') ? runtime.resetBot(id) : runtime.neutralizeBot(id)
          if (!ok) return json({ error: 'bot tidak ditemukan' }, 404)
          return json({ ok: true })
        }

        if (pathname === '/api/feed/reconnect') {
          runtime.restartFeed()
          return json({ ok: true })
        }

        if (pathname === '/api/models/reload') {
          return json({ ok: true, ...runtime.reloadModels() })
        }

        return json({ error: 'endpoint tidak dikenal' }, 404)
      }

      if (pathname.startsWith('/api/')) {
        noteApiError(`404 ${pathname}`)
        return json({ error: 'endpoint tidak dikenal' }, 404)
      }

      const asset = await serveStatic(pathname)
      if (asset) return asset

      return new Response(
        `Simulasi berjalan. UI belum dibangun.\n\n` +
          `Jalankan: bun run dev (mode pengembangan) atau bun run build lalu buka http://localhost:${config.port}\n` +
          `API: /api/health, /api/snapshot, /api/trades, /ws\n`,
        { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
      )
    },

    websocket: {
      open(ws) {
        clients.add(ws)
        metrics.wsClients = clients.size
        metrics.wsPeak = Math.max(metrics.wsPeak, clients.size)
        ws.send(JSON.stringify({ type: 'snapshot', data: runtime.snapshot() }))
      },
      message(ws, raw) {
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
        if (text === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }))
      },
      close(ws) {
        clients.delete(ws)
        metrics.wsClients = clients.size
      },
    },
  })
}
