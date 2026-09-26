// Seller valuation evidence boundary. Never import questionnaire fields here.
const number = value => value === null || value === undefined || value === "" || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
export function historicalSellerProperty(raw, address, parsed) {
  const r = raw || {};
  const basement = Array.isArray(r.Basement) ? r.Basement.join(" · ") : text(r.Basement);
  return {
    address, listingKey: r.ListingKey || null,
    propertySubType: text(r.PropertySubType) || "unknown", propertyType: text(r.PropertyType),
    city: text(r.City) || parsed.city || "", cityRegion: text(r.CityRegion), postalCode: text(r.PostalCode),
    livingAreaRange: text(r.LivingAreaRange), buildingAreaTotal: number(r.BuildingAreaTotal), buildingAreaUnits: text(r.BuildingAreaUnits),
    beds: number(r.BedroomsAboveGrade) ?? number(r.BedroomsTotal), belowGradeBeds: number(r.BedroomsBelowGrade),
    bedroomBasis: number(r.BedroomsAboveGrade) !== null ? "MLS above-grade" : number(r.BedroomsTotal) !== null ? "MLS total; above-grade breakdown unknown" : "Unknown",
    baths: number(r.BathroomsTotalInteger), lotWidth: number(r.LotWidth), lotDepth: number(r.LotDepth), lotSizeUnits: text(r.LotSizeUnits),
    kitchens: number(r.KitchensTotal) ?? number(r.KitchensAboveGrade), basement: basement || "unknown",
    separateEntrance: r.SeparateEntranceYN === true || /separate\s+entrance/i.test(basement || "") ? "yes" : r.SeparateEntranceYN === false ? "no" : "unknown",
    parkingTotal: number(r.ParkingTotal), garageType: text(r.GarageType),
    architecturalStyle: r.ArchitecturalStyle ?? null,
    // Historical remarks remain attributed historical claims, never an inspection.
    remarks: text(r.PublicRemarks),
  };
}
export function historicalSellerProfile(property = {}) {
  return {
    version: 4, source: "historical_mls", homeType: property.propertySubType || "unknown",
    city: property.city || "", community: property.cityRegion || "", postal: property.postalCode || "",
    sizeBand: property.livingAreaRange || "unknown", beds: property.beds ?? null,
    belowBeds: property.belowGradeBeds ?? null, basement: property.basement || "unknown",
    entrance: property.separateEntrance || "unknown", kitchens: property.kitchens ?? null,
    condition: "unknown", renovationPct: null, upgrades: [], targetPrice: null,
    targetMin: null, targetMax: null, timing: "exploring", notes: ""
  };
}
