import { useState, useCallback } from 'react';
import type { UsageTopUsersResponse } from 'librechat-data-provider';
import { formatCreditsWithUSD, formatNumber } from './utils';
import PaginationControls from './PaginationControls';
import ExportButton from './ExportButton';

interface TopUsersTableProps {
  data: UsageTopUsersResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  offset: number;
  limit: number;
  search: string;
  onPageChange: (offset: number) => void;
  onSearchChange: (search: string) => void;
  onUserClick?: (userId: string) => void;
}

/**
 * REQ-004: Top users by spend with search and pagination.
 */
export default function TopUsersTable({
  data,
  isLoading,
  isError,
  refetch,
  offset,
  limit,
  search,
  onPageChange,
  onSearchChange,
  onUserClick,
}: TopUsersTableProps) {
  const users = data?.data?.users || [];
  const pagination = data?.meta?.pagination;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary dark:text-white">
          Top Users by Spend
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
          <ExportButton
            headers={['User', 'Email', 'Spend', 'Transactions']}
            rows={users.map((u) => ({
              name: u.name,
              email: u.email,
              totalTokenValue: u.totalTokenValue,
              transactionCount: u.transactionCount,
            }))}
            columns={['name', 'email', 'totalTokenValue', 'transactionCount']}
            filename="top-users-spend.csv"
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
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load user spend data.</p>
          <button type="button" onClick={refetch} className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && users.length === 0 && (
        <p className="py-6 text-center text-sm text-text-tertiary dark:text-gray-500">
          No user spend data for the selected period.
        </p>
      )}

      {!isLoading && !isError && users.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-light dark:border-gray-700">
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Name</th>
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Email</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Spend</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.userId}
                    className={`border-b border-border-light/50 dark:border-gray-700/50 ${onUserClick ? 'cursor-pointer hover:bg-surface-secondary dark:hover:bg-gray-750' : ''}`}
                    onClick={() => onUserClick?.(user.userId)}
                  >
                    <td className="px-3 py-2 text-text-primary dark:text-gray-200">{user.name}</td>
                    <td className="px-3 py-2 text-text-secondary dark:text-gray-400">{user.email}</td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatCreditsWithUSD(user.totalTokenValue)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatNumber(user.transactionCount)}
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
