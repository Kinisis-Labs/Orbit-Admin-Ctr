---
name: Orval codegen quirks
description: Non-obvious behaviors of the OpenAPI->Orval (zod + react-query) codegen pipeline in lib/api-spec.
---

# Orval codegen quirks (lib/api-spec → lib/api-zod, lib/api-client-react)

## Query params can break the barrel with a duplicate-export error
Adding the **first** query parameter to any operation makes Orval emit an
`<Op>Params` symbol in BOTH the zod output (`api-zod/.../generated/api.ts`, a
`zod.object(...)` const) AND the types output (`.../generated/types/...`, a TS
`type`). The package barrel does `export * from "./generated/api"` and
`export * from "./generated/types"`, so the same name is exported twice →
`tsc` fails with TS2308 "already exported a member named '<Op>Params'".

**Why:** two separate Orval generators (zod client + types) independently name
the params symbol, and the barrel re-exports both namespaces flatly.

**How to apply:** if a list/query endpoint only needs an optional knob (e.g.
`?limit`) that no generated client actually consumes, prefer leaving it OUT of
the OpenAPI `parameters` and reading it manually from `req.query` in the
handler — OR, if you keep it, expect to resolve the barrel collision. Keeping
route capability out of the contract is a spec/runtime mismatch the architect
will flag, so the clean choice is usually: don't expose the param at all and
let the service apply a sane internal cap.

## Not every operation gets a `*Response` zod
Orval does not always emit `<Op>Response` for non-200 success bodies (e.g. a
`201` POST body produced no `PostLedgerEntryResponse`). Validate the returned
object against the equivalent shared item schema instead (e.g. a single posted
journal entry was validated with `ListLedgerEntriesResponseItem`).

## Misc
- Never change OpenAPI `info.title` — it drives generated filenames.
- `pnpm --filter @workspace/api-spec run codegen` also runs `typecheck:libs`;
  a clean run means libs typecheck passed too.
