# Development Environment Variables Design

## Purpose

Provide a safe, dependency-free way to configure local development through a root `.env` file while preserving a tracked template for contributors.

## Scope

The change applies to both local server commands:

- `npm start`
- `npm run start:install`

It introduces a committed `.env.example`, ignores each developer's `.env`, and does not alter runtime configuration parsing in application code.

## Architecture

The project requires Node.js 24.x, which provides the native `--env-file-if-exists` CLI option. Each startup script will pass `.env` through that option before executing `server.ts`.

When `.env` is absent, Node continues normally. When present, Node populates `process.env` from its entries. Values explicitly supplied by the parent shell or deployment environment retain precedence, allowing commands such as `PORT=6000 npm start` to override a developer's local file without editing it.

No `dotenv` package or custom configuration loader is needed.

## Files and responsibilities

- `package.json`: add optional native `.env` loading to both server startup scripts.
- `.gitignore`: exclude the developer-local `.env` file.
- `.env.example`: document the supported `PORT` variable and its default value without including secrets.

## Configuration contract

The current server reads only `PORT`. The example file will contain:

```dotenv
# Port used by the Stremio addon HTTP server.
PORT=52932
```

Developers create `.env` from this template and can change the port. The server's existing fallback remains `52932` if neither `.env` nor the parent environment defines `PORT`.

## Verification

Verification confirms that both startup commands include the optional loader, `.env` is ignored while `.env.example` is tracked, and a temporary `.env` value changes the port selected by `npm start`. It also confirms a shell-supplied `PORT` has precedence and runs the repository's TypeScript and lint checks.

## Success criteria

- `.env.example` is committed and describes the supported local environment variable.
- `.env` is not tracked by Git.
- `npm start` and `npm run start:install` load `.env` when it exists and work when it does not.
- Existing process environment variables override values in `.env`.
- No runtime dependency is added.
