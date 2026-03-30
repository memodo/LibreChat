import { downloadCSV, tableToCSV } from './utils';

interface ExportButtonProps {
  headers: string[];
  rows: Array<Record<string, string | number>>;
  columns: string[];
  filename: string;
  isPaginated?: boolean;
}

/**
 * REQ-014: CSV export button.
 * Paginated tables export current page only.
 */
export default function ExportButton({
  headers,
  rows,
  columns,
  filename,
  isPaginated = false,
}: ExportButtonProps) {
  const handleExport = () => {
    const csv = tableToCSV(headers, rows, columns);
    downloadCSV(csv, filename);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      className="rounded-md border border-border-light bg-surface-primary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {isPaginated ? 'Export Current Page (CSV)' : 'Download CSV'}
    </button>
  );
}
