import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys, SystemRoles } from 'librechat-data-provider';
import { ArrowLeft } from 'lucide-react';
import { useAuthContext, useCustomLink } from '~/hooks';
import {
  useGetUsageOverview,
  useGetUsageTrends,
  useGetUsageModels,
  useGetUsageTopUsers,
  useGetUsageActivity,
} from '~/data-provider';
import { getDefaultDateRange } from './utils';
import DateRangePicker from './DateRangePicker';
import OverviewCards from './OverviewCards';
import UsageTrendsTable from './UsageTrendsTable';
import ModelBreakdownTable from './ModelBreakdownTable';
import TopUsersTable from './TopUsersTable';
import UserActivityTable from './UserActivityTable';
import UserDetailPanel from './UserDetailPanel';
import GuardrailEventsSection from './GuardrailEventsSection';

/**
 * REQ-010: Admin-only reporting dashboard page.
 * Renders at /d/reporting.
 */
export default function ReportingDashboard() {
  const { user } = useAuthContext();

  // Admin gate: FAIL-002
  if (!user || user.role !== SystemRoles.ADMIN) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-text-primary dark:text-white">Access Denied</h1>
          <p className="mt-2 text-sm text-text-secondary dark:text-gray-400">
            You do not have permission to view usage reports. Contact your administrator to request
            the READ_USAGE capability.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <BackToChat />
      <ReportingDashboardInner />
    </>
  );
}

function BackToChat() {
  const chatLinkHandler = useCustomLink('/c/new');
  return (
    <div className="mr-2 mt-2 flex h-10 items-center px-2">
      <a
        href="/"
        className="flex flex-row items-center gap-1 text-sm text-text-secondary hover:text-text-primary dark:text-gray-400 dark:hover:text-white"
        onClick={chatLinkHandler}
      >
        <ArrowLeft className="icon-xs" aria-hidden="true" />
        Back to Chat
      </a>
    </div>
  );
}

function ReportingDashboardInner() {
  const queryClient = useQueryClient();
  const defaults = getDefaultDateRange();

  // Date range state
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  // Granularity for trends
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');

  // Pagination states
  const [modelsOffset, setModelsOffset] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [activityOffset, setActivityOffset] = useState(0);

  // Search states
  const [usersSearch, setUsersSearch] = useState('');
  const [activitySearch, setActivitySearch] = useState('');

  // Debounce search: only send to API when >= 2 chars
  const usersSearchParam = usersSearch.length >= 2 ? usersSearch : undefined;
  const activitySearchParam = activitySearch.length >= 2 ? activitySearch : undefined;

  // User detail panel
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const dateParams = useMemo(
    () => ({ startDate, endDate }),
    [startDate, endDate],
  );

  // Queries (all share the same date range)
  const overview = useGetUsageOverview(dateParams);
  const trends = useGetUsageTrends({ ...dateParams, granularity });
  const models = useGetUsageModels({ ...dateParams, offset: modelsOffset });
  const topUsers = useGetUsageTopUsers({
    ...dateParams,
    offset: usersOffset,
    search: usersSearchParam,
  });
  const activity = useGetUsageActivity({
    ...dateParams,
    offset: activityOffset,
    search: activitySearchParam,
  });

  const handleDateChange = useCallback(
    (newStart: string, newEnd: string) => {
      setStartDate(newStart);
      setEndDate(newEnd);
      // Reset pagination when date changes
      setModelsOffset(0);
      setUsersOffset(0);
      setActivityOffset(0);
    },
    [],
  );

  // REQ-018: Manual refresh button
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.usageOverview] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.usageTrends] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.usageModels] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.usageTopUsers] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.usageActivity] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.guardrailEvents] });
  }, [queryClient]);

  const handleUsersSearch = useCallback((s: string) => {
    setUsersSearch(s);
    setUsersOffset(0);
  }, []);

  const handleActivitySearch = useCallback((s: string) => {
    setActivitySearch(s);
    setActivityOffset(0);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-text-primary dark:text-white">Usage Reports</h1>
            <p className="mt-0.5 text-sm text-text-secondary dark:text-gray-400">
              Internal Charges (Token Credits) — may differ from provider invoices
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded-md border border-border-light bg-surface-primary px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-tertiary dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Refresh
          </button>
        </div>

        {/* Date Range Picker — REQ-011 */}
        <div className="mb-6">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onDateChange={handleDateChange}
          />
        </div>

        {/* Overview Cards — REQ-001 */}
        <section className="mb-8">
          <OverviewCards
            data={overview.data?.data}
            isLoading={overview.isLoading}
            isError={overview.isError}
            refetch={() => overview.refetch()}
          />
        </section>

        {/* Usage Trends — REQ-002 */}
        <section className="mb-8 rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
          <UsageTrendsTable
            data={trends.data}
            isLoading={trends.isLoading}
            isError={trends.isError}
            refetch={() => trends.refetch()}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />
        </section>

        {/* Model Breakdown — REQ-003 */}
        <section className="mb-8 rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
          <ModelBreakdownTable
            data={models.data}
            isLoading={models.isLoading}
            isError={models.isError}
            refetch={() => models.refetch()}
            offset={modelsOffset}
            limit={50}
            onPageChange={setModelsOffset}
          />
        </section>

        {/* Users Section — REQ-004 + REQ-006 as separate tables */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-text-primary dark:text-white">Users</h2>

          {/* REQ-004: Top Users by Spend */}
          <div className="mb-6 rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
            <TopUsersTable
              data={topUsers.data}
              isLoading={topUsers.isLoading}
              isError={topUsers.isError}
              refetch={() => topUsers.refetch()}
              offset={usersOffset}
              limit={50}
              search={usersSearch}
              onPageChange={setUsersOffset}
              onSearchChange={handleUsersSearch}
              onUserClick={setSelectedUserId}
            />
          </div>

          {/* REQ-006: User Activity */}
          <div className="rounded-lg border border-border-light bg-surface-primary p-4 dark:border-gray-700 dark:bg-gray-800">
            <UserActivityTable
              data={activity.data}
              isLoading={activity.isLoading}
              isError={activity.isError}
              refetch={() => activity.refetch()}
              offset={activityOffset}
              limit={50}
              search={activitySearch}
              onPageChange={setActivityOffset}
              onSearchChange={handleActivitySearch}
            />
          </div>
        </section>

        {/* Guardrail Events */}
        <section className="mb-8">
          <GuardrailEventsSection startDate={startDate} endDate={endDate} />
        </section>

        {/* REQ-005: User Detail Panel */}
        {selectedUserId && (
          <UserDetailPanel
            userId={selectedUserId}
            startDate={startDate}
            endDate={endDate}
            onClose={() => setSelectedUserId(null)}
          />
        )}
      </div>
    </div>
  );
}
