---
"eve": minor
---

Handle app-owned Slack modal submissions with `slackChannel({ onViewSubmission })`.

The hook receives the callback ID, private metadata, view ID, full state, actor,
and a workspace Slack API handle. eve acknowledges immediately and runs the hook
in the background. Its own approval and question modals keep their existing flow.
