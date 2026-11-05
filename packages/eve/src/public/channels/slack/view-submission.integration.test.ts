import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isCompiledChannel } from "#channel/compiled-channel.js";
import { isHttpRouteDefinition } from "#channel/routes.js";
import { mockAgentRouteArgs } from "#internal/testing/mocks/mock-route-args.js";
import { HITL_FREEFORM_MODAL_CALLBACK_ID } from "#public/channels/slack/hitl.js";
import {
  slackChannel,
  type SlackChannelConfig,
  type SlackViewSubmission,
} from "#public/channels/slack/index.js";

const secret = "modal-test-secret";
const state = {
  values: {
    date: { value: { type: "datepicker", selected_date: "2026-11-05" } },
    tags: {
      value: {
        type: "multi_static_select",
        selected_options: [{ value: "sales" }, { value: "support" }],
      },
    },
  },
};
function request(callbackId = "meeting_edit", valid = true) {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: "T_ACTOR" },
      user: { id: "U_REVIEWER", team_id: "T_ACTOR" },
      view: {
        id: "V_EDIT",
        app_installed_team_id: "T_INSTALLATION",
        callback_id: callbackId,
        private_metadata: "review:42:version:3",
        state,
      },
    }),
  }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return new Request("https://example.com/eve/v1/slack", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": valid ? `v0=${signature}` : "v0=forged",
    },
  });
}
async function post(config: SlackChannelConfig, input: Request) {
  const channel = slackChannel(config);
  if (!isCompiledChannel(channel)) throw new Error("Expected compiled channel");
  const route = channel.routes.find((route) => route.method === "POST");
  if (!route || !isHttpRouteDefinition(route)) throw new Error("Expected HTTP route");
  const pending: Promise<unknown>[] = [];
  const unavailable = () => {
    throw new Error("Modal callback must not start a session");
  };
  const response = await route.handler(input, {
    from: unavailable,
    resolveSession: unavailable,
    attachSession: unavailable,
    to: unavailable,
    params: {},
    requestIp: null,
    ...mockAgentRouteArgs(),
    waitUntil: (task) => {
      pending.push(task);
    },
  });
  return { response, pending };
}

describe("custom modal submissions", () => {
  it("acknowledges before application work settles and preserves rich state and installation identity", async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const observed: SlackViewSubmission[] = [];
    let authorization: string | null = null;
    const { response, pending } = await post(
      {
        credentials: {
          signingSecret: secret,
          botToken: async ({ teamId }) => `token-for-${teamId}`,
        },
        api: {
          fetch: async (_url, init) => {
            authorization = new Headers(init?.headers).get("authorization");
            return Response.json({ ok: true });
          },
        },
        async onViewSubmission(submission, ctx) {
          observed.push(submission);
          await work;
          await ctx.slack.request("chat.postEphemeral", {
            channel: "C_REVIEW",
            user: submission.user.id,
            text: "Saved",
          });
        },
      },
      request(),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(observed).toEqual([
      {
        callbackId: "meeting_edit",
        privateMetadata: "review:42:version:3",
        viewId: "V_EDIT",
        state,
        user: { id: "U_REVIEWER", username: undefined, name: undefined },
        teamId: "T_ACTOR",
      },
    ]);
    expect(authorization).toBeNull();
    finish();
    await Promise.all(pending);
    expect(authorization).toBe("Bearer token-for-T_INSTALLATION");
  });

  it.each(["no handler", "eve-owned modal", "invalid signature", "handler failure"])(
    "preserves safe handling for %s",
    async (scenario) => {
      const received: string[] = [];
      const { response, pending } = await post(
        {
          credentials: { signingSecret: secret },
          ...(scenario === "no handler"
            ? {}
            : {
                onViewSubmission: async (submission: SlackViewSubmission) => {
                  received.push(submission.callbackId);
                  if (scenario === "handler failure") throw new Error("application failure");
                },
              }),
        },
        request(
          scenario === "eve-owned modal" ? HITL_FREEFORM_MODAL_CALLBACK_ID : "meeting_edit",
          scenario !== "invalid signature",
        ),
      );
      expect(response.status).toBe(scenario === "invalid signature" ? 401 : 200);
      if (response.status === 200) expect(await response.text()).toBe("");
      await Promise.all(pending);
      expect(received).toEqual(scenario === "handler failure" ? ["meeting_edit"] : []);
    },
  );
});
