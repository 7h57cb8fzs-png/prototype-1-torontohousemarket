const analysisForm = document.getElementById("analysisForm");
const propertyInput = document.getElementById("propertyInput");
const snapshotSection = document.getElementById("snapshotSection");
const snapshotProperty = document.getElementById("snapshotProperty");
const snapshotMeta = document.getElementById("snapshotMeta");
const propertySummary = document.getElementById("propertySummary");
const marketIntel = document.getElementById("marketIntel");
const liveAddress = document.getElementById("liveAddress");
const liveDetails = document.getElementById("liveDetails");
const livePrice = document.getElementById("livePrice");
const matchMethod = document.getElementById("matchMethod");
const offerTimingValue = document.getElementById("offerTimingValue");
const offerTimingNote = document.getElementById("offerTimingNote");
const soldRangeValue = document.getElementById("soldRangeValue");
const soldRangeNote = document.getElementById("soldRangeNote");
const latestSoldValue = document.getElementById("latestSoldValue");
const latestSoldNote = document.getElementById("latestSoldNote");
const listingTempoValue = document.getElementById("listingTempoValue");
const listingTempoNote = document.getElementById("listingTempoNote");

const leadModal = document.getElementById("leadModal");
const closeModal = document.getElementById("closeModal");
const doneButton = document.getElementById("doneButton");
const leadForm = document.getElementById("leadForm");
const leadFormPanel = document.getElementById("leadFormPanel");
const leadSuccessPanel = document.getElementById("leadSuccessPanel");
const modalProperty = document.getElementById("modalProperty");
const modalPropertyDisplay = document.getElementById("modalPropertyDisplay");
const leadSubmit = document.getElementById("leadSubmit");
const leadError = document.getElementById("leadError");

let activeProperty = "";
let liveListing = null;

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => propertyInput.focus(), 450);
    }
  });
});

function money(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
}

function compactMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1000000) return `$${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 2)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return money(value);
}

function soldDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function detectMlsKey(value) {
  const match = value.trim().toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

function setBaseSnapshot() {
  document.getElementById("priceSignal").textContent = "Compare before offering";
  document.getElementById("priceSignalText").textContent = "We put the asking price in context against the closest matches.";
  document.getElementById("marketSignal").textContent = "Finding matches";
  document.getElementById("marketSignalText").textContent = "Micro-area, property type, size, lot, layout utility and recency.";
  document.getElementById("flagSignal").textContent = "What to verify";
  document.getElementById("flagSignalText").textContent = "Surface details worth checking before you get emotionally committed.";
  document.getElementById("valueSignal").textContent = "What may support value";
  document.getElementById("valueSignalText").textContent = "Lot, layout, parking, condition, location and useful property features.";
  document.getElementById("showingSignal").textContent = "Go in prepared";
  document.getElementById("showingSignalText").textContent = "Know what matters most to verify inside this specific property.";
  document.getElementById("nextMoveSignal").textContent = "Worth a closer look?";
  document.getElementById("nextMoveText").textContent = "A simple buyer action — not a meaningless AI score.";

  matchMethod.textContent = "Similarity-weighted property matching";
  offerTimingValue.textContent = "Checking…";
  offerTimingNote.textContent = "Checking listing instructions.";
  soldRangeValue.textContent = "Checking…";
  soldRangeNote.textContent = "Finding the closest property matches.";
  latestSoldValue.textContent = "Checking…";
  latestSoldNote.textContent = "Price · sold date";
  listingTempoValue.textContent = "Checking…";
  listingTempoNote.textContent = "How fresh this listing is.";
}

function renderMarketPulse(listing) {
  marketIntel.classList.remove("hidden");
  const offer = listing.offerTiming;
  offerTimingValue.textContent = offer?.label || "Offers anytime*";
  offerTimingNote.textContent = offer?.note || "Verify with the listing brokerage.";

  const comp = listing.comparableContext;
  if (comp?.available) {
    soldRangeValue.textContent = comp.rangeLow === comp.rangeHigh
      ? compactMoney(comp.rangeLow)
      : `${compactMoney(comp.rangeLow)} – ${compactMoney(comp.rangeHigh)}`;
    const source = comp.source === "sold" ? "sold matches" : "live asking matches";
    soldRangeNote.textContent = `${comp.matchCount} ${source} · ${comp.confidence}`;
    matchMethod.textContent = `${comp.method} · ${comp.sourceLabel}`;
  } else {
    soldRangeValue.textContent = "Building market set";
    soldRangeNote.textContent = "Closest live property matches are still being expanded.";
    matchMethod.textContent = "THM Similarity Engine";
  }

  if (comp?.latestSold?.price && comp?.latestSold?.date) {
    latestSoldValue.textContent = `${compactMoney(comp.latestSold.price)} · ${soldDate(comp.latestSold.date)}`;
    latestSoldNote.textContent = "Latest usable sold record in the match pool";
  } else {
    latestSoldValue.textContent = "Unavailable in IDX";
    latestSoldNote.textContent = "We will not substitute an asking price for a sold price.";
  }

  const days = listing.daysLive;
  if (typeof days === "number") {
    listingTempoValue.textContent = days === 0 ? "Listed today" : days === 1 ? "1 day live" : `${days} days live`;
    listingTempoNote.textContent = listing.status ? `${listing.status} · freshness affects urgency` : "Listing freshness affects urgency";
  } else {
    listingTempoValue.textContent = listing.status || "Live listing";
    listingTempoNote.textContent = "Current listing status";
  }
}

function marketPosition(listing) {
  const comp = listing.comparableContext;
  const ask = listing.listPrice;
  if (!comp?.available || typeof ask !== "number" || !comp.midpoint) {
    return { title: `${money(ask)} asking`, note: "Comparable context is still limited by the current property match set." };
  }

  const delta = (ask - comp.midpoint) / comp.midpoint;
  const pct = Math.abs(delta * 100).toFixed(1).replace(".0", "");
  const range = `${compactMoney(comp.rangeLow)}–${compactMoney(comp.rangeHigh)}`;

  if (ask < comp.rangeLow) return { title: "Below THM match band", note: `${pct}% below the similarity-weighted midpoint · band ${range}.` };
  if (ask > comp.rangeHigh) return { title: "Above THM match band", note: `${pct}% above the similarity-weighted midpoint · band ${range}.` };
  return { title: "Inside THM match band", note: `${pct}% from the similarity-weighted midpoint · band ${range}.` };
}

function renderListing(listing) {
  liveListing = listing;
  propertySummary.classList.remove("hidden");
  liveAddress.textContent = listing.address || activeProperty;

  const facts = [
    listing.propertySubType,
    listing.beds != null ? `${listing.beds} bed` : null,
    listing.baths != null ? `${listing.baths} bath` : null,
    listing.livingAreaRange || null
  ].filter(Boolean);
  liveDetails.textContent = facts.join(" · ");
  livePrice.textContent = money(listing.listPrice);
  renderMarketPulse(listing);

  const position = marketPosition(listing);
  document.getElementById("priceSignal").textContent = position.title;
  document.getElementById("priceSignalText").textContent = position.note;

  const comp = listing.comparableContext;
  if (comp?.available) {
    document.getElementById("marketSignal").textContent = `${comp.matchCount} close matches`;
    document.getElementById("marketSignalText").textContent = `${comp.basis || "Similarity + recency weighted"} · ${comp.sourceLabel}.`;
  } else {
    document.getElementById("marketSignal").textContent = "Broad market context";
    document.getElementById("marketSignalText").textContent = "We avoid forcing weak properties into the comp set just to produce a number.";
  }

  const flags = [];
  if (Array.isArray(listing.basement) && listing.basement.length) flags.push(listing.basement.join(", "));
  if (listing.kitchensTotal > 1) flags.push(`${listing.kitchensTotal} kitchens`);
  if (listing.remarks && /permit|approval|zoning|legal/i.test(listing.remarks)) flags.push("Verify approvals / permits");
  document.getElementById("flagSignal").textContent = flags.length ? flags[0] : "No obvious listing flag";
  document.getElementById("flagSignalText").textContent = flags.length > 1 ? flags.slice(1).join(" · ") : "Still verify condition, representations and material property details.";

  const valueBits = [];
  if (listing.lotWidth && listing.lotDepth) valueBits.push(`${listing.lotWidth} × ${listing.lotDepth} ft lot`);
  if (listing.parkingTotal) valueBits.push(`${listing.parkingTotal} parking`);
  if (listing.garageType) valueBits.push(listing.garageType);
  document.getElementById("valueSignal").textContent = valueBits[0] || "Property strengths";
  document.getElementById("valueSignalText").textContent = valueBits.slice(1).join(" · ") || "Focus on features that materially support utility and resale value.";

  if (listing.showingFocus) {
    document.getElementById("showingSignal").textContent = listing.showingFocus.title;
    document.getElementById("showingSignalText").textContent = listing.showingFocus.note;
  }

  const offerScheduled = listing.offerTiming?.type === "scheduled";
  if (offerScheduled) {
    document.getElementById("nextMoveSignal").textContent = "See it before offer time";
    document.getElementById("nextMoveText").textContent = "If interested, inspect early enough to verify the property before deciding on offer strategy.";
  } else if (comp?.available && listing.listPrice < comp.rangeLow) {
    document.getElementById("nextMoveSignal").textContent = "Worth seeing quickly";
    document.getElementById("nextMoveText").textContent = "The asking price sits below the current THM match band; verify why before assuming it is a bargain.";
  } else if (comp?.available && listing.listPrice > comp.rangeHigh) {
    document.getElementById("nextMoveSignal").textContent = "View, then negotiate";
    document.getElementById("nextMoveText").textContent = "The ask sits above the THM match band; condition and uniqueness need to justify the premium.";
  } else {
    document.getElementById("nextMoveSignal").textContent = "Worth seeing";
    document.getElementById("nextMoveText").textContent = "Use the showing to validate condition, layout and the details that can change your offer strategy.";
  }
}

analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  activeProperty = propertyInput.value.trim();
  if (!activeProperty) return;

  setBaseSnapshot();
  liveListing = null;
  propertySummary.classList.add("hidden");
  marketIntel.classList.add("hidden");
  snapshotProperty.textContent = activeProperty;
  snapshotMeta.textContent = "A fast first read — no registration.";
  snapshotSection.classList.remove("hidden");
  setTimeout(() => snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" }), 70);

  const listingKey = detectMlsKey(activeProperty);
  if (!listingKey) {
    snapshotMeta.textContent = "Snapshot ready. Live MLS matching for addresses and listing links is the next resolver layer.";
    return;
  }

  snapshotMeta.textContent = "Loading live listing + THM match set…";
  try {
    const response = await fetch(`/api/property?listingKey=${encodeURIComponent(listingKey)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load listing.");
    renderListing(result.property);
    snapshotProperty.textContent = result.property.address || listingKey;
    snapshotMeta.textContent = `MLS ${listingKey} · Live property intelligence`;
  } catch (error) {
    snapshotMeta.textContent = "Live property intelligence could not be loaded right now.";
  }
});

function openLeadModal() {
  modalProperty.value = activeProperty;
  modalPropertyDisplay.value = liveListing?.address || activeProperty;
  leadForm.reset();
  modalProperty.value = activeProperty;
  modalPropertyDisplay.value = liveListing?.address || activeProperty;
  leadError.classList.add("hidden");
  leadError.textContent = "";
  leadFormPanel.classList.remove("hidden");
  leadSuccessPanel.classList.add("hidden");
  leadSubmit.disabled = false;
  leadSubmit.textContent = "Request Showing + Full AI Brief";
  leadModal.classList.remove("hidden");
}

function hideLeadModal() { leadModal.classList.add("hidden"); }

document.getElementById("seeHomeButton").addEventListener("click", openLeadModal);
closeModal.addEventListener("click", hideLeadModal);
doneButton.addEventListener("click", hideLeadModal);
leadModal.addEventListener("click", (event) => { if (event.target === leadModal) hideLeadModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideLeadModal(); });

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeProperty) return;

  const form = new FormData(leadForm);
  const payload = {
    property_input: activeProperty,
    listing_key: liveListing?.listingKey || detectMlsKey(activeProperty),
    name: String(form.get("name") || "").trim(),
    mobile: String(form.get("mobile") || "").trim(),
    email: String(form.get("email") || "").trim(),
    showing_timing: String(form.get("showing_timing") || "asap"),
    website: String(form.get("website") || "").trim(),
    page_url: window.location.href,
    referrer: document.referrer || null
  };

  leadSubmit.disabled = true;
  leadSubmit.textContent = "Sending…";
  leadError.classList.add("hidden");

  try {
    const response = await fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send your request.");
    leadFormPanel.classList.add("hidden");
    leadSuccessPanel.classList.remove("hidden");
  } catch (error) {
    leadError.textContent = error instanceof Error ? error.message : "Unable to send your request.";
    leadError.classList.remove("hidden");
    leadSubmit.disabled = false;
    leadSubmit.textContent = "Request Showing + Full AI Brief";
  }
});
