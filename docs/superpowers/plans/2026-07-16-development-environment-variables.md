# Development Environment Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both development server commands optionally load root `.env` values, provide a committed template, and prevent local configuration from being committed.

**Architecture:** Node.js 24 natively parses `.env` files through `--env-file-if-exists`, so the two existing package scripts will opt into that flag before running `server.ts`. Git ignores the developer-local file while a `.env.example` documents the current `PORT` configuration; no application code or third-party dependency changes are required.

**Tech Stack:** Node.js 24 native CLI environment-file support, npm scripts, Git ignore rules, TypeScript project checks.

---

### Task 1: Add safe local configuration files

**Files:**
- Modify: `.gitignore:1-3`
- Create: `.env.example`

- [ ] **Step 1: Add the root `.env` file to Git ignore rules**

  Insert `.env` as its own line after `node_modules` in `.gitignore`:

  ```gitignore
  node_modules
  .env
  static/logs-*
  storage/*
  !storage/.gitkeep
  ```

  Do not use `.env*`: it would also ignore the committed `.env.example` template.

- [ ] **Step 2: Create the tracked template with the current server setting**

  Create `.env.example` at the repository root with exactly:

  ```dotenv
  # Port used by the Stremio addon HTTP server.
  PORT=52932
  ```

  This matches `server.ts`, which falls back to `52932` when `PORT` is unset. Do not add speculative variables for features not implemented by the current branch.

- [ ] **Step 3: Verify Git treats the two files differently**

  Run:

  ```bash
  git check-ignore -v .env
  git check-ignore -v .env.example
  ```

  Expected: the first command prints the `.gitignore` rule that ignores `.env`; the second exits with status `1` and prints nothing because `.env.example` remains trackable.

- [ ] **Step 4: Commit the configuration-file change**

  ```bash
  git add .gitignore .env.example
  git commit -m "chore: add local environment template"
  ```

### Task 2: Enable optional `.env` loading for both server commands

**Files:**
- Modify: `package.json:9-10`

- [ ] **Step 1: Update the two package scripts to use Node’s optional environment-file loader**

  Replace the current script values with:

  ```json
  {
    "scripts": {
      "start": "node --env-file-if-exists=.env --experimental-strip-types server.ts",
      "start:install": "node --env-file-if-exists=.env --experimental-strip-types server.ts --install"
    }
  }
  ```

  Retain every other script unchanged. The `if-exists` form is essential: it lets contributors run both commands before creating `.env`.

- [ ] **Step 2: Confirm the scripts retain the required Node flags and entrypoint**

  Run:

  ```bash
  npm pkg get scripts.start scripts.start:install
  ```

  Expected:

  ```json
  "node --env-file-if-exists=.env --experimental-strip-types server.ts"
  "node --env-file-if-exists=.env --experimental-strip-types server.ts --install"
  ```

- [ ] **Step 3: Commit the startup-script change**

  ```bash
  git add package.json
  git commit -m "chore: load local environment files on startup"
  ```

### Task 3: Verify environment loading and repository health

**Files:**
- Verify only; do not stage `.env`.

- [ ] **Step 1: Verify Node’s loader applies values and preserves shell precedence**

  Run the following commands from the repository root, using a temporary file so no developer-local `.env` is created or overwritten:

  ```bash
  env_file="$(mktemp)"
  printf 'PORT=6101\n' > "$env_file"
  node --env-file="$env_file" --input-type=module -e 'if (process.env.PORT !== "6101") process.exit(1)'
  PORT=6102 node --env-file="$env_file" --input-type=module -e 'if (process.env.PORT !== "6102") process.exit(1)'
  rm "$env_file"
  ```

  Expected: both Node commands exit `0`. This proves `.env`-style values are loaded and an explicitly supplied `PORT` wins over the file.

- [ ] **Step 2: Install the locked dependencies needed to start the server**

  Run:

  ```bash
  npm ci
  ```

  Expected: dependencies from `package-lock.json` are installed without modifying either package manifest.

- [ ] **Step 3: Verify both commands start when `.env` is absent**

  Before starting either command, ensure that `.env` does not exist; if a developer-local file is already present, do not delete or overwrite it. In one terminal, start each command separately; while it remains running, execute the corresponding `curl` in a second terminal:

  ```bash
  npm start
  curl --fail http://127.0.0.1:52932/manifest.json
  ```

  ```bash
  npm run start:install
  curl --fail http://127.0.0.1:52932/manifest.json
  ```

  Expected: each `curl` command exits `0` and returns the addon manifest. Stop the active server before starting the next one. This confirms optional loading does not require `.env`.

- [ ] **Step 4: Verify both commands use a root `.env` and shell values override it**

  Create an ignored local file with an unused port:

  ```bash
  printf 'PORT=6101\n' > .env
  ```

  In one terminal, start each command separately; while it remains running, execute the corresponding `curl` in a second terminal:

  ```bash
  npm start
  curl --fail http://127.0.0.1:6101/manifest.json
  ```

  ```bash
  npm run start:install
  curl --fail http://127.0.0.1:6101/manifest.json
  ```

  Stop the active server between commands. Then, in one terminal, run `npm start` with a parent-environment override; request its manifest from a second terminal:

  ```bash
  PORT=6102 npm start
  curl --fail http://127.0.0.1:6102/manifest.json
  ```

  Expected: every `curl` command exits `0`. The final command must listen on `6102`, proving the parent environment overrides `.env`. Keep `.env` locally if useful; Git ignores it.

- [ ] **Step 5: Run static repository checks**

  Run:

  ```bash
  npm run check
  ```

  Expected: both `tsc --noEmit` and ESLint exit successfully.

- [ ] **Step 6: Review the final diff and commit verification-only documentation if needed**

  Run:

  ```bash
  git status --short
  git diff --check HEAD
  ```

  Expected: no tracked unexpected files, no `.env` in Git status, and no whitespace errors. No commit is needed for the verification steps themselves.
