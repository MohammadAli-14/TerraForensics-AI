const { reqBody } = require("../../../utils/http");
const {
  validatedRequest,
} = require("../../../utils/middleware/validatedRequest");

function apiPageAgentEndpoints(app) {
  if (!app) return;

  const hasValidJson = (content) => {
    if (typeof content !== "string") return false;
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  };

  const safeParseJson = (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const normalizeToAgentOutput = (data, actionNames = new Set()) => {
    const message = data?.choices?.[0]?.message;
    if (!message) return data;

    const firstToolCall = Array.isArray(message.tool_calls)
      ? message.tool_calls[0]
      : null;

    // Case 1: Model returned a direct tool call (e.g. click_element_by_index).
    // Page-Agent expects tool_call.function.name === "AgentOutput" and action payload inside arguments.
    if (
      firstToolCall?.function?.name &&
      firstToolCall.function.name !== "AgentOutput"
    ) {
      const actionName = firstToolCall.function.name;
      if (actionNames.has(actionName)) {
        const args = safeParseJson(firstToolCall.function.arguments) || {};
        const wrapped = { action: { [actionName]: args } };
        message.tool_calls = [
          {
            ...firstToolCall,
            function: {
              ...firstToolCall.function,
              name: "AgentOutput",
              arguments: JSON.stringify(wrapped),
            },
          },
        ];
        return data;
      }
    }

    // Case 2: Model returned JSON in content like {"name":"click...","input":{...}}
    // Convert to { action: { click...: {...} } } format expected by Page-Agent.
    const parsedContent = safeParseJson(message.content);
    if (
      parsedContent &&
      typeof parsedContent === "object" &&
      parsedContent.name &&
      actionNames.has(parsedContent.name)
    ) {
      const wrapped = {
        action: {
          [parsedContent.name]: parsedContent.input || {},
        },
      };
      message.tool_calls = [
        {
          id: `call_${Date.now()}`,
          type: "function",
          function: {
            name: "AgentOutput",
            arguments: JSON.stringify(wrapped),
          },
        },
      ];
      return data;
    }

    // Case 3: Empty assistant message (no tool_call + no content).
    // The local model (Ollama) likely ran out of context space or failed to produce JSON.
    // Instead of forcing a "wait 1" action which causes an infinite 40-step loop,
    // we force a `done` action to gracefully abort the task.
    const hasToolCalls =
      Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    const hasContent =
      typeof message.content === "string" && message.content.trim().length > 0;
    if (!hasToolCalls && !hasContent) {
      message.tool_calls = [
        {
          id: `call_${Date.now()}`,
          type: "function",
          function: {
            name: "AgentOutput",
            arguments: JSON.stringify({
              action: {
                done: {
                  success: false,
                  text: "Local model failed to respond correctly due to context size or complexity. Please ensure your Ollama Context Window (num_ctx) is large enough, or try a more capable model.",
                },
              },
            }),
          },
        },
      ];
      message.content = "";
      return data;
    }

    return data;
  };

  // Proxy endpoint for Page-Agent LLM requests.
  // Forwards OpenAI-compatible chat/completions (with tools) to local Ollama.
  // Page-Agent's OpenAIClient calls ${baseURL}/chat/completions, so the route
  // must end with /chat/completions to match.
  app.post(
    "/v1/page-agent/chat/completions",
    [validatedRequest],
    async (request, response) => {
      try {
        const ollamaBase = process.env.PAGE_AGENT_OLLAMA_BASE;
        const upstreamBase = process.env.PAGE_AGENT_BASE_URL || ollamaBase;
        const model = process.env.PAGE_AGENT_MODEL;
        const upstreamApiKey = process.env.PAGE_AGENT_API_KEY;

        if (!upstreamBase || !model) {
          return response.status(503).json({
            error:
              "Page-Agent is not configured. Set PAGE_AGENT_MODEL and PAGE_AGENT_BASE_URL (or PAGE_AGENT_OLLAMA_BASE) in server/.env.development",
          });
        }

        const body = reqBody(request);
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const actionNames = new Set(
          hasTools
            ? body.tools
                .map((t) => t?.function?.name)
                .filter((name) => typeof name === "string" && name.length > 0)
            : []
        );

        // Build the forwarded payload — pass through everything Page-Agent sends
        // but override the model with the configured one.
        const payload = {
          ...body,
          model,
          // Lower temperature reduces free-form replies and improves tool-call reliability.
          temperature:
            typeof body.temperature === "number" ? body.temperature : 0,
          // When tools are present, require tool call output unless caller explicitly overrides.
          ...(hasTools && !body.tool_choice ? { tool_choice: "required" } : {}),
          ...(ollamaBase && upstreamBase === ollamaBase
            ? {
                // Expand context window so Page-Agent's large DOM prompts fit.
                // llama3.1:8b defaults to 8K which is too small.
                options: {
                  ...(body.options || {}),
                  num_ctx: Number(process.env.PAGE_AGENT_NUM_CTX) || 32768,
                },
              }
            : {}),
        };

        const base = upstreamBase.replace(/\/+$/, "");
        const hasCompletionsPath = /\/chat\/completions$/i.test(base);
        const hasV1Suffix = /\/v1$/i.test(base);
        const isOllamaMode = !!ollamaBase && upstreamBase === ollamaBase;
        const upstreamCandidates = hasCompletionsPath
          ? [base]
          : isOllamaMode && !hasV1Suffix
            ? [`${base}/v1/chat/completions`, `${base}/chat/completions`]
            : hasV1Suffix
              ? [`${base}/chat/completions`]
              : [`${base}/chat/completions`, `${base}/v1/chat/completions`];

        const callUpstream = async (requestPayload) => {
          for (const url of upstreamCandidates) {
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(upstreamApiKey
                  ? { Authorization: `Bearer ${upstreamApiKey}` }
                  : {}),
              },
              body: JSON.stringify(requestPayload),
              signal: AbortSignal.timeout(120_000), // 2 min timeout for large DOM prompts
            });

            // If a candidate path is not found, try the next known-compatible path.
            if (res.status === 404 && upstreamCandidates.length > 1) continue;
            return { res, url };
          }

          return { res: null, url: upstreamCandidates[0] || base };
        };

        let { res: ollamaResponse, url: resolvedUpstreamURL } =
          await callUpstream(payload);

        // Repair pass: some models occasionally ignore tools and return plain text.
        // If that happens, force a concise reminder and retry once server-side.
        if (ollamaResponse.ok) {
          const firstDataRaw = await ollamaResponse.json();
          const firstData = normalizeToAgentOutput(firstDataRaw, actionNames);
          const firstMessage = firstData?.choices?.[0]?.message || {};
          const missingToolCall =
            hasTools &&
            (!Array.isArray(firstMessage.tool_calls) ||
              firstMessage.tool_calls.length === 0);
          const invalidJsonContent = !hasValidJson(firstMessage.content);

          if (missingToolCall && invalidJsonContent) {
            const repairPayload = {
              ...payload,
              messages: [
                ...(Array.isArray(payload.messages) ? payload.messages : []),
                {
                  role: "system",
                  content:
                    "You must respond using function tool calls only. Do not return plain text.",
                },
              ],
              tool_choice: "required",
              temperature: 0,
            };

            const { res: retryResponse, url: retryURL } =
              await callUpstream(repairPayload);
            if (retryResponse.ok) {
              const retryRaw = await retryResponse.json();
              const retryData = normalizeToAgentOutput(retryRaw, actionNames);
              return response.status(200).json(retryData);
            }

            resolvedUpstreamURL = retryURL || resolvedUpstreamURL;
            ollamaResponse = retryResponse;
          }

          return response.status(200).json(firstData);
        }

        {
          if (!ollamaResponse) {
            return response.status(502).json({
              error:
                "Upstream endpoint not reachable from configured Page-Agent base URL.",
            });
          }

          const errText = await ollamaResponse.text().catch(() => "");
          console.error(
            `[Page-Agent Proxy] Upstream ${resolvedUpstreamURL} returned ${ollamaResponse.status}: ${errText}`
          );
          return response.status(ollamaResponse.status).json({
            error: `Ollama error (${ollamaResponse.status}): ${errText}`,
          });
        }
      } catch (e) {
        console.error(`[Page-Agent Proxy] Error: ${e.message}`);
        if (e.name === "TimeoutError") {
          return response.status(504).json({
            error:
              "Ollama request timed out. The model may need more time for large DOM contexts.",
          });
        }
        return response.status(500).json({
          error: `Page-Agent proxy error: ${e.message}`,
        });
      }
    }
  );

  // Health check — lets the frontend know if Page-Agent is configured.
  app.get(
    "/v1/page-agent/status",
    [validatedRequest],
    async (_request, response) => {
      const configured =
        (!!process.env.PAGE_AGENT_BASE_URL ||
          !!process.env.PAGE_AGENT_OLLAMA_BASE) &&
        !!process.env.PAGE_AGENT_MODEL;
      return response.status(200).json({
        enabled: configured,
        model: process.env.PAGE_AGENT_MODEL || null,
        baseURL:
          process.env.PAGE_AGENT_BASE_URL ||
          process.env.PAGE_AGENT_OLLAMA_BASE ||
          null,
      });
    }
  );
}

module.exports = { apiPageAgentEndpoints };
