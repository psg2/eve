import { e2eSubagentConfig } from "@eve-e2e/config";
import { defineSelfModificationAgent } from "eve/self-modification/agent";

import config from "./config";

export default defineSelfModificationAgent({
  config,
  model: e2eSubagentConfig().model,
});
