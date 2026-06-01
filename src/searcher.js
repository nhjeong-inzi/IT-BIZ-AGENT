// Google News RSS 기반 수집 — API 키 불필요

function parseRss(xml) {
  const items = [];
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    items.push({
      title:   stripHtml(get('title')),
      link:    get('link') || block.match(/<link\/>(.*?)\n/)?.[1]?.trim() || '',
      desc:    stripHtml(get('description')),
      pubDate: get('pubDate'),
      source:  stripHtml(get('source')),
    });
  }
  return items;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

function stripHtml(s) {
  // 엔티티 디코딩 먼저 → 태그 제거 → 다시 엔티티 디코딩 (이중 인코딩 대비)
  return decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

function isWithin24h(pubDateStr) {
  if (!pubDateStr) return true;
  const diff = Date.now() - new Date(pubDateStr).getTime();
  return diff >= 0 && diff < 24 * 60 * 60 * 1000;
}

function formatDate(pubDateStr) {
  if (!pubDateStr) return null;
  const d = new Date(pubDateStr);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function getImportance(title, desc) {
  const text = title + ' ' + desc;
  if (/출시|오픈|론칭|선보|도입|계약체결|출범|개시|개통|가동|런칭/.test(text)) return '상';
  if (/계획|검토|추진|협약|MOU|준비|예정|발표|협력|파트너/.test(text)) return '중';
  return '하';
}

export async function searchNews(category, query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:1d')}&hl=ko&gl=KR&ceid=KR:ko`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml   = await res.text();
  const items = parseRss(xml).filter(i => isWithin24h(i.pubDate));

  return items.slice(0, 8).map(item => ({
    title:        item.title,
    media:        item.source || '알 수 없음',
    category:     category.key,
    summary:      item.desc || item.title,
    url:          item.link,
    published_at: formatDate(item.pubDate),
    importance:   getImportance(item.title, item.desc),
  }));
}
