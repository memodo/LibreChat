import { useState } from 'react';
import type { UsageModelsResponse } from 'librechat-data-provider';
import { formatCreditsWithUSD, formatNumber } from './utils';
import PaginationControls from './PaginationControls';
import ExportButton from './ExportButton';

interface ModelBreakdownTableProps {
  data: UsageModelsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  offset: number;
  limit: number;
  onPageChange: (offset: number) => void;
}

/**
 * REQ-003: Per-model cost breakdown table.
 */
export default function ModelBreakdownTable({
  data,
  isLoading,
  isError,
  refetch,
  offset,
  limit,
  onPageChange,
}: ModelBreakdownTableProps) {
  const models = data?.data?.models || [];
  const pagination = data?.meta?.pagination;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary dark:text-white">
          Cost by Model
        </h2>
        <ExportButton
          headers={['Model', 'Total Spend', 'Prompt Tokens', 'Completion Tokens', 'Transactions']}
          rows={models.map((m) => ({
            model: m.model || '(unknown)',
            totalTokenValue: m.totalTokenValue,
            promptTokens: m.promptTokens,
            completionTokens: m.completionTokens,
            transactionCount: m.transactionCount,
          }))}
          columns={['model', 'totalTokenValue', 'promptTokens', 'completionTokens', 'transactionCount']}
          filename="cost-by-model.csv"
          isPaginated
        />
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
          <p className="text-sm text-red-600 dark:text-red-400">Failed to load model data.</p>
          <button type="button" onClick={refetch} className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && models.length === 0 && (
        <p className="py-6 text-center text-sm text-text-tertiary dark:text-gray-500">
          No model usage data for the selected period.
        </p>
      )}

      {!isLoading && !isError && models.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-light dark:border-gray-700">
                  <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">Model</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Spend</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Prompt Tokens</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Completion Tokens</th>
                  <th className="px-3 py-2 text-right font-medium text-text-secondary dark:text-gray-400">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.model} className="border-b border-border-light/50 dark:border-gray-700/50">
                    <td className="px-3 py-2 font-mono text-xs text-text-primary dark:text-gray-200">
                      {model.model || '(unknown)'}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatCreditsWithUSD(model.totalTokenValue)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatNumber(model.promptTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatNumber(model.completionTokens)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary dark:text-gray-200">
                      {formatNumber(model.transactionCount)}
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
