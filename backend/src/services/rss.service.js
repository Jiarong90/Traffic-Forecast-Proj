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
  const resp = await fetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!resp.ok) throw new Error(`RSS fetch failed: ${resp.status}`);
  const xml = await resp.text();
  return parseRssItems(xml);
}

module.exports = {
  fetchRss
};
