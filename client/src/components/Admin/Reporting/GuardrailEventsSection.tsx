import { useState, useCallback, useMemo } from 'react';
import type {
  GuardrailEventsResponse,
  GuardrailEventsQueryParams,
} from 'librechat-data-provider';
import { useGetGuardrailEvents } from '~/data-provider';
import { formatNumber } from './utils';
import PaginationControls from './PaginationControls';

interface GuardrailEventsSectionProps {
  startDate: string;
  endDate: string;
}

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'block', label: 'Blocked' },
  { value: 'warn', label: 'Warned' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'pii', label: 'PII Detection' },
];

function actionBadge(action: string) {
  if (action === 'block') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Blocked
      </span>
    );
  }
  if (action === 'warn') {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        Warned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
      {action}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Guardrail Events section for the admin reporting dashboard.
 * Shows summary cards, filter controls, and a paginated events table.
 */
export default function GuardrailEventsSection({
  startDate,
  endDate,
}: GuardrailEventsSectionProps) {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const params: GuardrailEventsQueryParams = useMemo(() => {
    const p: GuardrailEventsQueryParams = { startDate, endDate, offset };
    if (actionFilter) {
      p.action = actionFilter;
    }
    if (typeFilter) {
      p.guardrailType = typeFilter;
    }
    return p;
  }, [startDate, endDate, offset, actionFilter, typeFilter]);

  const { data, isLoading, isError, refetch } = useGetGuardrailEvents(params);

  const events = data?.data?.events || [];
  const summary = data?.data?.summary;
  const pagination = data?.meta?.pagination;

  const handleActionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setActionFilter(e.target.value);
    setOffset(0);
  }, []);

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTypeFilter(e.target.value);
    setOffset(0);
  }, []);

  return (
    <div>
      <h2 className="mb-4 text-base font-semibold text-text-primary dark:text-white">
        Guardrail Events
      </h2>

      {/* Summary Cards */}
      {summary && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border-light bg-surface-primary p-3 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-xs font-medium text-text-secondary dark:text-gray-400">
              Total Events
            </h3>
            <p className="mt-0.5 text-lg font-semibold text-text-primary dark:text-white">
              {formatNumber(summary.totalEvents)}
            </p>
          </div>
          <div className="rounded-lg border border-border-light bg-surface-primary p-3 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-xs font-medium text-text-secondary dark:text-gray-400">Blocked</h3>
            <p className="mt-0.5 text-lg font-semibold text-red-600 dark:text-red-400">
              {formatNumber(summary.byAction?.block || 0)}
            </p>
          </div>
          <div className="rounded-lg border border-border-light bg-surface-primary p-3 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-xs font-medium text-text-secondary dark:text-gray-400">Warned</h3>
            <p className="mt-0.5 text-lg font-semibold text-yellow-600 dark:text-yellow-400">
              {formatNumber(summary.byAction?.warn || 0)}
            </p>
          </div>
          <div className="rounded-lg border border-border-light bg-surface-primary p-3 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-xs font-medium text-text-secondary dark:text-gray-400">
              Users Affected
            </h3>
            <p className="mt-0.5 text-lg font-semibold text-text-primary dark:text-white">
              {formatNumber(summary.uniqueUsers)}
            </p>
          </div>
        </div>
      )}

      {/* Filters and Table */}
      <div className="rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary dark:text-white">Event Log</h3>
          <div className="flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={handleTypeChange}
              className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={handleActionChange}
              className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load guardrail events.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-1 text-sm font-medium text-red-700 underline dark:text-red-300"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <p className="py-6 text-center text-sm text-text-tertiary dark:text-gray-500">
            No guardrail events for the selected period and filters.
          </p>
        )}

        {!isLoading && !isError && events.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border-light dark:border-gray-700">
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Date
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      User
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Type
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Action
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Entity Types
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Route
                    </th>
                    <th className="px-3 py-2 font-medium text-text-secondary dark:text-gray-400">
                      Chat
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event._id}
                      className="border-b border-border-light/50 dark:border-gray-700/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-text-secondary dark:text-gray-400">
                        {formatDate(event.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-text-primary dark:text-gray-200">
                          {event.userName}
                        </div>
                        <div className="text-xs text-text-tertiary dark:text-gray-500">
                          {event.userEmail}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-text-primary dark:text-gray-200">
                        {event.guardrailType}
                      </td>
                      <td className="px-3 py-2">{actionBadge(event.action)}</td>
                      <td className="px-3 py-2 text-text-secondary dark:text-gray-400">
                        {event.details?.entityTypes?.join(', ') || '-'}
                      </td>
                      <td className="px-3 py-2 text-text-secondary dark:text-gray-400">
                        {event.route || '-'}
                      </td>
                      <td className="px-3 py-2">
                        {event.conversationId ? (
                          <a
                            href={`/c/${event.conversationId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-text-tertiary dark:text-gray-500">-</span>
                        )}
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
                onPageChange={setOffset}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
