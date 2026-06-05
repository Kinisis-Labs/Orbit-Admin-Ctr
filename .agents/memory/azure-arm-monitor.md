---
name: Azure arm-monitor client name
description: The @azure/arm-monitor package exports MonitorClient, not MonitorManagementClient. Activity log access pattern.
---

# Azure arm-monitor Client Name

The class is `MonitorClient`, not `MonitorManagementClient`.

```ts
import { MonitorClient } from "@azure/arm-monitor";
const client = new MonitorClient(credential, subscriptionId);
for await (const event of client.activityLogs.list(filter, { select: "..." })) { ... }
```

**Why:** `MonitorManagementClient` was the old name in an earlier major version of the package. The current `@azure/arm-monitor` (v9+) exports `MonitorClient`. The TypeScript type definitions are in `types/arm-monitor.d.ts` (not `dist/index.d.ts`).

**How to apply:** Any time you import from `@azure/arm-monitor` and need to query activity logs or metrics, use `MonitorClient`. Check `types/arm-monitor.d.ts` for the correct export name if unsure.
