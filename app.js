const $ = (id) => document.getElementById(id);

const analysisForm = $("analysisForm");
const propertyInput = $("propertyInput");
const snapshotSection = $("snapshotSection");
const snapshotProperty = $("snapshotProperty");
const snapshotMeta = $("snapshotMeta");
const propertySummary = $("propertySummary");
const marketIntel = $("marketIntel");
const liveAddress = $("liveAddress");
const liveDetails = $("liveDetails");
const livePrice = $("livePrice");
const listingLabel = $("listingLabel");
const marketStatusPill = $("marketStatusPill");
const matchMethod = $("matchMethod");
const offerTimingValue = $("offerTimingValue");
const offerTimingNote = $("offerTimingNote");
const soldRangeValue = $("soldRangeValue");
const soldRangeNote = $("soldRangeNote");
const latestSoldValue = $("latestSoldValue");
const latestSoldNote = $("latestSoldNote");
const listingTempoValue = $("listingTempoValue");
const listingTempoNote = $("listingTempoNote");
const decisionTitle = $("decisionTitle");
const decisionText = $("decisionText");
const seeHomeButton = $("seeHomeButton");

const leadModal = $("leadModal");
const closeModal = $("closeModal");
const doneButton = $("doneButton");
const leadForm = $("leadForm");
const leadFormPanel = $("leadFormPanel");
const leadSuccessPanel = $("leadSuccessPanel");
const modalProperty = $("modalProperty");
const modalPropertyDisplay = $("modalPropertyDisplay");
const leadSubmit = $("leadSubmit");
const leadError = $("leadError");
const modalEyebrow = $("modalEyebrow");
const modalTitle = $("modalTitle");
const nextStepLabel = $("nextStepLabel");
const showingTiming = $("showingTiming");

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function detectMlsKey(value) {
  const match = value.trim().toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

function setText(id, title, note) {
  $(id).textContent = title;
  const noteEl = $(`${id}Text`);
  if (noteEl) noteEl.textContent = note;
}

function setBaseSnapshot() {
  setText("priceSignal", "Analyzing price", "Building the closest available market set.");
  setText("marketSignal", "Finding matches", "Micro-area, property type, size, lot, utility and recency.");
  setText("flagSignal", "What to verify", "Surface details that can change value or strategy.");
  setText("valueSignal", "What supports value", "Lot, layout, parking, condition and useful property features.");
  setText("showingSignal", "Property focus", "The most useful thing to verify next.");
  setText("nextMoveSignal", "Clear next step", "A practical buyer action — not a fake score.");

  matchMethod.textContent = "THM Similarity Engine v2";
  offerTimingValue.textContent = "Checking…";
  offerTimingNote.textContent = "Checking property status and offer instructions.";
  soldRangeValue.textContent = "Checking…";
  soldRangeNote.textContent = "Building the closest market range.";
  latestSoldValue.textContent = "Checking…";
  latestSoldNote.textContent = "Verified sold when available.";
  listingTempoValue.textContent = "Checking…";
  listingTempoNote.textContent = "Current listing or 10-year MLS history.";
}

function renderMarketPulse(listing) {
  marketIntel.classList.remove("hidden");
  const comp = listing.comparableContext;
  const opinion = listing.priceOpinion;

  offerTimingValue.textContent = listing.offerTiming?.label || (listing.forSale ? "Offers anytime*" : "Not for sale");
  offerTimingNote.textContent = listing.offerTiming?.note || "Verify status before relying on it.";

  if (opinion?.available) {
    soldRangeValue.textContent = `${compactMoney(opinion.low)} – ${compactMoney(opinion.high)}`;
    soldRangeNote.textContent = `${listing.forSale ? "THM comp range" : "THM price opinion"} · ${opinion.confidence} confidence`;
    matchMethod.textContent = `${comp?.method || "THM Similarity Engine v2"} · ${comp?.sourceLabel || "market history"}`;
  } else {
    soldRangeValue.textContent = "Range unavailable";
    soldRangeNote.textContent = opinion?.note || "Not enough reliable data to force a number.";
    matchMethod.textContent = comp?.method || "THM Similarity Engine v2";
  }

  const sold = comp?.latestSold || listing.historySummary?.latestSold;
  if (sold?.price && sold?.date) {
    latestSoldValue.textContent = `${compactMoney(sold.price)} · ${formatDate(sold.date)}`;
    latestSoldNote.textContent = "Verified sold price + date from available MLS data";
  } else if (!listing.forSale && listing.historySummary?.appearanceCount) {
    latestSoldValue.textContent = `${listing.historySummary.appearanceCount} MLS record${listing.historySummary.appearanceCount === 1 ? "" : "s"}`;
    latestSoldNote.textContent = "No verified sold price exposed by this IDX feed";
  } else {
    latestSoldValue.textContent = "Sold not exposed";
    latestSoldNote.textContent = "We do not substitute an asking price for a sold price";
  }

  if (listing.forSale) {
    const days = listing.daysLive;
    listingTempoValue.textContent = typeof days === "number" ? (days === 0 ? "Listed today" : `${days} day${days === 1 ? "" : "s"} live`) : (listing.status || "Active");
    listingTempoNote.textContent = `${listing.status || "Active"} · listing freshness affects urgency`;
  } else {
    const h = listing.historySummary;
    listingTempoValue.textContent = h?.lastSeenDate ? `Last MLS: ${formatDate(h.lastSeenDate)}` : "No active listing";
    listingTempoNote.textContent = h?.lastStatus ? `Last status: ${h.lastStatus} · searched 10 years` : "Searched up to 10 years of MLS history";
  }
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
  liveDetails.textContent = facts.join(" · ") || "Property identified from MLS history";

  marketStatusPill.textContent = listing.forSale ? "FOR SALE" : "NOT FOR SALE";
  marketStatusPill.className = `market-status-pill ${listing.forSale ? "is-live" : "is-off"}`;
  listingLabel.textContent = listing.forSale ? "LIVE LISTING" : "OFF-MARKET PROPERTY";

  if (listing.forSale) {
    livePrice.textContent = money(listing.listPrice);
  } else if (listing.priceOpinion?.available) {
    livePrice.innerHTML = `<span class="price-caption">THM PRICE OPINION</span>${money(listing.priceOpinion.midpoint)}`;
  } else {
    livePrice.innerHTML = `<span class="price-caption">STATUS</span>Not for sale`;
  }

  renderMarketPulse(listing);

  const comp = listing.comparableContext;
  const opinion = listing.priceOpinion;

  if (listing.forSale) {
    if (opinion?.available && listing.listPrice) {
      const delta = (listing.listPrice - opinion.midpoint) / opinion.midpoint;
      const pct = Math.abs(delta * 100).toFixed(1).replace(".0", "");
      if (listing.listPrice < opinion.low) setText("priceSignal", "Below THM range", `${pct}% below midpoint · ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`);
      else if (listing.listPrice > opinion.high) setText("priceSignal", "Above THM range", `${pct}% above midpoint · ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`);
      else setText("priceSignal", "Inside THM range", `${pct}% from midpoint · ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`);
    } else {
      setText("priceSignal", `${money(listing.listPrice)} asking`, "The current match set is too thin for a responsible range.");
    }
  } else {
    setText("priceSignal", "Not for sale", opinion?.available
      ? `THM indicative value: ${compactMoney(opinion.low)}–${compactMoney(opinion.high)} · midpoint ${compactMoney(opinion.midpoint)}.`
      : "No active listing and not enough reliable data for a price opinion.");
  }

  if (comp?.available) {
    setText("marketSignal", `${comp.matchCount} closest matches`, `${comp.basis || "Similarity + recency weighted"} · ${comp.sourceLabel}.`);
  } else {
    setText("marketSignal", "10-year history scan", "THM checked the available neighbourhood/property history without forcing weak comps.");
  }

  const flags = [];
  if (Array.isArray(listing.basement) && listing.basement.length) flags.push(listing.basement.join(", "));
  if (listing.kitchensTotal > 1) flags.push(`${listing.kitchensTotal} kitchens`);
  if (listing.remarks && /permit|approval|zoning|legal/i.test(listing.remarks)) flags.push("Verify approvals / permits");
  setText("flagSignal", flags[0] || (listing.forSale ? "No obvious listing flag" : "History-based profile"),
    flags.length > 1 ? flags.slice(1).join(" · ") : (listing.forSale ? "Still verify condition and material facts." : "Off-market profile uses the most recent MLS record found in the 10-year search."));

  const valueBits = [];
  if (listing.lotWidth && listing.lotDepth) valueBits.push(`${listing.lotWidth} × ${listing.lotDepth} ft lot`);
  if (listing.parkingTotal) valueBits.push(`${listing.parkingTotal} parking`);
  if (listing.garageType) valueBits.push(listing.garageType);
  setText("valueSignal", valueBits[0] || "Property utility", valueBits.slice(1).join(" · ") || "Focus on features that materially support utility and resale value.");

  if (listing.showingFocus) setText("showingSignal", listing.showingFocus.title, listing.showingFocus.note);

  if (!listing.forSale) {
    setText("nextMoveSignal", "Value review, not a showing", "This property is not currently for sale. Use the THM range as a starting point, then verify condition and ownership context before relying on it.");
    decisionTitle.textContent = "Not for sale. Want a deeper value review?";
    decisionText.textContent = "We can refine the range with a Realtor review, property condition and more detailed local comparables.";
    seeHomeButton.textContent = "Get Value Review →";
  } else if (listing.offerTiming?.type === "scheduled") {
    setText("nextMoveSignal", "See it before offer time", "Inspect early enough to verify the property before deciding on offer strategy.");
    decisionTitle.textContent = "See this home. Get the full AI Buyer Brief.";
    decisionText.textContent = "We start arranging the earliest available showing while deeper analysis runs in parallel.";
    seeHomeButton.textContent = "See This Home →";
  } else {
    setText("nextMoveSignal", "Worth seeing", "Use the showing to validate condition, layout and the details that can change your offer strategy.");
    decisionTitle.textContent = "See this home. Get the full AI Buyer Brief.";
    decisionText.textContent = "We start arranging the earliest available showing while deeper analysis runs in parallel.";
    seeHomeButton.textContent = "See This Home →";
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
  snapshotMeta.textContent = "Checking live MLS + up to 10 years of property history…";
  snapshotSection.classList.remove("hidden");
  setTimeout(() => snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" }), 70);

  const listingKey = detectMlsKey(activeProperty);
  const apiUrl = listingKey
    ? `/api/property?listingKey=${encodeURIComponent(listingKey)}`
    : `/api/property?q=${encodeURIComponent(activeProperty)}`;

  try {
    const response = await fetch(apiUrl);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to identify this property.");
    renderListing(result.property);
    snapshotProperty.textContent = result.property.address || activeProperty;
    snapshotMeta.textContent = result.property.forSale
      ? `${result.property.listingKey ? `MLS ${result.property.listingKey} · ` : ""}Live property intelligence`
      : `NOT FOR SALE · THM checked up to 10 years of available MLS history`;
  } catch (error) {
    snapshotMeta.textContent = error instanceof Error ? error.message : "Property intelligence could not be loaded.";
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

  if (liveListing?.forSale === false) {
    modalEyebrow.textContent = "✦ VALUE REVIEW";
    modalTitle.textContent = "Refine this off-market value.";
    nextStepLabel.textContent = "NEXT STEP";
    showingTiming.innerHTML = `<option value="value_review">Full value review</option><option value="contact_me">Contact me about this property</option>`;
    leadSubmit.textContent = "Request Full Value Review";
  } else {
    modalEyebrow.textContent = "⚡ SEE THIS HOME";
    modalTitle.textContent = "Let’s get you inside.";
    nextStepLabel.textContent = "WHEN DO YOU WANT TO SEE IT?";
    showingTiming.innerHTML = `<option value="asap">ASAP</option><option value="few_hours">Within a few hours</option><option value="later_today">Later today</option><option value="within_24h">Within 24 hours</option>`;
    leadSubmit.textContent = "Request Showing + Full AI Brief";
  }
  leadModal.classList.remove("hidden");
}

function hideLeadModal() { leadModal.classList.add("hidden"); }
seeHomeButton.addEventListener("click", openLeadModal);
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
    leadSubmit.textContent = liveListing?.forSale === false ? "Request Full Value Review" : "Request Showing + Full AI Brief";
  }
});
