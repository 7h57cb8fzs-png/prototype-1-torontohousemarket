// Reviewed historic subject facts only. Sale prices never enter this store.
export function sellerArchiveKey(parsed, city) {
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return [parsed.number,parsed.name,parsed.suffix,parsed.direction,parsed.unit,city||parsed.city].map(norm).join('|');
}
export function validatedArchive(row, parsed, city, exactMatch) {
  if (!row?.verified_at || !row.source_date || !row.facts || Date.parse(row.source_date)>Date.now()) return null;
  let source;try{source=new URL(row.source_url);if(source.protocol!=='https:')return null;}catch{return null;}
  const allowed=['UnparsedAddress','StreetNumber','StreetName','StreetSuffix','StreetDirSuffix','UnitNumber','City','CityRegion','PostalCode','PropertySubType','LivingAreaRange','BedroomsAboveGrade','BedroomsBelowGrade','BedroomsTotal','BathroomsTotalInteger','LotWidth','LotDepth','LotSizeUnits','Basement','KitchensTotal'];
  const facts=Object.fromEntries(allowed.filter(k=>row.facts[k]!=null).map(k=>[k,row.facts[k]]));
  if (!exactMatch(parsed,facts,city) || !['Detached','Semi-Detached','Att/Row/Townhouse','Condo Apartment','Condo Townhouse','Duplex'].includes(facts.PropertySubType)) return null;
  const archive={sourceUrl:source.href,sourceLabel:String(row.source_label||'Public archived listing').slice(0,120),recordedAt:row.source_date,verifiedAt:row.verified_at};
  return {...facts,ListingKey:'archive:'+row.id,StandardStatus:'Unknown',_sellerArchive:archive,_sellerHistory:[],_sellerHistoryComplete:true,_sellerFactSources:Object.fromEntries(Object.keys(facts).map(k=>[k,source.href]))};
}
