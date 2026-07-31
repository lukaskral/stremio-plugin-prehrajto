# Migrate Proxy Tests to Vitest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the six existing service-proxy test files from Node’s `node:test` runner into the project’s Vitest suite so one `npm test` command executes utility, fixture, unit, and integration coverage.

**Architecture:** Preserve the existing fake fetches, proxy seams, and local HTTP servers. Replace only test registration, assertions, and lifecycle APIs: Vitest `it`/`describe`/`it.each`, Vitest `expect`, and `try/finally` server cleanup. Expand discovery to the repository-wide `*.test.ts` convention and remove the separate Node runner.

**Tech Stack:** Vitest 4, TypeScript, Node 24 fetch/HTTP APIs, Express handler adapters, existing proxy modules.

---

### Task 1: Establish unified Vitest discovery

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Rename: `tests/prehrajto/fixtureParsing.vitest.test.ts` → `tests/prehrajto/fixtureParsing.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Confirm the current failure mode**

Run:

```bash
npx vitest run tests/proxy/config.test.ts
```

Expected: `No test suite found`, because the file registers tests through `node:test`.

- [ ] **Step 2: Rename the existing Vitest fixture test**

Rename `tests/prehrajto/fixtureParsing.vitest.test.ts` to `tests/prehrajto/fixtureParsing.test.ts` without changing its assertions.

- [ ] **Step 3: Expand Vitest discovery**

Set `vitest.config.ts` to:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

Keep the default Node environment; no browser environment is needed.

- [ ] **Step 4: Remove the parallel runner and update docs**

Remove `test:node` from `package.json`; keep `test: vitest run` and `test:watch: vitest`. Update `README.md` so `npm test` is documented as the command for utility, fixture, proxy unit, and proxy integration tests. Remove all `npm run test:node` references.

- [ ] **Step 5: Commit discovery changes**

```bash
git add package.json vitest.config.ts README.md tests/prehrajto/fixtureParsing.test.ts tests/prehrajto/fixtureParsing.vitest.test.ts
git commit -m "test: discover all tests through Vitest"
```

### Task 2: Convert simple proxy unit tests

**Files:**
- Modify: `tests/proxy/config.test.ts`
- Modify: `tests/proxy/protocol.test.ts`
- Modify: `tests/proxy/serviceFetch.test.ts`
- Modify: `tests/proxy/prehrajtoTransport.test.ts`

- [ ] **Step 1: Replace runner imports and registrations**

Replace the Node imports in each file with:

```ts
import { describe, expect, it } from "vitest";
```

Replace every top-level `test("...", callback)` with `it("...", callback)`. Use `describe` only for meaningful output grouping; preserve all test cases and production imports.

- [ ] **Step 2: Convert assertion semantics**

Apply these mappings:

```ts
assert.equal(a, b);             // expect(a).toBe(b)
assert.deepEqual(a, b);         // expect(a).toEqual(b)
assert.ok(value);               // expect(value).toBeTruthy()
assert.match(value, regex);     // expect(value).toMatch(regex)
assert.doesNotMatch(v, regex);  // expect(v).not.toMatch(regex)
assert.throws(fn, matcher);     // expect(fn).toThrow(matcher)
assert.rejects(p, matcher);     // await expect(p).rejects.toThrow(matcher)
```

For error-code predicates, use `await expect(promise).rejects.toMatchObject({ code: "..." })`; retain `node:assert/strict` only if a predicate cannot be expressed with Vitest matchers without changing behavior.

- [ ] **Step 3: Run the converted files**

```bash
npx vitest run tests/proxy/config.test.ts tests/proxy/protocol.test.ts tests/proxy/serviceFetch.test.ts tests/proxy/prehrajtoTransport.test.ts
```

Expected: all four files pass with no `node:test` registration errors and no external network calls.

- [ ] **Step 4: Commit the unit migration**

```bash
git add tests/proxy/config.test.ts tests/proxy/protocol.test.ts tests/proxy/serviceFetch.test.ts tests/proxy/prehrajtoTransport.test.ts
git commit -m "test: migrate proxy unit tests to Vitest"
```

### Task 3: Convert relay tests and nested cases

**Files:**
- Modify: `tests/proxy/relay.test.ts`

- [ ] **Step 1: Replace the Node runner imports**

Use `import { describe, expect, it } from "vitest"`; keep the shared config, envelope, logger, and dependency helpers unchanged.

- [ ] **Step 2: Replace unsafe-destination `t.test` calls with table tests**

Convert the six-case `for`/`await t.test(name, ...)` block to Vitest `it.each(cases)`. Retain all cases—plain HTTP, embedded credentials, unlisted host, suffix bypass, unlisted port, and unsupported method—and assert that `executeProxyRequest` rejects with `ProxyRelayError` and that the fake fetch call count remains zero:

```ts
it.each(cases)("rejects unsafe destination or method: %s", async (_name, patch) => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response();
  }) satisfies typeof fetch;
  await expect(
    executeProxyRequest({ ...baseEnvelope, ...patch }, serverConfig, dependencies(fetchImpl)),
  ).rejects.toBeInstanceOf(ProxyRelayError);
  expect(calls).toBe(0);
});
```

- [ ] **Step 3: Split nested size-limit cases**

Replace `t.test("request")` and `t.test("response")` with sibling tests named `rejects oversized decoded request bodies` and `rejects oversized decoded response bodies`. Preserve the size constants, error codes, and upstream-call assertions exactly.

- [ ] **Step 4: Convert remaining relay assertions**

Use the Task 2 matcher mappings for header stripping, redirects, method conversion, timeout, and log redaction. Preserve sensitive values in `baseEnvelope` and the assertions proving they never reach logs.

- [ ] **Step 5: Run and commit relay coverage**

```bash
npx vitest run tests/proxy/relay.test.ts
git add tests/proxy/relay.test.ts
git commit -m "test: migrate relay tests to Vitest"
```

### Task 4: Convert HTTP integration tests and cleanup

**Files:**
- Modify: `tests/proxy/serviceProxy.integration.test.ts`

- [ ] **Step 1: Replace runner imports and remove Node test context**

Use `describe`, `expect`, and `it` from Vitest. Remove the Node `t` callback context and all `t.test`/`t.after` calls.

- [ ] **Step 2: Split endpoint-policy coverage into independent tests**

Create these four tests from the existing blocks: `missing server token disables the endpoint`, `rejects non-POST endpoint requests`, `rejects missing and incorrect bearer tokens`, and `rejects malformed and oversized JSON safely`. Each test creates its own relay and closes it in `finally`:

```ts
const relay = await startServer(nodeListener(handler));
try {
  const response = await fetch(relay.url, requestOptions);
  expect(response.status).toBe(expectedStatus);
} finally {
  await relay.close();
}
```

- [ ] **Step 3: Convert end-to-end cleanup to `try/finally`**

Keep the fake upstream, relay, `createServiceFetch`, cookie propagation, multipart boundary, request order, and body assertions unchanged. Close the relay and upstream in `finally`, even when an assertion fails.

- [ ] **Step 4: Run integration tests with localhost access**

```bash
npx vitest run tests/proxy/serviceProxy.integration.test.ts
```

Expected: all endpoint-policy and end-to-end tests pass. If a restricted sandbox reports localhost `EPERM`, rerun with the approved localhost permission before diagnosing a test failure.

- [ ] **Step 5: Commit integration coverage**

```bash
git add tests/proxy/serviceProxy.integration.test.ts
git commit -m "test: migrate proxy integration tests to Vitest"
```

### Task 5: Verify the unified suite and documentation

**Files:**
- Modify: `README.md` only if test command references remain
- Modify: `package.json` or `vitest.config.ts` only if discovery differs from Task 1

- [ ] **Step 1: Confirm the old runner is gone**

```bash
rg -n 'node:test|test:node|\.vitest\.test\.ts' tests package.json README.md vitest.config.ts || true
```

Expected: no `node:test` imports, no `test:node` script/reference, and no old fixture filename.

- [ ] **Step 2: Run all tests through the single command**

```bash
npm test
```

Expected: Vitest reports utility, PrehrajTo fixture, proxy unit, relay, and HTTP integration tests as passing.

- [ ] **Step 3: Run repository checks**

```bash
npm run check:tsc
npm run check:lint
git diff --check
```

Expected: all commands exit successfully and converted test callbacks have no implicit `any` types.

- [ ] **Step 4: Commit any final corrections**

```bash
git add README.md package.json vitest.config.ts tests
git commit -m "test: run proxy coverage through unified Vitest suite"
```

Expected: `npm test` is the single automated test command and the worktree has no migration changes left unstaged.

---

## Self-review

- All six proxy files are covered: config, protocol, service fetch, PrehrajTo transport, relay, and HTTP integration.
- Node nested `t.test` cases become `it.each` or independent `it` cases.
- Node `t.after` cleanup becomes `try/finally` so server resources are released on assertion failure.
- Existing fake fetches, security assertions, cookie behavior, redirect behavior, and local HTTP coverage remain intact.
- Vitest discovers both proxy tests and the existing PrehrajTo fixture tests through `tests/**/*.test.ts`.
