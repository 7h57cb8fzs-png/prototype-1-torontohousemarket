export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Lead system is not configured." }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  if (typeof payload.website === "string" && payload.website.trim()) {
    return json({ ok: true }, 200);
  }

  const propertyInput = clean(payload.property_input, 1000);
  const listingKey = clean(payload.listing_key, 32) || null;
  const name = clean(payload.name, 160);
  const mobile = clean(payload.mobile, 50);
  const email = clean(payload.email, 254).toLowerCase() || null;
  const showingTiming = clean(payload.showing_timing, 30) || "asap";

  if (!propertyInput || !name || !mobile) {
    return json({ ok: false, error: "Property, name and mobile are required." }, 400);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please enter a valid email." }, 400);
  }

  const rpcUrl = `${env.SUPABASE_URL}/rest/v1/rpc/create_lead_and_assign`;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      p_property_input: propertyInput,
      p_listing_key: listingKey,
      p_name: name,
      p_mobile: mobile,
      p_email: email,
      p_showing_timing: showingTiming,
      p_page_url: clean(payload.page_url, 1000) || null,
      p_referrer: clean(payload.referrer, 1000) || null
    })
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Lead RPC failed", result);
    return json({ ok: false, error: "Unable to save your request right now." }, 500);
  }

  const row = Array.isArray(result) ? result[0] : result;
  return json({ ok: true, lead_id: row?.lead_id || null }, 201);
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
