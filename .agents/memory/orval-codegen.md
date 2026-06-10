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

## Zod param symbol naming differs by whether a path param exists
When an endpoint has **both a path param and a query param**, Orval names the
zod schema `<Op>Params` (e.g. `GetCostParams`). When it has **only query params**
(no path params), Orval names it `<Op>QueryParams` (e.g.
`GetGlobalCostSummaryQueryParams`). Both still cause TS2308 and must be
explicitly re-exported from `lib/api-zod/src/index.ts`.

## Adding query params shifts the generated hook signature
When a previously-parameterless endpoint gains a query param, Orval inserts a
`params?` argument **before** the `options` argument. Every existing call site
must be updated to pass `undefined` as params: `useGetFoo(undefined, { query: … })`.

## Duplicate YAML key kills codegen with a cryptic error
A duplicate property key anywhere in `openapi.yaml` (e.g. two `daily:` entries
under the same schema) causes orval 8.x to fail with **"Failed to resolve input:
Please provide a valid string value or pass a loader to process the input"** —
not a helpful YAML parse error. The generated `src/generated/` dirs stay empty,
leaving stale `dist/` declarations and cascading TS property-missing errors.

**Why:** orval's YAML parser chokes on duplicate mapping keys; the error is
swallowed and reported as an input resolution failure with no line number.

**How to apply:** when codegen gives that error and the spec path is clearly
correct, grep `openapi.yaml` for duplicate property keys within the same object
block before debugging anything else. YAML does not forbid duplicate keys at the
spec level, so editors won't flag them.

## Response-type barrel collision (TS2724 at re-export block)
When a new operation is added to the spec and codegen runs, Orval emits both a
Zod const AND a TS interface with the same `<Op>Response` name (e.g.
`ListClerkIdentitiesResponse`). The double `export *` barrel in `index.ts`
silently drops one of them, causing TS2724 ("has no exported member named …")
when CI builds the lib. **Fix: add the symbol to the explicit re-export block
in `lib/api-zod/src/index.ts`** (the block already contains
`GetGlobalCostSummaryResponse`, `ListDeploymentsResponse`, etc.) so the Zod
side wins.

## Generated files are committed — push them after codegen
`lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` are
**tracked in git** (no `.gitignore`). Running codegen locally and not pushing
the resulting files causes CI to see a stale generated `api.ts` and fail
`typecheck:libs` with TS2724. After every `pnpm --filter @workspace/api-spec
run codegen`, push the generated files alongside any spec or index changes.

## Misc
- Never change OpenAPI `info.title` — it drives generated filenames.
- `pnpm --filter @workspace/api-spec run codegen` also runs `typecheck:libs`;
  a clean run means libs typecheck passed too.
