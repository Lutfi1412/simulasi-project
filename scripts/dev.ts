/**
 * Mode pengembangan: server Bun (PORT, default 8080) + Vite dev server (5173).
 * Vite mem-proxy /api dan /ws ke server, jadi UI bisa hot-reload tanpa build ulang.
 *
 *   bun run dev              -> hanya localhost
 *   bun run dev -- --host    -> bisa dibuka dari HP di jaringan yang sama (LAN)
 */
import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const isWindows = process.platform === 'win32'
// 8081 dipakai dev supaya tidak berebut port dengan container Docker di 8080
const port = process.env.PORT ?? '8081'

const args = process.argv.slice(2)
const expose = args.includes('--host') || args.includes('-H') || args.includes('--lan')
// nilai host opsional: --host 0.0.0.0 (default kalau hanya --host)
const hostIndex = args.findIndex((a) => a === '--host' || a === '-H')
const hostValue =
  hostIndex >= 0 && args[hostIndex + 1] && !args[hostIndex + 1].startsWith('-') ? args[hostIndex + 1] : '0.0.0.0'

/** daftar IPv4 non-loopback untuk mencetak URL yang bisa dibuka dari HP */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address} (${name})`)
    }
  }
  return out
}

/** cek port kosong sebelum menyalakan server, supaya tidak bentrok dengan container Docker */
function portBusy(p: number): Promise<boolean> {
  // Windows mengizinkan dua proses bind port yang sama bila beda address family
  // (Docker di ::, Bun di 0.0.0.0), jadi bind-probe tidak cukup — cek dengan connect.
  return new Promise((done) => {
    const socket = connect({ port: p, host: '127.0.0.1' })
    const finish = (busy: boolean) => {
      socket.destroy()
      done(busy)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

if (await portBusy(Number(port))) {
  console.error(
    `\n  Port ${port} sudah dipakai — biasanya container Docker "simulasi-6-model" sedang jalan.\n` +
      `  Pilih salah satu:\n` +
      `    docker stop simulasi-6-model     lalu jalankan ulang\n` +
      `    PORT=8081 bun run dev -- --host  (dev di port lain)\n`,
  )
  process.exit(1)
}

const server = Bun.spawn(['bun', '--watch', 'apps/server/src/index.ts'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, PORT: port, HOST: expose ? hostValue : (process.env.HOST ?? '0.0.0.0') },
})

const viteArgs = ['run', '--cwd', 'apps/web', 'dev']
if (expose) viteArgs.push('--', '--host', hostValue)

const web = Bun.spawn(['bun', ...viteArgs], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, API_TARGET: `http://localhost:${port}` },
})

if (expose) {
  setTimeout(() => {
    const list = lanAddresses()
    console.log('\n  Buka dari HP (jaringan Wi-Fi yang sama):')
    for (const entry of list) {
      const ip = entry.split(' ')[0]
      console.log(`    http://${ip}:5173   ← UI dev (hot reload)`)
    }
    console.log(`    API: http://${list[0]?.split(' ')[0] ?? '<ip>'}:${port}/api/health\n`)
  }, 2_500)
}

const shutdown = () => {
  server.kill()
  web.kill()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
if (isWindows) process.on('SIGBREAK', shutdown)

await Promise.all([server.exited, web.exited])
