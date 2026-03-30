/**
 * Convert tokenValue to USD.
 * costUSD = tokenValue / 1,000,000
 */
export function tokenValueToUSD(tokenValue: number): number {
  return tokenValue / 1_000_000;
}

/**
 * Format a token credit value with USD equivalent.
 * REQ-012: "12,500 credits ($0.0125)"
 */
export function formatCreditsWithUSD(tokenValue: number): string {
  const credits = tokenValue.toLocaleString();
  const usd = tokenValueToUSD(tokenValue).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  return `${credits} credits (${usd})`;
}

/**
 * Format a number with locale-aware thousands separators.
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/**
 * Get default date range (last 30 days).
 */
export function getDefaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

/**
 * Date range presets.
 */
export const DATE_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
] as const;

/**
 * Sanitize a CSV cell value to prevent formula injection.
 * Cells starting with =, +, -, @, \t, or \r are prefixed with a single quote
 * to prevent spreadsheet applications from interpreting them as formulas.
 */
function sanitizeCSVCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Convert table data to CSV string.
 * REQ-014: CSV export.
 * Sanitizes values to prevent CSV injection (finding 3.1).
 */
export function tableToCSV(
  headers: string[],
  rows: Array<Record<string, string | number>>,
  columns: string[],
): string {
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      const strVal = sanitizeCSVCell(String(val ?? ''));
      if (strVal.includes(',')) {
        return `"${strVal}"`;
      }
      return strVal;
    }).join(','),
  );
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Trigger a CSV file download in the browser.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
