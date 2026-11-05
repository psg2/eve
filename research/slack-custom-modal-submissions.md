---
issue: "https://github.com/vercel/eve/issues/2879"
status: proposed
last_updated: "2026-11-05"
---

# App-owned Slack modal submissions

Related to [#2879](https://github.com/vercel/eve/issues/2879) and
[the earlier #663 proposal](https://github.com/vercel/eve/pull/663).

Apps can open a modal from a message action, but eve acknowledges and discards
submissions whose callback ID is not its own HITL modal. Add an optional
`onViewSubmission(submission, ctx)` notification hook after request verification.

Expose callback ID, private metadata, view ID, raw state, submitting user and actor
workspace. Keep the Slack API handle scoped to the installation workspace, which
can differ from the actor's workspace. Applications still authorize their own
writes and validate private metadata against current backend state.

Return an empty HTTP 200 immediately and keep the callback alive with `waitUntil`,
as for shortcuts. Preserve eve-owned HITL precedence and the no-hook behavior.
This API cannot return field errors or replace the view in the acknowledgment.
That broader contract from #2879 is separate: Slack requires an acknowledgment
within three seconds, while application work can take longer.

The raw state and view ID extend the earlier #663 design. They allow applications
to process dates and multi-select values and identify submissions without parsing
the original HTTP request. No new credentials, route, or external service is needed.

Validation exercises the public signed HTTP route: rich state and identity,
installation-token selection, immediate acknowledgment before deferred work
settles, invalid signatures, no handler, callback failure, and HITL isolation.
