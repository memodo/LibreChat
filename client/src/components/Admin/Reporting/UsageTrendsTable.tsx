import { useState } from 'react';
import type { UsageTrendsResponse, UsageTrendsQueryParams } from 'librechat-data-provider';
import { formatCreditsWithUSD, formatNumber } from './utils';
import ExportButton from './ExportButton';

interface UsageTrendsTableProps {
  data: UsageTrendsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  granularity: 'day' | 'week' | 'month';
  onGranularityChange: (g: 'day' | 'week' | 'month') => void;
}

/**
 * REQ-002: Usage trends time-series table.
 */
export default function UsageTrendsTable({
  data,
  isLoading,
  isError,
  refetch,
  granularity,
  onGranularityChange,
}: UsageTrendsTableProps) {
  const buckets = data?.data?.buckets || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text-primary dark:text-white">Usage Trends</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border-light dark:border-gray-600">
            {(['day', 'week', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGranularityChange(g)}
                className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  granularity === g
                    ? 'bg-green-600 text-white'
                    : 'text-text-secondary hover:bg-surface-tertiary dark:text-gray-300 dark:hover:bg-gray-700'
                } first:rounded-l-md last:rounded-r-md`}
              >
                {g}
              </button>
            ))}
          </div>
          <ExportButton
            headers={['Date', 'Total Spend', 'Raw Tokens', 'Transactions', 'Cancelled', 'Active Users']}
            rows={buckets.map((b) => ({
              date: b.date,
              totalTokenValue: b.totalTokenValue,
              totalRawTokens: b.totalRawTokens,
              transactionCount: b.transactionCount,
              cancelledCount: b.cancelledCount,
              activeUsers: b.activeUsers,
            }))}
            columns={['date', 'totalTokenValue', 'totalRawTokens', 'transactionCount', 'cancelledCount', 'activeUsers']}
            filename={`usage-trends-${granularity}.csv`}
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
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load trends data.</p>
          <button type="button" onClick={refetch} className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && buckets.length === 0 && (
        <p className="py-6 text-center text-sm text-text-tertiary dark:text-gray-500">
          No usage data yet for the selected period.
        </p>
      )}

      {!isLoading && !isError && buckets.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-light dark:border-gray-700">
                <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Date</th>
                <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Spend</th>
                <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Raw Tokens</th>
                <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Transactions</th>
                <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Cancelled</th>
                <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Active Users</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.date} className="border-b border-border-light/50 dark:border-gray-700/50">
                  <td className="px-3 py-2 text-text-primary dark:text-gray-200">{bucket.date}</td>
                  <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                    {formatCreditsWithUSD(bucket.totalTokenValue)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                    {formatNumber(bucket.totalRawTokens)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                    {formatNumber(bucket.transactionCount)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                    {formatNumber(bucket.cancelledCount)}
                  </td>
                  <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                    {formatNumber(bucket.activeUsers)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
