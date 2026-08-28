import smartSnapshot from "./worker-v12.js";
import agentMcp from "./worker-agent-v12.js";

const VERSION = "phase2-combined-snapshot-agent-v23-20260828";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        website: "smart-property-snapshot",
        agents: "authenticated-rest-and-streamable-http-mcp",
        comparables: "recent-sold-only",
        reports: "workers-ai-with-deterministic-fallback",
        operations: "admin-and-job-queue"
      });
    }

    if (
      url.pathname === "/mcp" ||
      url.pathname === "/api/agent/search" ||
      url.pathname.startsWith("/api/agent/listing/")
    ) {
      return agentMcp.fetch(request, env, ctx);
    }

    return smartSnapshot.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    // The Aug 27 agent worker delegates scheduled jobs to worker-v11,
    // which owns the existing report/notification automation pipeline.
    if (typeof agentMcp.scheduled === "function") {
      return agentMcp.scheduled(controller, env, ctx);
    }
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-THM-Version": VERSION,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
