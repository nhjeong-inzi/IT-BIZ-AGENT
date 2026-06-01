import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { queryArticles, getStats, getRunLogs, insertRunLog, getArticleById, updateArticleContent, queryBizOpps, getBizStats, initBizOppsTable } from '../src/db.js';
import { main as runCollect } from '../src/collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Articles ──────────────────────────────────────────────────────────────────
app.get('/api/articles', (req, res) => {
  try {
    res.json(queryArticles({
      q:          req.query.q,
      category:   req.query.category,
      media:      req.query.media,
      importance: req.query.importance,
      dateFrom:   req.query.date_from,
      dateTo:     req.query.date_to,
      page:       req.query.page,
      limit:      req.query.limit,
      sort:       req.query.sort,
      order:      req.query.order,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (_req, res) => {
  try { res.json(getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Article detail + content fetch ───────────────────────────────────────────
app.get('/api/articles/:id', (req, res) => {
  const article = getArticleById(Number(req.params.id));
  if (!article) return res.status(404).json({ error: 'not found' });
  res.json(article);
});

app.get('/api/articles/:id/content', async (req, res) => {
  const article = getArticleById(Number(req.params.id));
  if (!article) return res.status(404).json({ error: 'not found' });

  // 캐시된 본문이 있으면 바로 반환
  if (article.content) return res.json({ content: article.content, cached: true });

  try {
    const content = await fetchArticleText(article.url);
    const result  = content || article.summary;
    if (content) updateArticleContent(article.id, content);
    res.json({ content: result, cached: false });
  } catch (e) {
    res.json({ content: article.summary, cached: false, error: e.message });
  }
});

async function fetchArticleText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractText(html);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function extractText(html) {
  // 노이즈 제거
  let h = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(nav|header|footer|aside|iframe|figure|figcaption|form|button)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // 본문 컨테이너 우선 추출 (한국 언론사 패턴)
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /class="[^"]*(?:article[-_]?body|article[-_]?content|news[-_]?body|news[-_]?content|view[-_]?cont|article[-_]?text)[^"]*"[^>]*>([\s\S]{200,}?)(?=<\/(?:div|section|article)>)/i,
    /id="[^"]*(?:article[-_]?body|newsView|articleBody|articeBody)[^"]*"[^>]*>([\s\S]{200,}?)(?=<\/(?:div|section)>)/i,
  ];

  let content = h;
  for (const re of patterns) {
    const m = h.match(re);
    if (m && m[1]?.length > 300) { content = m[1]; break; }
  }

  // 단락 추출 후 완전한 텍스트로 정리
  const paras = [];
  for (const [, p] of content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = p
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
      .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,'')
      .replace(/\s+/g,' ').trim();
    if (text.length > 25 && !/저작권|무단전재|기자$|@|구독신청|광고문의|Copyright/.test(text)) {
      paras.push(text);
    }
  }
  return paras.length >= 2 ? paras.slice(0, 40).join('\n\n') : null;
}

// ── Run logs ──────────────────────────────────────────────────────────────────
app.get('/api/run-logs', (_req, res) => {
  try { res.json(getRunLogs()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manual collect trigger ────────────────────────────────────────────────────
let collecting = false;

app.get('/api/collect/status', (_req, res) => {
  res.json({ collecting });
});

app.post('/api/collect', (req, res) => {
  if (collecting) return res.json({ status: 'running', message: '이미 수집 중입니다.' });
  collecting = true;
  res.json({ status: 'started', message: '수집을 시작합니다.' });

  runCollect()
    .catch(e => {
      console.error('collect error:', e);
      insertRunLog({ run_at: new Date().toISOString(), duration_sec: 0, total_raw: 0, total_saved: 0, status: 'error' });
    })
    .finally(() => { collecting = false; });
});

// ── 사업공고자료 (DB) ─────────────────────────────────────────────────────────
app.get('/api/biz-opps', (req, res) => {
  try {
    const opps  = queryBizOpps({ org: req.query.org, sol: req.query.sol, priority: req.query.priority, srcType: req.query.src_type, dateFrom: req.query.date_from, dateTo: req.query.date_to });
    const stats = getBizStats();
    res.json({ stats, opportunities: opps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 사업공고 수집 트리거 (구글뉴스) ──────────────────────────────────────────
let bizCollecting = false;
app.post('/api/collect-biz', (req, res) => {
  if (bizCollecting) return res.json({ status: 'running' });
  bizCollecting = true;
  res.json({ status: 'started' });
  import('../src/collect-biz.js').then(m => m.main())
    .catch(e => console.error('collect-biz error:', e))
    .finally(() => { bizCollecting = false; });
});
app.get('/api/collect-biz/status', (_req, res) => res.json({ collecting: bizCollecting }));

// ── 나라장터 수집 트리거 ──────────────────────────────────────────────────────
let g2bCollecting = false;
app.post('/api/collect-g2b', (req, res) => {
  if (g2bCollecting) return res.json({ status: 'running' });
  g2bCollecting = true;
  res.json({ status: 'started', hasKey: !!process.env.G2B_SERVICE_KEY });
  import('../src/collect-g2b.js').then(m => m.main())
    .catch(e => console.error('collect-g2b error:', e))
    .finally(() => { g2bCollecting = false; });
});
app.get('/api/collect-g2b/status', (_req, res) =>
  res.json({ collecting: g2bCollecting, hasKey: !!process.env.G2B_SERVICE_KEY }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 IT-BIZ-AGENT: http://localhost:${PORT}`);
});
