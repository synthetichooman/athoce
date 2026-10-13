export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function submissionsCsv(rows) {
  const columns = [
    ['신청 코드', 'code'], ['제출 시각', 'submittedAt'], ['성함', 'fullName'],
    ['instagram', 'instagram'], ['연락처', 'phone'], ['주소', 'address'],
    ['동반인원 수', 'guests'], ['촬영 동의', 'filmingConsent'],
  ];
  return '\uFEFF' + [columns.map(([label]) => csvCell(label)).join(','),
    ...rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(','))].join('\r\n');
}
