/**
 * Tests for the AuthProvider polling useEffect (session-end behaviour).
 *
 * Strategy:
 * - `vi.useFakeTimers()` is called BEFORE render so setInterval in the
 *   polling effect is captured by vitest's fake timer system.
 * - `await act(async () => {})` flushes React effects + microtasks without
 *   relying on RTL's `waitFor` (which polls via setInterval and would also be
 *   captured by fake timers, causing deadlocks).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER = {
  id: "test-user",
  displayName: "Test User",
  userPrincipalName: "test@kinisislabs.com",
  jobTitle: "Engineer",
  initial: "T",
};

const GROUP_A = { id: "group-a", displayName: "Group A", description: "" };
const GROUP_B = { id: "group-b", displayName: "Group B", description: "" };

type MeBody =
  | { mode: "mock" }
  | { mode: "entra"; authenticated: false }
  | {
      mode: "entra";
      authenticated: true;
      user: typeof MOCK_USER;
      groups: (typeof GROUP_A)[];
    };

function makeResponse(body: MeBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function entraOk(groups: (typeof GROUP_A)[] = []): Response {
  return makeResponse({
    mode: "entra",
    authenticated: true,
    user: MOCK_USER,
    groups,
  });
}

function statusOnly(status: number): Response {
  return new Response(null, { status });
}

/**
 * Flush microtasks + React state updates without relying on RTL's waitFor.
 * Several rounds are needed because async continuations can chain.
 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A child that surfaces auth context values as data-testid spans. */
function AuthSnapshot() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="mode">{auth.mode}</span>
      <span data-testid="groups">{auth.groups.map((g) => g.id).join(",")}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Fake timers BEFORE render so the polling setInterval is captured.
  vi.useFakeTimers();

  // Prevent jsdom NavigationError on window.location.assign calls
  vi.stubGlobal("location", {
    ...window.location,
    assign: vi.fn(),
    pathname: "/",
    search: "",
  });

  // Default: tab is visible
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });

  // Clear localStorage so loadMockGroups() doesn't interfere
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Shared helpers to get the component into "entra authenticated" state.
// ---------------------------------------------------------------------------

async function renderAndWaitForEntraLoad(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<ReturnType<typeof render>> {
  vi.stubGlobal("fetch", fetchMock);
  const result = render(
    <AuthProvider>
      <AuthSnapshot />
    </AuthProvider>,
  );
  // Flush the initial useEffect's async fetch + React state update
  await flushAsync();
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const POLL_MS = 15 * 60 * 1000;

describe("AuthProvider — polling useEffect", () => {
  test("(a) poll updates entra state when groups change between ticks", async () => {
    // Initial load returns group-a only; polls return group-a + group-b
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(entraOk([GROUP_A]))
      .mockResolvedValue(entraOk([GROUP_A, GROUP_B]));

    await renderAndWaitForEntraLoad(fetchMock);

    expect(screen.getByTestId("mode").textContent).toBe("entra");
    expect(screen.getByTestId("groups").textContent).toBe("group-a");

    // Advance exactly one poll interval to trigger the setInterval callback
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
      // Allow the async poll function (fetch + setState) to resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("groups").textContent).toBe("group-a,group-b");
  });

  test("(b) poll sets authError='revoked' when /auth/me returns 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(entraOk([GROUP_A]))  // initial load
      .mockResolvedValue(statusOnly(401));          // every subsequent poll

    await renderAndWaitForEntraLoad(fetchMock);

    expect(screen.getByTestId("mode").textContent).toBe("entra");

    // Trigger one poll tick
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    // AuthNotice kind="revoked" renders the RevokedNotice which shows "Session ended"
    expect(screen.queryByTestId("mode")).toBeNull();
    expect(screen.getByText("Session ended")).toBeInTheDocument();
  });

  test("(b) poll sets authError='revoked' when /auth/me returns 403", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(entraOk([GROUP_A]))
      .mockResolvedValue(statusOnly(403));

    await renderAndWaitForEntraLoad(fetchMock);

    expect(screen.getByTestId("mode").textContent).toBe("entra");

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Session ended")).toBeInTheDocument();
  });

  test("(c) poll is skipped entirely when document.visibilityState is 'hidden'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(entraOk([GROUP_A]));

    await renderAndWaitForEntraLoad(fetchMock);

    // Record how many fetches happened during initial load (exactly 1)
    const callsAfterMount = fetchMock.mock.calls.length;
    expect(callsAfterMount).toBe(1);

    // Hide the tab before any poll fires
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });

    // Advance through three poll intervals
    await act(async () => {
      vi.advanceTimersByTime(3 * POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The poll guard `if (document.visibilityState === "hidden") return;`
    // must have prevented any additional fetches
    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });

  test("(d) poll interval is cleared when the component unmounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(entraOk([GROUP_A]));

    const { unmount } = await renderAndWaitForEntraLoad(fetchMock);

    const callsAfterMount = fetchMock.mock.calls.length;

    // Unmount — the polling useEffect cleanup runs clearInterval
    unmount();

    // Advance several poll intervals — interval must no longer be live
    await act(async () => {
      vi.advanceTimersByTime(3 * POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fetch count must not have grown after unmount
    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });
});
