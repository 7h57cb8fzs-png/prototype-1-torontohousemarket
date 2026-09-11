const api=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
const headers={Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`};
async function cf(path){const r=await fetch(api+path,{headers});if(!r.ok)throw Error('Configuration read failed');return (await r.json()).result;}
const dep=await cf('/workers/scripts/prototype-1-torontohousemarket/deployments');
const v=await cf(`/workers/workers/prototype-1-torontohousemarket/versions/${dep.deployments[0].versions[0].version_id}`);
const token=v.bindings.find(b=>b.name==='AMPRE_TOKEN')?.text;
if(!token)throw Error('Feed credential unavailable to read-only diagnostic');
for(const path of ["Property('N13611398')",`Property?${new URLSearchParams({'$filter':"contains(UnparsedAddress,'898 Portage')",'$top':'500','$select':'ListingKey,StreetNumber,StreetName,StreetSuffix,UnitNumber,UnparsedAddress,StandardStatus,TransactionType,InternetEntireListingDisplayYN,InternetAddressDisplayYN'}).toString().replace(/\+/g,'%20')}`]){
 const r=await fetch('https://query.ampre.ca/odata/'+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});const b=await r.json().catch(()=>({}));
 const rows=(b.value|| (b.ListingKey?[b]:[]));
 console.log(JSON.stringify({kind:path.startsWith('Property(')?'exactMLS':'addressCandidates',status:r.status,count:rows.length,subject:rows.filter(x=>String(x.UnitNumber)==='2106'||/\b2106\b/.test(x.UnparsedAddress||'')).map(x=>Object.fromEntries(['ListingKey','StreetNumber','StreetName','StreetSuffix','UnitNumber','UnparsedAddress','StandardStatus','TransactionType','InternetEntireListingDisplayYN','InternetAddressDisplayYN'].map(k=>[k,x[k]]))),errorCode:b.error?.code}));
}
