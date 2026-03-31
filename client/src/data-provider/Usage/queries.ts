import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';
import type {
  UsageOverviewResponse,
  UsageTrendsResponse,
  UsageModelsResponse,
  UsageTopUsersResponse,
  UsageUserDetailResponse,
  UsageActivityResponse,
  GuardrailEventsResponse,
  GuardrailSummaryResponse,
  GuardrailEventsQueryParams,
  AdminConversationResponse,
  UsageQueryParams,
  UsageTrendsQueryParams,
  UsagePaginatedQueryParams,
} from 'librechat-data-provider';

/** REQ-018: 5-minute staleTime, no window refocus refetch */
const defaultConfig = {
  staleTime: 300_000,
  gcTime: 600_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: 1,
};

export const useGetUsageOverview = (
  params: UsageQueryParams = {},
  config?: Partial<UseQueryOptions<UsageOverviewResponse>>,
) => {
  return useQuery<UsageOverviewResponse>(
    [QueryKeys.usageOverview, params],
    () => dataService.getUsageOverview(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetUsageTrends = (
  params: UsageTrendsQueryParams = {},
  config?: Partial<UseQueryOptions<UsageTrendsResponse>>,
) => {
  return useQuery<UsageTrendsResponse>(
    [QueryKeys.usageTrends, params],
    () => dataService.getUsageTrends(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetUsageModels = (
  params: UsagePaginatedQueryParams = {},
  config?: Partial<UseQueryOptions<UsageModelsResponse>>,
) => {
  return useQuery<UsageModelsResponse>(
    [QueryKeys.usageModels, params],
    () => dataService.getUsageModels(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetUsageTopUsers = (
  params: UsagePaginatedQueryParams = {},
  config?: Partial<UseQueryOptions<UsageTopUsersResponse>>,
) => {
  return useQuery<UsageTopUsersResponse>(
    [QueryKeys.usageTopUsers, params],
    () => dataService.getUsageTopUsers(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetUsageUserDetail = (
  userId: string,
  params: UsageQueryParams = {},
  config?: Partial<UseQueryOptions<UsageUserDetailResponse>>,
) => {
  return useQuery<UsageUserDetailResponse>(
    [QueryKeys.usageUserDetail, userId, params],
    () => dataService.getUsageUserDetail(userId, params),
    {
      ...defaultConfig,
      enabled: !!userId,
      ...config,
    },
  );
};

export const useGetUsageActivity = (
  params: UsagePaginatedQueryParams = {},
  config?: Partial<UseQueryOptions<UsageActivityResponse>>,
) => {
  return useQuery<UsageActivityResponse>(
    [QueryKeys.usageActivity, params],
    () => dataService.getUsageActivity(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetGuardrailEvents = (
  params: GuardrailEventsQueryParams = {},
  config?: Partial<UseQueryOptions<GuardrailEventsResponse>>,
) => {
  return useQuery<GuardrailEventsResponse>(
    [QueryKeys.guardrailEvents, params],
    () => dataService.getGuardrailEvents(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};

export const useGetAdminConversation = (
  conversationId: string,
  config?: Partial<UseQueryOptions<AdminConversationResponse>>,
) => {
  return useQuery<AdminConversationResponse>(
    [QueryKeys.adminConversation, conversationId],
    () => dataService.getAdminConversation(conversationId),
    {
      ...defaultConfig,
      enabled: !!conversationId,
      ...config,
    },
  );
};

export const useGetGuardrailSummary = (
  params: UsageQueryParams = {},
  config?: Partial<UseQueryOptions<GuardrailSummaryResponse>>,
) => {
  return useQuery<GuardrailSummaryResponse>(
    [QueryKeys.guardrailSummary, params],
    () => dataService.getGuardrailSummary(params),
    {
      ...defaultConfig,
      ...config,
    },
  );
};
