import app from "./worker-v11.js";

const AMPRE = "https://query.ampre.ca/odata";
const VERSION = "phase2-smart-snapshot-v12-20260828";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/version") {
      return json({
        ok: true,
        version: VERSION,
        snapshot: "garage-basement-offer-history-school",
        schoolSource: "AMPRE school fields when available; no fabricated rating"
      });
    }

    if (url.pathname === "/api/property" && request.method === "GET") {
      const response = await app.fetch(request, env, ctx);
      let body;
      try { body = await response.clone().json(); } catch { return response; }
      if (!response.ok || !body?.ok || !body?.property) return response;

      const property = body.property;
      if (property.listingKey && env.AMPRE_TOKEN) {
        const raw = await fetchRawProperty(property.listingKey, env);
        if (raw) enrichProperty(property, raw);
      }

      normalizeSnapshotFields(property);
      return json(body, response.status);
    }

    if (url.pathname === "/app.js" && request.method === "GET") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      const original = await response.text();
      const patch = `\n\n;(${snapshotPatch.toString()})();\n`;
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "application/javascript; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(original + patch, { status: response.status, headers });
    }

    return app.fetch(request, env, ctx);
  }
};

async function fetchRawProperty(listingKey, env) {
  try {
    const response = await fetch(`${AMPRE}/Property('${encodeURIComponent(listingKey)}')`, {
      headers: { Authorization: `Bearer ${env.AMPRE_TOKEN}`, Accept: "application/json" }
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function enrichProperty(property, raw) {
  const garageSpaces = firstNumber(raw, [
    "GarageSpaces", "GarageSpaces1", "GarageParkingSpaces", "GarageParkingTotal", "CoveredSpaces"
  ]);
  if (garageSpaces != null) property.garageSpaces = garageSpaces;
  if (!property.garageType) property.garageType = firstText(raw, ["GarageType"]);

  property.offerDate = detectOfferDate(raw);

  const school = detectSchool(raw);
  if (school) property.bestSchool = school;
}

function normalizeSnapshotFields(property) {
  if (!property.offerDate) {
    const fallback = property.offerTiming || {};
    const parsed = extractDate(fallback.label || "");
    property.offerDate = parsed
      ? { available: true, label: parsed, note: "Offer date detected from the listing information. Verify with the listing brokerage before relying on it." }
      : { available: false, label: "No offer date", note: "There is no offer date mentioned in the listing information." };
  }
  if (!property.historySummary) property.historySummary = { years: 10, appearanceCount: 0 };
  if (!property.bestSchool) {
    property.bestSchool = {
      available: false,
      name: "School data unavailable",
      rating: null,
      note: "A verified school name/rating was not available from the connected property data. THM will not invent a rating."
    };
  }
}

function detectOfferDate(raw) {
  // Never expose brokerage/private remark text. If the authenticated feed makes
  // an offer instruction available, only the detected date is surfaced.
  const brokerText = [
    raw.BrokerRemarks, raw.BrokerageRemarks, raw.PrivateRemarks,
    raw.PrivateOfficeRemarks, raw.RemarksForBrokerage, raw.OfferRemarks
  ].filter(v => typeof v === "string" && v.trim()).join(" ");
  const publicText = [raw.PublicRemarks, raw.PublicRemarksExtras]
    .filter(v => typeof v === "string" && v.trim()).join(" ");
  const sourceText = brokerText || publicText;
  const offerSentences = sourceText.split(/(?<=[.!?])\s+|\n+/)
    .filter(s => /\boffer(?:s|ing)?\b|offer presentation|presentation of offers|reviewing offers/i.test(s))
    .join(" ");
  const date = extractDate(offerSentences);
  if (date) {
    return {
      available: true,
      label: date,
      note: brokerText
        ? "Offer date detected from brokerage listing instructions. Verify before drafting."
        : "Offer date detected from public listing remarks. Verify before drafting."
    };
  }
  return {
    available: false,
    label: "No offer date",
    note: brokerText
      ? "There is no offer date mentioned in the brokerage listing instructions."
      : "There is no offer date mentioned in the listing remarks."
  };
}

function extractDate(text) {
  const value = String(text || "");
  const named = value.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i)?.[0];
  if (named) return named.replace(/\s+/g, " ").trim();
  const iso = value.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/)?.[0];
  if (iso) return iso;
  return value.match(/\b\d{1,2}[-/]\d{1,2}[-/]20\d{2}\b/)?.[0] || null;
}

function detectSchool(raw) {
  const preferredNameKeys = [
    "ElementarySchool", "MiddleOrJuniorSchool", "HighSchool", "SchoolName",
    "NearbySchool", "ClosestSchool", "SchoolDistrict"
  ];
  let name = firstText(raw, preferredNameKeys);
  if (!name) {
    const entry = Object.entries(raw || {}).find(([key, value]) =>
      /school/i.test(key) && typeof value === "string" && value.trim() && !/district|board|bus|type/i.test(key)
    );
    if (entry) name = entry[1].trim();
  }
  if (!name) return null;

  let rating = firstNumber(raw, ["SchoolRating", "ElementarySchoolRating", "HighSchoolRating", "SchoolScore"]);
  if (rating == null) {
    const entry = Object.entries(raw || {}).find(([key, value]) =>
      /school.*(?:rating|score)|(?:rating|score).*school/i.test(key) && Number.isFinite(Number(value))
    );
    if (entry) rating = Number(entry[1]);
  }
  return {
    available: true,
    name,
    rating: rating != null ? rating : null,
    note: rating != null
      ? "School name and rating supplied by the connected property data; verify school boundaries and eligibility."
      : "School name supplied by the connected property data. A verified numeric rating is not available, so THM does not fabricate one."
  };
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const n = Number(record?.[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) return value.filter(Boolean).join(", ");
  }
  return null;
}

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

function snapshotPatch() {
  const byId = (id) => document.getElementById(id);
  const titleCase = (value) => String(value || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const plural = (n, one, many) => Number(n) === 1 ? one : many;

  const quickFactLabels = document.querySelectorAll("#quickFacts > div > span");
  if (quickFactLabels[4]) quickFactLabels[4].textContent = "GARAGE";

  const aiCards = document.querySelectorAll(".ai-grid article > span");
  if (aiCards[2]) aiCards[2].textContent = "BASEMENT";

  const marketPanel = document.querySelector(".market-panel");
  const marketKicker = marketPanel?.querySelector(".panel-kicker");
  const marketHeading = marketPanel?.querySelector(".panel-head h3");
  if (marketKicker) marketKicker.textContent = "SMART PROPERTY SNAPSHOT";
  if (marketHeading) marketHeading.textContent = "The MLS details buyers usually have to dig for.";

  const pulseLabels = document.querySelectorAll(".market-pulse-grid > div > span");
  if (pulseLabels[0]) pulseLabels[0].textContent = "MLS HISTORY · 10 YEARS";
  if (pulseLabels[1]) pulseLabels[1].textContent = "BEST CLOSEST SCHOOL";
  if (pulseLabels[2]) pulseLabels[2].textContent = "OFFER DATE";
  if (pulseLabels[3]) pulseLabels[3].textContent = "LISTING AGE";

  const originalQuickFacts = renderQuickFacts;
  renderQuickFacts = function(listing) {
    originalQuickFacts(listing);
    const rawSpaces = Number(listing.garageSpaces);
    const spaces = Number.isFinite(rawSpaces) ? rawSpaces : null;
    const type = listing.garageType ? titleCase(listing.garageType) : null;
    let value = "—";
    if (spaces != null && spaces > 0) value = [spaces, type].filter(Boolean).join(" ");
    else if (type && !/^false|none|no$/i.test(type)) value = type;
    else if (spaces === 0) value = "No garage";
    byId("factParking").textContent = value;
  };

  const originalAiBrief = renderAiBrief;
  renderAiBrief = function(listing) {
    originalAiBrief(listing);
    const basement = Array.isArray(listing.basement) ? listing.basement.filter(Boolean) : [];
    if (basement.length) {
      const primary = basement.slice(0, 2).map(titleCase).join(" + ");
      const extra = basement.slice(2).map(titleCase).join(" · ");
      setSignal(
        "flagSignal",
        primary,
        extra || "Basement configuration reported in the MLS. Verify finish quality, ceiling height, permits and legal use where relevant."
      );
    } else {
      setSignal("flagSignal", "Not reported", "The MLS does not provide a basement configuration for this property.");
    }
  };

  renderMarketRead = function(listing) {
    const history = listing.historySummary || {};
    const count = Number(history.appearanceCount || 0);
    byId("soldRangeValue").textContent = count ? `${count} ${plural(count, "listing", "listings")}` : "No MLS history";
    byId("soldRangeNote").textContent = count
      ? `This property appeared on MLS ${count} ${plural(count, "time", "times")} in the last 10 years.`
      : "No matching MLS appearance was found in the last 10 years.";

    const school = listing.bestSchool || {};
    byId("compCountValue").textContent = school.name || "School data unavailable";
    byId("compCountNote").textContent = school.rating != null
      ? `${school.rating}/10 · verify boundary and eligibility`
      : (school.note || "Verified school rating is not available from the connected data.");

    const offer = listing.offerDate || {};
    byId("offerTimingValue").textContent = listing.forSale ? (offer.available ? offer.label : "No offer date") : "Not for sale";
    byId("offerTimingNote").textContent = listing.forSale
      ? (offer.note || "There is no offer date mentioned in the listing information.")
      : "No active offer process.";

    if (listing.forSale) {
      const days = listing.daysLive;
      byId("listingTempoValue").textContent = typeof days === "number"
        ? (days === 0 ? "Listed today" : `${days} ${plural(days, "day", "days")} live`)
        : (listing.status || "Active");
      byId("listingTempoNote").textContent = listing.details?.listedAt
        ? `Listed ${formatDate(listing.details.listedAt)}`
        : "Current active MLS listing";
    } else if (count) {
      byId("listingTempoValue").textContent = history.lastSeenDate
        ? `Last seen ${formatDate(history.lastSeenDate)}`
        : `${count} MLS records`;
      byId("listingTempoNote").textContent = "Property is not currently listed for sale.";
    } else {
      byId("listingTempoValue").textContent = "Off market";
      byId("listingTempoNote").textContent = "No current MLS listing found.";
    }

    const comp = listing.comparableContext;
    const soldComps = byId("soldComps");
    const rows = Array.isArray(comp?.comparables) ? comp.comparables.slice(0, 3) : [];
    soldComps.innerHTML = rows.length
      ? `<div class="snapshot-comp-label">CLOSEST RECENT SOLD EVIDENCE</div>` + rows.map((item) => {
          const facts = [
            item.beds != null ? `${item.beds} bd` : null,
            item.baths != null ? `${item.baths} ba` : null,
            item.livingAreaRange
          ].filter(Boolean).join(" · ");
          return `<article class="sold-comp"><div><span>${escapeHtml(item.address || "MLS comparable")}</span><small>${escapeHtml([item.soldDate ? formatDate(item.soldDate) : null, facts].filter(Boolean).join(" · "))}</small></div><div><strong>${money(item.soldPrice)}</strong><em>${Math.round(item.similarity || 0)}% match</em></div></article>`;
        }).join("")
      : `<div class="sold-comps-empty">No strong recent sold match is shown here. THM will not use asking prices as fake sold evidence.</div>`;
  };
}
