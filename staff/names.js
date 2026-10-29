const aliases = { aategois: 'at', hooman: 'ho', cementbay: 'ce' };
export function employeeLabel(employee) {
  if (!employee) return '사용 중지된 직원';
  return employee.role === 'core' ? aliases[employee.name.trim().toLowerCase()] || employee.name : employee.name;
}
