import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { defineEval } from "eve/evals";

const TOOL_NAME = "eval_greet_user";
const TOOL_PATH = `/source/tools/${TOOL_NAME}.ts`;
const TOOL_TOKEN = "SELF_MOD_NATIVE_TOOL_OK";

export default defineEval({
  tags: ["real-model"],
  description:
    "A request for a reusable agent action creates a model-callable eve tool instead of a standalone script.",
  timeoutMs: 240_000,

  async test(t) {
    if (t.target.kind !== "local") {
      t.skip("Self-modification tool creation requires a local development target.");
    }

    const sourcePath = join(process.cwd(), "agent", "tools", `${TOOL_NAME}.ts`);
    await rm(sourcePath, { force: true });
    await rebuild(t);

    try {
      const started = await t.send(
        [
          `Please add a reusable action named ${TOOL_NAME} that you can use when Alice asks for a greeting in future conversations.`,
          `It must accept a required name string and return structured data containing the name and the greeting "${TOOL_TOKEN} Hello, <name>!".`,
        ].join(" "),
      );
      started.expectOk();
      started.calledSubagent("self-modification");

      const progress = t.target.watchTurn(started.sessionId, {
        startIndex: requireStreamIndex(t),
      });
      const progressTurn = await progress.result();
      progressTurn.expectOk();
      const childSessionId = progressTurn.events.flatMap((event) =>
        event.type === "subagent.called" && event.data.name === "self-modification"
          ? [event.data.childSessionId]
          : [],
      )[0];
      if (childSessionId === undefined) {
        throw new Error("Self-modification child session was not started.");
      }

      const childTurn = await t.target.watchTurn(childSessionId).result();
      childTurn.expectOk();
      childTurn.calledTool("write_file", {
        input: { filePath: TOOL_PATH },
        output: { existed: false, path: TOOL_PATH },
        count: 1,
      });
      childTurn.noFailedActions();

      const source = await readFile(sourcePath, "utf8");
      if (
        !/from\s+["']eve\/tools["']/u.test(source) ||
        !/export\s+default\s+defineTool\s*\(/u.test(source)
      ) {
        throw new Error(`${TOOL_PATH} is not an authored eve tool definition.`);
      }

      await rebuild(t);

      const followUp = await t.send(
        `Call ${TOOL_NAME} exactly once with the name Alice, then reply with only its greeting.`,
      );
      followUp.expectOk();
      followUp.calledTool(TOOL_NAME, { count: 1 });
      followUp.calledTool(TOOL_NAME, {
        input: { name: "Alice" },
        output: { name: "Alice", greeting: `${TOOL_TOKEN} Hello, Alice!` },
      });
      followUp.messageIncludes(`${TOOL_TOKEN} Hello, Alice!`);

      t.succeeded();
      t.noFailedActions();
    } finally {
      await rm(sourcePath, { force: true });
      await rebuild(t);
    }
  },
});

async function rebuild(t: {
  readonly target: { fetch(path: string, init?: RequestInit): Promise<Response> };
}): Promise<void> {
  const response = await t.target.fetch("/eve/v1/dev/runtime-artifacts/rebuild?force=1", {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(`Failed to rebuild the self-modified agent: ${response.status}`);
}

function requireStreamIndex(session: {
  readonly state?: { readonly streamIndex?: number };
}): number {
  const streamIndex = session.state?.streamIndex;
  if (streamIndex === undefined) throw new Error("Parent session has no stream index.");
  return streamIndex;
}
