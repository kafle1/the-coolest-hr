# System Explanation

## Architecture decisions

### Single state machine for the entire pipeline

Every application follows one linear status progression: `APPLIED → SCREENED → SHORTLISTED → INTERVIEW_PENDING → INTERVIEW_SCHEDULED → INTERVIEW_COMPLETED → OFFER_DRAFT → OFFER_SENT → OFFER_SIGNED → SLACK_INVITED → ONBOARDED`. Rejections branch from any status to `REJECTED`, and `REJECTED` can return to `SHORTLISTED` via admin override.

**Why**: A single status field with explicit transition rules eliminates ambiguity about where a candidate is in the pipeline. Every transition is recorded in `StatusHistory` with the actor, timestamp, and note, creating a complete audit trail.

### Service interfaces with credential-gated implementations

Every external integration (AI provider, Google Calendar, Resend, Slack, Fireflies) is behind a TypeScript interface with a factory function. The factory checks whether the required credentials are configured:

- **AI provider** — Required. The factory selects OpenRouter when `AI_PROVIDER=auto` and `OPENROUTER_API_KEY` is present, otherwise it uses direct OpenAI. All AI features (screening, research, transcript summary, feedback review, offer generation, Slack welcome) require one of those keys.
- **Google Calendar** — Optional. Falls back to `LocalCalendarService` which manages slots in Postgres without creating real calendar events.
- **Resend** — Optional. Falls back to `LocalMailService` which writes emails to the database for audit visibility.
- **Slack** — Optional. Falls back to `LocalSlackService` which logs actions to the console and records events in the database.
- **Fireflies** — Optional. Falls back to `DirectTextTranscriptService` which accepts pasted transcript text directly. When Fireflies is configured, it fetches transcripts via the GraphQL API.

**Why**: The system never dead-ends when optional credentials are missing. Required services (the AI provider) fail fast with clear errors. Optional services degrade gracefully to local implementations that keep the state machine running.

### Serializable transactions for scheduling

Slot confirmation uses Prisma's `Serializable` isolation level. The transaction reads the freshest hold state, checks for cross-candidate overlaps, confirms the chosen slot, releases siblings, and creates the interview record atomically.

**Why**: Calendar scheduling is the highest-risk area for race conditions. Serializable isolation prevents phantom reads and ensures that the overlap check and the status update are atomic.

### File-system resume storage with path traversal protection

Resumes are stored in `data/resumes/` and retrieved via a route that validates the resolved path stays within the resume directory.

**Why**: For a take-home prototype, this avoids cloud storage complexity while keeping the security model real. The path validation in `readStoredResume` prevents directory traversal attacks.

## Where AI adds real value

### Resume screening

AI parses the resume into structured fields (skills, experience, education, employers, achievements) and produces a fit score with specific strengths and gaps against the role requirements. This replaces the first 15–30 minutes of manual resume review with a structured signal. The auto-shortlist threshold means only strong candidates proceed to research, saving expensive web-search calls and interviewer prep time.

### Candidate research

The research module uses provider-native web search to find public evidence about shortlisted candidates. It produces a hiring-manager brief, summarizes LinkedIn/GitHub/portfolio evidence, flags discrepancies against the resume, and records limitations. The system distinguishes between "no evidence found" and "contradictory evidence found" — missing data is a limitation, not a negative signal.

### Feedback guardrail

When an interviewer submits feedback, AI reviews it for vague or potentially biased language and suggests an evidence-based rewrite. Flagged feedback is marked `requiresAttention` in the UI. The guardrail does not block feedback — it flags it and provides a concrete alternative.

### Offer letter generation

AI generates a professional offer letter body from candidate context, role, compensation, and manager name. The output feeds into a styled HTML template with proper escaping.

### Slack welcome message

After offer signing and Slack join, AI generates a personalized onboarding DM with their name, role, start date, and manager.

## Trade-offs

| Decision | Upside | Downside |
|---|---|---|
| Custom signing UI instead of DocuSign | Fully functional without third-party dependency | No legal audit trail for production use |
| Refresh-token calendar access with service-account fallback | Real interviewer availability and invite handling when configured | Requires one-time Google OAuth setup in development |
| File-system resume storage | No cloud dependency; path traversal protection | Not suitable for multi-instance deployment without shared storage |
| AI provider required, other services optional | Core AI features always work; optional services degrade gracefully | Development still requires one live AI API key |
| Direct transcript text input fallback | Works without Fireflies API key | No automated meeting recording |

## What production would need

1. **Real e-signature provider** (DocuSign, Dropbox Sign) for legally binding offers
2. **Cloud storage** (S3/GCS) for resumes and offer documents
3. **Production-grade auth and RBAC** for the admin dashboard instead of single-admin env credentials
4. **Cron-based scheduling** for hold expiration and nudge processing
5. **Webhook verification** for Fireflies (currently modeled but not cryptographically verified)
6. **Distributed rate limiting** instead of the current in-memory limiter
7. **Background job queue** (e.g., Inngest, BullMQ) to decouple AI screening from the request cycle
