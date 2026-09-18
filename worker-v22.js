import { homeChat } from './home-chat.js';
import { homeSearch } from './discovery-search.js';
import legacyApp, { deliverEmailJob } from './worker-v11.js';
import reportCore, { processV7ReportJobs } from './worker-v12.js';
import { reportFetch } from './report-runtime.js';

const VERSION='version-7.4-history-search-20260918';
const LUNA='gpt-5.6-luna';
const TERRA='gpt-5.6-terra';
const OPENAI='https://api.openai.com/v1/responses';
const AUTOMATION_ROUTES=new Set(['/api/lead','/api/vow/accept-terms','/api/vow/activate-request']);

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/home-chat' && request.method==='POST') return homeChat(request,env,ctx,legacyApp);
    if(url.pathname==='/api/home-search' && request.method==='GET') return homeSearch(request,env,ctx,legacyApp);
    if(url.pathname==='/api/version') return json({
      ok:true,version:VERSION,release:'7.4',chat_model:LUNA,chat_search:'neighbourhood and brokerage scoped MLS queries',
      valuation:'Estimated Market Value + Likely Market Range',
      candidate_policy:'broad VOW evidence when strict evidence is insufficient; structural attributes are relevance signals',
      openai_policy:'Luna first; Terra only for compound severe complexity',
      scheduler:'single report pipeline; no duplicate nested scheduler',
      seller_condition:'native 0-100 renovation context; no fixed renovation markup',
      address_input:'shared buyer/seller touch-first suggestions; condo unit-first input preserved'
    });

    // Static assets and normal property/address APIs go straight to the stable base.
    // This intentionally bypasses the old /seller.js runtime-injection wrapper.
    if(!AUTOMATION_ROUTES.has(url.pathname)) return legacyApp.fetch(request,env,ctx);

    // One owner for report generation. Lower-layer email delivery is suppressed;
    // V7.3 decorates the completed report before releasing its email.
    const pending=[];
    const proxy={waitUntil(p){pending.push(Promise.resolve(p));}};
    const response=await reportCore.fetch(request,coreEnv(env),proxy);
    if(response.ok) ctx?.waitUntil?.((async()=>{
      await drain(pending);
      // Reports are finalized atomically before save; no second AI pass.
      await emails(env,10);
    })());
    return response;
  },

  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      await rpc(env, 'recover_stale_report_jobs', {});
      await rpc(env, 'queue_overdue_sla_notifications', {}).catch(()=>null);
      await emails(env,20);
      // Drain short bursts on Workers Paid, releasing each email as soon as its
      // atomically claimed report is ready. A new cron may safely claim other jobs.
      for(let i=0;i<3;i++){
        const result=await processV7ReportJobs(coreEnv(env),1);
        await emails(env,20);
        if(!result.claimed)break;
      }
    })());
  }
};

function coreEnv(env){return {...env,GEMINI_API_KEY:null,OPENROUTER_API_KEY:null,AI:null,OPENAI_MODEL:LUNA,OPENAI_EXTERNAL_COMP_SEARCH:'false',RESEND_API_KEY:null,THM_REPORT_SCHEDULED_ONLY:true,THM_FINALIZE_REPORT: finalizePayload};}

async function finalizePayload(report,env){
  let p=decorate(report),cx=complexity(p);
  p.model_policy={primary:LUNA,terra_review:false,terra_threshold:'compound severe complexity only',complexity_score:cx.score,complexity_flags:cx.flags};
  if(cx.escalate && p.comparables?.length>=3 && env.OPENAI_API_KEY){try{p=applyTerra(p,await terra(env,p),cx);}catch(e){p.model_policy.terra_error=String(e?.message||e).slice(0,200);}}
  p.version=7.4;p.version_label='Toronto House Market Version 7.4';
  p.ai_note=p.model_policy.terra_review?'Version 7.4 · exceptional-complexity Terra review':'Version 7.4 · primary path; Terra not used';
  return p;
}

async function drain(pending){
  let rounds=0;
  while(pending.length&&rounds<50){
    const batch=pending.splice(0,pending.length);
    const results=await Promise.allSettled(batch);
    for(const r of results) if(r.status==='rejected') console.error(JSON.stringify({event:'v73_waituntil_error',error:String(r.reason?.message||r.reason).slice(0,300)}));
    rounds++;
  }
  if(pending.length) console.error(JSON.stringify({event:'v73_waituntil_drain_limit',remaining:pending.length,rounds}));
}

function decorate(src){
  const p=JSON.parse(JSON.stringify(src||{})),f=p.facts||{},cs=Array.isArray(p.comparables)?p.comparables:[],st=normType(f.property_type||f.propertyType),sa=String(f.address||'').toLowerCase();
  const vs=cs.map(c=>{const v=num(c.adjustedIndication,c.adjustedPrice,c.adjusted_indication,c.soldPrice);if(!v)return null;let w=1;if(st&&normType(c.propertySubType||c.type)===st)w+=.65;if(sameBuilding(sa,String(c.address||'').toLowerCase()))w+=1.15;if((f.neighbourhood||f.cityRegion)&&c.cityRegion&&norm(f.neighbourhood||f.cityRegion)===norm(c.cityRegion))w+=.35;return{v,w};}).filter(Boolean);
  if(vs.length>=3 && (p.report_type!=="THM Seller Price Perspective" || (p.seller?.evidence?.subjectMatched ?? p.seller?.evidence?.listingMatched))){
    const mv=round(weightedMedian(vs)),disp=vs.reduce((s,x)=>s+x.w*Math.abs(x.v-mv)/mv,0)/vs.reduce((s,x)=>s+x.w,0),old=String(p.valuation?.confidence||'').toLowerCase(),base=p.seller?.evidence?.archiveSubject?.sourceUrl ? .125:old==='moderate'?.04:old==='strong'||old==='high'?.025:.065,pct=Math.max(base,Math.min(p.seller?.evidence?.archiveSubject?.sourceUrl ? .20:.10,disp*1.35)),low=round(mv*(1-pct)),high=round(mv*(1+pct));
    p.valuation={...(p.valuation||{}),available:true,estimated_market_value:mv,market_value:mv,midpoint:mv,low,high,likely_market_range:{low,high},range_basis:'Evidence dispersion + confidence; not a fixed percentage.'};
  }
  const sameType=cs.filter(c=>normType(c.propertySubType||c.type)===st).length,sameB=cs.filter(c=>sameBuilding(sa,String(c.address||'').toLowerCase())).length,large=cs.filter(c=>{const s=num(c.soldPrice),a=num(c.adjustedIndication,c.adjustedPrice,c.adjusted_indication);return s&&a&&Math.abs(a-s)/s>=.15;}).length;
  let q='Limited';if(cs.length>=4&&large<=1&&(sameType>=3||sameB>=2))q='Strong';else if(cs.length>=3&&large<=2)q='Moderate';
  if (/^(low|limited)$/i.test(p.valuation?.confidence||'') || p.comparable_policy?.retrievalCapped || p.comparable_policy?.expandedWindow || p.comparable_policy?.sizeFallbackUsed || p.seller?.evidence?.archiveSubject) q='Limited';
  p.evidence_quality={label:q,candidate_count:num(p.comparable_policy?.candidateCount,p.expert_comp_mode?.candidateCount),selected_count:cs.length,same_subtype_selected:sameType,same_building_selected:sameB,large_adjustment_count:large};
  if(p.valuation)p.valuation.confidence=q;
  const value=num(p.valuation?.estimated_market_value,p.valuation?.midpoint),ask=num(f.list_price,f.listPrice);
  p.decision_summary={headline:value?'Estimated Market Value':'Insufficient market evidence',estimated_market_value:value,likely_market_range:{low:p.valuation?.low||null,high:p.valuation?.high||null},asking_price:ask,asking_vs_value_pct:value&&ask?Math.round((ask-value)/value*1000)/10:null,evidence_confidence:q,market_read:p.narrative?.market_read||p.narrative?.executive_summary||p.seller?.strategy?.independent_market_read||null,strategy:p.narrative?.buyer_strategy||p.seller?.strategy?.listing_strategy||null};
  p.comparables=cs.map((c,i)=>({...c,display_rank:i+1,why_it_matters:c.expertSelectionReason||c.selection_reason||null,recorded_sold_price:c.soldPrice||null,subject_indication:c.adjustedIndication||c.adjustedPrice||c.adjusted_indication||null}));
  return p;
}

function complexity(p){
  const e=p.evidence_quality||{},flags=[],sel=Number(e.selected_count||0),cand=Number(e.candidate_count||0),large=Number(e.large_adjustment_count||0);
  if(String(e.label).toLowerCase()==='limited')flags.push('limited_confidence');
  if(sel<3)flags.push('fewer_than_3_sales');
  if(cand>0&&cand<8)flags.push('very_small_vow_pool');
  if(large>=3)flags.push('3plus_large_adjustments');
  if(sel&&large/sel>=.6)flags.push('majority_large_adjustments');
  if(e.same_subtype_selected===0&&e.same_building_selected===0)flags.push('no_structural_anchor');
  const v=(p.comparables||[]).map(c=>num(c.adjustedIndication,c.adjustedPrice,c.adjusted_indication)).filter(Boolean);
  if(v.length>=3&&(Math.max(...v)-Math.min(...v))/median(v)>=.22)flags.push('indications_conflict_22pct');
  const severe=flags.filter(x=>['fewer_than_3_sales','very_small_vow_pool','majority_large_adjustments','indications_conflict_22pct'].includes(x)).length,score=flags.length+severe;
  return{flags,score,escalate:severe>=1&&flags.length>=4&&score>=6};
}

async function terra(env,p){
  const schema={type:'object',additionalProperties:false,properties:{estimated_market_value:{type:'number'},range_low:{type:'number'},range_high:{type:'number'},confidence:{type:'string',enum:['Moderate','Low','Limited']},market_read:{type:'string'},strategy:{type:'string'}},required:['estimated_market_value','range_low','range_high','confidence','market_read','strategy']};
  const r=await reportFetch(env,OPENAI,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(22000),body:JSON.stringify({model:TERRA,reasoning:{effort:'medium'},input:[{role:'system',content:'Final adjudication only for an exceptionally complex residential valuation. Use only supplied genuine MLS evidence. Never invent sales. Determine Estimated Market Value first, then uncertainty range. Return JSON only.'},{role:'user',content:JSON.stringify({subject:p.facts,evidence_quality:p.evidence_quality,comparables:(p.comparables||[]).slice(0,8)})}],text:{format:{type:'json_schema',name:'thm_v73_terra',strict:true,schema}}})});
  const d=await r.json();if(!r.ok)throw new Error(`Terra ${r.status}`);const text=d.output_text||(d.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');return JSON.parse(text);
}
function applyTerra(p,t,c){const mv=round(Number(t.estimated_market_value)),low=round(Number(t.range_low)),high=round(Number(t.range_high));if(!(low>0&&mv>=low&&high>=mv&&p.comparables?.length>=3))return p;p.valuation={...(p.valuation||{}),available:true,estimated_market_value:mv,market_value:mv,midpoint:mv,low,high,likely_market_range:{low,high},confidence:t.confidence};p.decision_summary={...(p.decision_summary||{}),estimated_market_value:mv,likely_market_range:{low,high},evidence_confidence:t.confidence,market_read:t.market_read,strategy:t.strategy};p.model_policy={primary:LUNA,terra_review:true,terra_model:TERRA,terra_reason:c.flags,complexity_score:c.score};return p;}

async function emails(env,limit){if(!env.RESEND_API_KEY)return;const jobs=await rpc(env,'claim_email_jobs',{p_limit:limit}).catch(()=>[]);for(const j of Array.isArray(jobs)?jobs:[]){try{await deliverEmailJob(env,j);}catch(e){await rpc(env,'fail_email_job',{p_job_id:j.id,p_error:String(e?.message||e).slice(0,300)}).catch(()=>null);}}}
async function rpc(env,name,body){const r=await db(env,`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(body)}),d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||name);return d;}
function db(env,path,init={}){const base=env.SUPABASE_URL||'https://pwbtxyavjjotxtvegrqe.supabase.co';return fetch(`${base}${path}`,{...init,signal:init.signal||AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,...(init.headers||{})}});}
function weightedMedian(a){const x=[...a].sort((a,b)=>a.v-b.v),t=x.reduce((s,z)=>s+z.w,0);let r=0;for(const z of x){r+=z.w;if(r>=t/2)return z.v;}return x.at(-1).v;}
function sameBuilding(a,b){const A=norm(a).match(/^(\d+)\s+(.+?)(?:\s+(?:unit|suite|apt)\s*\w+|\s+\d{1,5})?$/),B=norm(b).match(/^(\d+)\s+(.+?)(?:\s+(?:unit|suite|apt)\s*\w+|\s+\d{1,5})?$/);return!!(A&&B&&A[1]===B[1]&&A[2]===B[2]);}
function normType(v){return norm(v).replace(/semi detached.*/,'semi detached').replace(/detached.*/,'detached').replace(/att row townhouse.*/,'att row townhouse').replace(/condo apartment.*/,'condo apartment').replace(/condo townhouse.*/,'condo townhouse');}
function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function num(...v){for(const x of v){const n=Number(x);if(Number.isFinite(n)&&n>0)return n;}return null;}
function median(v){const a=[...v].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function round(v){if(!Number.isFinite(v))return null;const s=v>=1e6?10000:5000;return Math.round(v/s)*s;}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-THM-Version':VERSION}});}
