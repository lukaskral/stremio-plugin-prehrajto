# PrehrajTo Fixture Parsing Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned, sanitized PrehrajTo HTML snapshots and deterministic Vitest tests that verify the public resolver parses real search and detail pages correctly without making network requests.

**Architecture:** Keep the resolver’s public `getResolver(fetchImpl)` seam as the test boundary; do not test private parser functions directly or introduce a second parser implementation. Store search and detail HTML under a dedicated fixture folder, use a small fixture-backed `fetch` adapter for the authentication/search/detail request sequence, and assert the resolver’s returned search and stream structures. Keep the existing Node-native proxy tests separate from the Vitest fixture tests through the existing Vitest include pattern.

**Tech Stack:** TypeScript, Vitest, Node 24 `fs/promises`, `Response`, `FormData`, Linkedom, checked-in HTML fixtures.

---

### Task 1: Define and capture the fixture set

**Files:**
- Create: `tests/fixtures/prehrajto/README.md`
- Create: `tests/fixtures/prehrajto/search-movie.html`
- Create: `tests/fixtures/prehrajto/detail-movie.html`
- Create: `tests/fixtures/prehrajto/search-series.html`
- Create: `tests/fixtures/prehrajto/detail-series.html`

- [ ] **Step 1: Select two public search cases with different result shapes**

Use one movie search and one series/episode search so the fixtures exercise multiple cards, duration parsing, size parsing, optional format parsing, and detail-page resolution. Capture the search responses from the existing endpoint shape:

```text
https://prehraj.to/hledej/harry%20potter?vp-page=0
```

Choose result links that are present in the captured search HTML and save the corresponding detail responses from:

```text
https://prehraj.to/video/example
```

Do not capture the home page, login response, cookies, request headers, or account data as fixtures; those remain local test inputs.

- [ ] **Step 2: Save the raw HTML snapshots with stable filenames**

Save the exact response bodies as UTF-8 files under `tests/fixtures/prehrajto/`. Keep the HTML structure, attributes, localized text, `var sources`/fallback media declarations, and `var tracks` declarations intact. Do not prettify or run a formatter over the snapshots because parser regressions can depend on real whitespace and script contents.

- [ ] **Step 3: Review and sanitize the snapshots before staging**

Inspect every fixture for credentials, cookies, bearer tokens, personal account details, or query parameters containing secrets. Remove only sensitive values while preserving the DOM and JavaScript syntax that the parser consumes. Record the source path, capture date, whether the page is a movie or series example, and any sanitized fields in `tests/fixtures/prehrajto/README.md`.

- [ ] **Step 4: Record fixture expectations in the fixture README**

For each chosen page, record the resolver ID, expected number of parsed search results, one representative parsed title, duration in seconds, byte size, optional format value, resolved video URL, and subtitle IDs/languages. These values become the explicit assertions in Task 3 and make fixture changes reviewable.

- [ ] **Step 5: Commit the fixture-only change**

```bash
git add tests/fixtures/prehrajto
git commit -m "test: add PrehrajTo HTML fixtures"
```

Expected: the commit contains only reviewed HTML snapshots and their provenance/expectation documentation.

### Task 2: Add a fixture-backed fetch adapter

**Files:**
- Create: `tests/prehrajto/fixtureFetch.ts`

- [ ] **Step 1: Implement a typed fixture loader**

Create a helper that reads fixture files relative to `tests/fixtures/prehrajto/` using `readFile(new URL(..., import.meta.url), "utf8")`. Expose a `createPrehrajtoFixtureFetch()` function returning `typeof fetch` and a call log. The adapter must return `Response` objects and must never call the real network.

- [ ] **Step 2: Model the resolver’s authentication requests explicitly**

Return deterministic local responses for `GET https://prehraj.to/` and `POST https://prehraj.to/?frm=loginDialog-login-loginForm`, including `set-cookie` headers for the anonymous and authenticated flows. Validate that the POST body is a `FormData` instance and that the expected login fields are present; throw for any unexpected URL or method so tests fail when the resolver changes its request contract.

- [ ] **Step 3: Map search and detail URLs to the checked-in fixtures**

Route the two known search paths to `search-movie.html` and `search-series.html`. Route the resolver IDs recorded in the fixture README to their matching detail snapshots. Return `text/html` responses and record each request’s URL, method, and headers in the call log for request-boundary assertions.

- [ ] **Step 4: Commit the adapter**

```bash
git add tests/prehrajto/fixtureFetch.ts
git commit -m "test: add PrehrajTo fixture fetch adapter"
```

Expected: the adapter is deterministic, network-free, and rejects requests that are not part of the documented resolver flow.

### Task 3: Add Vitest resolver parsing tests

**Files:**
- Create: `tests/prehrajto/fixtureParsing.vitest.test.ts`

- [ ] **Step 1: Write the failing fixture assertions**

Use the public resolver API with the fixture adapter:

```ts
const fetchFixture = createPrehrajtoFixtureFetch();
const resolver = getResolver(fetchFixture.fetch);
const config = {
  prehrajtoUsername: "fixture-user@example.test",
  prehrajtoPassword: "fixture-password",
};
```

Add one test for the movie snapshot and one for the series snapshot. Each test must call `validateConfig`, `search`, and `resolve`, then assert the exact values recorded in the fixture README for the selected result. Assert at minimum: non-empty result list, resolver ID, title, duration, byte size, format when present, detail video URL, and subtitles when present.

- [ ] **Step 2: Assert the complete request boundary**

Assert that each test made exactly one anonymous GET, one login POST, one search GET, and one detail GET; assert that no request targets the resolved media URL. This preserves the distinction between parsing control-plane HTML and downloading media.

- [ ] **Step 3: Assert both detail-page stream formats represented by the fixtures**

Ensure one detail fixture exercises the `var sources = [...]` parser and one exercises the fallback `src: "..."` parser. Ensure at least one fixture has caption tracks and one has no captions, so both subtitle outcomes are locked down.

- [ ] **Step 4: Run the new tests and verify the intended failure first**

```bash
npm test -- tests/prehrajto/fixtureParsing.vitest.test.ts
```

Expected before any parser correction: the test either passes if the current parser handles both real snapshots or fails at the first concrete unsupported fixture shape with an assertion that identifies the missing parsed field. Do not weaken assertions to make a fixture pass.

- [ ] **Step 5: Make the smallest parser correction only if the snapshots expose a real gap**

Modify `src/service/prehrajto.ts` only for a confirmed fixture failure. Preserve the existing `getResolver(fetchImpl)` API, keep all network calls injectable, and add a focused assertion for every parser behavior changed. Do not add live network access, committed credentials, or a fallback that hides malformed pages.

- [ ] **Step 6: Run the Vitest suite and commit the tests**

```bash
npm test
npx eslint tests/prehrajto/fixtureFetch.ts tests/prehrajto/fixtureParsing.vitest.test.ts src/service/prehrajto.ts
git add tests/prehrajto src/service/prehrajto.ts
git commit -m "test: verify PrehrajTo parsing against snapshots"
```

Expected: Vitest passes the existing utility tests and both fixture parsing tests without network access.

### Task 4: Document fixture maintenance and verify all repository tests

**Files:**
- Modify: `README.md`
- Modify: `tests/fixtures/prehrajto/README.md`

- [ ] **Step 1: Document the test commands and fixture policy**

Update `README.md` to state that `npm test` runs deterministic Vitest tests, `npm run test:node` runs the Node-native proxy suite, and the PrehrajTo fixture tests use checked-in snapshots without credentials or network access. In the fixture README, document that snapshots should be refreshed only when the upstream markup changes and that expected values must be updated in the same change.

- [ ] **Step 2: Run all verification commands**

```bash
npm test
npm run test:node
npm run check:tsc
npm run check:lint
git diff --check
```

Expected: Vitest and the Node-native suite pass; any pre-existing compiler or lint errors are reported separately rather than masked by the fixture work.

- [ ] **Step 3: Review the final fixture diff**

Confirm that the diff contains only the intended HTML snapshots, parser tests, test adapter, documentation, and any narrowly required parser fix. Search the final tree for credentials and live smoke-test commands:

```bash
rg -n "password|token|cookie|Authorization|test:live|fetch\(" tests/fixtures/prehrajto README.md
```

Expected: no real credentials or cookies are present, and fixture tests contain no external network call.

- [ ] **Step 4: Commit documentation changes**

```bash
git add README.md tests/fixtures/prehrajto/README.md
git commit -m "docs: document PrehrajTo fixture tests"
```

Expected: fixture provenance, expected parser output, and refresh instructions are versioned with the tests.

---

## Self-review

- Fixture coverage includes both search-page parsing and detail-page stream parsing.
- Authentication remains deterministic and local; no cookies or credentials are checked in.
- The tests exercise the public resolver API rather than duplicating private parsing logic.
- Both `var sources` and fallback `src` stream declarations, plus caption/no-caption outcomes, are explicitly covered.
- Existing Node-native proxy tests remain runnable through `npm run test:node`; Vitest discovers only `.vitest.test.ts` files through `vitest.config.ts`.
- The plan includes parser changes only when a real snapshot demonstrates a concrete gap.
