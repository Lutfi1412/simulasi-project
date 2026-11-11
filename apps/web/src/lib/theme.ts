export type Theme = 'gelap' | 'terang'

const KEY = 'sim-theme'

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    // 'malam' adalah nilai tema lama; sekarang diganti pasangan gelap/terang.
    if (saved === 'terang') return 'terang'
    return 'gelap'
  } catch {
    return 'gelap'
  }
}

/** Terapkan tema ke <html data-theme="…"> dan simpan pilihannya. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* localStorage bisa diblokir; tema tetap berlaku untuk sesi ini */
  }
}
