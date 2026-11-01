// Shared, versioned contract fields. No resident registration numbers are collected.
export const SCHEMA = 'athoce-employment-v1';
export const EMPLOYER_CONSENT = '계약 내용을 확인하였으며 고용주 또는 적법한 권한을 가진 대리인으로서 전자서명하고 서명을 요청합니다.';
export const WORKER_CONSENT = '계약 내용을 읽고 동의하며 본인의 이름으로 전자서명합니다. 사본을 받을 이메일을 직접 지정하고 전자문서 수령에 동의합니다.';
export const FIELDS = [
  ['employerName','고용주 상호·법인명','text',120,''],
  ['representative','대표자 또는 서명 권한자','text',80,''],
  ['employerAddress','사업장 주소','text',250,''],
  ['employerContact','고용주 연락처','text',80,''],
  ['workerName','근로자 성명','text',80,''],
  ['workerAddress','근로자 주소','text',250,''],
  ['workerContact','근로자 연락처','text',80,''],
  ['startDate','근무 시작일','date',10,''],
  ['endDate','근무 종료일 (비워두면 기간의 정함 없음)','date',10,'',true],
  ['workplace','근무 장소','text',250,'방울내로 56, 아토스 서울'],
  ['duties','담당 업무','textarea',1500,'매장 쇼룸 유지·관리 및 내점 고객 응대'],
  ['workDays','근로일·근로일별 시작 및 종료 시각','textarea',3000,''],
  ['breaks','휴게 시간 및 유·무급 여부','textarea',1000,''],
  ['hourlyRate','시간급 (원)','number',1000000,''],
  ['wageItems','임금 구성·수당','textarea',2000,'기본급은 시간급을 기준으로 산정하며, 주휴수당 등 적용되는 법정수당은 별도 산정한다.'],
  ['wageCalculation','임금 계산 방법','textarea',1500,'기본급 = 시간급 × 유급 근로시간. 수당 및 법정 공제는 해당 요건에 따라 별도 계산한다.'],
  ['payPeriod','임금 산정 기간','text',250,'전월 26일부터 당월 25일까지'],
  ['payDay','매월 임금 지급일','number',31,25],
  ['payMethod','임금 지급 방법','text',500,'근로자 명의 계좌로 이체'],
  ['holidays','휴일·주휴일','textarea',1500,''],
  ['annualLeave','연차유급휴가','textarea',1500,'관계 법령에 따라 적용되는 연차유급휴가를 부여한다.'],
  ['insurance','사회보험 적용','textarea',1000,''],
  ['otherTerms','그 밖의 합의 사항','textarea',2500,'',true],
];
export function defaultTerms(name = '') { return { ...Object.fromEntries(FIELDS.map(([key,,,,value]) => [key,value])), workerName:name }; }
export const STATES = { draft:'작성 중', requested:'서명 대기', signed:'서명 완료', withdrawn:'요청 취소' };
