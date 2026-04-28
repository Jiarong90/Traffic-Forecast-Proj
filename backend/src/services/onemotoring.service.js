const fs = require('fs/promises');
const config = require('../../config');
const { decodeHtmlEntities, stripHtml } = require('../utils/common');
const { withCache } = require('./cache.service');
const { fetchTextCached } = require('./dataSource.service');

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bcar\s*park\b/g, ' ')
    .replace(/\bshopping\s*centre\b/g, ' ')
    .replace(/\bshopping\s*center\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\bp\d+\b/g, ' ')
    .replace(/\brws\b/g, ' resorts world sentosa ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePlacemarkBlocks(kmlText) {
  return Array.from(String(kmlText || '').matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi)).map((m) => m[1]);
}

function parseErpKml(kmlText) {
  return parsePlacemarkBlocks(kmlText).map((block, index) => {
    const nameMatch = block.match(/<td>([^<]+)<\/td>/i);
    const coordMatch = block.match(/<coordinates>\s*([0-9.\-]+),([0-9.\-]+),0\s*<\/coordinates>/i);
    const ddlMatch = block.match(/iframe\s+src="([^"]+_ddl\.html)"/i);
    if (!nameMatch || !coordMatch) return null;
    const ddlUrl = ddlMatch
      ? `https:${ddlMatch[1].startsWith('//') ? ddlMatch[1] : `//${ddlMatch[1].replace(/^https?:\/\//i, '')}`}`
      : '';
    return {
      id: `erp-${index + 1}`,
      name: decodeHtmlEntities(nameMatch[1]),
      lat: parseFloat(coordMatch[2]),
      lon: parseFloat(coordMatch[1]),
      ddlUrl
    };
  }).filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

function parsePgsKml(kmlText) {
  return parsePlacemarkBlocks(kmlText).map((block, index) => {
    const nameMatch = block.match(/<b>([^<]+)<\/b>/i);
    const coordMatch = block.match(/<coordinates>\s*([0-9.\-]+),([0-9.\-]+),0\s*<\/coordinates>/i);
    const imageMatch = block.match(/<img[^>]+src="([^"]+Parking\/[^"]+)"/i);
    const availabilityTimeMatch = block.match(/Parking Lots Availability is correct as at\s*([^<\n]+)/i);
    const availabilityCountMatch = block.match(/font-size:31px;font-weight:bold;'>([^<]+)<\/span>/i);
    if (!nameMatch || !coordMatch) return null;
    const imageUrl = imageMatch
      ? `https:${imageMatch[1].startsWith('//') ? imageMatch[1] : `//${imageMatch[1].replace(/^https?:\/\//i, '')}`}`
      : '';
    return {
      id: `pgs-${index + 1}`,
      name: decodeHtmlEntities(nameMatch[1]),
      lat: parseFloat(coordMatch[2]),
      lon: parseFloat(coordMatch[1]),
      imageUrl,
      availability: decodeHtmlEntities(availabilityCountMatch?.[1] || ''),
      availabilityUpdatedAt: decodeHtmlEntities(availabilityTimeMatch?.[1] || '')
    };
  }).filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

function parseParkingRatesPage(html, sourceUrl) {
  const rows = [];
  const rowMatches = Array.from(String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi));
  rowMatches.forEach((rowMatch) => {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi))
      .map((m) => ({
        label: decodeHtmlEntities(m[1]),
        value: stripHtml(m[2])
      }));
    if (cells.length < 5) return;
    const row = Object.fromEntries(cells.map((c) => [c.label, c.value]));
    const carPark = row['Car Park'];
    if (!carPark) return;
    rows.push({
      name: carPark,
      normalizedName: normalizeLookupName(carPark),
      weekdayBefore: row['Weekdays before 5/6pm'] || '',
      weekdayAfter: row['Weekdays after 5/6pm'] || '',
      saturday: row['Saturdays'] || '',
      sunday: row['Sundays/Public Holidays'] || '',
      sourceUrl
    });
  });
  return rows;
}

function findBestParkingRateMatch(name, rows) {
  const target = normalizeLookupName(name);
  if (!target) return null;
  const exact = rows.find((row) => row.normalizedName === target);
  if (exact) return exact;
  const contains = rows.find((row) => row.normalizedName.includes(target) || target.includes(row.normalizedName));
  if (contains) return contains;
  const targetTokens = target.split(' ').filter(Boolean);
  let best = null;
  let bestScore = 0;
  rows.forEach((row) => {
    const rowTokens = row.normalizedName.split(' ').filter(Boolean);
    const overlap = targetTokens.filter((token) => rowTokens.includes(token)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = row;
    }
  });
  return bestScore >= 2 ? best : null;
}

async function fetchParkingRatesLookup() {
  const pages = await Promise.all(
    config.ONEMOTORING_PARKING_RATE_PAGE_URLS.map(async (url) => parseParkingRatesPage(await fetchTextCached(url), url))
  );
  return pages.flat();
}

async function fetchLocalErpRates() {
  return withCache(`json:${config.ERP_RATES_JSON_PATH}`, config.ONEMOTORING_SOURCE_TTL_MS, async () => {
    const raw = await fs.readFile(config.ERP_RATES_JSON_PATH, 'utf8');
    return JSON.parse(raw);
  });
}

module.exports = {
  fetchTextCached,
  parseErpKml,
  parsePgsKml,
  fetchParkingRatesLookup,
  findBestParkingRateMatch,
  fetchLocalErpRates
};
