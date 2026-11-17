import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config'
import type { MinuteContext } from '../core/types'
import type { ModelRuntime } from '../models/runtime'
import type { BotManager } from '../sim/bot'

export interface ReplayData {
  columns: string[]
  rows: (number | null)[][]
}

export interface ReplayStatus {
  playing: boolean
  index: number
  total: number
  speed: number
  effectiveSpeed: number
  currentTs: number
  startTs: number
  endTs: number
  folds: { name: string; startIndex: number; ts: number }[]
}

/**
 * Pemutar ulang data validasi (replay.json) — semua model diuji pada data yang sama
 * dengan lipatan walk-forward notebook, lengkap dengan bar o/h/l/c asli.
 */
export class ReplaySource {
  readonly total: number
  private index = 0
  private playing = false
  private speed = 240
  private effectiveSpeed = 240
  private timer: Timer | null = null
  private lastStep = 0
  readonly startTs: number
  readonly endTs: number
  readonly folds: { name: string; startIndex: number; ts: number }[] = []
  private featureIndex = new Map<string, number>()
  private runColumns: string[] = []

  constructor(
    private readonly data: ReplayData,
    private readonly models: ModelRuntime,
    private readonly bots: BotManager,
    private readonly onRow: (ctx: MinuteContext) => void,
  ) {
    this.total = data.rows.length
    data.columns.forEach((c, i) => this.featureIndex.set(c, i))
    this.runColumns = data.columns.filter((c) => c.startsWith('run_b') || c.startsWith('run_s'))
    this.startTs = this.num('ts', 0)
    this.endTs = this.num('ts', this.total - 1)
    this.collectFolds()
  }

  /** Harga penutupan pada baris yang sedang diputar (untuk header). */
  get currentPrice(): number {
    return this.index < this.total ? this.num('c', this.index) : Number.NaN
  }

  static load(path = join(config.dataDir, 'replay/replay.json')): ReplayData {
    return JSON.parse(readFileSync(path, 'utf8')) as ReplayData
  }

  private collectFolds(): void {
    const splitCol = this.featureIndex.get('split')
    if (splitCol === undefined) return
    const names: Record<number, string> = { 3: 'V1', 4: 'V2', 5: 'V3' }
    const seen = new Set<number>()
    for (let i = 0; i < this.total; i++) {
      const code = this.data.rows[i][splitCol]
      if (typeof code !== 'number') continue
      const name = names[code]
      if (!name || seen.has(code)) continue
      seen.add(code)
      this.folds.push({ name, startIndex: i, ts: this.num('ts', i) })
    }
  }

  private num(column: string, rowIndex: number): number {
    const c = this.featureIndex.get(column)
    if (c === undefined) return Number.NaN
    const v = this.data.rows[rowIndex][c]
    return typeof v === 'number' ? v : Number.NaN
  }

  get status(): ReplayStatus {
    return {
      playing: this.playing,
      index: this.index,
      total: this.total,
      speed: this.speed,
      effectiveSpeed: this.effectiveSpeed,
      currentTs: this.index < this.total ? this.num('ts', this.index) : this.endTs,
      startTs: this.startTs,
      endTs: this.endTs,
      folds: this.folds,
    }
  }

  private contextAt(i: number): MinuteContext {
    const features: Record<string, number> = {}
    for (const name of this.models.bundle.manifest.features) {
      features[name] = this.num(name, i)
    }
    const rawRuns: Record<string, number> = {}
    for (const c of this.runColumns) rawRuns[c] = this.num(c, i)
    return {
      ts: this.num('ts', i),
      minuteIndex: i,
      open: this.num('o', i),
      high: this.num('h', i),
      low: this.num('l', i),
      close: this.num('c', i),
      features,
      rawRuns,
      source: 'replay',
    }
  }

  private sequence(i: number): Record<string, number>[] {
    const seqLen = Math.max(
      ...[...this.models.bundle.models.values()].map((m) => ('seq_len' in m.file ? m.file.seq_len : 0)),
      1,
    )
    const seq: Record<string, number>[] = []
    for (let r = Math.max(0, i - seqLen + 1); r <= i; r++) seq.push(this.contextAt(r).features)
    return seq
  }

  /** Proses satu baris: buka posisi tertunda di open, cek bar, lalu prediksi & sinyal. */
  private step(): void {
    if (this.index >= this.total) {
      this.pause()
      return
    }
    const ctx = this.contextAt(this.index)
    this.bots.onReplayBar(ctx)
    const seq = this.sequence(this.index)
    const outputs = this.models.predict(ctx.features, ctx.rawRuns, seq)
    this.bots.onMinute(ctx, outputs, 'replay')
    this.onRow(ctx)
    this.index++
  }

  play(): void {
    if (this.playing) return
    if (this.index >= this.total) this.reset(0)
    this.playing = true
    this.lastStep = Date.now()
    this.timer = setInterval(() => {
      const now = Date.now()
      const elapsed = Math.min(1, (now - this.lastStep) / 1000)
      this.lastStep = now
      const steps = Math.max(1, Math.round(this.speed * elapsed))
      // batas waktu per tick: kalau inference lebih lambat dari target,
      // replay melambat sendiri alih-alih membuat event loop kelaparan
      const budgetEnd = now + 55
      let done = 0
      for (let k = 0; k < steps && this.index < this.total; k++) {
        this.step()
        done++
        if (Date.now() > budgetEnd) break
      }
      this.effectiveSpeed = elapsed > 0 ? Math.round(done / elapsed) : this.speed
      if (this.index >= this.total) this.pause()
    }, 100)
  }

  pause(): void {
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  setSpeed(minutesPerSecond: number): number {
    this.speed = Math.min(2000, Math.max(1, Math.round(minutesPerSecond)))
    return this.speed
  }

  reset(index = 0): void {
    this.pause()
    this.index = Math.min(Math.max(0, index), this.total - 1)
    this.bots.reset()
  }

  dispose(): void {
    this.pause()
  }
}
