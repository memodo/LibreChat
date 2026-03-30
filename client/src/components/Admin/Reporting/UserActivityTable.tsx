import type { UsageActivityResponse } from 'librechat-data-provider';
import { formatNumber } from './utils';
import PaginationControls from './PaginationControls';
import ExportButton from './ExportButton';

interface UserActivityTableProps {
  data: UsageActivityResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  offset: number;
  limit: number;
  search: string;
  onPageChange: (offset: number) => void;
  onSearchChange: (search: string) => void;
}

/**
 * REQ-006: User activity table (from Conversation collection).
 */
export default function UserActivityTable({
  data,
  isLoading,
  isError,
  refetch,
  offset,
  limit,
  search,
  onPageChange,
  onSearchChange,
}: UserActivityTableProps) {
  const users = data?.data?.users || [];
  const pagination = data?.meta?.pagination;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary dark:text-white">
          User Activity (Conversations)
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by user ID..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
          <ExportButton
            headers={['User ID', 'Conversations', 'Last Active', 'Models', 'Endpoints']}
            rows={users.map((u) => ({
              userId: u.userId,
              conversationCount: u.conversationCount,
              lastActive: u.lastActive ? new Date(u.lastActive).toLocaleString() : '',
              models: u.models.join('; '),
              endpoints: u.endpoints.join('; '),
            }))}
            columns={['userId', 'conversationCount', 'lastActive', 'models', 'endpoints']}
            filename="user-activity.csv"
            isPaginated
          />
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-gray-200 dark:bg-gray-700" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load activity data.</p>
          <button type="button" onClick={refetch} className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && users.length === 0 && (
        <p className="py-6 text-center text-sm text-text-tertiary dark:text-gray-500">
          No conversation activity for the selected period.
        </p>
      )}

      {!isLoading && !isError && users.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-light dark:border-gray-700">
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">User ID</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Conversations</th>
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Last Active</th>
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Models</th>
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Endpoints</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId} className="border-b border-border-light/50 dark:border-gray-700/50">
                    <td className="px-3 py-2 font-mono text-xs text-text-primary dark:text-gray-200">
                      {user.userId}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatNumber(user.conversationCount)}
                    </td>
                    <td className="px-3 py-2 text-text-secondary dark:text-gray-400">
                      {user.lastActive ? new Date(user.lastActive).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {user.models.filter(Boolean).map((model) => (
                          <span
                            key={model}
                            className="inline-block rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-secondary dark:bg-gray-700 dark:text-gray-300"
                          >
                            {model}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {user.endpoints.filter(Boolean).map((ep) => (
                          <span
                            key={ep}
                            className="inline-block rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-secondary dark:bg-gray-700 dark:text-gray-300"
                          >
                            {ep}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && (
            <PaginationControls
              offset={pagination.offset}
              limit={pagination.limit}
              total={pagination.total}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  );
}
