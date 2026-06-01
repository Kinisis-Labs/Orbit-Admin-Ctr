---
name: Fast Refresh export consistency (Vite React)
description: Why mixing component + non-component exports in one .tsx breaks HMR and throws "must be used within a Provider"
---

# Fast Refresh export consistency

A `.tsx` file that exports **both** a React component **and** non-component values
(a hook, a `createContext` object, plain constants) is Fast-Refresh-incompatible.
Vite logs `Could not Fast Refresh ("X" export is incompatible)` and falls back to a
full module reload.

**The trap:** when such a file *also* defines a React Context, the fallback reload
recreates the Context object. The live Provider higher in the tree still holds the
*old* context instance, so consumers calling the hook read a *different* instance and
get `null` → the hook's guard throws (e.g. `useScope must be used within a
ScopeProvider`) even though a Provider is clearly mounted.

**What surfaces it:** any mass HMR invalidation. In this repo, every `api-spec`
codegen run briefly removes/rewrites the generated `@workspace/api-client-react`
files, which invalidates *every* module importing it. Files mixing exports get caught
in that wave and throw — so the crash appears "randomly" after seemingly unrelated work.

**Fix / convention:** keep context + hook + constants in a non-component module
(e.g. `scope-context.ts`), and let the `.tsx` export **only** components
(Provider, Select, etc.). Importing non-components into the component file is fine —
the rule is about *exports*, not imports.
**Why:** a component-only file gets a clean Fast Refresh boundary; the context
identity lives in a stable module that isn't a refresh boundary, so provider/consumer
never desync.
**How to apply:** when adding a Context + Provider, never co-locate the `useX` hook or
the `createContext` call with the Provider component's exports. Optional guard:
enable ESLint `react-refresh/only-export-components`.
