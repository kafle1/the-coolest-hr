# Niural Candidate Onboarding System

Working prototype for the Niural AI Product Operator take-home. The app covers the full candidate lifecycle from public job listing to Slack onboarding, with AI used where it creates real operator leverage instead of cosmetic automation.

## What the prototype covers

- Careers page with 3 seeded roles and full job descriptions
- Structured application intake with PDF or DOCX resume validation
- Automated confirmation email on submission
- AI resume parsing, fit scoring, and shortlist decisions
- AI candidate research with source links, limitations, and discrepancy flags
- Admin hiring dashboard with filters, manual overrides, status history, and candidate detail pages
- Session-based admin authentication with middleware-enforced route protection
- Candidate-facing application status tracker
- Rate limiting on public endpoints (application submission, login)
- Google Calendar scheduling flow with held slots, reschedules, and no-reply follow-up support
- Transcript ingestion through Fireflies API or direct text input
- Evidence-aware interviewer feedback review
- AI-generated offer letters with in-app signing
- Slack invite trigger, Slack onboarding events, and personalized welcome generation

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma + PostgreSQL
- OpenRouter or OpenAI for structured AI workflows
- Google Calendar API
- Resend
- Slack Web API
- Fireflies transcript retrieval
- Vitest + Playwright

## Local setup

1. Copy the env file and fill in your AI provider key:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY or OPENAI_API_KEY
```

2. Make sure PostgreSQL is available at the `DATABASE_URL` from `.env`.
   A local `docker-compose.yml` is included if you want Postgres in Docker.

3. Generate Prisma client, apply the schema, and seed roles:

```bash
pnpm prisma:generate
pnpm prisma migrate dev --name init
pnpm db:seed
```

4. Start the app:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AI_PROVIDER` | No | `auto` by default; prefers OpenRouter when `OPENROUTER_API_KEY` is set |
| `OPENROUTER_API_KEY` | No | Powers all AI features through OpenRouter |
| `OPENROUTER_MODEL` | No | Defaults to `openai/gpt-4.1-mini` |
| `OPENAI_API_KEY` | No | Optional direct OpenAI fallback |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini` |
| `SCREENING_THRESHOLD` | No | Minimum AI score to auto-shortlist (default: 76) |
| `RESEND_API_KEY` | No | Sends real emails; writes to DB when missing |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | No | Google Calendar integration |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | No | Google Calendar integration |
| `GOOGLE_CALENDAR_ID` | No | Google Calendar integration |
| `SLACK_BOT_TOKEN` | No | Slack DMs and notifications |
| `SLACK_ADMIN_USER_TOKEN` | No | Slack workspace invites |
| `SLACK_SIGNING_SECRET` | No | Verifies Slack webhook requests |
| `SLACK_TEAM_ID` | No | Required for real Slack invites |
| `SLACK_HR_CHANNEL_ID` | No | HR notification channel |
| `SLACK_DEFAULT_CHANNEL_IDS` | No | Auto-join channels for new hires |
| `FIREFLIES_API_KEY` | No | Fetches transcripts; direct text paste when missing |
| `ADMIN_EMAIL` | No | Admin login email (default: `admin@niural.com`) |
| `ADMIN_PASSWORD` | No | Admin login password (default: `test_admin_pwd`) |

When optional credentials are missing, the service gracefully degrades:
- **Calendar**: manages slots in Postgres without creating Google Calendar events
- **Email**: writes emails to the database for admin visibility
- **Slack**: logs actions to console and records events in the database
- **Fireflies**: accepts pasted transcript text directly

## Walkthrough script

1. Open `/` and show the 3 seeded roles with full job descriptions, locations, levels, and direct apply links.
2. Open one role detail page, then open `/apply` and show the intake form with file validation, role selection, and duplicate-role protection.
3. Submit a test application and explain that the backend immediately stores the resume, sends a confirmation email, runs AI resume parsing, calculates the fit score, and generates the research brief.
4. Open `/candidates/status`, enter the candidate email, and show the self-serve status tracker.
5. Navigate to `/admin`, show the redirect to `/admin/login`, and log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
6. In the admin dashboard, filter the application list and open the candidate profile. Walk through:
   - AI screening output with score, strengths, and gaps
   - Parsed skills, experience, education, employers, and achievements
   - Candidate research brief, discrepancies, source links, and limitations
   - Full status history and admin override controls
   - Resume preview and download
7. Click "Send scheduling options" and explain the hold logic: 3 to 5 interview slots are reserved immediately so no two candidates can confirm the same time.
8. Open the public scheduling link, confirm one slot, then point back to the candidate profile to show the confirmed interview and released sibling holds. Mention the reschedule path and the 48-hour nudge processor.
9. Paste or fetch a transcript, submit interviewer feedback, and show the AI feedback guardrail plus transcript summary.
10. Generate the offer from the admin page, review the AI-drafted letter, open the public signing link, and sign the offer.
11. Return to the candidate profile and show the signature metadata, signed-offer alert, Slack invite event, and onboarding-ready state.
12. If Slack credentials are configured, finish by replaying or describing the `team_join` flow that sends the AI-generated welcome message and HR notification. If not, show the local fallback audit trail instead.

## Architecture

- `app/`
  Candidate-facing pages, admin pages, public scheduling/signing pages, and route handlers.
- `lib/applications/service.ts`
  Main workflow orchestration for intake, screening, research, scheduling, transcript ingestion, feedback, resume retrieval, and overdue scheduling nudges.
- `lib/offers/service.ts`
  Offer generation, signing, alerting, Slack invitation, and Slack onboarding completion.
- `lib/ai/service.ts`
  AI boundary that supports either OpenAI directly or OpenRouter with structured outputs and web search.
- `lib/calendar/service.ts`
  Slot discovery, hold creation, confirmation, release, and Google Calendar event management.
- `lib/email/service.ts`, `lib/slack/service.ts`, `lib/fireflies/service.ts`
  External-service boundaries with credential-gated real implementations and local fallbacks.

## AI usage

Each AI call uses structured outputs backed by Zod schemas so the response is always type-safe and parseable. OpenAI uses the Responses API directly; OpenRouter uses JSON-schema structured responses and web search through the OpenAI-compatible endpoint.

- **Resume screening**: Parses resume into skills, experience, education, employers, achievements. Produces a fit score (0–100) with strengths and gaps against the specific role requirements.
- **Candidate research**: Builds a hiring-manager brief using web search, summarizes public evidence from LinkedIn/GitHub/portfolio, flags discrepancies, and records limitations.
- **Transcript summary**: Converts interview transcript text into a concise summary with bullet points.
- **Feedback guardrail**: Reviews interviewer notes for vague or biased phrasing and suggests evidence-based rewrites.
- **Offer generation**: Drafts a professional offer letter from candidate context and manager-provided inputs.
- **Slack welcome message**: Generates a personalized onboarding DM from signed offer and manager context.

## Integrations

### AI provider (required)

The app now supports either:

- **OpenRouter** via `OPENROUTER_API_KEY` and a model slug like `openai/gpt-4.1-mini`
- **OpenAI directly** via `OPENAI_API_KEY`

`AI_PROVIDER=auto` is the default and prefers OpenRouter when both are available. Candidate research keeps web search enabled in both paths.

### Google Calendar (optional)

Real mode uses Calendar freebusy queries for availability and creates hold/confirmation events. When credentials are missing, slots are managed locally in Postgres with real business-day timing.

### Fireflies (optional)

Chosen for v1 because transcript retrieval by meeting ID is straightforward to model. When the Fireflies API key is present, transcripts are fetched from the GraphQL API. When missing, the admin can paste transcript text directly. Limitation: notetaker attendance is not orchestrated in-app; the prototype focuses on post-meeting transcript retrieval and AI summarization.

### Slack (optional)

Real mode uses Slack admin scopes for invites with `team_id` and channel assignment. Handles `team_join` events for onboarding completion with email fallback lookup. When credentials are missing, events are logged and recorded locally.

### Resend (optional)

Real mode sends transactional emails. When missing, emails are written to the database and visible in the candidate audit trail.

## Scheduling conflict prevention

This is the most important systems design piece.

- When interview options are sent, the system creates `HELD` slot records in Postgres and mirrors them to calendar hold events.
- When a candidate confirms a slot, confirmation runs inside a **serializable transaction**.
- That transaction marks the chosen hold `CONFIRMED`, releases sibling holds for that candidate, preserves any already-confirmed interview until the replacement is secured, and blocks overlapping confirmation attempts across candidates.
- After the transaction succeeds, the calendar hold is promoted to the final meeting invite and obsolete holds are released.
- Candidate acceptance is tracked from the calendar event response status, not from email replies.
- If the candidate does not respond within 48 hours, the nudge processor sends exactly one follow-up email per option round and records `lastNudgeAt`.
- Expired holds can be cleaned up via `POST /api/scheduling/expire-holds`.

## Edge cases handled

1. **Duplicate applications** — Composite uniqueness on `email + roleId` prevents duplicate submissions. Orphaned resume files are cleaned up.
2. **Invalid or oversized resumes** — Only PDF/DOCX accepted. Files over 5 MB rejected before storage.
3. **Stale role submissions** — Backend re-checks role status at submit time.
4. **Slot conflicts across candidates** — Serializable transactions with explicit overlap checks.
5. **Calendar acceptance without email reply** — Tracked from Google Calendar invite status.
6. **No-reply scheduling follow-up** — Idempotent 48-hour nudge per option batch.
7. **Slack retries** — Repeated `team_join` events do not duplicate onboarding side effects.
8. **Expired slot holds** — Automatic cleanup via expiration endpoint.
9. **Admin auth bypass** — Next.js middleware intercepts all `/admin` and `/api/admin` routes before they execute.
10. **Brute-force login** — Rate limited to 10 attempts per minute per IP.
11. **Application spam** — Rate limited to 5 submissions per minute per IP.

## Assumptions and trade-offs

1. **Custom signing UI instead of DocuSign** — Keeps the entire offer flow demonstrable locally while still capturing signature image, signer IP, and timestamp. A production system would use DocuSign or Dropbox Sign for legal validity.
2. **Service-account calendar access** — Faster and more reproducible for a take-home than building a full OAuth consent flow. A production system would use delegated credentials.
3. **Credential-gated local fallbacks** — The system never dead-ends when optional credentials are missing. An AI provider key is the only required external dependency because AI is where the real value is.
4. **Fireflies over other notetakers** — Chosen because transcript retrieval by meeting ID is the fastest to integrate. Read.ai and Fathom have limited public API access.
5. **File-system resume storage** — Avoids cloud storage complexity for the take-home. A production system would use S3 or GCS.
6. **Env-based admin credentials** — Simple and appropriate for a single-admin internal tool. A production system would use a proper auth provider (Auth0, NextAuth, etc.) with password hashing.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

## Submission checklist

- [x] Working local prototype
- [x] README with architecture, integration choices, edge cases, and trade-offs
- [x] Edge case documentation (`EDGE_CASES.md`)
- [x] System explanation with trade-offs (`SYSTEM_EXPLANATION.md`)
- [x] Verification commands passing locally
- [ ] Loom walkthrough (use the walkthrough script above)
