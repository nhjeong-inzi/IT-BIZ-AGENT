export const MEDIA_SOURCES = [
  '매일경제', '한국경제', '이데일리', '머니투데이', '아시아경제',
  '연합뉴스', '파이낸셜뉴스', '서울경제', '헤럴드경제', '뉴스1',
  '디지털데일리', 'ZDNet Korea', '더벨', '비즈니스포스트',
];

export const CATEGORIES = [
  {
    key: 'ocr',
    label: 'AI OCR',
    icon: '🔍',
    color: '#0F6E56',
    bg: '#E1F5EE',
    queries: [
      '금융 AI OCR 문자인식 지능형문서처리',
      '은행 보험 OCR 자동화 도입',
    ],
  },
  {
    key: 'image',
    label: '이미지시스템',
    icon: '🖼️',
    color: '#185FA5',
    bg: '#E6F1FB',
    queries: [
      '금융기관 이미지시스템 문서 스캔 이미지처리',
      '은행 보험 전자문서 이미지 관리시스템',
    ],
  },
  {
    key: 'rpa',
    label: 'RPA',
    icon: '🤖',
    color: '#4338CA',
    bg: '#EEF2FF',
    queries: [
      '금융 RPA 로봇프로세스자동화 업무자동화',
      '은행 보험 증권 RPA 도입 자동화',
    ],
  },
  {
    key: 'id',
    label: '신분증 인식',
    icon: '🪪',
    color: '#7C3AED',
    bg: '#F5F3FF',
    queries: [
      '금융 신분증인식 본인확인 비대면 인증',
      '은행 신분증 신원확인 진위확인 도입',
    ],
  },
  {
    key: 'digital',
    label: '디지털창구',
    icon: '🏦',
    color: '#B45309',
    bg: '#FAEEDA',
    queries: [
      '은행 디지털창구 스마트창구 무인점포 키오스크',
      '금융기관 비대면창구 디지털점포 신기능',
    ],
  },
];

export const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
export const MAX_ARTICLES_PER_QUERY = 8;
