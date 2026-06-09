---
name: Azure Resource Graph SDK normalizer
description: The SDK returns result.data in one of three formats; normalizeResourceGraphRows must handle all three.
---

The `ResourceGraphClient.resources()` SDK call returns `result.data` in **three** formats, not two:

1. **Array**: `[{name, type, ...}, ...]` — small results
2. **Table**: `{columns: [{name, type},...], rows: [[val,...],...]}` — larger results
3. **Numeric-keyed object**: `{"0": {...}, "1": {...}}` — observed in production (Azure SDK v4+)

Format 3 is the one that was silently dropping all results: it is neither an array nor the table shape, so the original normalizer returned `[]`.

**Fix:** After checking for array and table format, add:
```typescript
const keys = Object.keys(d);
if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
  return keys.sort((a, b) => parseInt(a) - parseInt(b)).map((k) => d[k] as Record<string, unknown>);
}
```

**Why:** The SDK deserialises the JSON response into a plain object whose keys happen to be numeric strings when the result set is small (≤ ~100 rows in our testing). Not documented by Microsoft.

**How to apply:** Any new Resource Graph query route must pass `result.data` through `normalizeResourceGraphRows` (in `lib/azureNetwork.ts`) — do not access `result.data` directly as an array.

Also required for live data to work:
- `AZURE_CLIENT_ID` must be set on the Container App env vars (not just `AZURE_MANAGED_IDENTITY_CLIENT_ID`) — `DefaultAzureCredential` reads the former to select a user-assigned managed identity
- Reader RBAC at **subscription** scope (not resource group scope) for the managed identity on every subscription in `AZURE_SUBSCRIPTION_IDS`
