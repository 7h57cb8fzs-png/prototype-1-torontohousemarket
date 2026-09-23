import { MARKETING_HTML, MARKETING_TEXT } from './seller-marketing-template.js';

export const MARKETING_VERSION = 'seller-strategy-fees-2026-09-23';
export const MARKETING_WORDING = 'Yes, email me your selling plan, listing fees and occasional selling tips.';
export const MARKETING_SUBJECT = 'Selling Strategy & Fees';
const ORIGIN = 'https://torontohousemarket.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function marketingConsent(value) {
  // Older ownership/contact permissions never imply marketing permission.
  return value === true ? {
    marketingConsent: true, marketingConsentVersion: MARKETING_VERSION,
    marketingConsentWording: MARKETING_WORDING,
    marketingConsentAt: new Date().toISOString(), marketingConsentSource: '/seller'
  } : { marketingConsent: false };
}

export function marketingMessage(job, env) {
  if (!UUID.test(job.unsubscribe_token)) throw Error('Invalid subscription token');
  const unsubscribe = `${ORIGIN}/api/marketing/unsubscribe?token=${job.unsubscribe_token}`;
  const configured = String(env.RESEND_FROM_EMAIL || 'notifications@updates.torontohousemarket.com');
  const address = configured.match(/<([^<>]+)>/)?.[1] || configured.trim();
  return {
    from: `Toronto House Market <${address}>`, to: [job.email],
    reply_to: 'torontohousemarket@gmail.com', subject: MARKETING_SUBJECT,
    html: MARKETING_HTML.replaceAll('{{UNSUBSCRIBE_URL}}', unsubscribe),
    text: MARKETING_TEXT.replaceAll('{{UNSUBSCRIBE_URL}}', unsubscribe),
    attachments: [{ filename: 'THM-Selling-Plan-and-Fees.pdf', path: `${ORIGIN}/marketing/THM-Selling-Plan-and-Fees-v1.pdf` }],
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{name:'campaign',value:'seller-strategy-fees-v1'}]
  };
}

export async function marketingRpc(env, name, body) {
  const r = await fetch(`${env.SUPABASE_URL || 'https://pwbtxyavjjotxtvegrqe.supabase.co'}/rest/v1/rpc/${name}`, {
    method:'POST', headers:{'Content-Type':'application/json', apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},
    body:JSON.stringify(body), signal:AbortSignal.timeout(10000)
  });
  const data = await r.json().catch(()=>null);
  if (!r.ok) throw Error(`Marketing storage unavailable (${r.status})`);
  return data;
}

export async function deliverSellerMarketing(env, job) {
  const message = job.frozen_email || marketingMessage(job,env);
  // Freeze before the first provider call. Retries reuse identical data and key.
  // The RPC rechecks consent, report delivery, lease ownership and suppression.
  const permitted = await marketingRpc(env,'prepare_seller_marketing_send',{
    p_job_id:job.id,p_attempt:job.attempts,p_message:message
  });
  if (!permitted) return {skipped:true};
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`thm-seller-marketing-${job.id}-v1`},
    body:JSON.stringify(message),signal:AbortSignal.timeout(15000)
  });
  const result = await r.json().catch(()=>({}));
  if (!r.ok || !result.id) throw Error(`Marketing provider rejected the send (${r.status})`);
  // Retry acknowledgement locally; never repeat the provider call here.
  for(let attempt=0;attempt<3;attempt++){
    try {
      await marketingRpc(env,'complete_seller_marketing_send',{p_job_id:job.id,p_attempt:job.attempts,p_provider_id:result.id});
      return {accepted:true,id:result.id};
    } catch(e) {if(attempt===2)throw e;}
  }
}

export async function processSellerMarketing(env) {
  if (!env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const jobs = await marketingRpc(env,'claim_seller_marketing_jobs',{p_limit:3});
    for(const job of jobs || []){
      try {await deliverSellerMarketing(env,job);}
      catch(e){await marketingRpc(env,'fail_seller_marketing_send',{p_job_id:job.id,p_attempt:job.attempts,p_error:String(e.message).slice(0,200)}).catch(()=>null);}
    }
  } catch {console.error(JSON.stringify({event:'seller_marketing_queue_unavailable'}));}
}

export async function marketingUnsubscribe(request, env) {
  const url=new URL(request.url),token=url.searchParams.get('token');
  if(!['GET','POST'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, POST'}});
  if(!UUID.test(token||'')) return unsubscribePage('Check your unsubscribe link','Use the unsubscribe link in your Toronto House Market marketing email.',null,400);
  if(request.method==='GET') return unsubscribePage('Email preferences','Stop selling-plan emails and selling tips from the Toronto House Market team. You can still request property reports.',token);
  try {
    const found=await marketingRpc(env,'unsubscribe_seller_marketing',{p_token:token});
    return found ? unsubscribePage('You’re unsubscribed','You will no longer receive marketing emails from the Toronto House Market team. Your requested property reports are unaffected.')
      : unsubscribePage('Check your unsubscribe link','Use the unsubscribe link in your Toronto House Market marketing email.',null,400);
  }catch{return unsubscribePage('Please try again','We could not save your preference. Try again, or reply “unsubscribe” to the email and our team will help.',token,503);}
}

function unsubscribePage(title,copy,token=null,status=200){
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Toronto House Market</title><style>body{margin:0;background:#f7f8f5;color:#193c36;font:17px/1.6 system-ui,sans-serif}main{max-width:540px;margin:12vh auto;padding:32px}h1{font:36px/1.15 Georgia,serif}button{border:0;border-radius:8px;padding:14px 22px;background:#1d6254;color:white;font:inherit;cursor:pointer}a{color:inherit}footer{margin-top:36px;font-size:13px}</style></head><body><main><strong>TORONTO HOUSE MARKET</strong><h1>${title}</h1><p>${copy}</p>${token?`<form method="post" action="/api/marketing/unsubscribe?token=${token}"><button type="submit">Unsubscribe from marketing</button></form>`:''}<footer>Alireza &amp; Mehrdad Golestan Habibi · Sales Representatives<br>CENTURY 21 Leading Edge Realty Inc., Brokerage<br>1053 McNicoll Avenue, Toronto, ON M1W 3W6<br><a href="mailto:torontohousemarket@gmail.com">torontohousemarket@gmail.com</a> · 647-890-4704</footer></main></body></html>`,{
    status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}
  });
}
