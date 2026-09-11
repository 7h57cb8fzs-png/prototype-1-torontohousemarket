import {randomInt} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const base='https://torontohousemarket.com';
const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n');
const excluded=new Set(files.flatMap(f=>{try{return readFileSync(f,'utf8').match(/\b[A-Z]\d{7,9}\b/g)||[]}catch{return []}}));
for(const k of ['C13774128','C13774156','W13774206','N13611398','C13772812'])excluded.add(k);
async function get(path){try{const r=await fetch(base+path,{signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json()};}catch(e){return {status:0,data:{error:e.name}};}}
const sample=[];
for(const [city,count] of [['Toronto',4],['Richmond Hill',3],['Vaughan',3]]){
 const {status,data}=await get('/api/discovery?'+new URLSearchParams({city,type:'condo',mode:'new'}));
 if(status!==200||!data.ok)throw Error('Inventory unavailable: '+city);
 const pool=data.listings.filter(p=>!excluded.has(p.listingKey));
 if(pool.length<count)throw Error('Insufficient previously untested inventory: '+city);
 for(let i=pool.length-1;i>0;i--){const j=randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
 sample.push(...pool.slice(0,count).map(p=>({...p,city})));
}
console.log(JSON.stringify({sample:sample.map(p=>({city:p.city,listingKey:p.listingKey,address:p.address}))}));
const results=[];
for(const home of sample){
 const address=home.address.split(',')[0];
 const byAddress=await get('/api/property?'+new URLSearchParams({q:address,mode:'public_snapshot'}));
 const byKey=await get('/api/property?'+new URLSearchParams({listingKey:home.listingKey,mode:'public_snapshot'}));
 const a=byAddress.data.property,k=byKey.data.property;
 const result={city:home.city,address,expected:home.listingKey,matched:a?.listingKey||null,resolvedAddress:a?.address||null,addressStatus:byAddress.status,keyStatus:byKey.status,keyMatched:k?.listingKey||null,passed:a?.listingKey===home.listingKey&&k?.listingKey===home.listingKey,error:byAddress.data.error||null};
 results.push(result);console.log(JSON.stringify({condoAddressCheck:result}));
}
mkdirSync('audit-output',{recursive:true});writeFileSync('audit-output/condo-address-results.json',JSON.stringify({sample,results},null,2));
console.log(JSON.stringify({summary:{tested:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length}}));
