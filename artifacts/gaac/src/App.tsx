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
import AppDetail from "@/pages/app-detail";
import NotFound from "@/pages/not-found";

function CostRoute() {
  return (
    <RequireGroup group={COST_READER_GROUP} resource="Cost Management">
      <Cost />
    </RequireGroup>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/cost" component={CostRoute} />
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
