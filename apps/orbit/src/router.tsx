import { createBrowserRouter } from "react-router-dom";
import React, { lazy, Suspense } from "react";
import { EnterpriseLayout } from "./layouts/EnterpriseLayout";
import { SignedOutPage } from "./modules/auth/SignedOutPage";

const DashboardPage = lazy(() => import("./modules/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PlaceholderPage = lazy(() => import("./components/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage })));
const ApplicationsPage = lazy(() => import("./modules/applications/ApplicationsPage").then((m) => ({ default: m.ApplicationsPage })));
const RolesPage = lazy(() => import("./modules/roles/RolesPage").then((m) => ({ default: m.RolesPage })));
const PermissionsPage = lazy(() => import("./modules/permissions/PermissionsPage").then((m) => ({ default: m.PermissionsPage })));
const UsersPage = lazy(() => import("./modules/users/UsersPage").then((m) => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import("./modules/audit/AuditPage").then((m) => ({ default: m.AuditPage })));
const NotificationsPage = lazy(() => import("./modules/notifications/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const ConfigurationPage = lazy(() => import("./modules/configuration/ConfigurationPage").then((m) => ({ default: m.ConfigurationPage })));
const HealthPage = lazy(() => import("./modules/platform/HealthPage").then((m) => ({ default: m.HealthPage })));
const InfrastructureDashboard = lazy(() => import("./modules/noc/InfrastructureDashboard").then((m) => ({ default: m.InfrastructureDashboard })));
const ApplicationDashboard = lazy(() => import("./modules/noc/ApplicationDashboard").then((m) => ({ default: m.ApplicationDashboard })));
const ApplicationDetailPage = lazy(() => import("./modules/noc/ApplicationDetailPage").then((m) => ({ default: m.ApplicationDetailPage })));
const SecurityDashboard = lazy(() => import("./modules/noc/SecurityDashboard").then((m) => ({ default: m.SecurityDashboard })));
const AIDashboard = lazy(() => import("./modules/noc/AIDashboard").then((m) => ({ default: m.AIDashboard })));
const IncidentDashboard = lazy(() => import("./modules/noc/IncidentDashboard").then((m) => ({ default: m.IncidentDashboard })));
const UXDashboard = lazy(() => import("./modules/noc/UXDashboard").then((m) => ({ default: m.UXDashboard })));
const ApiDependenciesDashboard = lazy(() => import("./modules/noc/ApiDependenciesDashboard").then((m) => ({ default: m.ApiDependenciesDashboard })));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

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
        element: <Lazy><DashboardPage /></Lazy>,
      },
      {
        path: "admin",
        children: [
          {
            path: "applications",
            element: <Lazy><ApplicationsPage /></Lazy>,
          },
          {
            path: "users",
            element: <Lazy><UsersPage /></Lazy>,
          },
          {
            path: "roles",
            element: <Lazy><RolesPage /></Lazy>,
          },
          {
            path: "permissions",
            element: <Lazy><PermissionsPage /></Lazy>,
          },
          {
            path: "audit",
            element: <Lazy><AuditPage /></Lazy>,
          },
          {
            path: "notifications",
            element: <Lazy><NotificationsPage /></Lazy>,
          },
          {
            path: "configuration",
            element: <Lazy><ConfigurationPage /></Lazy>,
          },
          {
            path: "feature-flags",
            element: <Lazy><ConfigurationPage /></Lazy>,
          },
        ],
      },
      {
        path: "platform",
        children: [
          {
            path: "health",
            element: <Lazy><HealthPage /></Lazy>,
          },
        ],
      },
      {
        path: "noc",
        children: [
          {
            path: "infrastructure",
            element: <Lazy><InfrastructureDashboard /></Lazy>,
          },
          {
            path: "applications",
            element: <Lazy><ApplicationDashboard /></Lazy>,
          },
          {
            path: "applications/:slug",
            element: <Lazy><ApplicationDetailPage /></Lazy>,
          },
          {
            path: "security",
            element: <Lazy><SecurityDashboard /></Lazy>,
          },
          {
            path: "ai",
            element: <Lazy><AIDashboard /></Lazy>,
          },
          {
            path: "incidents",
            element: <Lazy><IncidentDashboard /></Lazy>,
          },
          {
            path: "ux",
            element: <Lazy><UXDashboard /></Lazy>,
          },
          {
            path: "api-dependencies",
            element: <Lazy><ApiDependenciesDashboard /></Lazy>,
          },
        ],
      },
      {
        path: "revenue",
        element: (
          <Lazy>
            <PlaceholderPage
              title="Revenue Management"
              description="Finance and revenue analytics are coming soon."
            />
          </Lazy>
        ),
      },
      {
        path: "service",
        element: (
          <Lazy>
            <PlaceholderPage
              title="Service Management"
              description="IT support and service desk tools are coming soon."
            />
          </Lazy>
        ),
      },
      {
        path: "*",
        element: (
          <Lazy>
            <PlaceholderPage
              title="Page not found"
              description="This page doesn't exist. Use the sidebar to navigate."
            />
          </Lazy>
        ),
      },
    ],
  },
]);
