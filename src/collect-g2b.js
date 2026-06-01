// 나라장터 공공데이터포털 API — 사전규격 공개 수집
// 서비스: 조달청_나라장터 사전규격정보서비스 (data.go.kr 활용신청 필요)
// .env 에 G2B_SERVICE_KEY=<일반 인증키> 추가

import { insertBizOpps, initBizOppsTable } from './db.js';

const SERVICE_KEY = process.env.G2B_SERVICE_KEY || '';
const ENDPOINT = 'https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoThng';

const IT_KW = [
  'OCR', '문자인식', 'IDP', '지능형문서',
  'RPA', '로봇프로세스', '업무자동화',
  '신분증', '본인확인', '비대면', '신원확인',
  '이미지시스템', '스캔', '전자문서',
  '디지털창구', '스마트창구', '키오스크', '무인창구',
  '소프트웨어', 'SW', '인공지능', 'AI', '머신러닝',
];

const SOL_MAP = [
  { re: /OCR|문자인식|IDP|지능형문서/,           sol: 'ocr'     },
  { re: /이미지시스템|스캔|전자문서/,              sol: 'image'   },
  { re: /RPA|로봇프로세스|업무자동화/,             sol: 'rpa'     },
  { re: /신분증|본인확인|비대면|신원확인/,          sol: 'id'      },
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
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만원`;
  return `${n.toLocaleString()}원`;
}

// KST 날짜를 YYYYMMDDHHMM 형식으로 변환
function toG2BDate(date, time = '0000') {
  return date.toISOString().slice(0, 10).replace(/-/g, '') + time;
}

const ENDPOINTS = [
  { url: 'https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoThng',  biz_type: '물품', label: '사전규격 — 물품' },
  { url: 'https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc', biz_type: '용역', label: '사전규격 — 용역' },
];

async function fetchPreSpecs(endpoint, bgnDt, endDt, page = 1) {
  const url = new URL(endpoint);
  url.searchParams.set('serviceKey', SERVICE_KEY);
  url.searchParams.set('type', 'json');
  url.searchParams.set('numOfRows', '100');
  url.searchParams.set('pageNo', String(page));
  url.searchParams.set('inqryDiv', '1');
  url.searchParams.set('inqryBgnDt', bgnDt);
  url.searchParams.set('inqryEndDt', endDt);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const code = (json?.response?.header?.resultCode || json?.['nkoneps.com.response.ResponseError']?.header?.resultCode);
  if (code && code !== '00') {
    const msg = json?.response?.header?.resultMsg || json?.['nkoneps.com.response.ResponseError']?.header?.resultMsg || '';
    throw new Error(`API 오류 [${code}]: ${msg}`);
  }

  const raw = json?.response?.body?.items ?? [];
  return Array.isArray(raw) ? raw : (raw ? [raw] : []);
}

function toOpportunity(it) {
  const name = it.prdctClsfcNoNm || '';
  const detail = it.prdctDtlList || '';
  const text = name + ' ' + detail;
  return {
    title:        `[사전규격] ${name || '제목없음'}`,
    org:          it.orderInsttNm || it.rlDminsttNm || '조달청',
    sol:          detectSol(text),
    priority:     it.swBizObjYn === 'Y' ? '상' : '중',
    deadline:     it.opninRgstClseDt?.slice(0, 10) || '확인필요',
    budget:       fmtPrice(it.asignBdgtAmt),
    summary:      `[사전규격] ${name} | 기관: ${it.orderInsttNm || '-'} | 의견마감: ${it.opninRgstClseDt?.slice(0, 10) || '-'} | SW사업: ${it.swBizObjYn || 'N'}`,
    source:       it.specDocFileUrl1 || 'https://www.g2b.go.kr',
    published_at: it.rcptDt?.slice(0, 10) || null,
    src_type:     'g2b',
    biz_type:     it._biz_type || '',
  };
}

export async function main() {
  if (!SERVICE_KEY) {
    console.log('\n❌ G2B_SERVICE_KEY 가 설정되지 않았습니다.');
    console.log('   1. https://www.data.go.kr 에서 회원가입');
    console.log('   2. "나라장터 사전규격정보서비스" 검색 → 활용신청');
    console.log('   3. .env 에 G2B_SERVICE_KEY=<일반 인증키> 추가\n');
    return { total_raw: 0, total_saved: 0 };
  }

  // KST 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const todayDate = new Date(kstNow.toISOString().slice(0, 10));
  const bgnDt = toG2BDate(todayDate, '0000');
  const endDt = toG2BDate(todayDate, '2359');

  const today = kstNow.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n🏛️  나라장터 사전규격 수집 시작 — ${today}`);
  console.log(`   조회기간: ${bgnDt} ~ ${endDt}`);
  console.log('='.repeat(60));

  const allIT = [];

  for (const { url, biz_type, label } of ENDPOINTS) {
    process.stdout.write(`  ${label} ... `);
    try {
      const raw = await fetchPreSpecs(url, bgnDt, endDt);
      const itItems = raw
        .filter(it => {
          const text = (it.prdctClsfcNoNm || '') + ' ' + (it.prdctDtlList || '');
          return matchesIT(text) || it.swBizObjYn === 'Y';
        })
        .map(it => ({ ...it, _biz_type: biz_type }));
      allIT.push(...itItems);
      console.log(`✅ 전체 ${raw.length}건 → IT 관련 ${itItems.length}건`);
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 80)}`);
    }
  }

  const opportunities = allIT.map(toOpportunity);

  initBizOppsTable();
  const saved = insertBizOpps(opportunities);

  console.log('='.repeat(60));
  console.log(`✅ 완료 — IT 관련 ${allIT.length}건 | 신규 저장 ${saved}건`);

  if (allIT.length > 0) {
    console.log('\n수집된 IT 사전규격:');
    allIT.slice(0, 5).forEach(it => {
      console.log(`  · [${it.swBizObjYn==='Y'?'SW':'일반'}] ${it.prdctClsfcNoNm} / ${it.orderInsttNm} / ${fmtPrice(it.asignBdgtAmt)}`);
    });
  }

  return { total_raw: allIT.length, total_saved: saved };
}

if (process.argv[1].replace(/\\/g, '/').endsWith('src/collect-g2b.js')) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
