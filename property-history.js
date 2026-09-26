const date=value=>{const n=Date.parse(value||'');return Number.isFinite(n)&&n<=Date.now()+864e5?new Date(n).toISOString().slice(0,10):null;};
export function historyEvent(row){
  const status=[row.MlsStatus,row.StandardStatus,row.ContractStatus].filter(Boolean).join(' / ');
  const sold=/sold|closed|deal firm/i.test(status)&&!/conditional|sold cond|lease|rent|terminat|cancel|expir|withdraw/i.test(status+' '+(row.TransactionType||''));
  return {listingKey:row.ListingKey||null,status:status||'Recorded listing',transaction:row.TransactionType||null,
    listedDate:date(row.ListingContractDate||row.OnMarketDate||row.OriginalEntryTimestamp),
    recordedAt:date(row.OriginalEntryTimestamp||row.ListingContractDate||row.OnMarketDate),
    soldDate:sold?date(row.PurchaseContractDate||row.SoldDate||row.CloseDate||row.ClosingDate):null,
    soldPrice:sold&&Number(row.ClosePrice||row.SoldPrice||row.SalePrice)>50000?Number(row.ClosePrice||row.SoldPrice||row.SalePrice):null};
}
export function summarizePropertyHistory(events=[],options={}){
  const cutoff=new Date();cutoff.setUTCFullYear(cutoff.getUTCFullYear()-5);const since=cutoff.toISOString().slice(0,10);
  const byId=new Map();
  for(const e of events)if(e?.listingKey){const old=byId.get(e.listingKey);byId.set(e.listingKey,{...old,...e});}
  const records=[...byId.values()].filter(e=>!/lease|rent/i.test((e.transaction||'')+' '+(e.status||'')));
  const rentals=[...byId.values()].filter(e=>/lease|rent/i.test((e.transaction||'')+' '+(e.status||''))&&e.listedDate&&e.listedDate>=since);
  const recent=records.filter(e=>e.listedDate&&e.listedDate>=since);
  const counts={listed:recent.length,terminated:0,cancelled:0,expired:0,withdrawn:0};
  for(const e of recent){const s=e.status||'';if(/terminat/i.test(s))counts.terminated++;else if(/cancel/i.test(s))counts.cancelled++;else if(/expir/i.test(s))counts.expired++;else if(/withdraw/i.test(s))counts.withdrawn++;}
  const sales=records.filter(e=>e.soldDate).sort((a,b)=>b.soldDate.localeCompare(a.soldDate));
  const lastSold=sales[0]?{date:sales[0].soldDate,year:Number(sales[0].soldDate.slice(0,4)),price:sales[0].soldPrice||null,listingKey:sales[0].listingKey}:null;
  const outcomes=['terminated','cancelled','expired','withdrawn'].filter(k=>counts[k]).map(k=>`${counts[k]} ${k}`).join(', ');
  const activity=recent.length?`At least ${counts.listed} distinct MLS sale listing${counts.listed===1?'':'s'} recovered in the past five years${outcomes?'; '+outcomes:''}.`:'No dated sale listings recovered for the past five years.';
  const sale=lastSold?`Last recorded sale found: ${lastSold.date}${lastSold.price?' for $'+lastSold.price.toLocaleString('en-CA'):''} (MLS ${lastSold.listingKey}).`:'A previous completed sale date was not recovered.';
  const rentalNote=rentals.length?` Also ${rentals.length} distinct rental listing${rentals.length===1?'':'s'} recovered in this period.`:'';
  return {years:5,since,counts,lastSold,records,rentalListingCount:rentals.length,coverage:'recovered_records_only',retrievalComplete:options.complete===true,summary:`${activity} ${sale}${rentalNote} Available MLS history may be incomplete.`};
}
