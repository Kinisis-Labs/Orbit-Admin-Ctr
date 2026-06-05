---
name: Ledger postedAt Zod vs interface mismatch
description: The Zod schema for postedAt is string; the PostEntryInput/IngestSaleInput interfaces use Date — convert at the route boundary.
---

# Ledger postedAt Type Mismatch

The Orval-generated Zod schemas (`PostLedgerEntryBody`, `IngestLedgerSaleBody`) define `postedAt` as `z.string().datetime({offset:true}).optional()` — a string. But the internal `PostEntryInput` and `IngestSaleInput` interfaces in `lib/ledger.ts` use `postedAt?: Date`.

Convert at the route boundary before calling the ledger function:

```ts
const entry = await postEntry(app.id, {
  ...parsed.data,
  postedAt: parsed.data.postedAt ? new Date(parsed.data.postedAt) : undefined,
});
```

**Why:** The OpenAPI spec models `postedAt` as a string (ISO 8601) because JSON has no native Date type. The internal Drizzle ORM layer expects `Date` objects. The conversion must happen at the route handler, not in the Zod schema.

**How to apply:** Any route that accepts a `postedAt` field from the request body and passes it to a ledger function.
