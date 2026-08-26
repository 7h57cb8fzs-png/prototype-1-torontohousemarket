const $ = (id) => document.getElementById(id);

const analysisForm = $("analysisForm");
const propertyInput = $("propertyInput");
const lookupButton = $("lookupButton");
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
const offMarketTitle = $("offMarketTitle");
const offMarketCopy = $("offMarketCopy");
const seeHomeButton = $("seeHomeButton");
const deepReportButton = $("deepReportButton");
const sellerReportButton = $("sellerReportButton");
const detailsGrid = $("detailsGrid");
const remarksToggle = $("remarksToggle");
const listingRemarks = $("listingRemarks");

const photoPlaceholder = $("photoPlaceholder");
const photoPlaceholderTitle = $("photoPlaceholderTitle");
const photoPlaceholderText = $("photoPlaceholderText");
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

let activePropertyInput = "";
let liveListing = null;
let photos = [];
let galleryIndex = 0;
let currentLeadMode = "showing";
let loading = false;

loadFeaturedListings();

async function loadFeaturedListings() {
  const grid = $("featuredListingGrid");
  const status = $("featuredListingStatus");
  if (!grid || !status) return;
  try {
    const response = await fetch("/api/featured-listings", { headers: { Accept: "application/json" } });
    const result = await response.json().catch(() => null);
    const listings = Array.isArray(result?.listings) ? result.listings : [];
    if (!response.ok || !result?.ok) throw new Error(result?.error || "Listings unavailable");
    if (!listings.length) {
      status.textContent = "No brokerage listings are available for internet display from the current IDX response. Use the live MLS search above to find any active property.";
      return;
    }
    grid.innerHTML = listings.map((listing) => `
      <article class="featured-card">
        <button type="button" class="featured-card-button" data-featured-mls="${escapeAttr(listing.listingKey)}" aria-label="Open ${escapeAttr(listing.address)}">
          <div class="featured-photo">${listing.photo?.url ? `<img src="${escapeAttr(listing.photo.url)}" alt="${escapeAttr(listing.photo.description || listing.address)}" loading="lazy" />` : `<span>CENTURY 21<br>Leading Edge</span>`}</div>
          <div class="featured-card-body">
            <span class="featured-mls">MLS® ${escapeHtml(listing.listingKey)}</span>
            <strong>${escapeHtml(listing.listPrice != null ? money(listing.listPrice) : "Price available on request")}</strong>
            <h3>${escapeHtml(listing.address || "Address available through IDX")}</h3>
            <p>${escapeHtml([listing.propertySubType, listing.beds != null ? `${listing.beds} bed` : "", listing.baths != null ? `${listing.baths} bath` : ""].filter(Boolean).join(" · "))}</p>
            <small>${escapeHtml(listing.listingOffice || "CENTURY 21 Leading Edge Realty Inc.")}</small>
          </div>
        </button>
      </article>`).join("");
    status.classList.add("hidden");
    for (const button of grid.querySelectorAll("[data-featured-mls]")) {
      button.addEventListener("click", () => {
        propertyInput.value = button.dataset.featuredMls;
        analysisForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        document.querySelector("#lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  } catch {
    status.textContent = "Current IDX listings could not be loaded. The live MLS search above remains available.";
  }
}

for (const button of document.querySelectorAll("[data-scroll]")) {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => propertyInput.focus(), 350);
  });
}

analysisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading) return;

  const value = propertyInput.value.trim();
  if (!value) {
    setInputStatus("error", "Enter an MLS number, street address, or listing URL.");
    propertyInput.focus();
    return;
  }

  activePropertyInput = value;
  setLoading(true);
  hideResult();
  setInputStatus("loading", "Checking the live MLS, listing status and property data…");

  const mls = detectMlsKey(value);
  const apiUrl = mls && !/^https?:\/\//i.test(value)
    ? `/api/property?listingKey=${encodeURIComponent(mls)}`
    : `/api/property?q=${encodeURIComponent(value)}`;

  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || !result?.property) {
      throw new Error(result?.error || "We could not check that property right now.");
    }

    liveListing = result.property;
    renderListing(liveListing);
    showResult();

    const verification = liveListing.inputValidation?.label || "Property checked.";
    setInputStatus("ok", verification);
    snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    liveListing = null;
    hideResult();
    setInputStatus("error", error instanceof Error ? error.message : "We could not check that property right now.");
  } finally {
    setLoading(false);
  }
});

function setLoading(value) {
  loading = value;
  lookupButton.disabled = value;
  lookupButton.textContent = value ? "Checking…" : "Check Home →";
  analysisForm.classList.toggle("is-loading", value);
}

function setInputStatus(type, text) {
  inputStatus.className = `input-status ${type || ""}`.trim();
  inputStatus.textContent = text;
}

function hideResult() {
  snapshotSection.classList.add("hidden");
}

function showResult() {
  snapshotSection.classList.remove("hidden");
}

function renderListing(listing) {
  resetDynamicSections();

  const hasMls = listing.foundInMls !== false;
  const active = !!listing.forSale;
  const restricted = !!listing.displayRestricted;

  resultEyebrow.textContent = active ? "LIVE LISTING · SHOWING READY" : hasMls ? "OFF-MARKET MLS HISTORY" : "OFF-MARKET PROPERTY";
  snapshotProperty.textContent = listing.address || activePropertyInput;
  snapshotMeta.textContent = buildSnapshotMeta(listing);

  if (listing.inputValidation?.label) {
    linkValidationBadge.textContent = `✓ ${listing.inputValidation.label}`;
    linkValidationBadge.classList.remove("hidden");
  }

  marketStatusPill.textContent = active ? "FOR SALE" : "NOT FOR SALE";
  marketStatusPill.className = `market-status-pill ${active ? "is-live" : "is-off"}`;
  mlsBadge.textContent = listing.listingKey ? `MLS ${listing.listingKey}` : hasMls ? "MLS HISTORY" : "NO MLS MATCH";

  liveAddress.textContent = listing.address || activePropertyInput;
  livePrice.innerHTML = renderPrice(listing);
  liveDetails.textContent = buildFactLine(listing, restricted);

  activeActionBox.classList.toggle("hidden", !active);
  offMarketActionBox.classList.toggle("hidden", active);

  if (!active) {
    if (hasMls) {
      offMarketTitle.textContent = "Not listed — but the property still has useful history.";
      offMarketCopy.textContent = "Request a deeper property report using available MLS history and current local market context.";
    } else {
      offMarketTitle.textContent = "No current MLS listing found.";
      offMarketCopy.textContent = "You can still request a deeper property report — or, if you own the home, a seller-focused value review.";
    }
  }

  renderPhotos(listing.photos || [], listing);
  renderQuickFacts(listing);
  renderAiBrief(listing);
  renderMarketRead(listing);
  renderDetails(listing);
}

function resetDynamicSections() {
  linkValidationBadge.classList.add("hidden");
  listingRemarks.classList.add("hidden");
  remarksToggle.classList.add("hidden");
  listingRemarks.textContent = "";
  detailsGrid.innerHTML = "";
}

function buildSnapshotMeta(listing) {
  if (listing.forSale) {
    const bits = [];
    if (listing.listingKey) bits.push(`MLS ${listing.listingKey}`);
    bits.push("active listing");
    if (typeof listing.daysLive === "number") bits.push(listing.daysLive === 0 ? "listed today" : `${listing.daysLive} day${listing.daysLive === 1 ? "" : "s"} live`);
    return bits.join(" · ");
  }
  if (listing.foundInMls === false) return "No active listing or matching MLS history found · deep report path available";
  const count = listing.historySummary?.appearanceCount || 0;
  return `Not currently listed${count ? ` · ${count} MLS appearance${count === 1 ? "" : "s"} found in 10 years` : ""}`;
}

function renderPrice(listing) {
  if (listing.forSale) {
    return listing.listPrice ? money(listing.listPrice) : `<span class="price-caption">ACTIVE LISTING</span>Price unavailable`;
  }
  if (listing.priceOpinion?.available) {
    return `<span class="price-caption">THM INDICATIVE VALUE</span>${money(listing.priceOpinion.midpoint)}`;
  }
  return `<span class="price-caption">STATUS</span>Not currently for sale`;
}

function buildFactLine(listing, restricted) {
  if (restricted) return "Listing identified · full internet display is restricted by the listing feed";
  const facts = [
    listing.propertySubType || listing.propertyType,
    listing.beds != null ? `${listing.beds} bed` : null,
    listing.baths != null ? `${listing.baths} bath` : null,
    listing.livingAreaRange ? `${listing.livingAreaRange} sq ft` : null,
  ].filter(Boolean);
  return facts.length ? facts.join(" · ") : listing.foundInMls === false ? "No current MLS property details available" : "Property identified from MLS history";
}

function renderPhotos(items, listing) {
  photos = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  photoThumbs.innerHTML = "";

  if (!photos.length) {
    photoPlaceholder.classList.remove("hidden");
    photoMainButton.classList.add("hidden");
    photoThumbs.classList.add("hidden");

    if (listing.forSale && listing.displayRestricted) {
      photoPlaceholderTitle.textContent = "Photo display restricted";
      photoPlaceholderText.textContent = "The listing was found, but this feed does not permit full internet display.";
    } else if (listing.forSale) {
      photoPlaceholderTitle.textContent = "Listing found — photos unavailable";
      photoPlaceholderText.textContent = "The property details are live. The MLS media feed did not return displayable photos for this listing.";
    } else {
      photoPlaceholderTitle.textContent = "No active listing photos";
      photoPlaceholderText.textContent = "Off-market properties do not use old listing photos in the public result.";
    }
    return;
  }

  photoPlaceholder.classList.add("hidden");
  photoMainButton.classList.remove("hidden");
  photoThumbs.classList.remove("hidden");

  mainPhoto.src = photos[0].url;
  mainPhoto.alt = photos[0].description || `Photo of ${listing.address || "property"}`;
  mainPhoto.onerror = () => removeBrokenPhoto(0);
  photoCountBadge.textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;

  const secondary = photos.slice(1, 5);
  photoThumbs.innerHTML = secondary.map((photo, index) => `
    <button type="button" data-photo-index="${index + 1}" aria-label="Open property photo ${index + 2}">
      <img src="${escapeAttr(photo.url)}" alt="" loading="lazy" />
    </button>`).join("");

  for (const button of photoThumbs.querySelectorAll("button")) {
    button.addEventListener("click", () => openGallery(Number(button.dataset.photoIndex || 0)));
    const img = button.querySelector("img");
    if (img) img.addEventListener("error", () => button.remove(), { once: true });
  }
}

function removeBrokenPhoto(index) {
  if (!photos[index]) return;
  photos.splice(index, 1);
  renderPhotos(photos, liveListing || {});
}

photoMainButton.addEventListener("click", () => openGallery(0));

function renderQuickFacts(listing) {
  $("factBeds").textContent = listing.beds ?? "—";
  $("factBaths").textContent = listing.baths ?? "—";
  $("factType").textContent = listing.propertySubType || listing.propertyType || "—";
  $("factLot").textContent = listing.lotWidth && listing.lotDepth ? `${formatNumber(listing.lotWidth)} × ${formatNumber(listing.lotDepth)} ft` : "—";
  $("factParking").textContent = listing.parkingTotal ?? "—";
  $("factTax").textContent = listing.details?.annualTax ? `${money(listing.details.annualTax)}${listing.details.taxYear ? ` · ${listing.details.taxYear}` : ""}` : "—";
}

function renderAiBrief(listing) {
  const opinion = listing.priceOpinion;

  if (listing.forSale) {
    if (opinion?.available && listing.listPrice) {
      if (listing.listPrice < opinion.low) {
        setSignal("priceSignal", "Below THM range", `${money(listing.listPrice)} asking vs. ${compactMoney(opinion.low)}–${compactMoney(opinion.high)} model range.`);
      } else if (listing.listPrice > opinion.high) {
        setSignal("priceSignal", "Above THM range", `${money(listing.listPrice)} asking vs. ${compactMoney(opinion.low)}–${compactMoney(opinion.high)} model range.`);
      } else {
        setSignal("priceSignal", "Inside THM range", `${money(listing.listPrice)} asking sits inside ${compactMoney(opinion.low)}–${compactMoney(opinion.high)}.`);
      }
    } else {
      setSignal("priceSignal", listing.listPrice ? `${money(listing.listPrice)} asking` : "Price unavailable", "We will not force a weak comparable range when the match set is too thin.");
    }
  } else if (opinion?.available) {
    setSignal("priceSignal", `${compactMoney(opinion.low)}–${compactMoney(opinion.high)}`, "Indicative off-market value range from the current MLS match set; not an appraisal or CMA.");
  } else {
    setSignal("priceSignal", "Deep review available", "There is not enough public MLS data on this screen to responsibly force a value range.");
  }

  if (listing.forSale) {
    const days = listing.daysLive;
    const title = typeof days === "number" ? (days === 0 ? "Listed today" : days <= 3 ? "Fresh listing" : `${days} days live`) : "Active listing";
    setSignal("marketSignal", title, listing.offerTiming?.note || "Confirm current showing and offer timing before acting.");
  } else {
    setSignal("marketSignal", "Off market", listing.foundInMls === false ? "No active listing or matching MLS history was found for this input." : "No active for-sale listing was found for this property.");
  }

  const flags = [];
  if (Array.isArray(listing.basement) && listing.basement.length) flags.push(listing.basement.join(" + "));
  if (listing.kitchensTotal > 1) flags.push(`${listing.kitchensTotal} kitchens`);
  if (listing.remarks && /permit|approval|zoning|legal|separate entrance|apartment/i.test(listing.remarks)) flags.push("Verify legal use / permits");
  if (listing.details?.pool && joinValue(listing.details.pool)) flags.push(`Pool: ${joinValue(listing.details.pool)}`);
  setSignal("flagSignal", flags[0] || (listing.forSale ? "Verify material facts" : "Off-market path"), flags.slice(1).join(" · ") || (listing.forSale ? "Condition, legal use and major systems still need in-person or professional verification." : "Use the deeper property or seller report for the next layer."));

  const focus = listing.showingFocus;
  setSignal("showingSignal", focus?.title || (listing.forSale ? "Condition + layout" : "Deep property review"), focus?.note || "Verify what the listing cannot tell you.");
}

function renderMarketRead(listing) {
  const opinion = listing.priceOpinion;
  const comp = listing.comparableContext;
  const soldComps = $("soldComps");

  $("soldRangeValue").textContent = opinion?.available ? `${compactMoney(opinion.low)} – ${compactMoney(opinion.high)}` : "No forced range";
  $("soldRangeNote").textContent = opinion?.available ? `${opinion.confidence || comp?.confidence || "Indicative"} confidence · ${opinion.note || "weighted match set"}` : (opinion?.note || "Not enough reliable public MLS matches.");

  $("compCountValue").textContent = comp?.available ? `${comp.matchCount} closest matches` : comp?.matchCount ? `${comp.matchCount} weak matches` : "Match set unavailable";
  $("compCountNote").textContent = comp?.basis || "Property type, size, lot and recency weighted";

  const rows = Array.isArray(comp?.comparables) ? comp.comparables.slice(0, 5) : [];
  soldComps.innerHTML = rows.length ? rows.map((item) => {
    const facts = [item.beds != null ? `${item.beds} bd` : null, item.baths != null ? `${item.baths} ba` : null, item.livingAreaRange, item.lotWidth && item.lotDepth ? `${formatNumber(item.lotWidth)}×${formatNumber(item.lotDepth)} lot` : null].filter(Boolean).join(" · ");
    return `<article class="sold-comp"><div><span>${escapeHtml(item.address || "MLS comparable")}</span><small>${escapeHtml([item.soldDate ? formatDate(item.soldDate) : null, facts].filter(Boolean).join(" · "))}</small></div><div><strong>${money(item.soldPrice)}</strong><em>${Math.round(item.similarity || 0)}% match</em></div></article>`;
  }).join("") : `<div class="sold-comps-empty">No responsible sold-comp set is available for this property yet. THM will not substitute asking prices for sold evidence.</div>`;

  $("offerTimingValue").textContent = listing.forSale ? (listing.offerTiming?.label || "Verify") : "Not for sale";
  $("offerTimingNote").textContent = listing.forSale ? (listing.offerTiming?.note || "Confirm before relying on timing.") : "No active showing or offer workflow.";

  if (listing.forSale) {
    $("listingTempoValue").textContent = typeof listing.daysLive === "number" ? (listing.daysLive === 0 ? "Listed today" : `${listing.daysLive} day${listing.daysLive === 1 ? "" : "s"} live`) : (listing.status || "Active");
    $("listingTempoNote").textContent = listing.details?.listedAt ? `Listed ${formatDate(listing.details.listedAt)}` : "Live MLS listing";
  } else if (listing.historySummary?.appearanceCount) {
    $("listingTempoValue").textContent = listing.historySummary.lastSeenDate ? `Last seen ${formatDate(listing.historySummary.lastSeenDate)}` : `${listing.historySummary.appearanceCount} MLS records`;
    $("listingTempoNote").textContent = `${listing.historySummary.appearanceCount} MLS appearance${listing.historySummary.appearanceCount === 1 ? "" : "s"} found in 10 years`;
  } else {
    $("listingTempoValue").textContent = "No MLS history match";
    $("listingTempoNote").textContent = "A deeper owner/property review can still be requested.";
  }
}

function renderDetails(listing) {
  const d = listing.details || {};
  const items = [
    ["STYLE", joinValue(d.architecturalStyle)],
    ["CONSTRUCTION", joinValue(d.construction)],
    ["HEATING", joinValue(d.heating)],
    ["COOLING", joinValue(d.cooling)],
    ["BASEMENT", Array.isArray(listing.basement) ? listing.basement.join(", ") : ""],
    ["PARKING", joinValue(d.parking) || (listing.garageType ? `${listing.garageType} garage` : "")],
    ["POSSESSION", d.possession],
    ["CROSS STREET", d.crossStreet],
    ["INTERIOR", joinValue(d.interior)],
    ["POOL", joinValue(d.pool)],
    ["DIRECTION", d.direction],
    ["LISTING OFFICE", d.listingOffice],
  ].filter(([, value]) => value && value !== "—");

  if (!items.length) {
    detailsGrid.innerHTML = `<div class="empty-details"><strong>${listing.forSale ? "Property details are limited for this listing." : "No active-listing details to display."}</strong><span>${listing.forSale ? "The showing request can still be sent." : "Use the deep report option for the next layer."}</span></div>`;
  } else {
    detailsGrid.innerHTML = items.map(([label, value]) => `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");
  }

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

function openLeadModal(mode) {
  if (!liveListing) return;
  if (mode === "showing" && !liveListing.forSale) return;

  currentLeadMode = mode;
  leadForm.reset();
  leadError.classList.add("hidden");
  leadError.textContent = "";
  leadFormPanel.classList.remove("hidden");
  leadSuccessPanel.classList.add("hidden");
  sellerTimelineWrap.classList.add("hidden");
  leadSubmit.disabled = false;

  modalProperty.value = activePropertyInput;
  modalPropertyDisplay.value = liveListing.address || activePropertyInput;
  leadMode.value = mode;

  if (mode === "showing") {
    modalEyebrow.textContent = "⚡ FAST SHOWING · 1–24H TARGET";
    modalTitle.textContent = "Request the fastest available showing.";
    modalCopy.textContent = "We save the request immediately. Our administrator assigns the right Realtor, who then confirms the appointment with the listing side.";
    nextStepLabel.textContent = "WHEN DO YOU WANT TO SEE IT?";
    showingTiming.innerHTML = `<option value="asap">As soon as possible</option><option value="today">Today, if available</option><option value="within_24h">Within 24 hours</option>`;
    leadSubmit.textContent = "Send Showing Request →";
    serviceNote.textContent = "Target showing window: 1–24 hours, subject to listing/seller availability. Realtor response target: within 5 minutes during service hours.";
  } else if (mode === "seller") {
    modalEyebrow.textContent = "SELLER AI REPORT";
    modalTitle.textContent = "Own this home? See the seller side.";
    modalCopy.textContent = "Request an AI-assisted value and market-position review without putting the property on the market.";
    nextStepLabel.textContent = "REPORT";
    showingTiming.innerHTML = `<option value="seller_report">Seller AI Deep Report</option>`;
    sellerTimelineWrap.classList.remove("hidden");
    leadSubmit.textContent = "Request Seller AI Report →";
    serviceNote.textContent = "Preliminary decision support only. A Realtor review is required before relying on pricing or listing strategy.";
  } else {
    modalEyebrow.textContent = "OFF-MARKET AI REPORT";
    modalTitle.textContent = "Go deeper on this property.";
    modalCopy.textContent = "No active listing was found. Request a deeper property-history and market-context review.";
    nextStepLabel.textContent = "NEXT STEP";
    showingTiming.innerHTML = `<option value="buyer_offmarket_report">AI Deep Property Report</option><option value="buyer_offmarket_contact">Talk to a Realtor about this property</option>`;
    leadSubmit.textContent = "Request AI Deep Property Report →";
    serviceNote.textContent = "This property is not currently listed for sale. Any value range is preliminary and requires verification.";
  }

  leadModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  window.setTimeout(() => leadForm.querySelector('input[name="name"]')?.focus(), 80);
}

function hideLeadModal() {
  leadModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

closeModal.addEventListener("click", hideLeadModal);
doneButton.addEventListener("click", () => {
  hideLeadModal();
  snapshotSection.scrollIntoView({ behavior: "smooth", block: "start" });
});
leadModal.addEventListener("click", (event) => { if (event.target === leadModal) hideLeadModal(); });

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!liveListing) return;

  const form = new FormData(leadForm);
  const name = String(form.get("name") || "").trim();
  const mobile = String(form.get("mobile") || "").trim();
  const email = String(form.get("email") || "").trim();
  const website = String(form.get("website") || "").trim();

  if (name.length < 2) return showLeadError("Please enter your name.");
  if (mobile.replace(/\D/g, "").length < 7) return showLeadError("Please enter a valid mobile number.");
  if (!email) return showLeadError("Please enter your email address.");
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email)) return showLeadError("Please enter a valid email address.");

  let timing = String(form.get("showing_timing") || "asap");
  if (currentLeadMode === "seller") timing = sellerTimeline.value || "seller_curious";

  leadSubmit.disabled = true;
  const originalText = leadSubmit.textContent;
  leadSubmit.textContent = "Sending…";
  leadError.classList.add("hidden");

  const payload = {
    property_input: activePropertyInput,
    listing_key: liveListing.listingKey || null,
    resolved_address: liveListing.address || activePropertyInput,
    name,
    mobile,
    email,
    website,
    showing_timing: timing,
    lead_mode: currentLeadMode,
    page_url: location.href,
    referrer: document.referrer || null,
    property_snapshot: {
      listingKey: liveListing.listingKey || null,
      address: liveListing.address || activePropertyInput,
      listPrice: liveListing.listPrice ?? null,
      marketStatus: liveListing.marketStatus || null,
      forSale: !!liveListing.forSale,
      beds: liveListing.beds ?? null,
      baths: liveListing.baths ?? null,
      propertySubType: liveListing.propertySubType || null,
      lotWidth: liveListing.lotWidth ?? null,
      lotDepth: liveListing.lotDepth ?? null,
    },
  };

  try {
    const response = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "Unable to send the request right now.");

    leadFormPanel.classList.add("hidden");
    leadSuccessPanel.classList.remove("hidden");
    renderLeadSuccess(result);
  } catch (error) {
    showLeadError(error instanceof Error ? error.message : "Unable to send the request right now.");
  } finally {
    leadSubmit.disabled = false;
    leadSubmit.textContent = originalText;
  }
});

function renderLeadSuccess(result) {
  const afterHours = !!result.queued_after_hours;
  if (currentLeadMode === "showing") {
    successTitle.textContent = "Showing request received instantly.";
    successCopy.textContent = afterHours
      ? "Your request is saved for administrator assignment in the next service window. The actual showing still needs confirmation from the listing side."
      : "Your request is saved for administrator assignment. A Realtor will then confirm the actual appointment time with the listing side.";
    successStepOne.textContent = "Showing request received";
    successStepOneNote.textContent = "The response timer starts when an administrator assigns a Realtor.";
  } else if (currentLeadMode === "seller") {
    successTitle.textContent = "Seller report request received.";
    successCopy.textContent = "The property and your request are saved for the seller-side review.";
    successStepOne.textContent = "Seller review assigned";
    successStepOneNote.textContent = "A Realtor review follows the AI-assisted property read.";
  } else {
    successTitle.textContent = "Deep report request received.";
    successCopy.textContent = "The off-market property request is saved for deeper review.";
    successStepOne.textContent = "Property review assigned";
    successStepOneNote.textContent = "We will use the available property and market context for the next layer.";
  }
}

function showLeadError(message) {
  leadError.textContent = message;
  leadError.classList.remove("hidden");
}

function openGallery(index) {
  if (!photos.length) return;
  galleryIndex = Math.max(0, Math.min(index, photos.length - 1));
  renderGallery();
  galleryModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeGallery() {
  galleryModal.classList.add("hidden");
  if (leadModal.classList.contains("hidden")) document.body.classList.remove("modal-open");
}

function renderGallery() {
  const photo = photos[galleryIndex];
  if (!photo) return;
  galleryImage.src = photo.url;
  galleryImage.alt = photo.description || `Property photo ${galleryIndex + 1}`;
  galleryCounter.textContent = `${galleryIndex + 1} / ${photos.length}`;
  galleryPrev.disabled = photos.length < 2;
  galleryNext.disabled = photos.length < 2;
}

galleryClose.addEventListener("click", closeGallery);
galleryPrev.addEventListener("click", () => { if (photos.length) { galleryIndex = (galleryIndex - 1 + photos.length) % photos.length; renderGallery(); } });
galleryNext.addEventListener("click", () => { if (photos.length) { galleryIndex = (galleryIndex + 1) % photos.length; renderGallery(); } });
galleryModal.addEventListener("click", (event) => { if (event.target === galleryModal) closeGallery(); });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!galleryModal.classList.contains("hidden")) closeGallery();
    else if (!leadModal.classList.contains("hidden")) hideLeadModal();
  }
});

function detectMlsKey(value) {
  const match = String(value || "").trim().toUpperCase().match(/\b[A-Z]\d{7,9}\b/);
  return match ? match[0] : null;
}

function setSignal(id, title, note) {
  const el = $(id);
  const noteEl = $(`${id}Text`);
  if (el) el.textContent = title || "—";
  if (noteEl) noteEl.textContent = note || "";
}

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

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(n) : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function joinValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value == null ? "" : String(value).trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
