# Verification

Original browser verification: 19 November 2026, macOS arm64 and the Codex in-app Chromium browser. Message timing and the delayed login transition were verified on 21 November 2026 using Node 24.22.3, React Testing Library and a real browser. Negative-review fixes were verified on 20 November with real PostgreSQL 18.6 integration tests. The earlier signup changes were also checked on Node 26.7.0.

## Automated checks

- Latest frontend run: all 33 React Testing Library tests passed on Node 24 (21 November). The unchanged server/domain suite last passed all 19 tests on 20 November. The current repository suite contains 52 tests; `npm test` runs both commands.
- `npm run build`: production React build succeeds.
- npm dependency audit: zero known vulnerabilities in the installed lockfile at verification time.
- The server tests create and drop an isolated temporary PostgreSQL database. These are real SQL integration tests, not database mocks.

## Message timing and login transition (21 November 2026)

- A successful login displays "Login successful!" on the login screen for 1.5 seconds. The message clears before the dashboard opens. Inputs and account switching are disabled during the transition; repeated submissions cannot start another login.
- Reading-form validation and server error messages, including both duplicate-slot messages and red highlighting, clear after three seconds. The entered value and chosen slot stay intact. Submitting an invalid draft again still validates it, and a fresh failure gets a fresh timeout.
- Reading save/update/delete success notices also clear after three seconds. Report-loading failures keep their unavailable/retry state.
- Timer tests assert login behavior at 1,499 ms and 1,500 ms and reading-feedback behavior at 2,999 ms and 3,000 ms, check cancellation on unmount and verify that a rejected login never navigates. The login delay was shortened from three seconds to 1.5 seconds after the initial browser check; the updated interval was verified with the automated tests.
- Browser verification used the fictional demo account on a temporary local preview at `127.0.0.1:3002`, leaving the existing localhost account alone. Login success appeared on the login screen; the dashboard then appeared without that message. A duplicate After breakfast attempt for 18 November displayed both errors, then cleared both while retaining `456`, the slot and a non-highlighted field. No reading was created by the rejected request.
- Actual screenshots: [login success](screenshots/07-login-success.jpg) and [preserved draft after errors clear](screenshots/08-message-cleared.jpg). The temporary preview was stopped after verification.

## Negative-review fixes (20 November 2026)

All three reported defects have regression coverage in the repository:

- A failed report request now shows an unavailable state and retry. The dashboard only renders data belonging to the current date, period, page and refresh. An initial failure no longer claims that the date or history is empty. Successful zero-row responses still show the normal empty state.
- Reading drafts survive report completion and retry. Automatic slot suggestions apply only to an untouched form. Successful saves and explicit edit/cancel actions still reset the form as intended.
- An edit whose reading was deleted after its ownership check returns 404. A deterministic real-PostgreSQL test commits the deletion before resuming the update, verifies the missing row and empty report, and checks that another save still succeeds.

The original independent negative-review harness was rerun against a separate copy of the fixes: all 10 API groups and 6 React groups passed. This includes all four assertions that failed during the original review. Across 98 rejected reading operations, database rows and all three report responses remained unchanged. The earlier review and its logs remain historical evidence for the pre-fix commit.

The local preview and proxied health endpoint both returned HTTP 200 after the changes. The new failure, delay, retry and draft interactions were checked with React Testing Library/jsdom, not a new browser automation run. No new browser screenshots are claimed.

## Signup and email update (20 November 2026)

- All five requested addresses pass both form and API tests: `alex@example.com`, `alex123@example.com`, `alex.morgan@example.com`, `alex_123@example.net`, and `developer@example.org`.
- Malformed formats, including missing TLDs, repeated dots, repeated @ signs, and invalid domain labels, are rejected before account creation. This checks format only; no verification email is sent.
- Signup returns the success message without setting a cookie or creating a session. Protected endpoints remain inaccessible until explicit login.
- Frontend tests confirm the success message, the prefilled login email, the cleared password and no dashboard callback until the user submits a successful login.
- The `bcrypt` package creates `$2b$` hashes with cost 12, and tests compare the saved hash with the password. The running local demo also accepts its existing hash after the package change.
- These updated interactions were checked with automated form and API tests; no new browser screenshot is claimed for this change.

## Fresh reviewer setup (19 November 2026)

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
