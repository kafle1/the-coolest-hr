# Edge Cases Handled

## 1. Duplicate applications

**Problem**: A candidate submits the same email + role combination twice.

**Solution**: A composite unique constraint (`@@unique([email, roleId])`) prevents duplicates at the database level. The submission handler catches the Prisma `P2002` error and returns a clear user-facing message. If the resume was already persisted to disk, it is cleaned up immediately so orphaned files never accumulate.

## 2. Invalid or oversized resumes

**Problem**: A candidate uploads a non-PDF/DOCX file, or a file over 5 MB.

**Solution**: `validateResumeFile` checks both MIME type and file extension before any processing. The system resolves the MIME type from the extension as a fallback (browsers sometimes send incorrect MIME types). Files exceeding 5 MB are rejected before they reach disk.

## 3. Closed or paused role submissions

**Problem**: A candidate loads the form for an open role, but by submit time the role is paused or closed.

**Solution**: `submitApplication` re-fetches the role from the database at submit time and checks `role.status !== OPEN`. Stale browser tabs cannot bypass this.

## 4. Slot conflicts across candidates

**Problem**: Two candidates try to confirm overlapping interview time slots simultaneously.

**Solution**: Slot confirmation runs inside a Prisma `$transaction` with `Serializable` isolation level. Before confirming, the transaction queries for any existing `CONFIRMED` holds that overlap the target time window across all interview plans. If a conflict is found, the transaction throws and no state changes are committed. When a candidate confirms a slot, all their remaining `HELD` sibling slots are atomically released.

## 5. Calendar acceptance tracking

**Problem**: Traditional systems parse email replies to detect whether a candidate accepted an invite, which is unreliable.

**Solution**: The system reads acceptance status directly from the Google Calendar event's `attendeeResponseStatus` field via the Calendar API. The status is stored on the `Interview` record and displayed in the admin UI.

## 6. No-reply scheduling follow-up

**Problem**: A candidate receives interview options but does not respond within 48 hours.

**Solution**: `processInterviewSchedulingNudges` finds all plans where `lastOptionsSentAt` is 48+ hours old with active `HELD` slots. It sends exactly one follow-up email per option batch and records `lastNudgeAt` so the nudge is not repeated.

## 7. Slack onboarding idempotency

**Problem**: The Slack `team_join` webhook may fire multiple times for the same user.

**Solution**: `completeSlackOnboarding` checks for existing `OnboardingEvent` records by type before performing any side effect. `SLACK_TEAM_JOIN`, `WELCOME_SENT`, and `HR_NOTIFIED` are each de-duplicated. The final status transition to `ONBOARDED` also checks current state before attempting the transition.

## 8. Expired hold cleanup

**Problem**: Interview slot holds that pass their `expiresAt` without candidate action can remain in `HELD` status indefinitely.

**Solution**: `POST /api/scheduling/expire-holds` finds all holds where `status = HELD` and `expiresAt < now`, marks them as `EXPIRED`, and releases associated Google Calendar hold events.

## 9. Admin route protection

**Problem**: The admin dashboard and admin API routes contain sensitive candidate data and hiring decisions that should not be publicly accessible.

**Solution**: A Next.js middleware intercepts all `/admin` and `/api/admin` routes before they reach any handler. It validates an HMAC-SHA256 signed session cookie. Unauthenticated page requests redirect to `/admin/login`; unauthenticated API requests return a `401` JSON response. The login page and auth API routes are excluded from protection.

## 10. Brute-force login attacks

**Problem**: An attacker could attempt to guess admin credentials through rapid automated login attempts.

**Solution**: The login endpoint is rate-limited to 10 attempts per minute per IP address. After exceeding the limit, all subsequent requests receive a `429 Too Many Requests` response until the window resets. The rate limiter uses a sliding window so the lockout decays naturally.

## 11. Application submission spam

**Problem**: Automated scripts could flood the application endpoint with fake submissions, consuming storage and AI screening resources.

**Solution**: The public `POST /api/applications` endpoint is rate-limited to 5 submissions per minute per IP address. This is generous enough for legitimate use but blocks rapid automated submissions. The rate limiter runs in-memory with automatic cleanup to prevent unbounded memory growth.
