export type Theme = 'gelap' | 'malam'

const KEY = 'sim-theme'

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'malam' ? 'malam' : 'gelap'
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
