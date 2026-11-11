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

function notifAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
  if (!notifEl) {
    notifEl = new Audio(NOTIF_SRC)
    notifEl.preload = 'auto'
    notifEl.volume = 0.9
  }
  return notifEl
}

/**
 * Buka izin autoplay browser. Panggil dari aksi pengguna (toggle ON / tes suara),
 * karena browser memblokir suara yang diputar tanpa interaksi.
 */
export function primeAudio(): void {
  const el = notifAudio()
  if (!el) return
  el.muted = true
  const played = el.play()
  if (played && typeof played.then === 'function') {
    played
      .then(() => {
        el.pause()
        el.currentTime = 0
        el.muted = false
      })
      .catch(() => {
        el.muted = false
      })
  }
}

/** Bunyikan notif.mp3 (nada pemberitahuan). */
export function playNotif(): void {
  const el = notifAudio()
  if (!el) return
  try {
    el.currentTime = 0
    const played = el.play()
    if (played && typeof played.catch === 'function') void played.catch(() => {})
  } catch {
    /* autoplay diblokir browser — suara akan berbunyi setelah ada interaksi */
  }
}

export function signalText(side: 1 | -1, model: string): string {
  return `sinyal ${side === 1 ? 'long' : 'short'} dari model ${model}`
}

/** Notifikasi lengkap: notif.mp3 + ucapan sinyal (diulang beberapa kali). */
export function alertSignal(side: 1 | -1, model: string, repeat = 3): boolean {
  playNotif()
  return speak(signalText(side, model), repeat)
}

/** Tes suara dari topbar: memutar notif.mp3 lalu contoh ucapan sinyal. */
export function testAlert(): boolean {
  playNotif()
  return speak('tes suara notifikasi sinyal, sinyal long dari model meta label', 1)
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
      alertSignal(s.side, s.model, 3)
    }
  }, [snapshot, enabled])
}
