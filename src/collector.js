import { CATEGORIES } from './config.js';
import { searchNews } from './searcher.js';
import { insertArticles, insertRunLog } from './db.js';

function dedup(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = a.url || a.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function main() {
  const startTime = Date.now();
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n🔍 IT-BIZ-AGENT 뉴스 탐색 시작 — ${today}`);
  console.log('='.repeat(60));

  const allArticles = [];
  let done = 0;
  const total = CATEGORIES.reduce((s, c) => s + c.queries.length, 0);

  for (const cat of CATEGORIES) {
    for (let qi = 0; qi < cat.queries.length; qi++) {
      done++;
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`[${String(done).padStart(2)}/${total}] (${pct}%) ${cat.icon} ${cat.label} #${qi + 1} ... `);
      try {
        const articles = await searchNews(cat, cat.queries[qi]);
        allArticles.push(...articles);
        console.log(`✅ ${articles.length}건`);
      } catch (e) {
        console.log(`❌ ${e.message.slice(0, 80)}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const deduped  = dedup(allArticles);
  const saved    = insertArticles(deduped);
  const duration = Math.round((Date.now() - startTime) / 1000);

  insertRunLog({
    run_at:       new Date().toISOString(),
    duration_sec: duration,
    total_raw:    allArticles.length,
    total_saved:  saved,
    status:       'success',
  });

  console.log('\n' + '='.repeat(60));
  console.log(`✅ 완료 — ${duration}초 | 발견 ${allArticles.length}건 | 신규 저장 ${saved}건`);
  return { total_raw: allArticles.length, total_saved: saved };
}

if (process.argv[1].replace(/\\/g, '/').endsWith('src/collector.js')) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
