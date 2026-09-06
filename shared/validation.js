export const PRESETS = ['COINBASE:BTCUSD', 'OANDA:XAUUSD', 'EURUSD'];
export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
export const RESOLUTIONS = { M1: '1', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D1: 'D' };
export const MODES = { auto: 'Otomatis', instruction: 'Mengikuti instruksi', combined: 'Gabungan' };
export const DRAWINGS = { support_resistance: 'Support / resistance', trendline: 'Trendline', supply_demand: 'Supply / demand', fibonacci: 'Fibonacci', entry_sl_tp: 'Entry / SL / TP' };
export const MAX_INSTRUCTION = 1500;
// Explicit character/grammar allowlist for custom TradingView identifiers.
export const SYMBOL_PATTERN = /^(?:[A-Z0-9_]{1,15}:)?[A-Z0-9][A-Z0-9._!]{0,24}$(?![\s\S])/;
export function validateRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('Permintaan tidak valid.');
  const {symbol, timeframe, mode, drawings, instruction} = input;
  if (input.requestType === 'chat') {
    if (symbol !== null || timeframe !== null || mode !== 'instruction' || !Array.isArray(drawings) || drawings.length) throw new Error('Format request chat tidak valid.');
    validateMessage(instruction);
    return {requestType: 'chat', symbol: null, timeframe: null, mode: 'instruction', drawings: [], instruction};
  }
  if (input.requestType !== undefined) throw new Error('Jenis request tidak tersedia.');
  if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) throw new Error('Simbol tidak valid. Contoh: COINBASE:BTCUSD atau NASDAQ:AAPL.');
  if (!TIMEFRAMES.includes(timeframe)) throw new Error('Timeframe tidak tersedia.');
  if (!Object.hasOwn(MODES, mode)) throw new Error('Mode analisis tidak tersedia.');
  if (!Array.isArray(drawings) || drawings.length > 5 || new Set(drawings).size !== drawings.length || drawings.some(d => typeof d !== 'string' || !Object.hasOwn(DRAWINGS, d))) throw new Error('Pilihan drawing tidak valid.');
  if (typeof instruction !== 'string' || instruction.length > MAX_INSTRUCTION || [...instruction].some(c => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && ![9, 10, 13].includes(n)); })) throw new Error('Instruksi maksimal 1.500 karakter dan tidak boleh berisi karakter kontrol.');
  if (mode === 'instruction' && !instruction.trim()) throw new Error('Tulis instruksi untuk mode mengikuti instruksi.');
  // Return only supported data. No executable, command, args, or prompt fields.
  return {symbol, timeframe, mode, drawings: [...drawings], instruction};
}

export function validateMessage(message) {
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_INSTRUCTION || [...message].some(c => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && ![9, 10, 13].includes(n)); })) {
    throw new Error('Tulis pesan antara 1–1.500 karakter, tanpa karakter kontrol.');
  }
  return message;
}
export function chatRequest(message) {
  return validateRequest({requestType: 'chat', symbol: null, timeframe: null, mode: 'instruction', drawings: [], instruction: validateMessage(message)});
}
export function requestsDrawingRemoval(message) {
  return /\b(hapus|bersihkan|remove|delete|clear)\b[^.!?\n]{0,70}\b(drawing|gambar|garis|anotasi|trendline|fibonacci|zona)\b/i.test(message);
}
