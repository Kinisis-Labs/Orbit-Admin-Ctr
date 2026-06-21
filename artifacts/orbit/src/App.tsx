import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { ScopeProvider } from "@/lib/scope";
import { AuthProvider } from "@/lib/auth";
import { RequireGroup } from "@/components/access-denied";
import { COST_READER_GROUP } from "@/lib/auth-groups";

import Home from "@/pages/home";
import Alerts from "@/pages/alerts";
import Cost from "@/pages/cost";
import AppDetail from "@/pages/app-detail";
import Deployments from "@/pages/deployments";
import Incidents from "@/pages/incidents";
import ActivityLog from "@/pages/activity";
import Health from "@/pages/health";
import NetworkPage from "@/pages/network";
import TelemetryPage from "@/pages/telemetry";
import Logs from "@/pages/logs";
import ServiceHealth from "@/pages/service-health";
import Subscriptions from "@/pages/subscriptions";
import PlaySubscriptions from "@/pages/play-subscriptions";
import AppleSubscriptions from "@/pages/apple-subscriptions";
import StripeSubscriptions from "@/pages/stripe-subscriptions";
import StoreReports from "@/pages/store-reports";
import Tags from "@/pages/tags";
import Access from "@/pages/access";
import Users from "@/pages/users";
import Preferences from "@/pages/preferences";
import FeatureFlags from "@/pages/feature-flags";
import Resources from "@/pages/resources";
import ConstellationPage from "@/pages/constellation";
import NotFound from "@/pages/not-found";
import SignedOut from "@/pages/signed-out";

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
        <Route path="/telemetry" component={TelemetryPage} />
        <Route path="/logs" component={Logs} />
        <Route path="/service-health" component={ServiceHealth} />
        <Route path="/users" component={Users} />
        <Route path="/cost"><Gated><Cost /></Gated></Route>
        <Route path="/play-subscriptions"><Gated><PlaySubscriptions /></Gated></Route>
        <Route path="/apple-subscriptions"><Gated><AppleSubscriptions /></Gated></Route>
        <Route path="/stripe-subscriptions"><Gated><StripeSubscriptions /></Gated></Route>
        <Route path="/store-reports"><Gated><StoreReports /></Gated></Route>
        <Route path="/constellation" component={ConstellationPage} />
        <Route path="/resources" component={Resources} />
        <Route path="/subscriptions" component={Subscriptions} />
        <Route path="/tags" component={Tags} />
        <Route path="/access" component={Access} />
        <Route path="/preferences" component={Preferences} />
        <Route path="/admin/feature-flags" component={FeatureFlags} />
        <Route path="/apps" component={Home} />
        <Route path="/apps/:appId" component={AppDetail} />
        <Route path="/cost/:rest*"><Redirect to="/cost" /></Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname;
  const isSignedOut = path === `${base}/signed-out` || path === "/signed-out";

  if (isSignedOut) {
    return (
      <TooltipProvider>
        <SignedOut />
        <Toaster />
      </TooltipProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ScopeProvider>
          <TooltipProvider>
            <WouterRouter base={base}>
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
