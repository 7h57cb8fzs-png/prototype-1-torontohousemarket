// Report-only extraction: never returns raw brokerage remarks or changes valuation.
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const datePattern=/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b|\b20\d{2}-\d{2}-\d{2}\b/gi;
const timePattern=/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/gi;
function torontoParts(now){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));}
function parseDate(text,anchor){
 let year,month,day,explicitYear=true;
 if(/^20\d{2}-/.test(text)){[year,month,day]=text.split('-').map(Number);}else{month=months.indexOf(text.slice(0,3).toLowerCase())+1;day=Number(text.match(/\d{1,2}/)?.[0]);year=Number(text.match(/20\d{2}/)?.[0]);explicitYear=!!year;}
 if(!year){const base=Date.parse(anchor||'');if(!Number.isFinite(base))return null;const y=new Date(base).getUTCFullYear();year=[y-1,y,y+1].sort((a,b)=>Math.abs(Date.UTC(a,month-1,day)-base)-Math.abs(Date.UTC(b,month-1,day)-base))[0];}
 const date=new Date(Date.UTC(year,month-1,day));if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
 return {iso:date.toISOString().slice(0,10),label:date.toLocaleDateString('en-CA',{timeZone:'UTC',month:'long',day:'numeric',...(explicitYear?{year:'numeric'}:{})})};
}
export function extractOfferInstructions(record,now=new Date()){
 const entries=[];let ambiguous=false;
 for(const [field,value] of Object.entries(record||{})){
  if(!/^(?:PrivateRemarks|BrokerageRemarks|BrokerRemarks|RemarksForBrokerages|OfferRemarks|OfferRemark|OfferPresentationRemarks|PublicRemarks|PublicRemarksExtras)$/i.test(field)||typeof value!=='string')continue;
  for(let clause of value.split(/;|\n|[.!?]\s+(?=[A-Z])/)){
   // Exclude acceptance-expiry instructions, even when appended to an offer sentence.
   clause=clause.split(/\birrevocab\w*\b/i)[0];
   if(!/\boffers?\b|presentation/i.test(clause)||!/present|review|consider|accept|submit|register|deadline|offers?\s+(?:on|date|by|at|due|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(clause))continue;
   const dates=[...clause.matchAll(datePattern)];if(!dates.length)continue;
   if(dates.length>1){ambiguous=true;continue;}
   const date=parseDate(dates[0][0],record.ModificationTimestamp||record.ListingContractDate);if(!date){ambiguous=true;continue;}
   const times=[...clause.matchAll(timePattern)];if(times.length>1){ambiguous=true;continue;}
   let time=null,clock=null;
   if(times.length){const [,h,m='00',ap]=times[0],hour=Number(h),minute=Number(m);if(hour<1||hour>12||minute>59){ambiguous=true;continue;}clock=String(hour%12+(ap.toLowerCase()==='p'?12:0)).padStart(2,'0')+':'+String(minute).padStart(2,'0');time=`${hour}:${String(minute).padStart(2,'0')} ${ap.toUpperCase()}M`;}
   entries.push({...date,time,clock});
  }
 }
 const days=new Set(entries.map(e=>e.iso)),times=new Set(entries.map(e=>e.clock).filter(Boolean));
 if(ambiguous||days.size>1||times.size>1)return {type:'unclear'};
 if(!entries.length)return null;
 const e=entries.find(e=>e.time)||entries[0],p=torontoParts(now),today=`${p.year}-${p.month}-${p.day}`;
 return {type:'scheduled',date:e.label,time:e.time,dateIso:e.iso,past:e.iso<today||e.iso===today&&!!e.clock&&e.clock<`${p.hour}:${p.minute}`};
}
export function offerEmailLines(report){
 const o=report?.facts?.offer_instructions;if(!o)return [];
 if(o.type==='unclear')return ['Confirm offer date and time with our team.'];
 if(o.type!=='scheduled'||!o.date)return [];
 const lines=[`${o.past?'Previously stated offer date':'Offer date'}: ${o.date}${o.time?' at '+o.time+' (Toronto time)':' · Time not specified'}.`,'Confirm current offer instructions with our team.'];
 const v=report.valuation||{},ask=Number(report.facts.list_price);
 if(v.available===true&&Number.isFinite(ask)&&ask>0&&Number.isFinite(Number(v.low))&&ask<Number(v.low))lines.push('The asking price is below the range supported by comparable sales and may reflect an offer-date strategy. It may not represent the seller’s expected selling price.');
 return lines;
}
