import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { ScopeProvider } from "@/lib/scope";
import { AuthProvider } from "@/lib/auth";
import { RequireGroup } from "@/components/access-denied";
import { COST_READER_GROUP } from "@/lib/auth";

import Home from "@/pages/home";
import Alerts from "@/pages/alerts";
import Cost from "@/pages/cost";
import Budgets from "@/pages/budgets";
import Forecasts from "@/pages/forecasts";
import AppDetail from "@/pages/app-detail";
import Deployments from "@/pages/deployments";
import Incidents from "@/pages/incidents";
import ActivityLog from "@/pages/activity";
import Health from "@/pages/health";
import NetworkPage from "@/pages/network";
import Logs from "@/pages/logs";
import ServiceHealth from "@/pages/service-health";
import Subscriptions from "@/pages/subscriptions";
import Tags from "@/pages/tags";
import Access from "@/pages/access";
import Preferences from "@/pages/preferences";
import NotFound from "@/pages/not-found";

function Gated({ children }: { children: React.ReactNode }) {
  return (
    <RequireGroup group={COST_READER_GROUP} resource="Cost Management">
      {children}
    </RequireGroup>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/deployments" component={Deployments} />
        <Route path="/incidents" component={Incidents} />
        <Route path="/activity" component={ActivityLog} />
        <Route path="/health" component={Health} />
        <Route path="/network" component={NetworkPage} />
        <Route path="/logs" component={Logs} />
        <Route path="/service-health" component={ServiceHealth} />
        <Route path="/cost"><Gated><Cost /></Gated></Route>
        <Route path="/cost/budgets"><Gated><Budgets /></Gated></Route>
        <Route path="/cost/forecasts"><Gated><Forecasts /></Gated></Route>
        <Route path="/subscriptions" component={Subscriptions} />
        <Route path="/tags" component={Tags} />
        <Route path="/access" component={Access} />
        <Route path="/preferences" component={Preferences} />
        <Route path="/apps/:appId" component={AppDetail} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ScopeProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </ScopeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
