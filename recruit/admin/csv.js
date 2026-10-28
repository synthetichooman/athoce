export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function submissionsCsv(rows) {
  const columns = [
    ['지원 코드', 'code'], ['제출 시각', 'submittedAt'], ['이름', 'fullName'],
    ['인스타그램', 'instagram'], ['연락처', 'phone'],
    ['근무 가능 요일', 'availableDays'], ['자기소개', 'introduction'],
  ];
  return '\uFEFF' + [columns.map(([label]) => csvCell(label)).join(','),
    ...rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(','))].join('\r\n');
}
