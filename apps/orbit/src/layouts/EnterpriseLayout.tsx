import { Outlet } from "react-router-dom";
import { Topbar } from "../modules/shell/Topbar";
import { Sidebar } from "../modules/shell/Sidebar";
import { Breadcrumb } from "../modules/shell/Breadcrumb";

export function EnterpriseLayout() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--orbit-bg-page)" }}>
      <Topbar />

      <div
        className="flex"
        style={{ paddingTop: "var(--orbit-topbar-height)" }}
      >
        <Sidebar />

        <div
          className="flex-1 flex flex-col min-h-0"
          style={{ marginLeft: "var(--orbit-sidebar-width)", transition: "margin-left 200ms" }}
        >
          <Breadcrumb />

          <main
            className="flex-1 p-6"
            style={{
              maxWidth: "var(--orbit-content-max)",
              width: "100%",
              margin: "0 auto",
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
