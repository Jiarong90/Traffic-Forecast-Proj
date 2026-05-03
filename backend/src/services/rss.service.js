const { nowIso, decodeHtmlLite } = require('../utils/common');

function parseRssItems(xml) {
  const items = [];
  const itemBlocks = String(xml || '').match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (!title || !link) continue;
    items.push({
      title: decodeHtmlLite(title).trim(),
      link: decodeHtmlLite(link).trim(),
      publishedAt: new Date(pubDate || nowIso()).toISOString()
    });
  }
  return items;
}

async function fetchRss(url) {
  console.log("[fetchRss] Fetching:", url);

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "en-SG,en;q=0.9"
    }
  });

  console.log("[fetchRss] Status:", resp.status, resp.statusText);

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.warn("[fetchRss] Failed body preview:", body.slice(0, 300));
    throw new Error(`RSS fetch failed: ${resp.status}`);
  }

  const xml = await resp.text();
  return parseRssItems(xml);
}

module.exports = {
  fetchRss
};
