import { lazy, Suspense } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import DashboardRoute from './Layouts/Dashboard';

/** REQ-010/PERF-002: Lazy-loaded reporting dashboard to avoid bundle impact for non-admin users. */
const ReportingDashboard = lazy(
  () => import('~/components/Admin/Reporting/ReportingDashboard'),
);

function PromptsRedirect() {
  const { '*': splat } = useParams();
  const target = splat ? `/prompts/${splat}` : '/prompts/new';
  return <Navigate to={target} replace={true} />;
}

const dashboardRoutes = {
  path: 'd/*',
  element: <DashboardRoute />,
  children: [
    {
      path: 'prompts/*',
      element: <PromptsRedirect />,
    },
    {
      path: 'reporting',
      element: (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
            </div>
          }
        >
          <ReportingDashboard />
        </Suspense>
      ),
    },
    {
      path: '*',
      element: <Navigate to="/c/new" replace={true} />,
    },
  ],
};

export default dashboardRoutes;
