export const HEARTBEAT_MAX_AGE = 60000;
export function heartbeatConnected(heartbeat, now = Date.now()) {
  const at = heartbeat?.checkedAt?.toMillis?.() ?? heartbeat?.checkedAt;
  return typeof at === 'number' && now >= at && now - at <= HEARTBEAT_MAX_AGE
    && heartbeat.cdp_connected === true && heartbeat.api_available === true;
}
export function notificationText(job) {
  const result = job.result;
  if (result?.summary) return String(result.summary).slice(0, 220);
  const name = [result?.symbol || job.symbol, result?.timeframe || job.timeframe].filter(Boolean).join(' ');
  return `${name || 'Analisis'} selesai — buka percakapan untuk melihat level harga.`;
}
export function screenshotSource(value) {
  // Only bridge-owned embedded raster data; never remote links, SVG, file paths, or HTML.
  if (!value || !['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)) return null;
  if (typeof value.data !== 'string' || value.data.length > 480000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) return null;
  return `data:${value.mimeType};base64,${value.data}`;
}
export function conversationUrl(base, id) {
  return `${base}?request=${encodeURIComponent(id)}`;
}
