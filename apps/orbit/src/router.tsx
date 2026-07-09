import { createBrowserRouter } from "react-router-dom";
import { EnterpriseLayout } from "./layouts/EnterpriseLayout";
import { DashboardPage } from "./modules/dashboard/DashboardPage";
import { SignedOutPage } from "./modules/auth/SignedOutPage";
import { PlaceholderPage } from "./components/PlaceholderPage";

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
            element: <PlaceholderPage title="Applications" description="Application registry and Entra group mapping — coming in Phase B." />,
          },
          {
            path: "users",
            element: <PlaceholderPage title="Users" description="User directory and role management — coming in Phase D." />,
          },
          {
            path: "roles",
            element: <PlaceholderPage title="Roles" description="RBAC role definitions — coming in Phase C." />,
          },
          {
            path: "permissions",
            element: <PlaceholderPage title="Permissions" description="Feature permission registry — coming in Phase C." />,
          },
          {
            path: "audit",
            element: <PlaceholderPage title="Audit" description="Immutable audit log viewer — coming in Phase E." />,
          },
          {
            path: "notifications",
            element: <PlaceholderPage title="Notifications" description="Alert rules and delivery channels — coming in Phase F." />,
          },
          {
            path: "configuration",
            element: <PlaceholderPage title="Configuration" description="Platform configuration and feature flags — coming in Phase G." />,
          },
          {
            path: "feature-flags",
            element: <PlaceholderPage title="Feature Flags" description="Runtime feature flag management — coming in Phase G." />,
          },
        ],
      },
      {
        path: "platform",
        children: [
          {
            path: "health",
            element: <PlaceholderPage title="Platform Health" description="Service and infrastructure health monitoring — coming in Phase H." />,
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
