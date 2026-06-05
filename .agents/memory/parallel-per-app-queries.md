---
name: Parallel per-app queries in React
description: Pattern for fanning out per-app API calls in React pages without violating hooks rules.
---

# Parallel Per-App Queries with useQueries

When a page needs data for each app (e.g. deployments, activity log) and the API is per-appId, use `useQueries` from `@tanstack/react-query` — available in the orbit artifact via the catalog dep.

```tsx
import { useQueries } from "@tanstack/react-query";
import { listDeployments, getListDeploymentsQueryKey, useListApps } from "@workspace/api-client-react";

const { data: apps } = useListApps();
const queries = useQueries({
  queries: (apps ?? []).map(app => ({
    queryKey: getListDeploymentsQueryKey(app.id),
    queryFn: () => listDeployments(app.id),
    staleTime: 5 * 60 * 1000,
  })),
});
const all = queries.flatMap(q => q.data ?? []);
```

**Why:** React hooks can't be called in a loop, but `useQueries` accepts a derived list. The Orval-generated `list*` functions (e.g. `listDeployments`) and `get*QueryKey` helpers are directly importable from `@workspace/api-client-react` (via `export *` barrel).

**How to apply:** Any page that aggregates data across all apps in global scope. For scoped views, just use the single `useList*` hook with the scoped appId. Empty-appId hooks auto-disable (Orval sets `enabled: !!(appId)` internally).
