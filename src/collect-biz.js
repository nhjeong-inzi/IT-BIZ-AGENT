// Google News RSS로 5개 은행 IT 사업 기회 수집

const BANKS = [
  { name: '우리은행',   queries: ['우리은행 IT 시스템 디지털 사업', '우리은행 OCR RPA 신분증 디지털창구'] },
  { name: 'KB국민은행', queries: ['KB국민은행 IT 시스템 디지털 사업', 'KB국민은행 OCR RPA 신분증 디지털창구'] },
  { name: '하나은행',   queries: ['하나은행 IT 시스템 디지털 사업',   '하나은행 OCR RPA 신분증 디지털창구'] },
  { name: '신한은행',   queries: ['신한은행 IT 시스템 디지털 사업',   '신한은행 OCR RPA 신분증 디지털창구'] },
  { name: 'NH농협은행', queries: ['NH농협은행 IT 시스템 디지털 사업', '농협은행 OCR RPA 신분증 디지털창구'] },
];

const SOL_PATTERNS = {
  ocr:     /OCR|문자인식|IDP|지능형문서|인식솔루션/i,
  image:   /이미지시스템|스캔시스템|이미지처리|문서이미지|이미지관리|스캐닝/i,
  rpa:     /RPA|로봇프로세스|업무자동화|로봇자동화|자동화솔루션/i,
  id:      /신분증인식|신분증|본인확인|신원인증|비대면인증|신원확인/i,
  digital: /디지털창구|스마트창구|비대면창구|키오스크|무인창구|디지털뱅킹|스마트뱅킹/i,
};

function detectSol(text) {
  for (const [sol, re] of Object.entries(SOL_PATTERNS)) {
    if (re.test(text)) return sol;
  }
  return 'digital';
}

function detectPriority(text) {
  if (/입찰|공고|RFP|제안요청|모집|발주|구축사업|선정|낙찰/.test(text)) return '상';
  if (/계획|추진|검토|도입|준비|구축예정|협약|MOU|추진/.test(text))    return '중';
  return '하';
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}
function stripHtml(s) {
  return decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, '')).replace(/\s+/g,' ').trim();
}

function parseRss(xml) {
  const items = [];
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = tag => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    items.push({
      title:   stripHtml(get('title')),
      link:    get('link'),
      desc:    stripHtml(get('description')),
      pubDate: get('pubDate'),
      source:  stripHtml(get('source')),
    });
  }
  return items;
}

function formatDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function isTodayKST(pubDateStr) {
  if (!pubDateStr) return true;
  const pub = new Date(pubDateStr);
  // KST(UTC+9) 기준 오늘 날짜와 비교
  const toKSTDate = d => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return toKSTDate(pub) === toKSTDate(new Date());
}

async function searchBizNews(bank, query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  return parseRss(xml)
    .filter(item => isTodayKST(item.pubDate))
    .filter(item => item.title && item.title.length > 5)
    .slice(0, 8)
    .map(item => {
      const text = item.title + ' ' + item.desc;
      return {
        title:        item.title,
        org:          bank,
        sol:          detectSol(text),
        priority:     detectPriority(text),
        deadline:     '확인필요',
        budget:       '미공개',
        summary:      item.desc || item.title,
        source:       item.link,
        published_at: formatDate(item.pubDate),
        src_type:     'bank',
      };
    });
}

import { insertBizOpps, initBizOppsTable } from './db.js';

export async function main() {
  const start = Date.now();
  initBizOppsTable();

  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n🏦 IT-BIZ-AGENT 사업공고 수집 시작 — ${today}`);
  console.log('='.repeat(60));

  const allResults = [];
  const tasks = BANKS.flatMap(b => b.queries.map(q => ({ bank: b.name, query: q })));
  let done = 0;

  for (const { bank, query } of tasks) {
    done++;
    const pct = Math.round(done / tasks.length * 100);
    process.stdout.write(`[${String(done).padStart(2)}/${tasks.length}] (${pct}%) ${bank} ... `);
    try {
      const items = await searchBizNews(bank, query);
      allResults.push(...items);
      console.log(`✅ ${items.length}건`);
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  // 제목+기관 기준 중복 제거
  const seen = new Set();
  const deduped = allResults.filter(a => {
    const key = `${a.title}|${a.org}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const saved = insertBizOpps(deduped);
  const duration = Math.round((Date.now() - start) / 1000);
  console.log('\n' + '='.repeat(60));
  console.log(`✅ 완료 — ${duration}초 | 발견 ${allResults.length}건 | 신규 저장 ${saved}건`);
  return { total_raw: allResults.length, total_saved: saved };
}

if (process.argv[1].replace(/\\/g, '/').endsWith('src/collect-biz.js')) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
