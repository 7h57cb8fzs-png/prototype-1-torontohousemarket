import app from "./worker-v3.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await app.fetch(request, env, ctx);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const type = response.headers.get("Content-Type") || "";
      if (response.ok && type.includes("text/html")) {
        let html = await response.text();
        html = html
          .replace(/<p class="legal-disclosure">[\s\S]*?<\/p>/i, '<p class="legal-disclosure">Showing targets depend on listing, seller and property-access availability.</p>')
          .replace(/phase2-20260814c/g, "phase2-20260814d");
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(html, { status: response.status, headers });
      }
    }

    return response;
  },
};
