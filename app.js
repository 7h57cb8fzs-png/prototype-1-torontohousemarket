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
let homeAiSequence = 0;
let homeAiController = null;

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
  resetHomeAssistant();
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

  resultEyebrow.textContent = active ? "PUBLIC MLS SNAPSHOT" : "PROPERTY REVIEW";
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
      offMarketCopy.textContent = "Request a deeper review using available MLS history and current local market context.";
    } else {
      offMarketTitle.textContent = "No current MLS listing found.";
      offMarketCopy.textContent = "Choose a buyer property review — or, if you own it, a seller value review.";
    }
  }

  renderPhotos(listing.photos || [], listing);
  renderQuickFacts(listing);
  renderAiBrief(listing);
  renderMarketRead(listing);
  renderDetails(listing);
  $("homeAiPanel").classList.toggle("hidden", !listing.forSale || listing.displayRestricted || !listing.listingKey);
  const updated = listing.publicListing?.updatedAt;
  $("snapshotFreshness").textContent = active ? `${updated ? `Listing updated ${formatDate(updated)}. ` : ""}Public IDX snapshot · may be cached for up to 5 minutes. Confirm availability before visiting.` : "No current for-sale listing verified. Historical details may not describe the property today.";
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
  if (listing.foundInMls === false) return "Not for sale on MLS · buyer and seller review options available";
  const count = listing.historySummary?.appearanceCount || 0;
  return `Not currently listed${count ? ` · ${count} MLS appearance${count === 1 ? "" : "s"} found in 10 years` : ""}`;
}

function renderPrice(listing) {
  if (listing.forSale) {
    return listing.listPrice ? money(listing.listPrice) : `<span class="price-caption">ACTIVE LISTING</span>Price unavailable`;
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
  mainPhoto.onerror = () => usePhotoFallback(mainPhoto,0);
  photoCountBadge.textContent = `${photos.length} photo${photos.length === 1 ? "" : "s"}`;

  const secondary = photos.slice(1, 5);
  photoThumbs.innerHTML = secondary.map((photo, index) => `
    <button type="button" data-photo-index="${index + 1}" aria-label="Open property photo ${index + 2}">
      <img src="${escapeAttr(photo.url)}" alt="" loading="lazy" />
    </button>`).join("");

  for (const button of photoThumbs.querySelectorAll("button")) {
    const index=Number(button.dataset.photoIndex||0);
    button.addEventListener("click", () => openGallery(index));
    const img = button.querySelector("img");
    if (img) img.addEventListener("error", () => {
      const photo=photos[index];
      if(photo?.fallbackUrl&&!img.dataset.fallbackUsed){
        img.dataset.fallbackUsed="true";
        img.src=photo.fallbackUrl;
      }else button.remove();
    });
  }
}

function removeBrokenPhoto(index) {
  if (!photos[index]) return;
  photos.splice(index, 1);
  renderPhotos(photos, liveListing || {});
}

function usePhotoFallback(image,index) {
  const photo=photos[index];
  if(photo?.fallbackUrl&&!image.dataset.fallbackUsed){
    image.dataset.fallbackUsed="true";
    image.src=photo.fallbackUrl;
    return;
  }
  removeBrokenPhoto(index);
}

photoMainButton.addEventListener("click", () => openGallery(0));

function renderQuickFacts(listing) {
  if (!listing.forSale || listing.displayRestricted) listing = {};
  $("factBeds").textContent = listing.beds ?? "—";
  $("factBaths").textContent = listing.baths ?? "—";
  $("factType").textContent = listing.propertySubType || listing.propertyType || "—";
  $("factLot").textContent = listing.lotWidth && listing.lotDepth ? `${formatNumber(listing.lotWidth)} × ${formatNumber(listing.lotDepth)} ${listing.publicListing?.lotUnits || "(units not reported)"}` : "—";
  $("factParking").textContent = listing.parkingTotal ?? "—";
  $("factTax").textContent = listing.details?.annualTax ? `${money(listing.details.annualTax)}${listing.details.taxYear ? ` · ${listing.details.taxYear}` : ""}` : "—";
}

function renderAiBrief(listing) {
  if (!listing.forSale || listing.displayRestricted) {
    for (const id of ["priceSignal", "marketSignal", "flagSignal", "showingSignal"]) setSignal(id, "Current details unavailable", "Request a property review. We have not verified current public listing facts.");
    return;
  }
  const change = listing.publicListing?.priceChange;
  setSignal("priceSignal", listing.listPrice ? money(listing.listPrice) : "Not reported",
    change ? `${money(change.amount)} (${change.percent}%) below the original ${money(change.original)} asking price on this MLS listing. Not a value estimate.` : "The seller’s asking price, not an estimate of market value. No verified reduction is shown.");
  const days = listing.daysLive;
  setSignal("marketSignal", Number.isFinite(days) ? days === 0 ? "Listed today" : `${days} days on this listing` : "Active listing",
    listing.offerTiming?.note || "Confirm showing access and whether there is an offer deadline.");
  const layout = [];
  if (listing.publicListing?.bedroomsBelowGrade > 0) layout.push(`${listing.publicListing.bedroomsBelowGrade} bedroom(s) below grade`);
  if (Array.isArray(listing.basement) && listing.basement.length) layout.push(`${listing.basement.join(", ")} basement`);
  if (listing.parkingTotal != null) layout.push(`${listing.parkingTotal} parking space(s)`);
  setSignal("flagSignal", listing.livingAreaRange ? `${listing.livingAreaRange} sq ft (MLS range)` : "Size not reported", layout.join(" · ") || "Confirm room dimensions, usable space and parking at your showing.");
  const extraUnit = listing.kitchensTotal > 1 || /separate entrance|apartment|legal|permit/i.test(listing.remarks || "");
  setSignal("showingSignal", extraUnit ? "Verify any additional unit" : listing.isCondominium ? "Review fees & building records" : "Check condition & major systems",
    extraUnit ? "Listing mentions are not proof of legal use. Verify permits, occupancy and fire safety with qualified professionals." : listing.isCondominium ? "Ask what fees cover, about planned work, and for a professional review of the status certificate." : "Check the roof, heating, cooling and signs of moisture. Photos cannot confirm condition.");
}

function renderMarketRead(listing) {
  const current = listing.forSale && !listing.displayRestricted;
  const d = current ? listing.details || {} : {};
  const tax = d.annualTax;
  $("snapshotTaxValue").textContent = Number.isFinite(tax) ? `${money(tax)} / year` : "Not reported";
  $("snapshotTaxNote").textContent = Number.isFinite(tax) ? `${d.taxYear || "MLS-reported"} · about ${money(tax / 12)} / month for tax alone. Not total ownership cost.` : "Confirm the current tax bill.";
  const fee = current ? listing.maintenanceFee : null;
  $("snapshotFeeValue").textContent = Number.isFinite(fee?.amount) ? `${money(fee.amount)} / ${fee.frequency || "period not reported"}` : "Not reported";
  const feeNotes = [];
  if (fee?.included?.length) feeNotes.push(`Listed as included: ${fee.included.join(", ")}.`);
  if (fee?.notIncluded?.length) feeNotes.push(`Listed as excluded: ${fee.notIncluded.join(", ")}.`);
  $("snapshotFeeNote").textContent = feeNotes.join(" ") || "Do not assume no fee. Confirm any condo, common-element or other charges.";
  $("snapshotPossessionValue").textContent = d.possession || "To be confirmed";
  $("snapshotPossessionNote").textContent = "Possession is separate from your showing date.";
  $("snapshotCommunityValue").textContent = current ? listing.cityRegion || listing.city || "Not reported" : "Not verified";
  $("snapshotCommunityNote").textContent = d.crossStreet ? `Near ${d.crossStreet}` : "Check the exact location and your commute.";
}

function renderDetails(listing) {
  if (!listing.forSale || listing.displayRestricted) listing = { forSale: false };
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
    modalEyebrow.textContent = "SHOWING REQUEST · 1–24 HOUR TARGET";
    modalTitle.textContent = "See this home as soon as available.";
    modalCopy.textContent = "Share your details once. We route the showing request and email your full Buyer Decision Report.";
    nextStepLabel.textContent = "WHEN DO YOU WANT TO SEE IT?";
    showingTiming.innerHTML = `<option value="asap">As soon as possible</option><option value="today">Today, if available</option><option value="within_24h">Within 24 hours</option>`;
    leadSubmit.textContent = "Request showing →";
    serviceNote.textContent = "Realtor response target: within 5 minutes, 9 AM–9 PM. Showing target: 1–24 hours, subject to availability.";
  } else if (mode === "seller") {
    modalEyebrow.textContent = "SELLER VALUE REVIEW";
    modalTitle.textContent = "Own this home? Understand its position.";
    modalCopy.textContent = "Request a private, AI-assisted value and market review without listing the property.";
    nextStepLabel.textContent = "REPORT";
    showingTiming.innerHTML = `<option value="seller_report">Seller Value Review</option>`;
    sellerTimelineWrap.classList.remove("hidden");
    leadSubmit.textContent = "Request seller review →";
    serviceNote.textContent = "Preliminary decision support only. A Realtor review is required before relying on pricing or listing strategy.";
  } else {
    modalEyebrow.textContent = "BUYER PROPERTY REVIEW";
    modalTitle.textContent = "Interested even though it is not listed?";
    modalCopy.textContent = "Request a deeper review of available MLS history and current local market context.";
    nextStepLabel.textContent = "NEXT STEP";
    showingTiming.innerHTML = `<option value="buyer_offmarket_report">Buyer Property Review</option><option value="buyer_offmarket_contact">Talk to a Realtor about this property</option>`;
    leadSubmit.textContent = "Request property review →";
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
    successTitle.textContent = "Showing request sent.";
    successCopy.textContent = afterHours
      ? "Your request is saved for the next service window. A Realtor will confirm the earliest available appointment."
      : "A Realtor will contact you to confirm the earliest appointment available from the listing side.";
    successStepOne.textContent = "Showing request routed";
    successStepOneNote.textContent = afterHours ? "We will respond in the next 9 AM–9 PM service window." : "Realtor response target: within 5 minutes.";
  } else if (currentLeadMode === "seller") {
    successTitle.textContent = "Seller review requested.";
    successCopy.textContent = "Your private property review is now being prepared.";
    successStepOne.textContent = "Seller request routed";
    successStepOneNote.textContent = "A Realtor reviews the AI-assisted property read before you rely on it.";
  } else {
    successTitle.textContent = "Property review requested.";
    successCopy.textContent = "We will review the available MLS history and local market context.";
    successStepOne.textContent = "Buyer request routed";
    successStepOneNote.textContent = "A Realtor reviews the result before the next decision.";
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

function resetHomeAssistant() {
  homeAiSequence++;
  homeAiController?.abort();
  $("homeAiAnswer").innerHTML = "";
  $("homeAiAnswer").classList.add("hidden");
  $("homeAiStatus").textContent = "Choose a question. No sign-up needed.";
  for (const button of document.querySelectorAll("[data-home-topic]")) { button.disabled = false; button.removeAttribute("aria-pressed"); }
}
for (const button of document.querySelectorAll("[data-home-topic]")) {
  button.addEventListener("click", async () => {
    if (!liveListing?.listingKey || !liveListing.forSale || loading) return;
    resetHomeAssistant();
    const sequence = homeAiSequence;
    const listingKey = liveListing.listingKey;
    homeAiController = new AbortController();
    const controller = homeAiController;
    const timer = window.setTimeout(() => controller.abort(), 25000);
    button.setAttribute("aria-pressed", "true");
    for (const question of document.querySelectorAll("[data-home-topic]")) question.disabled = true;
    $("homeAiStatus").textContent = "Reading this home’s listing facts…";
    try {
      const response = await fetch("/api/home-assistant", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ listingKey, topic: button.dataset.homeTopic }), signal: controller.signal });
      const data = await response.json();
      if (sequence !== homeAiSequence || liveListing?.listingKey !== listingKey) return;
      if (!response.ok || !data.ok || data.listingKey !== listingKey) throw new Error(data.error || "The assistant is temporarily unavailable. Your listing facts are still below.");
      $("homeAiStatus").textContent = data.label;
      const rows = (items) => (items || []).map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></li>`).join("");
      $("homeAiAnswer").innerHTML = `<div><h4>From the listing</h4><ul>${rows(data.facts)}</ul></div><div><h4>Ask your Realtor</h4><ul>${rows(data.checks)}</ul></div><p>${escapeHtml(data.note)}</p>`;
      $("homeAiAnswer").classList.remove("hidden");
    } catch (error) {
      if (sequence !== homeAiSequence) return;
      $("homeAiStatus").textContent = error.name === "AbortError" ? "The assistant took too long. Try again, or review the listing facts below." : error.message;
    } finally {
      window.clearTimeout(timer);
      if (sequence === homeAiSequence) for (const question of document.querySelectorAll("[data-home-topic]")) question.disabled = false;
    }
  });
}

// Discovery only opens public snapshots. It never submits a lead or sends a report.
const discoveryModes = {
  new: { title: "Just Listed", description: "Active homes entered on this MLS listing in the past 7 days. A relisting is not necessarily new to the market." },
  luxury: { title: "Luxury Homes", description: "Explore active homes asking $2 million or more, highest asking price first. Open a home for the listing facts and showing options." },
  budget: { title: "Search by Budget", description: "Active homes at or below your asking-price cap, lowest asking price first. This is not a mortgage affordability assessment." }
};
let discoveryMode = "new";
let discoveryController = null;
let discoverySequence = 0;
const discoveryForm = $("discoveryForm");
function resetDiscoveryResults() {
  discoverySequence++;
  discoveryController?.abort();
  $("discoverySubmit").disabled = false;
  $("discoverySubmit").textContent = "Find homes";
  $("discoveryResults").innerHTML = "";
  $("discoveryCoverage").textContent = "";
  $("discoveryStatus").textContent = "Choose your filters, then find homes.";
}
function openDiscovery(mode, focus = true) {
  if (!discoveryModes[mode]) return;
  resetDiscoveryResults();
  discoveryMode = mode;
  $("discoveryPanel").classList.remove("hidden");
  $("discoveryTitle").textContent = discoveryModes[mode].title;
  $("discoveryDescription").textContent = discoveryModes[mode].description;
  $("discoveryBudget").required = mode === "budget";
  $("discoveryBudget").min = mode === "luxury" ? "2000000" : "100000";
  if (mode === "luxury" && $("discoveryBudget").value && Number($("discoveryBudget").value) < 2000000) $("discoveryBudget").value = "";
  for (const tile of document.querySelectorAll("[data-discovery]")) {
    if (tile.dataset.discovery === mode) tile.setAttribute("aria-current", "true");
    else tile.removeAttribute("aria-current");
  }
  if (focus) { $("discoveryPanel").scrollIntoView({ behavior: "smooth", block: "start" }); $("discoveryTitle").focus({ preventScroll: true }); }
}
for (const tile of document.querySelectorAll("[data-discovery]")) {
  tile.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState(null, "", tile.getAttribute("href"));
    openDiscovery(tile.dataset.discovery);
  });
}
discoveryForm.addEventListener("input", resetDiscoveryResults);
discoveryForm.addEventListener("change", resetDiscoveryResults);
discoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!discoveryForm.reportValidity()) return;
  resetDiscoveryResults();
  const sequence = discoverySequence;
  discoveryController = new AbortController();
  const controller = discoveryController;
  const timer = window.setTimeout(() => controller.abort(), 20000);
  const params = new URLSearchParams({ mode: discoveryMode, city: $("discoveryCity").value, type: $("discoveryType").value });
  if ($("discoveryBudget").value) params.set("maxPrice", $("discoveryBudget").value);
  $("discoverySubmit").disabled = true;
  $("discoverySubmit").textContent = "Checking…";
  $("discoveryStatus").textContent = "Checking public listings…";
  try {
    const response = await fetch(`/api/discovery?${params}`, { headers: { Accept: "application/json" }, signal: controller.signal });
    const data = await response.json();
    if (sequence !== discoverySequence) return;
    if (!response.ok || !data.ok || !Array.isArray(data.listings)) throw new Error(data.error || "Listing search is temporarily unavailable.");
    $("discoveryStatus").textContent = data.listings.length ? `${data.listings.length} home${data.listings.length === 1 ? "" : "s"} to explore. Open a home to recheck its facts.` : "No matches in the listings checked. This is not a full-market search. Try another type or budget, or check an address directly.";
    $("discoveryResults").innerHTML = data.listings.map((home) => {
      const badge = discoveryMode === "luxury" ? "Asking $2M+" : home.daysLive != null ? `${home.daysLive} days on this listing` : "Active listing";
      const facts = [home.propertySubType, home.beds != null ? `${home.beds} bed` : null, home.baths != null ? `${home.baths} bath` : null].filter(Boolean).join(" · ");
      return `<article class="discovery-home"><span class="home-badge">${escapeHtml(badge)}</span><strong class="home-price">${money(home.listPrice)}</strong><h4>${escapeHtml(home.address)}</h4><p>${escapeHtml(facts)}</p><small>${escapeHtml(home.listingOffice || "Listing office not reported")} · MLS ${escapeHtml(home.listingKey)}</small><a href="/?listingKey=${encodeURIComponent(home.listingKey)}#lookup" data-open-listing="${escapeAttr(home.listingKey)}">Check this home →</a></article>`;
    }).join("");
    $("discoveryCoverage").textContent = `${data.note || "Results are a selection, not the full market."} ${data.coverage?.partial ? "The search reached its scan limit. " : ""}${data.coverage?.moreMatches ? "Showing the first 12 matches. Narrow your filters for more focused results. " : ""}${data.checkedAt ? `Checked ${formatDate(data.checkedAt)}; results may be cached for up to 5 minutes.` : ""}`;
  } catch (error) {
    if (sequence !== discoverySequence) return;
    $("discoveryStatus").textContent = error.name === "AbortError" ? "The search took too long. Try again, or check an address directly." : error.message || "Unable to check listings. Please try again.";
  } finally {
    window.clearTimeout(timer);
    if (sequence === discoverySequence) { $("discoverySubmit").disabled = false; $("discoverySubmit").textContent = "Find homes"; }
  }
});
$("discoveryResults").addEventListener("click", (event) => {
  const link = event.target.closest("[data-open-listing]");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (loading) return;
  propertyInput.value = link.dataset.openListing;
  analysisForm.requestSubmit();
});
function restoreDiscoveryHash() {
  const mode = window.location.hash.replace(/^#browse-/, "");
  if (discoveryModes[mode]) openDiscovery(mode, false);
}
window.addEventListener("hashchange", restoreDiscoveryHash);
window.addEventListener("popstate", restoreDiscoveryHash);
restoreDiscoveryHash();
const linkedMls = new URLSearchParams(window.location.search).get("listingKey");
if (linkedMls && /^[A-Z]\d{7,9}$/.test(linkedMls)) { propertyInput.value = linkedMls; analysisForm.requestSubmit(); }
