import { createBrowserRouter } from "react-router-dom";
import { EnterpriseLayout } from "./layouts/EnterpriseLayout";
import { DashboardPage } from "./modules/dashboard/DashboardPage";
import { SignedOutPage } from "./modules/auth/SignedOutPage";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { ApplicationsPage } from "./modules/applications/ApplicationsPage";
import { RolesPage } from "./modules/roles/RolesPage";
import { PermissionsPage } from "./modules/permissions/PermissionsPage";
import { UsersPage } from "./modules/users/UsersPage";
import { AuditPage } from "./modules/audit/AuditPage";
import { NotificationsPage } from "./modules/notifications/NotificationsPage";
import { ConfigurationPage } from "./modules/configuration/ConfigurationPage";
import { HealthPage } from "./modules/platform/HealthPage";
import { InfrastructureDashboard } from "./modules/noc/InfrastructureDashboard";
import { ApplicationDashboard } from "./modules/noc/ApplicationDashboard";
import { ApplicationDetailPage } from "./modules/noc/ApplicationDetailPage";
import { SecurityDashboard } from "./modules/noc/SecurityDashboard";
import { AIDashboard } from "./modules/noc/AIDashboard";
import { IncidentDashboard } from "./modules/noc/IncidentDashboard";
import { UXDashboard } from "./modules/noc/UXDashboard";
import { ApiDependenciesDashboard } from "./modules/noc/ApiDependenciesDashboard";

export const router = createBrowserRouter([
  {
    path: "/signed-out",
    element: <SignedOutPage />,
  },
  {
    path: "/",
    element: <EnterpriseLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: "admin",
        children: [
          {
            path: "applications",
            element: <ApplicationsPage />,
          },
          {
            path: "users",
            element: <UsersPage />,
          },
          {
            path: "roles",
            element: <RolesPage />,
          },
          {
            path: "permissions",
            element: <PermissionsPage />,
          },
          {
            path: "audit",
            element: <AuditPage />,
          },
          {
            path: "notifications",
            element: <NotificationsPage />,
          },
          {
            path: "configuration",
            element: <ConfigurationPage />,
          },
          {
            path: "feature-flags",
            element: <ConfigurationPage />,
          },
        ],
      },
      {
        path: "platform",
        children: [
          {
            path: "health",
            element: <HealthPage />,
          },
        ],
      },
      {
        path: "noc",
        children: [
          {
            path: "infrastructure",
            element: <InfrastructureDashboard />,
          },
          {
            path: "applications",
            element: <ApplicationDashboard />,
          },
          {
            path: "applications/:slug",
            element: <ApplicationDetailPage />,
          },
          {
            path: "security",
            element: <SecurityDashboard />,
          },
          {
            path: "ai",
            element: <AIDashboard />,
          },
          {
            path: "incidents",
            element: <IncidentDashboard />,
          },
          {
            path: "ux",
            element: <UXDashboard />,
          },
          {
            path: "api-dependencies",
            element: <ApiDependenciesDashboard />,
          },
        ],
      },
      {
        path: "*",
        element: (
          <PlaceholderPage
            title="Page not found"
            description="This page doesn't exist. Use the sidebar to navigate."
          />
        ),
      },
    ],
  },
]);
