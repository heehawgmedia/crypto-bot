export const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
export const fmtSf = (n: number): string => `${fmtInt(n)} sf`;

/** 12 -> 12', 12.5 -> 12'6" */
export function fmtFt(n: number): string {
  const whole = Math.floor(n);
  const inches = Math.round((n - whole) * 12);
  if (inches === 0) return `${whole}'`;
  if (inches === 12) return `${whole + 1}'`;
  return `${whole}'${inches}"`;
}
