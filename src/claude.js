// Claude's own count of a tool list, from the Anthropic token counting API (free; needs a key or an `ant` login).
// The tools' cost is the count with the tools minus the same request without them, so it includes the system
// prompt Claude adds when a request carries tools. Tool definitions are sent to Anthropic for counting.
import { definition } from "./count.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

export async function claudeCount(tools, { model = DEFAULT_MODEL } = {}) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    throw new Error("--claude needs the Anthropic SDK: npx -p @anthropic-ai/sdk -p mcp-token-cost mcp-token-cost --claude");
  }
  const client = new Anthropic();
  const messages = [{ role: "user", content: "." }];
  const base = await client.messages.countTokens({ model, messages });
  if (!tools.length) return { model, tokens: 0 };
  const withTools = await client.messages.countTokens({ model, messages, tools: tools.map(definition) });
  return { model, tokens: withTools.input_tokens - base.input_tokens };
}
