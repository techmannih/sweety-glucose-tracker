# Verification

Verified on 19 November 2026 using macOS arm64, Node 26.7.0, a real PostgreSQL 18.6 local instance and the Codex in-app Chromium browser.

## Automated checks

- `npm test`: 16 server/domain tests and 7 React Testing Library tests pass.
- `npm run build`: production React build succeeds.
- npm dependency audit: zero known vulnerabilities in the installed lockfile at verification time.
- The server tests create and drop an isolated temporary PostgreSQL database. These are real SQL integration tests, not database mocks.

## Fresh reviewer setup

The delivered ZIP was extracted into a separate folder with no existing `node_modules`, `.env` or database. Using bundled Node **24.22.3**, `npm ci` installed the exact lockfile, all 23 tests passed, the production build succeeded and the formatting check passed.

The local database launcher was then verified using a fresh PostgreSQL data directory and separate test ports. Both migration and seed scripts were run repeatedly. The seed remained at 198 sample readings without duplication. The built JavaScript asset, demo login, daily/previous-month reports, reading creation/edit/deletion and logout revocation all passed against that fresh database. Temporary services were shut down after the check.

The local launcher uses loopback TCP and disables unused Unix sockets, avoiding operating-system socket-path limits for repositories extracted into long directory paths. `.nvmrc` records Node 24 as the recommended version.

## Browser checks

Using the fictional seeded account:

- Login opens the dashboard with the account name and two readings for the current day.
- Empty glucose submission shows the required-value error.
- Adding a 123 mg/dl After lunch reading updates the list, count, average and chart.
- Editing that test reading to 127 mg/dl updates the report average.
- Delete opens a confirmation dialog; deleting the newly added test record restores the original two-reading day.
- Month-to-date and previous-month tabs display the proper date ranges and counts. The previous-month report covers 1-31 October 2026 with 124 readings.
- Reading history advances from page 1 to page 2 and displays different records.
- The dashboard is usable at a 390px viewport without horizontal page overflow. The viewport override was reset after verification.
- The production build served directly by Express loads correctly and preserves the authenticated session; it was checked at a temporary localhost port.
- Selecting an unrecorded date shows null statistics as dashes, a zero count, empty daily slots and the friendly chart empty state. Logout returns to the login screen.

Screenshots in `docs/screenshots/` are real browser captures, not mockups. All displayed readings are synthetic seed data. They show the login page, daily dashboard, previous-month report, paginated history and mobile layout.

## Limits

- Docker was unavailable on this host, so the supplied Dockerfile and Compose workflow were not executed here.
- No production service or GitHub remote was provisioned. No email was sent.
- No multi-browser compatibility certification or exhaustive accessibility audit is claimed.
