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

// Consistency check only. A prior transaction never sets the calculated value.
export function reviewRecentSale(report){
  const sale=report.property_history?.lastSold,value=Number(report.valuation?.midpoint);
  const age=(Date.parse(report.generated_at||new Date().toISOString())-Date.parse(sale?.date||''))/864e5;
  if(!report.valuation?.available||!(sale?.price>50000)||!(value>0)||age<0||age>90)return report;
  const gap=(value/sale.price-1)*100;if(Math.abs(gap)<20)return report;
  const note=`The estimate is ${Math.round(Math.abs(gap))}% ${gap>0?'above':'below'} this property's recorded ${sale.date} sale at $${sale.price.toLocaleString('en-CA')}. Verify the transaction terms, condition and comparable selection before relying on the estimate.`;
  return {...report,review_flags:[...(report.review_flags||[]),{code:'recent_subject_sale_gap',differencePct:Math.round(gap),note}],
    valuation:{...report.valuation,confidence:'Limited',requiresReview:true},
    evidence_quality:{...(report.evidence_quality||{}),label:'Limited'},
    decision_summary:{...(report.decision_summary||{}),headline:'Estimate needs review',evidence_confidence:'Limited'},
    value_rating:{available:false,score:null,label:'Review recent sale',reason:note}};
}

export function reviewSpecialUse(report,property={}){
  const remarks=String(property.remarks||'');
  const specialised=/\b(?:land assembly|development site|re[ -]?development opportunity|severance approved|approved severance|tear[ -]?down)\b/i.test(remarks)||/\b(?:approved|zoned|rezoning)\b[^.!?]{0,110}\b(?:townhomes?|townhouses?|four[ -]unit|\d+[ -]unit|multiplex|mixed[ -]use|commercial|redevelopment)\b/i.test(remarks);
  if(!specialised)return report;
  const note='The listing describes development or zoning potential. Ordinary residential sales do not establish the value of those rights. Verify the planning claims and obtain a specialist pricing review.';
  return {...report,review_flags:[...(report.review_flags||[]),{code:'special_use_review',note}],
    valuation:{...(report.valuation||{}),available:false,low:null,midpoint:null,high:null,estimated_market_value:null,market_value:null,likely_market_range:{low:null,high:null},confidence:'Limited',requiresReview:true,basis:note},
    value_rating:{available:false,score:null,label:'Specialist review',reason:note},
    narrative:{...(report.narrative||{}),executive_summary:note,market_read:note,buyer_strategy:'Ask the listing team for the planning documents, permitted uses and development-specific evidence before making a pricing decision.'}};
}

// Relative condo elevation is not established by a unit number or a penthouse
// label. The current comparable payload has no verified relative-floor field.
// Preserve real transactions, but prevent unsupported model claims pricing them.
export function reviewElevationAdjustments(report){
  const unsupported=/\b(?:higher[ -]floor|lower[ -]floor|lower recorded unit position|(?:more advantageous|superior)[^.!?]{0,50}(?:floor|elevation))\b/i;
  const hasClaim=c=>unsupported.test(String(c.expertAdjustmentReason||'')+' '+String(c.expertSelectionReason||''));
  if(!(report.comparables||[]).some(hasClaim))return report;
  const note='Some model adjustments rely on floor or elevation differences that the supplied records do not establish. Verify the relevant unit floors and views before a price estimate is issued.';
  const cleanReason=value=>String(value||'').split(/(?<=[.!?])\s+/).filter(s=>!unsupported.test(s)).join(' ');
  const comparables=report.comparables.map(c=>hasClaim(c)?{...c,adjustedIndication:null,subject_indication:null,adjustmentRequiresReview:true,expertSelectionReason:cleanReason(c.expertSelectionReason)||'Recorded sale retained for context.',expertAdjustmentReason:note,why_it_matters:cleanReason(c.expertSelectionReason)||'Recorded sale retained for context.'}:c);
  return {...report,comparables,review_flags:[...(report.review_flags||[]),{code:'unverified_elevation_adjustment',note}],
    valuation:{...(report.valuation||{}),available:false,low:null,midpoint:null,high:null,estimated_market_value:null,market_value:null,likely_market_range:{low:null,high:null},confidence:'Limited',requiresReview:true,basis:note},
    value_rating:{available:false,score:null,label:'Verify unit differences',reason:note},
    narrative:{...(report.narrative||{}),executive_summary:note},
    expert_comp_mode:{...(report.expert_comp_mode||{}),marketRead:note,evidence_only:true}};
}
