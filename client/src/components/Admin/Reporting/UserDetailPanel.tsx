import type { UsageUserDetailResponse } from 'librechat-data-provider';
import { useGetUsageUserDetail } from '~/data-provider';
import { formatCreditsWithUSD, formatNumber } from './utils';

interface UserDetailPanelProps {
  userId: string;
  startDate: string;
  endDate: string;
  onClose: () => void;
}

/**
 * REQ-005: Single user detail view.
 */
export default function UserDetailPanel({ userId, startDate, endDate, onClose }: UserDetailPanelProps) {
  const { data, isLoading, isError, refetch } = useGetUsageUserDetail(userId, {
    startDate,
    endDate,
  });

  const user = data?.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-border-light bg-surface-primary p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary dark:text-white">User Detail</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-tertiary dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading && (
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-36 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-20 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">Failed to load user detail.</p>
            <button type="button" onClick={() => refetch()} className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300">
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && user && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-text-primary dark:text-white">{user.name}</p>
              <p className="text-xs text-text-secondary dark:text-gray-400">{user.email}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-text-tertiary dark:text-gray-500">Total Spend</p>
                <p className="text-sm font-semibold text-text-primary dark:text-white">
                  {formatCreditsWithUSD(user.totalTokenValue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary dark:text-gray-500">Transactions</p>
                <p className="text-sm font-semibold text-text-primary dark:text-white">
                  {formatNumber(user.transactionCount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary dark:text-gray-500">Conversations</p>
                <p className="text-sm font-semibold text-text-primary dark:text-white">
                  {formatNumber(user.conversationCount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-tertiary dark:text-gray-500">Last Active</p>
                <p className="text-sm font-semibold text-text-primary dark:text-white">
                  {user.lastActiveDate ? new Date(user.lastActiveDate).toLocaleString() : 'N/A'}
                </p>
              </div>
            </div>

            {user.modelBreakdown.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary dark:text-gray-400">
                  Model Breakdown
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border-light dark:border-gray-700">
                        <th className="px-2 py-1.5 font-medium text-text-secondary dark:text-gray-400">Model</th>
                        <th className="px-2 py-1.5 text-right font-medium text-text-secondary dark:text-gray-400">Spend</th>
                        <th className="px-2 py-1.5 text-right font-medium text-text-secondary dark:text-gray-400">Txns</th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.modelBreakdown.map((mb) => (
                        <tr key={mb.model} className="border-b border-border-light/50 dark:border-gray-700/50">
                          <td className="px-2 py-1.5 font-mono text-text-primary dark:text-gray-200">
                            {mb.model || '(unknown)'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-text-primary dark:text-gray-200">
                            {formatCreditsWithUSD(mb.totalTokenValue)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-text-primary dark:text-gray-200">
                            {formatNumber(mb.transactionCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
