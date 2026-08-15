const $ = (id) => document.getElementById(id);

const analysisForm = $("analysisForm");
const propertyInput = $("propertyInput");
const inputStatus = $("inputStatus");
const snapshotSection = $("snapshotSection");
const snapshotProperty = $("snapshotProperty");
const snapshotMeta = $("snapshotMeta");
const resultEyebrow = $("resultEyebrow");
const linkValidationBadge = $("linkValidationBadge");
const marketStatusPill = $("marketStatusPill");
const mlsBadge = $("mlsBadge");
const liveAddress = $("liveAddress");
const livePrice = $("livePrice");
const liveDetails = $("liveDetails");
const activeActionBox = $("activeActionBox");
const offMarketActionBox = $("offMarketActionBox");
const seeHomeButton = $("seeHomeButton");
const deepReportButton = $("deepReportButton");
const sellerReportButton = $("sellerReportButton");
const detailsGrid = $("detailsGrid");
const remarksToggle = $("remarksToggle");
const listingRemarks = $("listingRemarks");

const photoPlaceholder = $("photoPlaceholder");
const photoMainButton = $("photoMainButton");
const mainPhoto = $("mainPhoto");
const photoThumbs = $("photoThumbs");
const photoCountBadge = $("photoCountBadge");

const leadModal = $("leadModal");
const closeModal = $("closeModal");
const doneButton = $("doneButton");
const leadForm = $("leadForm");
const leadFormPanel = $("leadFormPanel");
const leadSuccessPanel = $("leadSuccessPanel");
const modalProperty = $("modalProperty");
const modalPropertyDisplay = $("modalPropertyDisplay");
const leadMode = $("leadMode");
const modalEyebrow = $("modalEyebrow");
const modalTitle = $("modalTitle");
const modalCopy = $("modalCopy");
const nextStepLabel = $("nextStepLabel");
const showingTiming = $("showingTiming");
const sellerTimelineWrap = $("sellerTimelineWrap");
const sellerTimeline = $("sellerTimeline");
const leadSubmit = $("leadSubmit");
const leadError = $("leadError");
const serviceNote = $("serviceNote");
const successTitle = $("successTitle");
const successCopy = $("successCopy");
const successStepOne = $("successStepOne");
const successStepOneNote = $("successStepOneNote");

const galleryModal = $("galleryModal");
const galleryImage = $("galleryImage");
const galleryCounter = $("galleryCounter");
const galleryClose = $("galleryClose");
const galleryPrev = $("galleryPrev");
const galleryNext = $("galleryNext");

let activeProperty = "";
let liveListing = null;
let photos = [];
let galleryIndex = 0;
let currentLeadMode = "showing";

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
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function detectMlsKey(value) {
  const match = String(value || "").trim().toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

function setText(id, title, note) {
  const el = $(id);
  if (el) el.textContent = title || "—";
  const noteEl = $(`${id}Text`);
  if (noteEl) noteEl.textContent = note || "";
}

function resetResult() {
  linkValidationBadge.classList.add("hidden");
  photoPlaceholder.classList.remove("hidden");
  photoMainButton.classList.add("hidden");
  photoThumbs.classList.add("hidden");
  photoThumbs.innerHTML = "";
  photos = [];
  detailsGrid.innerHTML = "";
  remarksToggle.classList.add("hidden");
  listingRemarks.classList.add("hidden");
  listingRemarks.textContent = "";

  setText("priceSignal", "Analyzing", "Building the closest market context.");
  setText("marketSignal", "Checking", "Reading listing freshness and nearby competition.");
  setText("flagSignal", "Checking", "Looking for details that can change value or strategy.");
  setText("showingSignal", "Checking", "What to verify when you are physically inside.");

  $("soldRangeValue").textContent = "—";
  $("soldRangeNote").textContent = "Analyzing matches";
  $("compCountValue").textContent = "—";
  $("compCountNote").textContent = "Similarity + recency weighted";
  $("offerTimingValue").textContent = "—";
  $("offerTimingNote").textContent = "Checking";
  $("listingTempoValue").textContent = "—";
  $("listingTempoNote").textContent = "Checking";
}

analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  activeProperty = propertyInput.value.trim();
  if (!activeProperty) return;

  resetResult();
  liveListing = null;
  inputStatus.className = "input-status";
  inputStatus.textContent = "Checking live MLS, link validity and property history…";
  snapshotProperty.textContent = activeProperty;
  snapshotMeta.textContent = "Checking live MLS…";
  snapshotSection.classList.remove("hidden");
  setTimeout(() => snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" }), 80);

  const mls = detectMlsKey(activeProperty);
  const apiUrl = mls && !/^https?:\/\//i.test(activeProperty)
    ? `/api/property?listingKey=${encodeURIComponent(mls)}`
    : `/api/property?q=${encodeURIComponent(activeProperty)}`;

  try {
    const response = await fetch(apiUrl);
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to identify this property.");

    liveListing = result.property;
    renderListing(liveListing);

    inputStatus.className = "input-status ok";
    inputStatus.textContent = liveListing.inputValidation?.label || "Property matched to live MLS data.";
    snapshotProperty.textContent = liveListing.address || activeProperty;
    snapshotMeta.textContent = liveListing.forSale
      ? `${liveListing.listingKey ? `MLS ${liveListing.listingKey} · ` : ""}active listing · FastShow available`
      : "Not currently for sale · historical MLS context available";
  } catch (error) {
    inputStatus.className = "input-status error";
    inputStatus.textContent = error instanceof Error ? error.message : "We could not validate that property.";
    snapshotMeta.textContent = inputStatus.textContent;
  }
});

function renderListing(listing) {
  resultEyebrow.textContent = listing.forSale ? "LIVE PROPERTY · FASTSHOW READY" : "OFF-MARKET PROPERTY INTELLIGENCE";

  if (listing.inputValidation) {
    linkValidationBadge.textContent = `✓ ${listing.inputValidation.label}`;
    linkValidationBadge.classList.remove("hidden");
  }

  marketStatusPill.textContent = listing.forSale ? "FOR SALE" : "NOT FOR SALE";
  marketStatusPill.className = `market-status-pill ${listing.forSale ? "is-live" : "is-off"}`;
  mlsBadge.textContent = listing.listingKey ? `MLS ${listing.listingKey}` : "MLS HISTORY";

  liveAddress.textContent = listing.address || activeProperty;
  livePrice.innerHTML = listing.forSale
    ? money(listing.listPrice)
    : listing.priceOpinion?.available
      ? `<span class="price-caption">THM INDICATIVE VALUE</span>${money(listing.priceOpinion.midpoint)}`
      : `<span class="price-caption">STATUS</span>Not for sale`;

  const facts = [
    listing.propertySubType,
    listing.beds != null ? `${listing.beds} bed` : null,
    listing.baths != null ? `${listing.baths} bath` : null,
    listing.livingAreaRange ? `${listing.livingAreaRange} sq ft` : null,
  ].filter(Boolean);
  liveDetails.textContent = facts.join(" · ") || "Property identified from available MLS history";

  activeActionBox.classList.toggle("hidden", !listing.forSale);
  offMarketActionBox.classList.toggle("hidden", listing.forSale);

  renderPhotos(listing.photos || []);
  renderQuickFacts(listing);
  renderAiSnapshot(listing);
  renderMarketPulse(listing);
  renderDetails(listing);
}

function renderPhotos(items) {
  photos = Array.isArray(items) ? items : [];
  if (!photos.length) {
    photoPlaceholder.classList.remove("hidden");
    photoMainButton.classList.add("hidden");
    photoThumbs.classList.add("hidden");
    return;
  }

  photoPlaceholder.classList.add("hidden");
  photoMainButton.classList.remove("hidden");
  mainPhoto.src = photos[0].url;
  photoCountBadge.textContent = `View ${photos.length} photo${photos.length === 1 ? "" : "s"}`;

  const secondary = photos.slice(1, 3);
  photoThumbs.innerHTML = secondary.map((photo, index) => `
    <button type="button" data-photo-index="${index + 1}" aria-label="Open property photo ${index + 2}">
      <img src="${escapeAttr(photo.url)}" alt="Property photo ${index + 2}" loading="lazy" />
    </button>`).join("");
  photoThumbs.classList.toggle("hidden", secondary.length === 0);

  photoThumbs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => openGallery(Number(button.dataset.photoIndex || 0)));
  });
}

function renderQuickFacts(listing) {
  $("factBeds").textContent = listing.beds ?? "—";
  $("factBaths").textContent = listing.baths ?? "—";
  $("factType").textContent = listing.propertySubType || listing.propertyType || "—";
  $("factLot").textContent = listing.lotWidth && listing.lotDepth ? `${listing.lotWidth} × ${listing.lotDepth} ft` : "—";
  $("factParking").textContent = listing.parkingTotal ?? "—";
  $("factTax").textContent = listing.details?.annualTax ? `${money(listing.details.annualTax)}${listing.details.taxYear ? ` (${listing.details.taxYear})` : ""}` : "—";
}

function renderAiSnapshot(listing) {
  const opinion = listing.priceOpinion;
  const comp = listing.comparableContext;

  if (listing.forSale) {
    if (opinion?.available && listing.listPrice) {
      if (listing.listPrice < opinion.low) setText("priceSignal", "Below THM range", `${money(listing.listPrice)} asking vs. ${compactMoney(opinion.low)}–${compactMoney(opinion.high)} THM range.`);
      else if (listing.listPrice > opinion.high) setText("priceSignal", "Above THM range", `${money(listing.listPrice)} asking vs. ${compactMoney(opinion.low)}–${compactMoney(opinion.high)} THM range.`);
      else setText("priceSignal", "Inside THM range", `${money(listing.listPrice)} asking sits inside ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`);
    } else {
      setText("priceSignal", `${money(listing.listPrice)} asking`, "The current match set is too thin to force a price range.");
    }
  } else {
    setText("priceSignal", "Not currently listed", opinion?.available
      ? `Indicative THM value: ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`
      : "A deeper report can refine value using broader local and historical context.");
  }

  if (listing.forSale) {
    const days = listing.daysLive;
    const urgency = typeof days === "number" ? (days <= 3 ? "Fresh listing" : days <= 14 ? `${days} days live` : `${days} days on market`) : "Active listing";
    setText("marketSignal", urgency, listing.offerTiming?.note || "Listing freshness and offer context help frame urgency.");
  } else {
    setText("marketSignal", "Off market", "No active for-sale listing was found. Showing is not available through THM right now.");
  }

  const flags = [];
  if (Array.isArray(listing.basement) && listing.basement.length) flags.push(listing.basement.join(" + "));
  if (listing.kitchensTotal > 1) flags.push(`${listing.kitchensTotal} kitchens`);
  if (listing.remarks && /permit|approval|zoning|legal/i.test(listing.remarks)) flags.push("Verify permits / legal use");
  setText("flagSignal", flags[0] || "Verify material facts", flags.slice(1).join(" · ") || "Condition, legal use and major systems still need in-person / professional verification.");

  if (listing.showingFocus) setText("showingSignal", listing.showingFocus.title, listing.showingFocus.note);
  else setText("showingSignal", listing.forSale ? "Condition + layout" : "Deep property review", listing.forSale ? "Use the showing to validate what photos and MLS fields cannot." : "Use history and local context to understand likely value and seller opportunity.");
}

function renderMarketPulse(listing) {
  const opinion = listing.priceOpinion;
  const comp = listing.comparableContext;

  $("soldRangeValue").textContent = opinion?.available ? `${compactMoney(opinion.low)} – ${compactMoney(opinion.high)}` : "Range unavailable";
  $("soldRangeNote").textContent = opinion?.available ? `${opinion.confidence || "Indicative"} confidence · ${comp?.sourceLabel || "market matches"}` : "We do not force weak comps.";

  $("compCountValue").textContent = comp?.available ? `${comp.matchCount} closest matches` : "Thin match set";
  $("compCountNote").textContent = comp?.basis || "Similarity + recency weighted";

  $("offerTimingValue").textContent = listing.forSale ? (listing.offerTiming?.label || "Active") : "Not for sale";
  $("offerTimingNote").textContent = listing.forSale ? (listing.offerTiming?.note || "Verify before relying on offer timing.") : "No active showing workflow.";

  if (listing.forSale) {
    $("listingTempoValue").textContent = typeof listing.daysLive === "number" ? (listing.daysLive === 0 ? "Listed today" : `${listing.daysLive} day${listing.daysLive === 1 ? "" : "s"} live`) : (listing.status || "Active");
    $("listingTempoNote").textContent = listing.details?.listedAt ? `Listed ${formatDate(listing.details.listedAt)}` : "Live listing";
  } else {
    $("listingTempoValue").textContent = listing.historySummary?.lastSeenDate ? `Last MLS ${formatDate(listing.historySummary.lastSeenDate)}` : "10-year history scan";
    $("listingTempoNote").textContent = listing.historySummary?.appearanceCount ? `${listing.historySummary.appearanceCount} MLS appearance${listing.historySummary.appearanceCount === 1 ? "" : "s"}` : "Historical MLS context";
  }
}

function renderDetails(listing) {
  const d = listing.details || {};
  const items = [
    ["STYLE", joinValue(d.architecturalStyle) || "—"],
    ["CONSTRUCTION", joinValue(d.construction) || "—"],
    ["HEATING", joinValue(d.heating) || "—"],
    ["COOLING", joinValue(d.cooling) || "—"],
    ["BASEMENT", Array.isArray(listing.basement) && listing.basement.length ? listing.basement.join(", ") : "—"],
    ["PARKING", joinValue(d.parking) || (listing.garageType ? `${listing.garageType} garage` : "—")],
    ["POSSESSION", d.possession || "—"],
    ["CROSS STREET", d.crossStreet || "—"],
    ["INTERIOR", joinValue(d.interior) || "—"],
    ["POOL", joinValue(d.pool) || "—"],
    ["DIRECTION", d.direction || "—"],
    ["LISTING OFFICE", d.listingOffice || "—"],
  ];

  detailsGrid.innerHTML = items.map(([label, value]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");

  if (listing.remarks) {
    listingRemarks.textContent = listing.remarks;
    remarksToggle.classList.remove("hidden");
  }
}

remarksToggle.addEventListener("click", () => {
  const opening = listingRemarks.classList.contains("hidden");
  listingRemarks.classList.toggle("hidden");
  remarksToggle.textContent = opening ? "Hide listing remarks ↑" : "Read listing remarks ↓";
});

seeHomeButton.addEventListener("click", () => openLeadModal("showing"));
deepReportButton.addEventListener("click", () => openLeadModal("buyer_offmarket"));
sellerReportButton.addEventListener("click", () => openLeadModal("seller"));

document.querySelectorAll("[data-addon]").forEach((button) => {
  button.addEventListener("click", () => {
    const addon = button.dataset.addon;
    if (addon === "seller") openLeadModal("seller");
    else if (liveListing?.forSale) openLeadModal("showing", addon);
    else openLeadModal("buyer_offmarket", addon);
  });
});

function openLeadModal(mode, addon = null) {
  if (!liveListing) return;
  currentLeadMode = mode;
  leadMode.value = mode;
  modalProperty.value = activeProperty;
  modalPropertyDisplay.value = liveListing.address || activeProperty;
  leadForm.reset();
  modalProperty.value = activeProperty;
  modalPropertyDisplay.value = liveListing.address || activeProperty;
  leadMode.value = mode;
  leadError.classList.add("hidden");
  leadError.textContent = "";
  leadFormPanel.classList.remove("hidden");
  leadSuccessPanel.classList.add("hidden");
  sellerTimelineWrap.classList.add("hidden");
  leadSubmit.disabled = false;

  if (mode === "showing") {
    modalEyebrow.textContent = "⚡ THM FASTSHOW · 1–24H TARGET";
    modalTitle.textContent = addon ? `${addonLabel(addon)} + fast showing.` : "Let’s get you inside.";
    modalCopy.textContent = "We route your request immediately. Your full AI Buyer Brief starts in parallel.";
    nextStepLabel.textContent = "WHEN DO YOU WANT TO SEE IT?";
    showingTiming.innerHTML = `<option value="asap">ASAP</option><option value="within_6h">Within 6 hours</option><option value="within_24h">Within 24 hours</option>`;
    leadSubmit.textContent = addon ? `Request Showing + ${addonLabel(addon)}` : "Request Fast Showing + AI Brief";
    serviceNote.textContent = "Target showing window: 1–24 hours, subject to listing/seller availability. Current Realtor response target: within 5 minutes during service hours.";
  } else if (mode === "seller") {
    modalEyebrow.textContent = "✦ SELLER AI REPORT";
    modalTitle.textContent = "Own this home? See the seller side.";
    modalCopy.textContent = "Get an AI-assisted value range, market position and sale-readiness review — without putting the home on the market.";
    nextStepLabel.textContent = "REPORT TYPE";
    showingTiming.innerHTML = `<option value="seller_report">Seller AI Deep Report</option>`;
    sellerTimelineWrap.classList.remove("hidden");
    leadSubmit.textContent = "Request Seller AI Report";
    serviceNote.textContent = "Preliminary AI-assisted value review. A Realtor review is required before relying on pricing or listing strategy.";
  } else {
    modalEyebrow.textContent = "✦ OFF-MARKET AI REPORT";
    modalTitle.textContent = addon ? `${addonLabel(addon)} for this property.` : "Go deeper on this off-market home.";
    modalCopy.textContent = "No active listing was found. We can still build a deeper property-value and history report.";
    nextStepLabel.textContent = "NEXT STEP";
    showingTiming.innerHTML = `<option value="buyer_offmarket_report">AI Deep Property Report</option><option value="buyer_offmarket_contact">Talk to a Realtor about this property</option>`;
    leadSubmit.textContent = addon ? `Request ${addonLabel(addon)}` : "Request AI Deep Property Report";
    serviceNote.textContent = "This property is not currently for sale. Any value range is preliminary and requires verification.";
  }

  leadModal.classList.remove("hidden");
}

function addonLabel(addon) {
  if (addon === "renovation") return "Renovation Lens";
  if (addon === "income") return "Income / Suite Lens";
  if (addon === "offer") return "Offer Strategy";
  return "AI Deep Report";
}

function hideLeadModal() { leadModal.classList.add("hidden"); }
closeModal.addEventListener("click", hideLeadModal);
doneButton.addEventListener("click", hideLeadModal);
leadModal.addEventListener("click", (event) => { if (event.target === leadModal) hideLeadModal(); });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideLeadModal();
    closeGallery();
  }
});

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(leadForm);
  let timing = String(form.get("showing_timing") || "asap");
  if (currentLeadMode === "seller") timing = sellerTimeline.value || "seller_curious";

  const payload = {
    property_input: activeProperty,
    listing_key: liveListing?.listingKey || detectMlsKey(activeProperty),
    name: String(form.get("name") || "").trim(),
    mobile: String(form.get("mobile") || "").trim(),
    email: String(form.get("email") || "").trim(),
    showing_timing: timing,
    website: String(form.get("website") || "").trim(),
    page_url: window.location.href,
    referrer: document.referrer || null,
  };

  leadSubmit.disabled = true;
  leadSubmit.textContent = "Sending…";
  leadError.classList.add("hidden");

  try {
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send your request.");

    leadFormPanel.classList.add("hidden");
    leadSuccessPanel.classList.remove("hidden");

    if (currentLeadMode === "showing") {
      successTitle.textContent = "We’re on it.";
      successCopy.textContent = "Your showing request and AI Buyer Brief are now moving at the same time.";
      successStepOne.textContent = "Fast showing request routed";
      successStepOneNote.textContent = "We’re working toward the earliest available access within the 1–24 hour target window.";
    } else if (currentLeadMode === "seller") {
      successTitle.textContent = "Seller report started.";
      successCopy.textContent = "Your off-market seller request has been routed for deeper value review.";
      successStepOne.textContent = "Seller request routed";
      successStepOneNote.textContent = "The property will be reviewed from a seller / valuation perspective.";
    } else {
      successTitle.textContent = "Deep report started.";
      successCopy.textContent = "Your off-market property request has been routed for deeper analysis.";
      successStepOne.textContent = "Property report routed";
      successStepOneNote.textContent = "We’ll refine the history, market context and value range.";
    }
  } catch (error) {
    leadError.textContent = error instanceof Error ? error.message : "Unable to send your request.";
    leadError.classList.remove("hidden");
    leadSubmit.disabled = false;
    leadSubmit.textContent = currentLeadMode === "showing" ? "Request Fast Showing + AI Brief" : currentLeadMode === "seller" ? "Request Seller AI Report" : "Request AI Deep Property Report";
  }
});

photoMainButton.addEventListener("click", () => openGallery(0));
galleryClose.addEventListener("click", closeGallery);
galleryPrev.addEventListener("click", () => changeGallery(-1));
galleryNext.addEventListener("click", () => changeGallery(1));
galleryModal.addEventListener("click", (event) => { if (event.target === galleryModal) closeGallery(); });

function openGallery(index) {
  if (!photos.length) return;
  galleryIndex = Math.max(0, Math.min(index, photos.length - 1));
  renderGallery();
  galleryModal.classList.remove("hidden");
}

function closeGallery() { galleryModal.classList.add("hidden"); }

function changeGallery(delta) {
  if (!photos.length) return;
  galleryIndex = (galleryIndex + delta + photos.length) % photos.length;
  renderGallery();
}

function renderGallery() {
  galleryImage.src = photos[galleryIndex].url;
  galleryCounter.textContent = `${galleryIndex + 1} / ${photos.length}`;
}

function joinValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function escapeAttr(value) { return escapeHtml(value); }
