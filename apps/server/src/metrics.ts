/**
 * Penghitung ringan untuk halaman diagnostik: berapa klien WS, berapa snapshot
 * terkirim, dan berapa request API yang gagal. Tidak menyimpan histori panjang —
 * hanya angka terakhir supaya bisa dibaca kapan saja tanpa biaya.
 */
export const metrics = {
  wsClients: 0,
  wsPeak: 0,
  snapshotsSent: 0,
  lastBroadcastTs: 0,
  apiRequests: 0,
  apiErrors: 0,
  lastApiError: null as string | null,
  lastApiErrorTs: 0,
}

export function noteSnapshot(): void {
  metrics.snapshotsSent++
  metrics.lastBroadcastTs = Date.now()
}

export function noteApiError(message: string): void {
  metrics.apiErrors++
  metrics.lastApiError = message
  metrics.lastApiErrorTs = Date.now()
}
