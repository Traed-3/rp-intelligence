/**
 * One spreadsheet-safe CSV cell.
 *
 * Every value is quoted and embedded quotes are doubled, so commas, quotes and
 * line breaks in a name or note can't break the row apart. Text that starts
 * with =, +, -, @, tab or carriage return gets a leading apostrophe so Excel
 * and Sheets show it as text instead of running it as a formula. Plain numbers
 * (including negatives like -12.50) are left alone.
 */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  const isNumber = /^-?\d+(\.\d+)?$/.test(s)
  const safe = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

/** Join rows of raw values into CSV text, escaping every cell. */
export function toCsv(rows: unknown[][], newline = '\n'): string {
  return rows.map(r => r.map(csvCell).join(',')).join(newline)
}
