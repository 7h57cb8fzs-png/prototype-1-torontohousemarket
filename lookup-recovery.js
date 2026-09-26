import {reportFetch} from './report-runtime.js';

// The model selects server-built queries; it cannot create filters, addresses,
// comparable records, or relax exact unit/municipality verification.
export async function chooseLookupPlans(env, purpose, facts, plans) {
  const audit = {purpose, model:'gpt-5.6-luna', attempted:false, status:'not_configured', selected:[]};
  if (!env.OPENAI_API_KEY || !plans.length) return {plans:[], audit};
  const runtime=env.THM_REPORT_RUNTIME;
  if (runtime && runtime.deadline-Date.now()<18000) return {plans:[],audit:{...audit,status:'budget_exhausted'}};
  audit.attempted=true;
  try {
    const response=await reportFetch(env,'https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
      body:JSON.stringify({model:audit.model,reasoning:{effort:'low'},max_output_tokens:600,
        input:[{role:'system',content:'Choose up to three useful alternate MLS lookup plans after a failed or sparse lookup. Plans are queries, not evidence. Address numbers, condo units and municipality must remain exact. Never infer property facts. Prefer narrow geographic queries; try alternate field storage/case before broadening. Return only IDs from the supplied plans, in priority order.'},{role:'user',content:JSON.stringify({purpose,facts,plans})}],
        text:{format:{type:'json_schema',name:'thm_lookup_plans',strict:true,schema:{type:'object',additionalProperties:false,properties:{ids:{type:'array',items:{type:'string',enum:plans.map(p=>p.id)}}},required:['ids']}}}})
    });
    const data=await response.json().catch(()=>null);
    if(runtime)(runtime.aiUsage ||= []).push({purpose:'lookup_'+purpose,model:audit.model,http_status:response.status,usage:data?.usage||null});
    if(!response.ok)throw Error('OpenAI HTTP '+response.status);
    const output=data.output_text || data.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    const ids=[...new Set(JSON.parse(output).ids)].slice(0,3);
    const selected=ids.map(id=>plans.find(p=>p.id===id)).filter(Boolean);
    return {plans:selected,audit:{...audit,status:'completed',selected:selected.map(p=>p.id)}};
  }catch(error){return {plans:plans.slice(0,2),audit:{...audit,status:'deterministic_fallback',selected:plans.slice(0,2).map(p=>p.id),error:String(error?.message||error).slice(0,120)}};}
}

export function addressRecoveryPlans(parsed, attempted=[]) {
  const quote=v=>String(v||'').replaceAll("'","''");
  const words=String(parsed.name||'').split(/\s+/).filter(w=>w.length>2&&!/^(the|saint)$/i.test(w));
  const tokens=[...new Set([parsed.name,...words].filter(Boolean))];
  const plans=[];
  if(parsed.unit)plans.push({id:'exact_unit',filter:`contains(StreetName,'${quote(tokens[0])}') and contains(StreetNumber,'${quote(parsed.number)}') and contains(UnitNumber,'${quote(parsed.unit)}')`,reason:'Reduce a large condo building history to the requested unit; exact local validation remains mandatory.'});
  for(const [i,token] of tokens.entries())for(const [j,value] of [...new Set([token,token.toUpperCase(),token.replace(/\b\w/g,c=>c.toUpperCase())])].entries()){
    const filter=`contains(UnparsedAddress,'${quote(value)}') and contains(UnparsedAddress,'${quote(parsed.number)}')`;
    if(!attempted.includes(filter))plans.push({id:`address_${i}_${j}`,filter,reason:'Alternate address field; local exact identity validation remains mandatory.'});
  }
  return plans.slice(0,12);
}
