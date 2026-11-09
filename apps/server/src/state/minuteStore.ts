import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MinuteRow, SignalEvent } from '../core/types'

/**
 * Penyimpanan menit ke disk (JSONL, satu baris per menit) supaya simulasi 24 jam
 * tidak kehilangan histori saat server di-restart. Saat boot hanya baris terakhir
 * yang dibaca (cukup untuk 305 menit lookback + urutan GRU).
 */
export class MinuteStore {
  private rows = new Map<number, MinuteRow>()
  private times: number[] = []

  constructor(
    private readonly file: string,
    private readonly keep = 6000,
  ) {
    mkdirSync(dirname(file), { recursive: true })
  }

  get size(): number {
    return this.rows.size
  }

  get lastMinute(): number {
    return this.times.length ? this.times[this.times.length - 1] : 0
  }

  /**
   * Jumlah menit yang bisa dipakai model: hitung mundur dari menit terakhir,
   * berhenti di celah lebih dari `maxGapMenit` (celah kecil diisi ffill oleh grid).
   * Angka ini yang menentukan pemanasan, bukan jumlah baris mentah.
   */
  tailMinutes(maxGapMenit = 5): number {
    if (!this.times.length) return 0
    let count = 1
    for (let i = this.times.length - 1; i > 0; i--) {
      const stepMin = (this.times[i] - this.times[i - 1]) / 60
      if (stepMin > maxGapMenit + 1) break
      count++
    }
    return count
  }

  get map(): Map<number, MinuteRow> {
    return this.rows
  }

  add(row: MinuteRow): void {
    if (!Number.isFinite(row.ts) || !Number.isFinite(row.close) || row.close <= 0) return
    if (!this.rows.has(row.ts)) this.times.push(row.ts)
    this.rows.set(row.ts, row)
    appendFileSync(this.file, JSON.stringify(row) + '\n')
    this.trim()
  }

  private trim(): void {
    if (this.times.length <= this.keep) return
    const drop = this.times.splice(0, this.times.length - this.keep)
    for (const t of drop) this.rows.delete(t)
  }

  /** Muat baris terakhir dari disk; aman kalau file belum ada / rusak. */
  load(limit = 2000): number {
    if (!existsSync(this.file)) return 0
    // berkas besar: baca ekor saja agar boot cepat
    const size = statSync(this.file).size
    const maxBytes = 8 * 1024 * 1024
    let text: string
    if (size > maxBytes) {
      const fd = readFileSync(this.file)
      text = fd.subarray(size - maxBytes).toString('utf8')
      const nl = text.indexOf('\n')
      if (nl >= 0) text = text.slice(nl + 1)
    } else {
      text = readFileSync(this.file, 'utf8')
    }
    const lines = text.split('\n')
    let loaded = 0
    for (let i = Math.max(0, lines.length - limit - 1); i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        const row = JSON.parse(line) as MinuteRow
        if (!Number.isFinite(row.ts)) continue
        if (!this.rows.has(row.ts)) this.times.push(row.ts)
        this.rows.set(row.ts, row)
        loaded++
      } catch {
        /* baris rusak (mis. tulisan terputus saat mati) dilewati */
      }
    }
    this.times.sort((a, b) => a - b)
    return loaded
  }

  /** Tulis ulang berkas tanpa baris lama (dipanggil sekali saat boot). */
  compact(keep = this.keep): void {
    const keepTimes = this.times.slice(-keep)
    const lines = keepTimes.map((t) => JSON.stringify(this.rows.get(t)))
    writeFileSync(this.file, lines.join('\n') + (lines.length ? '\n' : ''))
  }
}

/** Riwayat sinyal dominasi (untuk fitur sig_*). */
export class SignalStore {
  events: SignalEvent[] = []
  private file: string

  constructor(dir: string, readonly keepMs = 26 * 3600_000) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'signals.jsonl')
  }

  load(): number {
    if (!existsSync(this.file)) return 0
    const lines = readFileSync(this.file, 'utf8').split('\n')
    const cutoff = Date.now() / 1000 - this.keepMs / 1000
    for (const line of lines) {
      const s = line.trim()
      if (!s) continue
      try {
        const e = JSON.parse(s) as SignalEvent
        if (e.ts >= cutoff) this.events.push(e)
      } catch {
        /* dilewati */
      }
    }
    this.events.sort((a, b) => a.ts - b.ts)
    return this.events.length
  }

  push(e: SignalEvent): void {
    this.events.push(e)
    appendFileSync(this.file, JSON.stringify(e) + '\n')
    const cutoff = e.ts - this.keepMs / 1000
    if (this.events.length > 2000 || this.events[0].ts < cutoff) {
      this.events = this.events.filter((x) => x.ts >= cutoff)
    }
  }
}
