// 나라장터 공공데이터포털 API — 사전규격 공개 + 입찰공고 수집
// API 키 발급: https://www.data.go.kr → "나라장터" 검색 → 오픈API 신청
// .env 에 G2B_SERVICE_KEY=<인증키(Encoding)> 추가

import { insertBizOpps, initBizOppsTable } from './db.js';

const SERVICE_KEY = process.env.G2B_SERVICE_KEY || '';
const BASE = 'https://apis.data.go.kr/1230000';

const IT_KW = [
  'OCR', '문자인식', 'IDP', '지능형문서처리',
  'RPA', '로봇프로세스자동화', '업무자동화',
  '신분증', '본인확인', '비대면인증', '신원확인',
  '이미지시스템', '스캔시스템', '전자문서', '이미지처리',
  '디지털창구', '스마트창구', '키오스크', '무인창구',
  '인공지능', 'AI', '딥러닝', '머신러닝',
];

const SOL_MAP = [
  { re: /OCR|문자인식|IDP|지능형문서/,           sol: 'ocr'     },
  { re: /이미지시스템|스캔|전자문서|이미지처리/,   sol: 'image'   },
  { re: /RPA|로봇프로세스|업무자동화/,            sol: 'rpa'     },
  { re: /신분증|본인확인|비대면인증|신원확인/,      sol: 'id'      },
  { re: /디지털창구|스마트창구|키오스크|무인창구/,  sol: 'digital' },
];

function detectSol(text) {
  for (const { re, sol } of SOL_MAP) if (re.test(text)) return sol;
  return 'digital';
}

function matchesIT(text) {
  return IT_KW.some(kw => text.includes(kw));
}

function fmtPrice(val) {
  const n = Number(val);
  if (!n) return '미공개';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}만원`;
  return `${n.toLocaleString()}원`;
}

async function g2bFetch(endpoint, extra = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('serviceKey', SERVICE_KEY);
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', '100');
  url.searchParams.set('pageNo', '1');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  // 인증키 오류 감지
  const code = json?.response?.header?.resultCode;
  if (code && code !== '00') {
    throw new Error(`API 오류 [${code}]: ${json?.response?.header?.resultMsg}`);
  }
  const raw = json?.response?.body?.items?.item ?? [];
  return Array.isArray(raw) ? raw : [raw];
}

// ── 사전규격 공개 ─────────────────────────────────────────
async function collectPreSpecs(fromDt, toDt) {
  const items = await g2bFetch('PlanInfoService/getPlanInfoServcPPSSrch', { fromDt, toDt });
  return items
    .filter(it => matchesIT(it.oddsNm || it.bidNtceNm || ''))
    .map(it => ({
      title:        `[사전규격] ${it.oddsNm || it.bidNtceNm || '제목없음'}`,
      org:          it.ntceInsttNm || it.dminsttNm || '조달청',
      sol:          detectSol(it.oddsNm || it.bidNtceNm || ''),
      priority:     '중',
      deadline:     it.opengRqstRcptClseDt?.slice(0, 10) || '확인필요',
      budget:       fmtPrice(it.presmptPrce),
      summary:      `사전규격 공개 | 기관: ${it.ntceInsttNm || '-'} | 공개일: ${it.opengDt?.slice(0, 10) || '-'}`,
      source:       it.lnkUrl || 'https://www.g2b.go.kr',
      published_at: it.opengDt?.slice(0, 10) || null,
    }));
}

// ── 입찰공고 목록 ─────────────────────────────────────────
async function collectBidNotices(fromDt, toDt) {
  const items = await g2bFetch('BidPublicInfoService/getBidPblancListInfoServc', {
    inqryDiv: '1', fromDt, toDt,
  });
  return items
    .filter(it => matchesIT(it.bidNtceNm || ''))
    .map(it => ({
      title:        `[입찰공고] ${it.bidNtceNm || '제목없음'}`,
      org:          it.ntceInsttNm || it.dminsttNm || '조달청',
      sol:          detectSol(it.bidNtceNm || ''),
      priority:     '상',
      deadline:     it.bidClseDt?.slice(0, 10) || '확인필요',
      budget:       fmtPrice(it.presmptPrce),
      summary:      `입찰공고 | 기관: ${it.ntceInsttNm || '-'} | 마감: ${it.bidClseDt?.slice(0, 10) || '-'}`,
      source:       it.lnkUrl || 'https://www.g2b.go.kr',
      published_at: it.bidNtceDt?.slice(0, 10) || null,
    }));
}

// ── 발주목록 (물품·용역·공사 구분) ───────────────────────
async function collectOrderList(fromDt, toDt) {
  // 용역/소프트웨어 발주 목록
  const items = await g2bFetch('BidPublicInfoService/getBidPblancListInfoServc', {
    inqryDiv: '1', fromDt, toDt, bidMethdNm: '일반경쟁',
  });
  return items
    .filter(it => matchesIT(it.bidNtceNm || ''))
    .map(it => ({
      title:        `[발주] ${it.bidNtceNm || '제목없음'}`,
      org:          it.ntceInsttNm || it.dminsttNm || '조달청',
      sol:          detectSol(it.bidNtceNm || ''),
      priority:     '상',
      deadline:     it.bidClseDt?.slice(0, 10) || '확인필요',
      budget:       fmtPrice(it.presmptPrce),
      summary:      `발주목록 | 기관: ${it.ntceInsttNm || '-'} | 입찰방법: ${it.bidMethdNm || '-'} | 마감: ${it.bidClseDt?.slice(0, 10) || '-'}`,
      source:       it.lnkUrl || 'https://www.g2b.go.kr',
      published_at: it.bidNtceDt?.slice(0, 10) || null,
    }));
}

export async function main() {
  if (!SERVICE_KEY) {
    console.log('\n❌ G2B_SERVICE_KEY 가 설정되지 않았습니다.');
    console.log('   1. https://www.data.go.kr 에서 회원가입');
    console.log('   2. "나라장터" → 입찰공고정보서비스, 사전규격정보서비스 신청');
    console.log('   3. .env 에 G2B_SERVICE_KEY=<인증키(Encoding)> 추가\n');
    return { total_raw: 0, total_saved: 0 };
  }

  // KST 오늘 날짜 (YYYYMMDD)
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const fromDt = kstNow.toISOString().slice(0, 10).replace(/-/g, '');
  const toDt   = fromDt;

  const today = kstNow.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n🏛️  나라장터 수집 시작 — ${today} (${fromDt})`);
  console.log('='.repeat(60));

  const all = [];

  const tasks = [
    { label: '사전규격 공개', fn: () => collectPreSpecs(fromDt, toDt) },
    { label: '입찰공고 목록', fn: () => collectBidNotices(fromDt, toDt) },
    { label: '발주목록',       fn: () => collectOrderList(fromDt, toDt) },
  ];

  for (const { label, fn } of tasks) {
    process.stdout.write(`  ${label} ... `);
    try {
      const items = await fn();
      all.push(...items);
      console.log(`✅ ${items.length}건 (IT 관련)`);
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 80)}`);
    }
  }

  initBizOppsTable();
  const saved = insertBizOpps(all);
  console.log('='.repeat(60));
  console.log(`✅ 완료 — 발견 ${all.length}건 | 신규 저장 ${saved}건`);
  return { total_raw: all.length, total_saved: saved };
}

if (process.argv[1].replace(/\\/g, '/').endsWith('src/collect-g2b.js')) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
