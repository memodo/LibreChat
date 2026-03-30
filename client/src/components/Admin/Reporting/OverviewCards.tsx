import type { UsageOverviewResponse } from 'librechat-data-provider';
import { formatCreditsWithUSD, formatNumber } from './utils';

interface OverviewCardsProps {
  data: UsageOverviewResponse['data'] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="h-6 w-32 rounded bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}

/**
 * REQ-001/REQ-005: Overview summary cards.
 * REQ-013: Cancellation breakdown display.
 * UX-001: Internal charges labeling.
 */
export default function OverviewCards({ data, isLoading, isError, refetch }: OverviewCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load overview data.</p>
        <button
          type="button"
          onClick={refetch}
          className="mt-2 text-sm font-medium text-red-700 underline dark:text-red-300"
        >
          Retry
        </button>
      </div>
    );
  }

  const cards = [
    {
      label: 'Registered Users',
      value: formatNumber(data.totalRegisteredUsers),
    },
    {
      label: 'Active Users',
      value: formatNumber(data.activeUsers),
      subtitle: 'Users with at least one transaction in period',
    },
    {
      label: 'Conversations',
      value: formatNumber(data.totalConversations),
    },
    {
      label: 'Total Spend',
      value: formatCreditsWithUSD(data.totalTokenValue),
      subtitle: 'Internal Charges (Token Credits)',
      tooltip:
        'These are internal LibreChat charges (token credits) and may differ from actual provider invoices due to cancellation surcharges and custom endpoint pricing.',
    },
    {
      label: 'Transactions',
      value: formatNumber(data.totalTransactions),
    },
    {
      label: 'Cancelled Request Spend',
      value: formatCreditsWithUSD(data.cancellation.totalIncompleteSpend),
      subtitle: `Est. Cancellation Surcharge (~15%): ${formatCreditsWithUSD(data.cancellation.estimatedSurchargeAmount)}`,
      tooltip:
        'When a request is cancelled or incomplete, LibreChat applies a 15% surcharge to the token cost. "Cancelled Request Spend" is the total charged for these requests. "Est. Cancellation Surcharge" is the approximate amount above what would have been charged at normal rates.',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium text-text-secondary dark:text-gray-400">
              {card.label}
            </h3>
            {card.tooltip && (
              <span
                title={card.tooltip}
                className="cursor-help text-text-tertiary dark:text-gray-500"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            )}
          </div>
          <p className="mt-1 text-lg font-semibold text-text-primary dark:text-white">
            {card.value}
          </p>
          {card.subtitle && (
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-gray-500">{card.subtitle}</p>
          )}
        </div>
      ))}
    </div>
  );
}
