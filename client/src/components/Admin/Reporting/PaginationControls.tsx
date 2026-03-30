interface PaginationControlsProps {
  offset: number;
  limit: number;
  total: number;
  onPageChange: (newOffset: number) => void;
}

export default function PaginationControls({
  offset,
  limit,
  total,
  onPageChange,
}: PaginationControlsProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <p className="text-xs text-text-secondary dark:text-gray-400">
        Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          className="rounded px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Previous
        </button>
        <span className="px-2 py-1 text-xs text-text-secondary dark:text-gray-400">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(offset + limit)}
          className="rounded px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}
