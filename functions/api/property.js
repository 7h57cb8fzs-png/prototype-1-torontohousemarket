export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const listingKey = (url.searchParams.get("listingKey") || "").trim().toUpperCase();

  if (!/^[A-Z]\d{7,9}$/.test(listingKey)) {
    return json({ ok: false, error: "Valid MLS number required." }, 400);
  }

  if (!env.AMPRE_TOKEN) {
    return json({ ok: false, error: "IDX connection is not configured." }, 503);
  }

  const select = [
    "ListingKey","UnparsedAddress","City","PostalCode","ListPrice","StandardStatus",
    "TransactionType","PropertyType","PropertySubType","BedroomsTotal",
    "BathroomsTotalInteger","LivingAreaRange","LotWidth","LotDepth","ParkingTotal",
    "GarageType","Basement","KitchensTotal","PublicRemarks","OriginalEntryTimestamp",
    "ModificationTimestamp","InternetAddressDisplayYN","InternetEntireListingDisplayYN"
  ].join(",");

  const endpoint = `https://query.ampre.ca/odata/Property('${encodeURIComponent(listingKey)}')?$select=${select}`;

  const response = await fetch(endpoint, {
    headers: {
      "Authorization": `Bearer ${env.AMPRE_TOKEN}`,
      "Accept": "application/json"
    }
  });

  if (response.status === 404) return json({ ok: false, error: "Listing not found." }, 404);
  if (!response.ok) return json({ ok: false, error: "Unable to load MLS listing." }, 502);

  const p = await response.json();

  if (p.InternetAddressDisplayYN === false || p.InternetEntireListingDisplayYN === false) {
    return json({ ok: false, error: "This listing is not permitted for full internet display." }, 403);
  }

  const property = {
    listingKey: p.ListingKey,
    address: p.UnparsedAddress,
    city: p.City,
    postalCode: p.PostalCode,
    listPrice: p.ListPrice,
    status: p.StandardStatus,
    transactionType: p.TransactionType,
    propertyType: p.PropertyType,
    propertySubType: p.PropertySubType,
    beds: p.BedroomsTotal,
    baths: p.BathroomsTotalInteger,
    livingAreaRange: p.LivingAreaRange,
    lotWidth: p.LotWidth,
    lotDepth: p.LotDepth,
    parkingTotal: p.ParkingTotal,
    garageType: p.GarageType,
    basement: p.Basement,
    kitchensTotal: p.KitchensTotal,
    remarks: p.PublicRemarks,
    originalEntryTimestamp: p.OriginalEntryTimestamp,
    modificationTimestamp: p.ModificationTimestamp
  };

  return json({ ok: true, property }, 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
