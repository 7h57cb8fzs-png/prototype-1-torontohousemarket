import app from "./worker-v8.js";

const VERSION = "phase2-media-v9-20260814-2125";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({ ok:true, version:VERSION, addressResolver:"unparsed-contains-local-exact", media:"unique-large-direct-with-proxy-fallback" });
    }

    if (url.pathname === "/api/property" && request.method === "GET") {
      const response = await app.fetch(request, env, ctx);
      let body;
      try { body = await response.clone().json(); } catch { return response; }
      if (response.ok && body?.ok && body?.property && Array.isArray(body.property.photos)) {
        body.property.photos = normalizeUniquePhotos(body.property.photos);
        body.property.photoCount = body.property.photos.length;
      }
      return json(body, response.status);
    }

    // Make the browser resilient: use AMPRE's signed image URL first and
    // fall back to our Worker media proxy if the remote image ever fails.
    if (url.pathname === "/app.js" && request.method === "GET") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let text = await response.text();
      text = text.replace(
        'mainPhoto.onerror = () => removeBrokenPhoto(0);',
        'mainPhoto.onerror = () => { const p = photos[0]; if (p?.fallbackUrl && mainPhoto.src !== new URL(p.fallbackUrl, location.href).href) { mainPhoto.onerror = () => removeBrokenPhoto(0); mainPhoto.src = p.fallbackUrl; } else { removeBrokenPhoto(0); } };'
      );
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/javascript; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(text, { status:response.status, headers });
    }

    return app.fetch(request, env, ctx);
  },
};

function normalizeUniquePhotos(items) {
  const groups = new Map();
  for (const p of items) {
    if (!p || (!p.url && !p.directUrl)) continue;
    const key = String(p.key || "");
    const base = key.replace(/-(?:l|m|t|nw)$/i, "") || String(p.directUrl || p.url);
    const candidate = {
      ...p,
      // Signed AMPRE URLs are already display-ready and avoid a second API lookup.
      url: p.directUrl || p.url,
      fallbackUrl: p.url && p.url !== p.directUrl ? p.url : null,
    };
    const current = groups.get(base);
    if (!current || rank(candidate) < rank(current)) groups.set(base, candidate);
  }
  return [...groups.values()].slice(0, 60);
}

function rank(p) {
  const k = String(p?.key || "").toLowerCase();
  if (/-l$/.test(k)) return 0;      // large, display-ready, watermarked
  if (!/-(?:m|t|nw)$/.test(k)) return 1;
  if (/-m$/.test(k)) return 2;
  if (/-nw$/.test(k)) return 3;
  if (/-t$/.test(k)) return 4;
  return 5;
}

function json(body, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "X-THM-Version":VERSION,
      "X-Content-Type-Options":"nosniff"
    }
  });
}
