import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { SystemRoles } from 'librechat-data-provider';

// Mock hooks before importing the component
const mockUseAuthContext = jest.fn();
const mockUseQueryClient = jest.fn(() => ({
  invalidateQueries: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => mockUseAuthContext(),
  useCustomLink: () => jest.fn(),
  useLocalize: () => (key: string) => key,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockUseQueryClient(),
  useQuery: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
}));

jest.mock('~/data-provider', () => ({
  useGetUsageOverview: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
  useGetUsageTrends: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
  useGetUsageModels: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
  useGetUsageTopUsers: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
  useGetUsageActivity: jest.fn(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: jest.fn(),
  })),
}));

import ReportingDashboard from '../ReportingDashboard';

describe('ReportingDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show access denied for non-admin users (FAIL-002)', () => {
    mockUseAuthContext.mockReturnValue({
      user: {
        id: 'user-123',
        role: SystemRoles.USER,
      },
    });

    render(<ReportingDashboard />);

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(
      screen.getByText(/You do not have permission to view usage reports/),
    ).toBeInTheDocument();
  });

  it('should show access denied when user is null', () => {
    mockUseAuthContext.mockReturnValue({
      user: null,
    });

    render(<ReportingDashboard />);

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('should render dashboard for admin users', () => {
    mockUseAuthContext.mockReturnValue({
      user: {
        id: 'admin-123',
        role: SystemRoles.ADMIN,
      },
    });

    render(<ReportingDashboard />);

    expect(screen.getByText('Usage Reports')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('should render date range picker with preset buttons', () => {
    mockUseAuthContext.mockReturnValue({
      user: {
        id: 'admin-123',
        role: SystemRoles.ADMIN,
      },
    });

    render(<ReportingDashboard />);

    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();
    expect(screen.getByText('1 year')).toBeInTheDocument();
  });
});
