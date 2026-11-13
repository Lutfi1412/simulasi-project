import { useEffect, useRef } from 'react'
import type { Snapshot } from '../../../server/src/api/contract'

const KEY = 'sim-sound-models'
const NOTIF_SRC = '/notif.mp3'

/** Model mana saja yang bersuara saat sinyal masuk (disimpan di browser). */
export function loadSoundModels(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function saveSoundModels(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* abaikan */
  }
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!speechSupported()) return undefined
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith('id')) ??
    voices.find((v) => v.voiceURI?.toLowerCase().includes('google')) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('en')) ??
    undefined
  )
}

/**
 * Ucapkan teks lewat Web Speech API (di Chrome memakai voice Google).
 * `repeat` > 1 akan mengantre ucapan yang sama beberapa kali.
 */
export function speak(text: string, repeat = 1): boolean {
  if (!speechSupported()) return false
  const synth = window.speechSynthesis
  const voice = pickVoice()
  for (let i = 0; i < Math.max(1, repeat); i++) {
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'id-ID'
    utter.rate = 1
    utter.pitch = 1
    utter.volume = 1
    if (voice) utter.voice = voice
    synth.speak(utter)
  }
  return true
}

export function cancelSpeech(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}

// Satu elemen audio dipakai ulang supaya file notif tidak diunduh berulang.
let notifEl: HTMLAudioElement | null = null
// Elemen terpisah khusus membuka izin autoplay; jangan pakai elemen notif karena
// pause() dari proses unlock bisa memotong notif yang baru saja diputar.
let unlockEl: HTMLAudioElement | null = null

function makeAudio(volume: number): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  const el = new Audio(NOTIF_SRC)
  el.preload = 'auto'
  el.volume = volume
  return el
}

function notifAudio(): HTMLAudioElement | null {
  if (!notifEl) notifEl = makeAudio(0.9)
  return notifEl
}

/**
 * Buka izin autoplay browser. Panggil dari aksi pengguna (klik pertama, toggle ON,
 * atau tombol tes suara), karena browser memblokir suara tanpa interaksi.
 */
export function primeAudio(): void {
  if (!unlockEl) unlockEl = makeAudio(0.01)
  if (unlockEl) {
    const el = unlockEl
    try {
      el.currentTime = 0
      const played = el.play()
      if (played && typeof played.then === 'function') {
        played
          .then(() => {
            el.pause()
            el.currentTime = 0
          })
          .catch(() => {})
      }
    } catch {
      /* diabaikan */
    }
  }
  // memicu pemuatan daftar voice lebih awal supaya ucapan tidak telat
  if (speechSupported()) window.speechSynthesis.getVoices()
}

/** Putar notif.mp3 dan tunggu sampai selesai sebelum lanjut ke ucapan. */
function playNotifAndWait(): Promise<void> {
  return new Promise((resolve) => {
    const el = notifAudio()
    if (!el) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      el.removeEventListener('ended', done)
      el.removeEventListener('error', done)
      resolve()
    }
    el.addEventListener('ended', done)
    el.addEventListener('error', done)
    try {
      el.currentTime = 0
      const played = el.play()
      if (played && typeof played.then === 'function') {
        played
          .then(() => {
            // jaring pengaman bila event 'ended' tidak terpicu
            const wait = Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : 1500
            setTimeout(done, wait + 500)
          })
          .catch(done)
      } else {
        setTimeout(done, 1500)
      }
    } catch {
      done()
    }
  })
}

/** Ucapkan teks lalu selesai setelah ucapan terakhir berhenti (dengan batas waktu). */
function speakAsync(text: string, repeat: number): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSupported()) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const voice = pickVoice()
    const count = Math.max(1, repeat)
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, 1500 + count * 2500)
    for (let i = 0; i < count; i++) {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'id-ID'
      utter.rate = 1
      utter.pitch = 1
      utter.volume = 1
      if (voice) utter.voice = voice
      if (i === count - 1) {
        utter.onend = done
        utter.onerror = done
      }
      synth.speak(utter)
    }
  })
}

// Antrean supaya beberapa sinyal berurutan: notif → ucapan → sinyal berikutnya.
let alertChain: Promise<void> = Promise.resolve()

function enqueueAlert(text: string, repeat: number): Promise<void> {
  const run = alertChain.then(async () => {
    await playNotifAndWait()
    await speakAsync(text, repeat)
  })
  alertChain = run.catch(() => {})
  return run
}

export function signalText(side: 1 | -1, model: string): string {
  return `sinyal ${side === 1 ? 'long' : 'short'} dari model ${model}`
}

/** Notifikasi lengkap: notif.mp3 selesai dulu, baru ucapan sinyal. */
export function alertSignal(side: 1 | -1, model: string, repeat = 3): Promise<void> {
  return enqueueAlert(signalText(side, model), repeat)
}

/** Tes suara dari topbar: notif.mp3 lalu contoh ucapan sinyal. */
export function testAlert(): boolean {
  void enqueueAlert('tes suara notifikasi sinyal, sinyal long dari model meta label', 1)
  return true
}

/**
 * Notifikasi patokan harga: satu kejadian = notif.mp3 diputar 3x, masing-masing
 * diikuti ucapan "patokan sudah di tercapai". Setelah tercapai fungsi ini tidak
 * dipanggil lagi sampai patokan baru dibuat/diedit (status kembali "menunggu").
 */
export function alertPatokan(times = 3): Promise<void> {
  const count = Math.max(1, Math.round(times))
  const run = alertChain.then(async () => {
    for (let i = 0; i < count; i++) {
      await playNotifAndWait()
      await speakAsync('patokan sudah di tercapai', 1)
    }
  })
  alertChain = run.catch(() => {})
  return run
}

/**
 * Bunyikan notifikasi untuk sinyal BARU yang masuk (yang benar-benar memicu entri).
 * Snapshot pertama hanya menandai sinyal lama supaya riwayat tidak ikut dibacakan.
 */
export function useSignalSound(snapshot: Snapshot | null, enabled: Record<string, boolean>): void {
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!snapshot) return
    const list = snapshot.signals
    const keyOf = (s: { botId: string; ts: number; side: 1 | -1 }) => `${s.botId}-${s.ts}-${s.side}`

    if (seen.current === null) {
      seen.current = new Set(list.map(keyOf))
      return
    }

    const seenSet = seen.current
    const fresh: typeof list = []
    for (const s of list) {
      const k = keyOf(s)
      if (seenSet.has(k)) continue
      seenSet.add(k)
      fresh.push(s)
    }
    if (!fresh.length) return

    // list terbaru di depan; bunyikan dari yang paling lama supaya urutannya wajar
    for (const s of fresh.reverse()) {
      if (!enabled[s.model]) continue
      void alertSignal(s.side, s.model, 3)
    }
  }, [snapshot, enabled])
}
