# Assessment requirement audit

Checked against the supplied Sweety assignment on 19 November 2026; updated for signup, negative-review fixes and message timing through 21 November 2026. This distinguishes implementation completeness from the external submission steps.

## Required application behavior

| Requirement                                           | Implementation                                                    | Evidence                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| React frontend, Node/Express API, PostgreSQL database | `client/`, `server/src/`, `server/db/schema.sql`                  | Production build and integration tests against real PostgreSQL pass.              |
| Register with name, email and password; log in        | `/api/auth/register`, `/api/auth/login`                           | Registration, validation, login and logout tests; browser login verified.         |
| Hash passwords with bcrypt                            | The `bcrypt` package, cost 12                                     | Stored bcrypt hashes and password comparison checked in API tests.                |
| Users see only their own readings                     | Account-scoped list, report, update and delete queries            | A second account cannot list, report, edit or delete the first account's reading. |
| Add, view, edit and delete readings                   | `/api/readings` routes, dashboard and reading history             | API tests and real browser CRUD checks.                                           |
| Exactly four permitted slots                          | Shared slot definitions plus SQL CHECK constraint                 | UI options, invalid-slot tests and direct SQL constraint test.                    |
| Value is required                                     | Shared client/server validation                                   | Form test and API tests.                                                          |
| Whole number from 40 through 600 mg/dl                | Shared validation plus SQL integer/range constraints              | Missing, fractional, non-numeric, out-of-range and boundary-value tests.          |
| One reading per slot per day                          | SQL unique constraint and transactional conflict handling         | Duplicate, concurrent-duplicate and edit-conflict tests.                          |
| At most four readings per day                         | Four permitted slots combined with uniqueness                     | API test saves all four slots and rejects an additional reading.                  |
| No future dates                                       | API validation and form validation, using the configured timezone | Future-date and timezone-boundary tests.                                          |
| Clear UI errors                                       | Field errors and request-error messages                           | Form tests and browser required-value validation.                                 |
| Daily report                                          | Selected date only, with each reading and its slot                | Aggregate/boundary tests and dashboard screenshot.                                |
| Month-to-date report                                  | First of selected month through selected date, inclusive          | Aggregate/boundary tests and browser check.                                       |
| Monthly report                                        | Entire month before the selected date's month                     | Month/year/leap-year tests and previous-month screenshot.                         |
| Highest, lowest, one-decimal average and count        | PostgreSQL aggregation plus one-decimal UI formatting             | Exact aggregate assertions, including a non-terminating average.                  |
| Friendly empty reports                                | Zero count, dashes for absent statistics, empty-state text        | Empty-report API test and actual empty-state screenshot.                          |

## Requested signup refinements

- **Valid email formats:** common personal/company addresses, including all five supplied examples, are accepted. Invalid formats show a field error in the UI and are rejected by the API. Format validation does not verify that a mailbox exists.
- **No automatic login after signup:** the account is saved, a success message is shown, and the form switches to login with the email retained and password cleared. No session or cookie is issued at registration.
- **Separate login:** a successful login creates the session and shows "Login successful!" on the login screen for 1.5 seconds; the message clears before the dashboard opens. Reading-form errors also dismiss after three seconds while preserving the draft.
- **bcrypt:** password hashes use the `bcrypt` package with cost 12. Passwords are never stored as plain text.

The API and React form tests cover each refinement.

## Negative-review corrections

- Failed requests have a separate unavailable state; previous-date readings and false empty states are not presented as the selected report. Retry and successful empty periods have regression tests.
- Background loading and retries preserve entered reading drafts. Automatic suggestions update untouched forms, and successful saves still reset them.
- Concurrent deletion followed by an update returns 404 instead of an empty success response. A real PostgreSQL concurrency regression test covers this ordering.

The repository suite now contains 52 tests. All 33 frontend tests passed for the latest timing change; the 19 server/domain tests last passed on 20 November. The original negative-review harness passed all 16 groups for the 20 November corrections. See [verification.md](verification.md) for dates, browser evidence and limits.

## Required submission materials

| Requirement                                                             | Status                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Public GitHub repository URL                                            | [techmannih/sweety-glucose-tracker](https://github.com/techmannih/sweety-glucose-tracker) |
| Regular commits, not one large commit                                   | Included in the local Git repository and ZIP.                                             |
| README: installation, database setup, server/client startup and tests   | Included; fresh installation, tests and build were checked with Node 24.                  |
| `.env.example` with every setting and no real secrets                   | Included. Real `.env`, database files and dependencies are excluded from the ZIP and Git. |
| Demo seed script and sample readings                                    | Included; creates a fictional account and sample readings.                                |
| Screenshots or a short recording                                        | Eight screenshots included.                                                               |
| Notes: assumptions and future improvements                              | Included in README.                                                                       |
| Reply to the hiring email with the public URL and screenshots/recording | Pending email submission.                                                                 |

## Optional bonuses

Pagination, a line chart, frontend form tests and Docker configuration are included. Docker was not available on the verification host, so its runtime is not claimed as tested. Redis caching, BullMQ reminders and doctor accounts are optional and are not required for a complete implementation of the assignment's mandatory scope.

See [verification.md](verification.md) for observed checks and limitations.
