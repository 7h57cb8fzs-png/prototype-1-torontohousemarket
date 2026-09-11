// Format validation only; a successful check does not verify phone ownership.
function normalizeNorthAmericanPhone(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 24 || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  else if (raw.startsWith('+')) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (digits.slice(1,3) === '11' || digits.slice(4,6) === '11' || /^(\d)\1{9}$/.test(digits) || ['1234567890','0123456789','9876543210'].includes(digits)) return null;
  return '+1' + digits;
}

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
let schoolSequence = 0;
let schoolController = null;
let homeAiSequence = 0;
let homeAiController = null;
let priceCheckSequence = 0;
let priceCheckController = null;

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
    loadPriceCheck(liveListing);
    loadHomeAssistant('overview');
    loadSchoolSnapshot(liveListing);
    if (new URLSearchParams(window.location.search).get('showing')==='1') openLeadModal('buyer_report',true);

    const verification = liveListing.inputValidation?.label || "Property checked.";
    setInputStatus(liveListing.foundInMls === false ? "error" : "ok", verification);
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
  lookupButton.textContent = value ? "Finding property…" : "Preview this home →";
  analysisForm.classList.toggle("is-loading", value);
}

function setInputStatus(type, text) {
  inputStatus.className = `input-status ${type || ""}`.trim();
  inputStatus.textContent = text;
}

function hideResult() {
  schoolSequence++; schoolController?.abort();
  $("mobileShowing").classList.add("hidden");
  $("mobileAsking").textContent = "";
  resetHomeAssistant();
  resetPriceCheck();
  snapshotSection.classList.add("hidden");
}

function showResult() {
  snapshotSection.classList.remove("hidden");
}

function renderListing(listing) {
  schoolSequence++; schoolController?.abort();
  resetDynamicSections();
  resetPriceCheck();

  const hasMls = listing.foundInMls !== false;
  const active = !!listing.forSale;
  const restricted = !!listing.displayRestricted;

  resultEyebrow.textContent = active ? "PUBLIC MLS SNAPSHOT" : "PROPERTY REVIEW";
  const fullAddress = listing.address || activePropertyInput;
  const addressParts = fullAddress.split(/,\s*/);
  snapshotProperty.textContent = addressParts[0];
  $("snapshotLocality").textContent = addressParts.slice(1).join(", ").replace(/([A-Z]\d[A-Z])\s+(\d[A-Z]\d)/ig, "$1\u00a0$2");
  snapshotMeta.textContent = buildSnapshotMeta(listing);

  if (listing.inputValidation?.label) {
    linkValidationBadge.textContent = `${hasMls ? "✓ " : ""}${listing.inputValidation.label}`;
    linkValidationBadge.classList.remove("hidden");
  }

  marketStatusPill.textContent = active ? "FOR SALE" : listing.forLease ? "FOR LEASE" : hasMls ? "NOT FOR SALE" : "STATUS UNCONFIRMED";
  marketStatusPill.className = `market-status-pill ${active ? "is-live" : "is-off"}`;
  mlsBadge.textContent = listing.listingKey ? `MLS ${listing.listingKey}` : hasMls ? "MLS HISTORY" : "NO MLS MATCH";

  liveAddress.textContent = listing.address || activePropertyInput;
  livePrice.innerHTML = renderPrice(listing);
  liveDetails.textContent = buildFactLine(listing, restricted);

  activeActionBox.classList.toggle("hidden", !active);
  offMarketActionBox.classList.toggle("hidden", active);

  if (!active) {
    if (listing.forLease) {
      offMarketTitle.textContent = "This property is offered for lease.";
      offMarketCopy.textContent = "You found the rental listing. Purchase price reports apply to homes for sale. Contact the team about this rental.";
    } else if (hasMls) {
      offMarketTitle.textContent = "Not listed — but the property still has useful history.";
      offMarketCopy.textContent = "Request a deeper review using available MLS history and current local market context.";
    } else {
      offMarketTitle.textContent = "This listing needs a team check.";
      offMarketCopy.textContent = "Check the unit and city, or try the MLS number. If it is listed elsewhere, our feed may not include it. Contact the team to confirm availability.";
    }
  }

  renderPhotos(listing.photos || [], listing);
  renderQuickFacts(listing);
  renderAiBrief(listing);
  renderMarketRead(listing);
  renderLayoutEssentials(listing);
  renderBuyerEssentials(listing);
  renderDetails(listing);
  $("mobileShowing").classList.toggle("hidden", !listing.forSale || listing.displayRestricted || !listing.listingKey);
  $("mobileAsking").textContent = listing.forSale && listing.listPrice > 0 ? money(listing.listPrice) : "";
  $("homeAiPanel").classList.toggle("hidden", !listing.forSale || listing.displayRestricted || !listing.listingKey);
  $("priceCheckPanel").classList.toggle("hidden", !listing.forSale || listing.displayRestricted || !listing.listingKey);
  $("priceCheckJump").classList.toggle("hidden", !listing.forSale || listing.displayRestricted || !listing.listingKey);
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
  if (listing.forLease) return `MLS ${listing.listingKey} · For lease · this is a rental listing, not a sale listing`;
  if (listing.forSale) {
    const bits = [];
    if (listing.listingKey) bits.push(`MLS ${listing.listingKey}`);
    bits.push("active listing");
    if (typeof listing.daysLive === "number") bits.push(listing.daysLive === 0 ? "listed today" : `${listing.daysLive} day${listing.daysLive === 1 ? "" : "s"} live`);
    return bits.join(" · ");
  }
  if (listing.foundInMls === false) return "Not found in our connected MLS feed · sale or lease status unconfirmed";
  const count = listing.historySummary?.appearanceCount || 0;
  return `Not currently listed${count ? ` · ${count} MLS appearance${count === 1 ? "" : "s"} found in 10 years` : ""}`;
}

function renderPrice(listing) {
  if (listing.forLease) return `${money(listing.listPrice)}<span class="price-caption"> RENT / MONTH</span>`;
  if (listing.foundInMls === false) return `<span class="price-caption">STATUS</span>Listing status unconfirmed`;
  if (listing.forSale) {
    return listing.listPrice ? money(listing.listPrice) : `<span class="price-caption">ACTIVE LISTING</span>Price unavailable`;
  }
  return `<span class="price-caption">STATUS</span>Not currently for sale`;
}

function buildFactLine(listing, restricted) {
  if (restricted) return "Listing identified · full internet display is restricted by the listing feed";
  const facts = [
    (listing.propertySubType || listing.propertyType || "").replace(/^Condo Apartment$/i, "Condo"),
    listing.beds != null ? `${bedroomLabel(listing)} bed` : null,
    listing.baths != null ? `${listing.baths} bath` : null,
    listing.livingAreaRange ? `${listing.livingAreaRange.replace(/-/g, "–")}\u00a0sq\u00a0ft` : null,
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
    } else if (listing.foundInMls === false) {
      photoPlaceholderTitle.textContent = "Try the MLS number or add the city";
      photoPlaceholderText.textContent = "We couldn’t confirm a listing for this address. Its availability is unknown.";
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

function bedroomLabel(listing) {
  const primary = listing.publicListing?.bedroomsAboveGrade;
  const extra = listing.publicListing?.bedroomsBelowGrade;
  return primary != null && extra > 0 ? `${primary}+${extra}` : listing.beds ?? "—";
}

function renderQuickFacts(listing) {
  if ((!listing.forSale && !listing.forLease) || listing.displayRestricted) listing = {};
  $("factBeds").textContent = bedroomLabel(listing);
  $("factBaths").textContent = listing.baths ?? "—";
  $("factType").textContent = listing.propertySubType || listing.propertyType || "—";
  $("factLotLabel").textContent = listing.isCondominium ? "MAINTENANCE" : "LOT";
  const fee = listing.maintenanceFee, amount = fee?.amount, frequency = String(fee?.frequency || 'month').toLowerCase();
  const feeKnown = amount != null && Number.isFinite(Number(amount)) && Number(amount) >= 0;
  const feeUnit = /^(month|monthly)$/.test(frequency) ? '' : /^(year|annual|annually|yearly)$/.test(frequency) ? '/yr' : ` / ${frequency}`;
  $("factLot").textContent = listing.isCondominium ? feeKnown ? `${new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",minimumFractionDigits:Number(amount)%1?2:0,maximumFractionDigits:2}).format(Number(amount))}${feeUnit}` : "Not reported" : listing.lotWidth && listing.lotDepth ? `${formatNumber(listing.lotWidth)} × ${formatNumber(listing.lotDepth)} ${listing.publicListing?.lotUnits || "(units not reported)"}` : "—";
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
  if (listing.publicListing?.bedroomsBelowGrade > 0) layout.push(listing.isCondominium ? `${bedroomLabel(listing)} reported bedroom layout; confirm the additional room's use` : `${listing.publicListing.bedroomsBelowGrade} bedroom(s) below grade`);
  if (Array.isArray(listing.basement) && listing.basement.length) layout.push(`${listing.basement.join(", ")} basement`);
  if (listing.parkingTotal != null) layout.push(`${listing.parkingTotal} parking space(s)`);
  setSignal("flagSignal", listing.livingAreaRange ? `${listing.livingAreaRange} sq ft (MLS range)` : "Size not reported", layout.join(" · ") || "Confirm room dimensions, usable space and parking at your showing.");
  const extraUnit = !listing.isCondominium && (listing.kitchensTotal > 1 || /separate entrance|basement apartment|secondary unit/i.test(listing.remarks || ""));
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

function renderLayoutEssentials(listing) {
  const visible = (listing.forSale || listing.forLease) && !listing.displayRestricted;
  $("layoutEssentials").classList.toggle("hidden", !visible);
  const apartment = /condo (?:apartment|apt)/i.test(listing.propertySubType || "");
  $("basementFactCard").classList.toggle("hidden", apartment);
  $("entranceFactCard").classList.toggle("hidden", apartment);
  const tags = (Array.isArray(listing.basement) ? listing.basement : []).map(v => String(v).replace(/([a-z])([A-Z])/g, "$1 $2").trim()).filter(Boolean);
  const noBasement = tags.some(v => /^(none|no basement)$/i.test(v));
  $("basementFact").textContent = noBasement ? "No basement" : tags.filter(v => !/separate.*entrance/i.test(v)).join(" · ") || "Not reported";
  const explicitEntry = tags.some(v => /separate.*entrance/i.test(v) && !/no |not |without /i.test(v));
  const entrySentences = String(listing.remarks || "").split(/[.!?\n]+/).filter(v => /separate(?:\s+(?:basement|side|rear))?\s+entrance/i.test(v));
  const uncertainEntry = entrySentences.some(v => /\b(?:potential|possible|could|proposed|future|option|may|can be|subject to)\b/i.test(v));
  const deniedEntry = tags.some(v => /(?:no|not|without).*separate.*entrance/i.test(v)) || entrySentences.some(v => /\b(?:no|not|without)\b[^,;]{0,45}separate(?:\s+(?:basement|side|rear))?\s+entrance/i.test(v));
  $("entranceFact").textContent = deniedEntry ? explicitEntry ? "Needs confirmation" : "Not available, per listing" : explicitEntry ? "Reported" : uncertainEntry ? "Potential — confirm" : entrySentences.length ? "Reported in remarks" : "Not reported";
  const kitchens = listing.kitchensTotal;
  $("kitchenFact").textContent = kitchens != null && Number.isInteger(Number(kitchens)) && Number(kitchens) >= 0 ? `${kitchens} ${Number(kitchens) === 1 ? "kitchen" : "kitchens"}` : "Not reported";
}

function renderBuyerEssentials(listing) {
  const visible = listing.forSale && !listing.displayRestricted;
  $("buyerEssentials").classList.toggle("hidden", !visible);
  const offer = visible ? listing.offerTiming : null;
  $("offerTimingValue").textContent = offer?.type === 'scheduled' ? offer.label : offer?.type === 'anytime' ? 'Offers anytime' : offer?.type === 'unclear' ? 'Confirm offer instructions' : 'Offer date not reported';
  $("offerTimingNote").textContent = ['scheduled', 'unclear'].includes(offer?.type) ? offer.note || 'Confirm the deadline and any early-offer instructions with your Realtor.' : offer?.type === 'anytime' ? 'The listing says offers can be considered anytime. Confirm before submitting.' : 'No clear deadline in the public listing. Your Realtor will confirm the offer instructions.';
  renderSchoolSummary(visible ? listing.schoolSummary : null, visible && !!listing.schoolResearchToken);
}
function renderSchoolSummary(school, loading = false) {
  $("schoolName").textContent = school?.name || (loading ? 'Finding a nearby school…' : 'Check schools for this address');
  $("schoolDetails").textContent = school?.name ? [school.distanceKm != null ? `${school.distanceKm} km away` : null, school.board, 'Nearby does not confirm enrolment. Check the school board’s boundary.'].filter(Boolean).join(' · ') : loading ? 'School details load separately from your property preview.' : 'Use the ratings and official results links to search by school or address.';
  const score = school?.rating;
  $("schoolRating").textContent = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10 && school.ratingScale === 10 ? `${score}/10 · MLS-reported rating${school.ratingYear ? ` · ${school.ratingYear}` : ' · year not supplied'}` : school?.name ? 'Rating: check the published school report below.' : '';
}
async function loadSchoolSnapshot(listing) {
  if (!listing?.forSale || listing.displayRestricted || listing.schoolSummary?.name || !listing.schoolResearchToken) return;
  const sequence = schoolSequence, key = listing.listingKey;
  schoolController = new AbortController(); const controller = schoolController;
  const timer = window.setTimeout(() => controller.abort(), 26000);
  try {
    const response = await fetch(`/api/school-enrichment?token=${encodeURIComponent(listing.schoolResearchToken)}`, {headers:{Accept:'application/json'},signal:controller.signal,cache:'no-store'});
    const data = await response.json();
    if (sequence !== schoolSequence || liveListing?.listingKey !== key) return;
    if (!response.ok || !data.ok) throw new Error('School lookup unavailable');
    renderSchoolSummary(data.schoolSummary);
  } catch {
    if (sequence === schoolSequence && liveListing?.listingKey === key) { renderSchoolSummary(null); $("schoolDetails").textContent = 'Nearby school lookup is unavailable. You can still check published ratings and official results.'; }
  } finally { window.clearTimeout(timer); }
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

$("headerReportButton").addEventListener("click", () => {
  if (!loading && liveListing?.forSale && !liveListing.displayRestricted) return openLeadModal("buyer_report");
  document.getElementById("lookup").scrollIntoView({behavior:"smooth",block:"start"}); propertyInput.focus({preventScroll:true});
});
seeHomeButton.addEventListener("click", () => openLeadModal("buyer_report"));
for (const id of ["briefShowingButton", "mobileShowingButton"]) $(id).addEventListener("click", () => openLeadModal("buyer_report"));
deepReportButton.addEventListener("click", () => openLeadModal("buyer_offmarket"));
sellerReportButton.addEventListener("click", () => openLeadModal("seller"));

let leadRequestKey = null;
function openLeadModal(mode, includeShowing = false) {
  if (!liveListing) return;
  if (["showing","buyer_report"].includes(mode) && !liveListing.forSale) return;

  currentLeadMode = mode;
  leadForm.reset();
  $("leadMobile").removeAttribute("aria-invalid");
  leadRequestKey = crypto.randomUUID();
  $("showingChoice").checked = includeShowing;
  $("showingChoiceWrap").classList.toggle("hidden", !["buyer_report","showing"].includes(mode));
  $("showingOptions").classList.add("hidden");
  $("showingCalendarFields").classList.add("hidden");
  leadError.classList.add("hidden");
  leadError.textContent = "";
  leadFormPanel.classList.remove("hidden");
  leadSuccessPanel.classList.add("hidden");
  sellerTimelineWrap.classList.add("hidden");
  leadSubmit.disabled = false;

  modalProperty.value = activePropertyInput;
  modalPropertyDisplay.value = liveListing.address || activePropertyInput;
  leadMode.value = mode;

  if (["showing","buyer_report"].includes(mode)) {
    modalEyebrow.textContent = "AI BUYER REPORT";
    modalTitle.textContent = "Your AI report starts here.";
    modalCopy.textContent = "We’ll email your sold comparisons, price guidance and key checks. Add a private showing if you’d like a closer look.";
    nextStepLabel.textContent = "WHEN DO YOU WANT TO SEE IT?";
    showingTiming.innerHTML = `<option value="asap">Earliest available</option><option value="preferred_time">Choose a date &amp; time</option>`;
    $("showingTime").innerHTML = Array.from({length:24},(_,i)=>{const hour=9+Math.floor(i/2), minute=i%2?"30":"00",value=`${String(hour).padStart(2,"0")}:${minute}`;return `<option value="${value}">${hour>12?hour-12:hour}:${minute} ${hour>=12?"PM":"AM"}</option>`;}).join("");
    $("showingDate").min = new Date().toLocaleDateString("en-CA",{timeZone:"America/Toronto"});
    $("showingDate").max = new Date(Date.now()+29*86400000).toLocaleDateString("en-CA",{timeZone:"America/Toronto"});
    leadSubmit.textContent = "Get my AI report";
    syncShowingChoice();
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

function syncShowingChoice() {
  if(!['buyer_report','showing'].includes(currentLeadMode)) return;
  const showing=$('showingChoice').checked;
  currentLeadMode=showing?'showing':'buyer_report'; leadMode.value=currentLeadMode;
  $('showingOptions').classList.toggle('hidden',!showing);
  const calendar=showing && showingTiming.value==='preferred_time';
  $('showingCalendarFields').classList.toggle('hidden',!calendar);
  $('showingDate').required=calendar; $('showingTime').required=calendar;
  leadSubmit.textContent=showing?'Get report + request showing':'Get my AI report';
}
$('leadMobile').addEventListener('input',()=> $('leadMobile').removeAttribute('aria-invalid'));
$('showingChoice').addEventListener('change',syncShowingChoice);
showingTiming.addEventListener('change',syncShowingChoice);

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
  const mobile = normalizeNorthAmericanPhone(String(form.get("mobile") || ""));
  const email = String(form.get("email") || "").trim();
  const website = String(form.get("website") || "").trim();

  if (name.length < 2) return showLeadError("Please enter your name.");
  if (!mobile) { $("leadMobile").setAttribute("aria-invalid", "true"); $("leadMobile").focus(); return showLeadError("Enter a valid 10-digit mobile number. You can include +1."); }
  if (!email) return showLeadError("Please enter your email address.");
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email)) return showLeadError("Please enter a valid email address.");

  let timing = currentLeadMode === "showing" ? showingTiming.value || "asap" : "report";
  if (currentLeadMode === "showing" && timing === "preferred_time" && (!$("showingDate").value || !$("showingTime").value)) return showLeadError("Choose your preferred showing date and time.");
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
    showing_requested: currentLeadMode === "showing",
    showing_date: currentLeadMode === "showing" ? $("showingDate").value : null,
    showing_time: currentLeadMode === "showing" ? $("showingTime").value : null,
    request_key: leadRequestKey,
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
    if (currentLeadMode === "showing" && result.showing_requested === false) currentLeadMode = "buyer_report";
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
    successTitle.textContent = "Showing + AI report requested.";
    successCopy.textContent = afterHours
      ? "Your request is saved for the next service window. A Realtor will confirm the earliest available appointment."
      : "A Realtor will contact you to confirm the earliest appointment available from the listing side.";
    successStepOne.textContent = "Showing request routed";
    successStepOneNote.textContent = afterHours ? "We will respond in the next 9 AM–9 PM service window." : "Realtor response target: within 5 minutes.";
  } else if (currentLeadMode === "buyer_report") {
    successTitle.textContent = "Your AI report is on its way.";
    successCopy.textContent = "Your request is saved. We’ll email the report when it is ready.";
    successStepOne.textContent = "No showing requested";
    successStepOneNote.textContent = "Choose a time from your report whenever you’re ready.";
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

function syncPriceCheckQuickStatus() {
  $("priceCheckQuickStatus").textContent = $("priceCheckBadge").textContent;
  $("priceCheckQuickStatus").className = $("priceCheckBadge").className;
}
function resetPriceCheck() {
  priceCheckSequence++;
  priceCheckController?.abort();
  $("priceCheckPanel").classList.add("hidden");
  $("priceCheckJump").classList.add("hidden");
  $("priceCheckBadge").className = "price-check-badge";
  $("priceCheckBadge").textContent = "Checking similar asking prices…";
  syncPriceCheckQuickStatus();
  $("priceCheckSummary").textContent = "Looking for similar homes in this exact community…";
  $("priceCheckDetails").open = false;
  $("priceCheckDetails").classList.add("hidden");
  $("priceCheckRetry").classList.add("hidden");
  for (const id of ["priceCheckNumbers", "priceCheckRange", "priceEvidence", "priceCheckCriteria", "priceCheckMatches", "priceCheckCoverage"]) $(id).innerHTML = "";
}
function renderAskingRange(data) {
  const range = data.observedAsking, target = $("priceCheckRange");
  if (!range || !(range.low > 0) || !(range.high >= range.low) || !(data.asking > 0)) { target.innerHTML = ""; return; }
  if (range.low === range.high) {
    const gap = data.asking - range.low;
    const comparison = gap === 0 ? "The asking prices are the same." : `This home asks ${money(Math.abs(gap))} ${gap < 0 ? 'less' : 'more'}.`;
    target.innerHTML = `<div class="price-picture"><div class="price-picture-subject"><span>THIS HOME IS ASKING</span><strong>${money(data.asking)}</strong></div><div class="price-picture-market price-picture-subject"><span>${data.count === 1 ? '1 SIMILAR HOME IS ASKING' : `${data.count} SIMILAR HOMES ARE ASKING`}</span><strong>${money(range.low)}</strong><p class="price-position-note">${comparison}</p></div></div><p class="price-picture-note">${data.count === 1 ? 'One listing is a comparison point, not a market range.' : 'The matched listings share the same asking price.'} Your email report compares completed sales.</p>`;
    return;
  }
  const position = data.asking < range.low ? 0 : data.asking > range.high ? 2 : 1;
  const positionText = position === 0 ? `Asking ${money(range.low-data.asking)} below this range.` : position === 2 ? `Asking ${money(data.asking-range.high)} above this range.` : "This home’s asking price is inside this range.";
  const graphic = ['Below range','Inside range','Above range'].map((label,i)=>`<div class="${i===position?'is-asking':''}"><small>${i===position?'THIS HOME':'&nbsp;'}</small>${label}</div>`).join('');
  target.innerHTML = `<div class="price-picture"><div class="price-picture-subject"><span>THIS HOME IS ASKING</span><strong>${money(data.asking)}</strong></div><div class="price-picture-market"><span>${data.count} SIMILAR HOMES · ASKING PRICE RANGE</span><div class="price-endpoints"><div><small>From</small><strong>${money(range.low)}</strong></div><div><small>To</small><strong>${money(range.high)}</strong></div></div><div class="price-position" role="img" aria-label="${positionText}">${graphic}</div><p class="price-position-note">${positionText}</p></div></div><p class="price-picture-note">These homes are still for sale. Your email report compares completed sales.</p>`;
}
function renderPriceCheck(data) {
  const recognized = ["below", "inline", "above", "review"].includes(data.signal);
  const available = data.available && recognized && data.count >= 3 && Number.isFinite(data.medianAsk) && data.medianAsk > 0 && Number.isFinite(data.differencePct);
  $("priceCheckBadge").className = `price-check-badge${available ? ` is-${data.signal}` : ""}`;
  $("priceCheckBadge").textContent = `${available && data.signal === "below" ? "✓ " : ""}${available ? data.label : data.count ? `${data.count} similar home${data.count===1?'':'s'}` : data.relatedMatches?.length ? `${data.relatedMatches.length} related home${data.relatedMatches.length===1?'':'s'} found` : "More evidence needed"}`;
  syncPriceCheckQuickStatus();
  const gap = Math.abs(data.differencePct);
  $("priceCheckSummary").textContent = available
    ? `${gap === 0 ? "At" : `${formatNumber(gap)}% ${data.differencePct < 0 ? "below" : "above"}`} the median asking price of ${data.count} matching active listings. ${data.signal === "review" ? data.reason : ""}`.trim()
    : data.count ? data.observedAsking && data.asking > data.observedAsking.high ? `This home asks ${money(data.asking - data.observedAsking.high)} more than the highest of these ${data.count} similar home${data.count===1?'':'s'}. Check whether ${data.sizeRule==='same_condo_size_range'?'condition, floor or view':'lot, condition or upgrades'} explain the difference.` : `${data.count} similar home${data.count===1?'':'s'} found in ${data.community || "this community"}. ${data.count===1?'Its asking price gives':'Their asking prices give'} you a starting point for comparison.` : data.relatedMatches?.length ? `${data.relatedMatches.length} same-community homes with different bedroom layouts. Shown for context; excluded from the price rating.` : data.reason || "There is not enough verified comparison data to assign a price label.";
  $("priceCheckNumbers").innerHTML = available ? `<div><span>MEDIAN ASKING PRICE</span><strong>${money(data.medianAsk)}</strong></div><div><span>SIMILAR HOMES</span><strong>${data.count}</strong></div>` : "";
  renderAskingRange(data);
  $("priceEvidence").textContent = data.count ? `${available && data.count >= 5 && !data.coverage?.partial ? "Broader asking-price sample" : "Limited asking-price sample"} · ${data.count} home${data.count===1?'':'s'}${data.community ? ` · ${data.community}` : ""}. ${available ? "This compares asking prices, not sale values." : "Too little consistent evidence for a price rating."}` : "No price rating yet. The listing highlights and showing checks are still useful.";
  $("priceCheckCriteria").textContent = data.criteria ? data.criteria : "";
  $("priceCheckMatches").innerHTML = (data.matches || []).map(home => `<a href="/?listingKey=${encodeURIComponent(home.listingKey)}#lookup"><span><strong>${escapeHtml(home.address)}</strong><small>${escapeHtml(home.size)} · ${escapeHtml(home.bedroomLayout || home.beds)} bed · ${home.differences?.length ? escapeHtml(home.differences.join(" · ")) : `${escapeHtml(home.baths ?? "—")} bath`} · MLS ${escapeHtml(home.listingKey)}<br>${escapeHtml(home.listingOffice || "Listing office not reported")}</small></span><b>${money(home.asking)}</b></a>`).join("");
  if (data.relatedMatches?.length) $("priceCheckMatches").innerHTML += `<h4>Related homes worth comparing</h4><p>Same community and home type, ${data.sizeRule==='same_condo_size_range'?'same interior size range':'similar size'}. Different bedroom layouts; excluded from the price signal.</p>${data.relatedMatches.map(home => `<a href="/?listingKey=${encodeURIComponent(home.listingKey)}#lookup"><span><strong>${escapeHtml(home.address)}</strong><small>${escapeHtml(home.size)} · ${escapeHtml(home.beds)} bed · ${escapeHtml(home.baths)} bath<br>${escapeHtml(home.difference)}<br>MLS ${escapeHtml(home.listingKey)} · ${escapeHtml(home.listingOffice || 'Listing office not reported')}</small></span><b>${money(home.asking)}</b></a>`).join('')}`;
  $("priceCheckCoverage").textContent = `${data.note || "Public IDX asking prices; not the entire market."}${data.coverage?.partial ? " The search reached its scan limit." : ""}${data.checkedAt ? ` Checked ${formatDate(data.checkedAt)}; may be cached for up to 5 minutes.` : ""}`;
  $("priceCheckDetails").classList.toggle("hidden", !data.criteria);
  $("priceCheckDetails").open = !!data.criteria;
}
async function loadPriceCheck(listing) {
  if (!listing?.forSale || listing.displayRestricted || !listing.listingKey) return;
  resetPriceCheck();
  $("priceCheckPanel").classList.remove("hidden");
  $("priceCheckJump").classList.remove("hidden");
  const sequence = priceCheckSequence, listingKey = listing.listingKey;
  priceCheckController = new AbortController();
  const controller = priceCheckController, timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`/api/price-check?listingKey=${encodeURIComponent(listingKey)}`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
    const data = await response.json();
    if (sequence !== priceCheckSequence || liveListing?.listingKey !== listingKey) return;
    if (!response.ok || !data.ok || data.listingKey !== listingKey) throw new Error(data.error || "Price Check could not verify the comparison data.");
    // Never attach a comparison based on a changed asking price to an old snapshot.
    if (data.asking > 0 && data.asking !== listing.listPrice) throw new Error("The asking price has changed. Check this home again to refresh its snapshot.");
    renderPriceCheck(data);
  } catch (error) {
    if (sequence !== priceCheckSequence) return;
    $("priceCheckBadge").textContent = "Price Check unavailable";
    syncPriceCheckQuickStatus();
    $("priceCheckSummary").textContent = error.name === "AbortError" ? "The comparison took too long. The listing facts are still available; no price label has been assigned." : error.message;
    $("priceCheckRetry").classList.remove("hidden");
  } finally { window.clearTimeout(timer); }
}
$("priceCheckRetry").addEventListener("click", () => { if (!loading) loadPriceCheck(liveListing); });

function resetHomeAssistant() {
  homeAiSequence++;
  homeAiController?.abort();
  $("homeAiAnswer").innerHTML = "";
  $("homeAiAnswer").classList.add("hidden");
  $("homeAiStatus").textContent = "Choose a question. No sign-up needed.";
  for (const button of document.querySelectorAll("[data-home-topic]")) { button.disabled = false; button.removeAttribute("aria-pressed"); }
}
async function loadHomeAssistant(topic, button = null) {
    if (!liveListing?.listingKey || !liveListing.forSale || liveListing.displayRestricted) return;
    resetHomeAssistant();
    const sequence = homeAiSequence;
    const listingKey = liveListing.listingKey;
    homeAiController = new AbortController();
    const controller = homeAiController;
    const timer = window.setTimeout(() => controller.abort(), 25000);
    button?.setAttribute("aria-pressed", "true");
    for (const question of document.querySelectorAll("[data-home-topic]")) question.disabled = true;
    $("homeAiStatus").textContent = "Preparing your property highlights…";
    const p = liveListing;
    $("homeAiAnswer").innerHTML = `<div><h4>The property</h4><p>${escapeHtml([p.propertySubType, p.livingAreaRange ? `${p.livingAreaRange} sq ft` : null, p.cityRegion].filter(Boolean).join(' · '))}</p></div><div><h4>At the showing</h4><p>We’re preparing the questions that matter for this listing.</p></div>`;
    $("homeAiAnswer").classList.remove("hidden");
    try {
      const response = await fetch("/api/home-assistant", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ listingKey, topic }), signal: controller.signal });
      const data = await response.json();
      if (sequence !== homeAiSequence || liveListing?.listingKey !== listingKey) return;
      if (!response.ok || !data.ok || data.listingKey !== listingKey) throw new Error(data.error || "The assistant is temporarily unavailable. Your listing facts are still below.");
      $("homeAiStatus").textContent = data.mode === "ai" ? "AI highlights · grounded in this listing" : "Listing highlights · AI unavailable";
      const rows = (items) => (items || []).slice(0, 2).map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></li>`).join("");
      $("homeAiAnswer").innerHTML = `<div><h4>${topic === 'costs' ? 'Costs to plan for' : 'What matters here'}</h4><ul>${rows(data.facts)}</ul></div><div><h4>Ask at the showing</h4><ul>${rows(data.checks)}</ul></div>`;
      $("homeAiAnswer").classList.remove("hidden");
    } catch (error) {
      if (sequence !== homeAiSequence) return;
      $("homeAiStatus").textContent = error.name === "AbortError" ? "The assistant took too long. Try again, or review the listing facts below." : error.message;
    } finally {
      window.clearTimeout(timer);
      if (sequence === homeAiSequence) for (const question of document.querySelectorAll("[data-home-topic]")) question.disabled = false;
    }
}
for (const button of document.querySelectorAll("[data-home-topic]")) {
  button.addEventListener("click", () => { if (!loading) loadHomeAssistant(button.dataset.homeTopic, button); });
}

// Discovery only opens public snapshots. It never submits a lead or sends a report.
const discoveryModes = {
  new: { title: "Just Listed", description: "A fresh shortlist from the past 7 days. Choose a home for its AI snapshot." },
  luxury: { title: "Luxury Homes", description: "A selection of homes asking $2 million or more. Refine the city and home type." },
  budget: { title: "Search by Budget", description: "Homes within your asking-price limit. Adjust the budget to make this shortlist yours." }
};
let discoveryMode = "new";
let discoveryController = null;
let discoverySequence = 0;
const discoveryForm = $("discoveryForm");
function resetDiscoveryResults() {
  discoverySequence++;
  discoveryController?.abort();
  $("discoverySubmit").disabled = false;
  $("discoverySubmit").textContent = "Find my shortlist";
  $("discoveryResults").innerHTML = "";
  $("discoveryCoverage").textContent = "";
  $("discoveryStatus").textContent = "Refine your search or choose a collection above.";
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
    if (tile.dataset.discovery === "budget" && !$("discoveryBudget").value) $("discoveryBudget").value = "1500000";
    discoveryForm.requestSubmit();
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
  const timer = window.setTimeout(() => controller.abort(), 30000);
  const params = new URLSearchParams({ mode: discoveryMode, city: $("discoveryCity").value, type: $("discoveryType").value });
  if ($("discoveryBudget").value) params.set("maxPrice", $("discoveryBudget").value);
  $("discoverySubmit").disabled = true;
  $("discoverySubmit").textContent = "Checking…";
  $("discoveryStatus").textContent = "Checking public listings…";
  try {
    const response = await fetch(`/api/recommendations?${params}`, { headers: { Accept: "application/json" }, signal: controller.signal });
    const data = await response.json();
    if (sequence !== discoverySequence) return;
    if (!response.ok || !data.ok || !Array.isArray(data.listings)) throw new Error(data.error || "Listing search is temporarily unavailable.");
    $("discoveryStatus").textContent = data.listings.length ? `${data.selectionMode === "ai" ? "AI shortlist" : "Matched shortlist"} · ${data.listings.length} home${data.listings.length === 1 ? "" : "s"}. Open a home to explore.` : "No matches in the listings checked. This is not a full-market search. Try another type or budget, or check an address directly.";
    $("discoveryResults").innerHTML = data.listings.map((home) => {
      const badge = discoveryMode === "luxury" ? "Asking $2M+" : home.daysLive != null ? `${home.daysLive} days on this listing` : "Active listing";
      const facts = [home.propertySubType, home.beds != null ? `${home.bedroomLayout || home.beds} bed` : null, home.baths != null ? `${home.baths} bath` : null].filter(Boolean).join(" · ");
      const photo = typeof home.photoUrl === 'string' && home.photoUrl.startsWith('/api/discovery-photo?listingKey=') ? `<img src="${escapeAttr(home.photoUrl)}" alt="${escapeAttr(home.address)}" loading="lazy" decoding="async" />` : '';
      return `<article class="discovery-home"><a class="discovery-photo" href="/?listingKey=${encodeURIComponent(home.listingKey)}#lookup" data-open-listing="${escapeAttr(home.listingKey)}" aria-label="Explore ${escapeAttr(home.address)}"><span class="photo-fallback">Photo unavailable · explore the home</span>${photo}<span class="home-badge">${escapeHtml(badge)}</span></a><div class="discovery-home-content"><strong class="home-price">${money(home.listPrice)}</strong><h4>${escapeHtml(home.address)}</h4><p>${escapeHtml(facts)}</p>${home.selectionReason ? `<p class="selection-reason"><span aria-hidden="true">✦</span> ${escapeHtml(home.selectionReason)}</p>` : ''}<small>${escapeHtml(home.listingOffice || "Listing office not reported")} · MLS ${escapeHtml(home.listingKey)}</small><a class="discovery-open" href="/?listingKey=${encodeURIComponent(home.listingKey)}#lookup" data-open-listing="${escapeAttr(home.listingKey)}">Explore this home →</a></div></article>`;
    }).join("");
    $("discoveryCoverage").textContent = `${data.note || "Results are a selection, not the full market."} ${data.coverage?.partial ? "The search reached its scan limit. " : ""}${data.coverage?.moreMatches ? "Refine your filters to explore another shortlist. " : ""}${data.checkedAt ? `Checked ${formatDate(data.checkedAt)}; results may be cached for up to 5 minutes.` : ""}`;
  } catch (error) {
    if (sequence !== discoverySequence) return;
    $("discoveryStatus").textContent = error.name === "AbortError" ? "The search took too long. Try again, or check an address directly." : error.message || "Unable to check listings. Please try again.";
  } finally {
    window.clearTimeout(timer);
    if (sequence === discoverySequence) { $("discoverySubmit").disabled = false; $("discoverySubmit").textContent = "Find my shortlist"; }
  }
});
$("discoveryResults").addEventListener("click", (event) => {
  const link = event.target.closest("[data-open-listing]");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (loading) return;
  history.pushState(null, "", `/?listingKey=${encodeURIComponent(link.dataset.openListing)}#lookup`);
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
else {
  const linkedQuery = new URLSearchParams(window.location.search).get("q");
  if (linkedQuery && linkedQuery.length <= 500) { propertyInput.value = linkedQuery; analysisForm.requestSubmit(); }
}

$("discoveryResults").addEventListener("error", event => {if(event.target?.tagName==='IMG'){event.target.style.display='none';}},true);
if(typeof IntersectionObserver!=='undefined'){
  const shortlistObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){shortlistObserver.disconnect();if(!$("discoveryResults").innerHTML && !$("discoverySubmit").disabled){openDiscovery(discoveryMode,false);discoveryForm.requestSubmit();}}},{rootMargin:'250px'});
  shortlistObserver.observe($("explore"));
}
