import { resolve4 } from 'node:dns/promises'

/**
 * Beberapa ISP (termasuk di Indonesia) membelokkan DNS Binance ke halaman blokir,
 * sehingga `fetch`/WebSocket gagal walau jaringan sebenarnya bisa menjangkau Binance.
 *
 * Modul ini menyelesaikan nama host lewat DNS-over-HTTPS (Cloudflare) lalu:
 *  - REST: memanggil IP asli dengan SNI `tls.serverName` + header Host yang benar;
 *  - WebSocket: membuka terowongan TCP lokal (127.0.0.1) → TLS ke IP asli, dengan
 *    header Host pada handshake ditulis ulang.
 *
 * Semuanya opsional: kalau jaringan normal (VPS luar negeri, VPN), jalur langsung
 * dipakai lebih dulu dan modul ini tidak pernah aktif.
 */

const DOH = 'https://cloudflare-dns.com/dns-query'
const IP_TTL_MS = 10 * 60_000
const ipCache = new Map<string, { ip: string; at: number }>()

export type Transport = 'direct' | 'tunnel' | 'unknown'

export async function resolveIp(host: string): Promise<string | null> {
  const hit = ipCache.get(host)
  if (hit && Date.now() - hit.at < IP_TTL_MS) return hit.ip

  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(host)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const data = (await res.json()) as { Answer?: { type: number; data: string }[] }
      const a = data.Answer?.find((r) => r.type === 1)?.data
      if (a) {
        ipCache.set(host, { ip: a, at: Date.now() })
        return a
      }
    }
  } catch {
    /* coba jalur kedua */
  }

  try {
    const list = await resolve4(host)
    if (list.length) {
      ipCache.set(host, { ip: list[0], at: Date.now() })
      return list[0]
    }
  } catch {
    /* menyerah */
  }
  return null
}

const isCertError = (message: string) =>
  /certificate|altname|self.signed|ERR_TLS|unable to verify/i.test(message)

/** GET JSON; kalau jalur langsung gagal karena DNS/cert, ulangi lewat IP asli + SNI. */
export async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (directError) {
    const parsed = new URL(url)
    const ip = await resolveIp(parsed.hostname)
    if (!ip) throw directError
    const direct = parsed.host
    parsed.host = ip
    const res = await fetch(parsed.toString(), {
      headers: { host: direct },
      tls: { serverName: direct },
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit)
    if (!res.ok) throw new Error(`HTTP ${res.status} (via ${ip})`)
    return (await res.json()) as T
  }
}

interface TunnelState {
  up?: { write: (chunk: Uint8Array) => number; end: () => void }
  queue: Uint8Array[]
  pending: Buffer
  ready: boolean
}

const tunnels = new Map<string, Promise<number>>()

/** Terowongan TCP lokal ke host:443 lewat IP asli (SNI tetap nama host). */
export function ensureTunnel(host: string): Promise<number> {
  const existing = tunnels.get(host)
  if (existing) return existing

  const created = (async () => {
    const ip = await resolveIp(host)
    if (!ip) throw new Error(`tidak bisa menemukan IP ${host}`)

    const server = Bun.listen<TunnelState>({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(client) {
          const state: TunnelState = { queue: [], pending: Buffer.alloc(0), ready: false }
          client.data = state
          Bun.connect({
            hostname: ip,
            port: 443,
            tls: { serverName: host },
            socket: {
              open(up) {
                state.up = up as unknown as TunnelState['up']
                for (const chunk of state.queue.splice(0)) state.up!.write(chunk)
              },
              data(_up, chunk) {
                client.write(chunk)
              },
              drain() {},
              close() {
                try {
                  client.end()
                } catch {
                  /* sudah tertutup */
                }
              },
              error() {
                try {
                  client.end()
                } catch {
                  /* sudah tertutup */
                }
              },
            },
          }).catch(() => client.end())
        },

        data(client, chunk) {
          const state = client.data
          if (state.ready) {
            state.up?.write(chunk)
            return
          }
          // tulis ulang header Host pada permintaan pertama (handshake WS/HTTP)
          state.pending = Buffer.concat([state.pending, Buffer.from(chunk)])
          const end = state.pending.indexOf('\r\n\r\n')
          if (end === -1) return
          const head = rewriteHost(state.pending.subarray(0, end).toString('latin1'), host)
          const rest = state.pending.subarray(end + 4)
          state.ready = true
          const out = Buffer.concat([Buffer.from(`${head}\r\n\r\n`, 'latin1'), rest])
          if (state.up) state.up.write(out)
          else state.queue.push(out)
        },

        close(client) {
          try {
            client.data?.up?.end()
          } catch {
            /* sudah tertutup */
          }
        },
        error() {},
      },
    })

    return server.port as number
  })()

  tunnels.set(host, created)
  created.catch(() => tunnels.delete(host))
  return created
}

function rewriteHost(head: string, host: string): string {
  const lines = head.split('\r\n')
  const idx = lines.findIndex((l) => /^host:/i.test(l))
  if (idx >= 0) lines[idx] = `Host: ${host}`
  else lines.splice(1, 0, `Host: ${host}`)
  return lines.join('\r\n')
}

export function closeTunnels(): void {
  tunnels.clear()
}

export { isCertError }
