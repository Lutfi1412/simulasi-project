import { config } from './config'
import { startServer } from './api/server'
import { SimulationRuntime } from './runtime'

const runtime = new SimulationRuntime()
const booted = runtime.start()
const server = startServer(runtime)

const host = config.hostname === '0.0.0.0' ? 'localhost' : config.hostname
console.log('')
console.log('  SIMULASI 6 MODEL — SOLUSDT FUTURES')
console.log('  ─────────────────────────────────────────────')
console.log(`  UI / API   http://${host}:${config.port}`)
console.log(`  WebSocket  ws://${host}:${config.port}/ws`)
console.log(`  Mode       ${runtime.mode} | sistem ${runtime.enabled ? 'ON' : 'OFF'}`)
console.log(`  Konteks    ${runtime.models.bundle.manifest.btc_symbol ?? config.btcSymbol} (fitur btc_*, bukan order)`)
console.log(`  Model      v${runtime.models.bundle.manifest.version} · ${runtime.models.bundle.manifest.models.length} model · ${runtime.models.bundle.manifest.features.length} fitur`)
console.log(`  Modal      ${runtime.models.bundle.manifest.trading.CAPITAL.toLocaleString('id-ID')} per bot · ${runtime.models.bundle.manifest.trading.LEVERAGE}x`)
console.log(
  `  Histori    futures ${booted.history.future} · spot ${booted.history.spot} · BTC futures ${booted.history.btcFuture} · BTC spot ${booted.history.btcSpot} menit · ${booted.restored} bot dipulihkan`,
)
if (!runtime.live.status.ready) {
  const live = runtime.live.status
  const pct = ((live.historyMinutes / live.neededMinutes) * 100).toFixed(1)
  console.log(
    `  Pemanasan  ${live.historyMinutes}/${live.neededMinutes} menit (${pct}%) — siap ±${Math.round(live.pendingMinutes)} menit lagi`,
  )
}
console.log('')

const shutdown = (signal: string) => {
  console.log(`\n[${signal}] menutup simulasi...`)
  runtime.stop()
  server.stop(true)
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
