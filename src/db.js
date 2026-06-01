import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '../data/news.db');

let _db = null;

function getDb() {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    // content 컬럼 마이그레이션 (기존 DB 호환)
    try { _db.exec(`ALTER TABLE articles ADD COLUMN content TEXT`); } catch {}
    _db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        media        TEXT    NOT NULL DEFAULT '',
        category     TEXT    NOT NULL DEFAULT '',
        summary      TEXT    NOT NULL DEFAULT '',
        url          TEXT    NOT NULL UNIQUE,
        published_at TEXT,
        importance   TEXT    NOT NULL DEFAULT '하',
        collected_at TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_category     ON articles(category);
      CREATE INDEX IF NOT EXISTS idx_media        ON articles(media);
      CREATE INDEX IF NOT EXISTS idx_importance   ON articles(importance);
      CREATE INDEX IF NOT EXISTS idx_collected_at ON articles(collected_at);

      CREATE TABLE IF NOT EXISTS run_logs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        run_at       TEXT    NOT NULL,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        total_raw    INTEGER NOT NULL DEFAULT 0,
        total_saved  INTEGER NOT NULL DEFAULT 0,
        status       TEXT    NOT NULL DEFAULT 'success'
      );
    `);
  }
  return _db;
}

export function insertArticles(articles) {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles
      (title, media, category, summary, url, published_at, importance, collected_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  let saved = 0;
  for (const a of articles) {
    const r = stmt.run(
      a.title       || '',
      a.media       || '',
      a.category    || '',
      a.summary     || '',
      a.url         || `no-url-${now}-${Math.random()}`,
      a.published_at || null,
      ['상','중','하'].includes(a.importance) ? a.importance : '하',
      now,
    );
    if (r.changes) saved++;
  }
  return saved;
}

export function queryArticles({ q, category, media, importance, dateFrom, dateTo, page = 1, limit = 30, sort = 'collected_at', order = 'desc' } = {}) {
  const db = getDb();
  const conds = [], params = [];

  if (q)          { conds.push(`(title LIKE ? OR summary LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }
  if (category)   { conds.push(`category = ?`);    params.push(category); }
  if (media)      { conds.push(`media = ?`);       params.push(media); }
  if (importance) { conds.push(`importance = ?`);  params.push(importance); }
  if (dateFrom)   { conds.push(`DATE(collected_at) >= ?`); params.push(dateFrom); }
  if (dateTo)     { conds.push(`DATE(collected_at) <= ?`); params.push(dateTo); }

  const where     = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const safeSort  = ['collected_at','published_at','title','importance'].includes(sort) ? sort : 'collected_at';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';
  const lim       = Math.min(Number(limit) || 30, 100);
  const offset    = (Math.max(1, Number(page)) - 1) * lim;

  const total    = db.prepare(`SELECT COUNT(*) as c FROM articles ${where}`).get(...params).c;
  const articles = db.prepare(
    `SELECT * FROM articles ${where} ORDER BY ${safeSort} ${safeOrder}, id DESC LIMIT ? OFFSET ?`
  ).all(...params, lim, offset);

  return { articles, total, page: Number(page), pages: Math.ceil(total / lim) };
}

export function getStats() {
  const db    = getDb();
  const today = new Date().toISOString().slice(0, 10);
  return {
    total:     db.prepare(`SELECT COUNT(*) as c FROM articles`).get().c,
    today:     db.prepare(`SELECT COUNT(*) as c FROM articles WHERE DATE(collected_at) = ?`).get(today).c,
    byCat:     db.prepare(`SELECT category, COUNT(*) as c FROM articles GROUP BY category ORDER BY c DESC`).all(),
    byMedia:   db.prepare(`SELECT media, COUNT(*) as c FROM articles WHERE media != '' GROUP BY media ORDER BY c DESC LIMIT 15`).all(),
    byImp:     db.prepare(`SELECT importance, COUNT(*) as c FROM articles GROUP BY importance`).all(),
    lastRunAt: db.prepare(`SELECT run_at FROM run_logs ORDER BY id DESC LIMIT 1`).get()?.run_at || null,
    dates:     db.prepare(`SELECT DATE(collected_at) as d, COUNT(*) as c FROM articles GROUP BY d ORDER BY d DESC LIMIT 30`).all(),
  };
}

export function insertRunLog(log) {
  getDb().prepare(
    `INSERT INTO run_logs (run_at, duration_sec, total_raw, total_saved, status) VALUES (?,?,?,?,?)`
  ).run(log.run_at, log.duration_sec, log.total_raw, log.total_saved, log.status);
}

export function getRunLogs(limit = 20) {
  return getDb().prepare(`SELECT * FROM run_logs ORDER BY id DESC LIMIT ?`).all(limit);
}

export function initBizOppsTable() {
  try { getDb().exec(`ALTER TABLE articles ADD COLUMN _dummy TEXT`); } catch {}
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS biz_opps (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT    NOT NULL,
      org          TEXT    NOT NULL DEFAULT '',
      sol          TEXT    NOT NULL DEFAULT '',
      priority     TEXT    NOT NULL DEFAULT '중',
      deadline     TEXT,
      budget       TEXT,
      summary      TEXT,
      source       TEXT,
      published_at TEXT,
      collected_at TEXT    NOT NULL,
      UNIQUE(title, org)
    );
    CREATE INDEX IF NOT EXISTS idx_biz_org ON biz_opps(org);
    CREATE INDEX IF NOT EXISTS idx_biz_sol ON biz_opps(sol);
    CREATE INDEX IF NOT EXISTS idx_biz_pri ON biz_opps(priority);
  `);
  // 기존 DB 마이그레이션: src_type 컬럼 추가
  try { getDb().exec(`ALTER TABLE biz_opps ADD COLUMN src_type TEXT NOT NULL DEFAULT 'bank'`); } catch {}
  try { getDb().exec(`CREATE INDEX IF NOT EXISTS idx_biz_srctype ON biz_opps(src_type)`); } catch {}
}

export function insertBizOpps(items) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO biz_opps
      (title, org, sol, priority, deadline, budget, summary, source, published_at, collected_at, src_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  const now = new Date().toISOString();
  let saved = 0;
  for (const a of items) {
    const r = stmt.run(
      a.title||'', a.org||'', a.sol||'', a.priority||'중',
      a.deadline||'확인필요', a.budget||'미공개',
      a.summary||'', a.source||'', a.published_at||null, now,
      a.src_type||'bank'
    );
    if (r.changes) saved++;
  }
  return saved;
}

export function queryBizOpps({ org, sol, priority, srcType, dateFrom, dateTo } = {}) {
  const db = getDb();
  const conds = [], params = [];
  if (org)      { conds.push(`org = ?`);               params.push(org); }
  if (sol)      { conds.push(`sol = ?`);               params.push(sol); }
  if (priority) { conds.push(`priority = ?`);          params.push(priority); }
  if (srcType)  { conds.push(`src_type = ?`);          params.push(srcType); }
  if (dateFrom) { conds.push(`DATE(collected_at) >= ?`); params.push(dateFrom); }
  if (dateTo)   { conds.push(`DATE(collected_at) <= ?`); params.push(dateTo); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM biz_opps ${where} ORDER BY priority='상' DESC, priority='중' DESC, id DESC`
  ).all(...params);
}

export function getBizStats() {
  const db = getDb();
  return {
    total:        db.prepare(`SELECT COUNT(*) as c FROM biz_opps`).get().c,
    byOrg:        db.prepare(`SELECT org, COUNT(*) as c FROM biz_opps GROUP BY org ORDER BY c DESC`).all(),
    bySol:        db.prepare(`SELECT sol, COUNT(*) as c FROM biz_opps GROUP BY sol ORDER BY c DESC`).all(),
    byPriority:   db.prepare(`SELECT priority, COUNT(*) as c FROM biz_opps GROUP BY priority`).all(),
    bySrcType:    db.prepare(`SELECT src_type, COUNT(*) as c FROM biz_opps GROUP BY src_type`).all(),
    lastCollected:db.prepare(`SELECT collected_at FROM biz_opps ORDER BY id DESC LIMIT 1`).get()?.collected_at || null,
    dates:        db.prepare(`SELECT DATE(collected_at) as d, COUNT(*) as c FROM biz_opps GROUP BY d ORDER BY d DESC LIMIT 30`).all(),
  };
}

export function getArticleById(id) {
  return getDb().prepare(`SELECT * FROM articles WHERE id = ?`).get(id) || null;
}

export function updateArticleContent(id, content) {
  getDb().prepare(`UPDATE articles SET content = ? WHERE id = ?`).run(content, id);
}
