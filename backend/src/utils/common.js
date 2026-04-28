function nowIso() {
  return new Date().toISOString();
}

function trimText(value, maxLen = 255) {
  return String(value || '').trim().slice(0, maxLen);
}

function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function downsample(items, maxCount) {
  if (!Array.isArray(items) || items.length <= maxCount) return items;
  const sampled = [];
  const step = items.length / maxCount;
  for (let i = 0; i < maxCount; i += 1) {
    sampled.push(items[Math.floor(i * step)]);
  }
  return sampled;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
}

function decodeHtmlLite(text = '') {
  return String(text || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deriveIncidentArea(message, lat, lon) {
  const msg = String(message || '').trim();
  if (msg) {
    const parts = msg.split(/ - |,|;/).map((s) => s.trim()).filter(Boolean);
    if (parts[0]) return parts[0];
  }
  return `(${lat?.toFixed?.(4) || lat}, ${lon?.toFixed?.(4) || lon})`;
}

module.exports = {
  nowIso,
  trimText,
  toNumber,
  toNumOrNull,
  downsample,
  decodeHtmlEntities,
  stripHtml,
  decodeHtmlLite,
  distanceMeters,
  deriveIncidentArea
};
