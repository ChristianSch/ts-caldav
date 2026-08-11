# Changelog

All notable changes to this project are documented here. This project adheres
to [Semantic Versioning](https://semver.org/). While the package is pre-`1.0`,
minor releases may carry notable internal changes worth reviewing.

## 0.4.0

### Changed

- **HTTP layer migrated from `axios` to the runtime's native `fetch`.** `axios`
  is no longer a dependency. The public API (methods, arguments, return types,
  and `CalDAVError`) is unchanged, but a few behavioral details differ — see
  below. Node.js **18 or newer** is now required (added `engines.node >= 18`),
  since native `fetch` is used.
- `CalDAVOptions.headers` is now typed as `Record<string, string>` instead of
  the axios-specific `AxiosHeaders`. Plain header objects continue to work
  unchanged; only code that explicitly typed headers as `AxiosHeaders` needs
  updating.
- **Unified error handling: every failure thrown from a public method is now a
  `CalDAVError`** with an optional `.status` (HTTP status code) and `.cause`
  (the underlying error). Previously some read paths (e.g. `getCalendars`,
  `getCtag`, `syncChanges`) could surface an axios error or an internal
  transport error. Timeouts and network failures are wrapped too. Replace any
  `axios.isAxiosError(...)` checks with `error instanceof CalDAVError`.

### Fixed

- **Sub-path `baseUrl` no longer doubles the path segment on `getEvents` /
  `getTodos` / multiget** (#23). Under axios, a `baseUrl` such as Baikal's
  `http://host/dav.php/` combined with an absolute calendar href like
  `/dav.php/calendars/user/default/` produced a doubled
  `…/dav.php/dav.php/…` REPORT URL (404). The `fetch` layer resolves URLs with
  WHATWG `new URL(url, baseUrl)`, which replaces the whole path for an
  absolute-path href, so the request now hits the calendar exactly once. The
  resulting `CalDAVError` also carries the real `.status`/`.cause` instead of a
  generic message, making such issues diagnosable.
- **`rejectUnauthorized: false` works again.** During the initial `fetch`
  migration this option was accepted but silently ignored. It is now honored in
  Node.js via an [`undici`](https://www.npmjs.com/package/undici) dispatcher
  (install `undici`, or set `NODE_TLS_REJECT_UNAUTHORIZED=0`). On runtimes where
  TLS verification cannot be disabled (browsers, React Native, or Node without
  `undici`), a warning is logged instead of the option being silently dropped.

### Added

- Opt-in server-side expansion of recurring events/todos via the
  `expand?: boolean` option on `getEvents()` and `getTodos()`.
- `/dav.php` added to the auto-discovery candidate roots, so Baikal / sabre/dav
  deployments are discovered without manually pinning `baseUrl` to the sub-path.
- New exported types: `AuthOptions`, `CalDAVClientCache`, `EventRef`,
  `EventStatus`, `TodoRef`, `TodoStatus`, `SupportedComponent`,
  `SyncChangesResult`, `SyncTodosResult`, `VTimezone`, and the `EVENT_STATUSES`
  / `TODO_STATUSES` constants.

### Internal

- Extracted the monolithic client into `protocol/` and `utils/` modules.
- Added request timeouts and optional request logging (`requestTimeout`,
  `logRequests`).
