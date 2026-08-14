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
const offerTimingValue = document.getElementById("offerTimingValue");
const offerTimingNote = document.getElementById("offerTimingNote");
const soldRangeValue = document.getElementById("soldRangeValue");
const soldRangeNote = document.getElementById("soldRangeNote");
const latestSoldValue = document.getElementById("latestSoldValue");

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
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  }).format(value);
}

function compactMoney(value) {
  if (typeof value !== "number") return "—";
  if (value >= 1000000) return `$${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 2)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return money(value);
}

function soldDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function detectMlsKey(value) {
  const match = value.trim().toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

function setBaseSnapshot() {
  document.getElementById("priceSignal").textContent = "Compare before offering";
  document.getElementById("priceSignalText").textContent = "We put the asking price in context so you know what deserves a closer look.";
  document.getElementById("marketSignal").textContent = "Know the competition";
  document.getElementById("marketSignalText").textContent = "Understand whether speed, patience, or negotiation is likely to matter.";
  document.getElementById("flagSignal").textContent = "What to verify";
  document.getElementById("flagSignalText").textContent = "Surface details worth checking before you get emotionally committed.";
  document.getElementById("valueSignal").textContent = "What may support value";
  document.getElementById("valueSignalText").textContent = "Lot, layout, parking, condition, location and useful property features.";
  document.getElementById("nextMoveSignal").textContent = "Worth a closer look?";
  document.getElementById("nextMoveText").textContent = "We turn the first read into a simple buyer action — not a meaningless AI score.";

  offerTimingValue.textContent = "Checking…";
  offerTimingNote.textContent = "We check the IDX-accessible listing remarks for offer instructions.";
  soldRangeValue.textContent = "Checking…";
  soldRangeNote.textContent = "Recent similar-type sales in the neighbourhood.";
  latestSoldValue.textContent = "Checking…";
}

function renderMarketIntel(listing) {
  marketIntel.classList.remove("hidden");

  const offer = listing.offerTiming;
  if (offer?.label) {
    offerTimingValue.textContent = offer.label;
    offerTimingNote.textContent = offer.note || "Realtor verification required.";
  } else {
    offerTimingValue.textContent = "Offers anytime";
    offerTimingNote.textContent = "No offer date detected in IDX-accessible remarks. Realtor verification required.";
  }

  const sold = listing.soldContext;
  if (sold?.available) {
    soldRangeValue.textContent = sold.rangeLow === sold.rangeHigh
      ? compactMoney(sold.rangeLow)
      : `${compactMoney(sold.rangeLow)} – ${compactMoney(sold.rangeHigh)}`;
    soldRangeNote.textContent = `${sold.sampleSize} recent similar-type sold${sold.sampleSize === 1 ? "" : "s"} used for this quick range.`;
    latestSoldValue.textContent = `${compactMoney(sold.latestSoldPrice)} · ${soldDate(sold.latestSoldDate)}`;
  } else {
    soldRangeValue.textContent = "Not enough sold data";
    soldRangeNote.textContent = "No reliable recent sold-price sample was returned by the current IDX feed.";
    latestSoldValue.textContent = "Not available";
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
  liveDetails.textContent = facts.join(" · ");
  livePrice.textContent = money(listing.listPrice);
  renderMarketIntel(listing);

  document.getElementById("priceSignal").textContent = listing.listPrice ? `${money(listing.listPrice)} asking` : "Price available";
  if (listing.soldContext?.available) {
    document.getElementById("priceSignalText").textContent = `Nearby sold context: ${compactMoney(listing.soldContext.rangeLow)}–${compactMoney(listing.soldContext.rangeHigh)} from a small recent similar-type sample.`;
  } else {
    document.getElementById("priceSignalText").textContent = "Live asking price loaded. Sold-price context is shown only when the current IDX feed returns a reliable sample.";
  }

  const domText = listing.daysOnMarket != null ? `${listing.daysOnMarket} days` : "Live status";
  document.getElementById("marketSignal").textContent = domText;
  document.getElementById("marketSignalText").textContent = listing.status ? `${listing.status} listing. We use listing activity to frame urgency and negotiation.` : "Listing activity helps frame urgency and negotiation.";

  const flags = [];
  if (Array.isArray(listing.basement) && listing.basement.length) flags.push(listing.basement.join(", "));
  if (listing.kitchensTotal > 1) flags.push(`${listing.kitchensTotal} kitchens`);
  if (listing.remarks && /permit|approval|zoning/i.test(listing.remarks)) flags.push("Verify approvals / permits");
  document.getElementById("flagSignal").textContent = flags.length ? flags[0] : "What to verify";
  document.getElementById("flagSignalText").textContent = flags.length > 1 ? flags.slice(1).join(" · ") : "Review condition, representations and material property details.";

  const valueBits = [];
  if (listing.lotWidth && listing.lotDepth) valueBits.push(`${listing.lotWidth} × ${listing.lotDepth} ft lot`);
  if (listing.parkingTotal) valueBits.push(`${listing.parkingTotal} parking`);
  if (listing.garageType) valueBits.push(listing.garageType);
  document.getElementById("valueSignal").textContent = valueBits[0] || "Property strengths";
  document.getElementById("valueSignalText").textContent = valueBits.slice(1).join(" · ") || "We surface the property features that may materially support value.";

  document.getElementById("nextMoveSignal").textContent = "Worth seeing";
  document.getElementById("nextMoveText").textContent = "Use the showing to validate condition, layout and the details that can change your offer strategy.";
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

  snapshotMeta.textContent = "Loading live listing facts…";

  try {
    const response = await fetch(`/api/property?listingKey=${encodeURIComponent(listingKey)}`);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load listing.");
    renderListing(result.property);
    snapshotProperty.textContent = result.property.address || listingKey;
    snapshotMeta.textContent = `MLS ${listingKey} · Live listing facts loaded`;
  } catch (error) {
    snapshotMeta.textContent = "Snapshot ready. Live listing facts could not be loaded right now.";
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

function hideLeadModal() {
  leadModal.classList.add("hidden");
}

document.getElementById("seeHomeButton").addEventListener("click", openLeadModal);
closeModal.addEventListener("click", hideLeadModal);
doneButton.addEventListener("click", hideLeadModal);
leadModal.addEventListener("click", (event) => {
  if (event.target === leadModal) hideLeadModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideLeadModal();
});

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
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
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
