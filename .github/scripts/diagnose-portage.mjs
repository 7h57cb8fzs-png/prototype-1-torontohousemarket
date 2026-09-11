import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const nonce=randomBytes(24).toString('hex');
const p='worker-v11.js';let source=readFileSync(p,'utf8');const start=source.indexOf('var worker_v10_default');const pos=source.indexOf('    const url = new URL(request.url);',start);
const handler=`
    if(url.pathname==='/api/diagnostic-${nonce}') {
      const results=[];
      for(const path of ["Property('N13611398')", "Property?$filter="+encodeURIComponent("contains(UnparsedAddress,'898 Portage')")+"&$top=500"]) {
        const r=await amplifyFetch(AMPRE_BASE+'/'+path,env); const b=await r.json().catch(()=>({})); const rows=b.value||(b.ListingKey?[b]:[]);
        results.push({kind:path.startsWith('Property(')?'exactMLS':'addressCandidates',status:r.status,count:rows.length,subject:rows.filter(x=>String(x.UnitNumber)==='2106'||/\\b2106\\b/.test(x.UnparsedAddress||'')).map(x=>Object.fromEntries(['ListingKey','StreetNumber','StreetName','StreetSuffix','UnitNumber','UnparsedAddress','StandardStatus','TransactionType','InternetEntireListingDisplayYN','InternetAddressDisplayYN'].map(k=>[k,x[k]]))),errorCode:b.error?.code});
      }
      return json6({results});
    }
`;
source=source.slice(0,pos)+source.slice(pos).replace('    const url = new URL(request.url);','    const url = new URL(request.url);'+handler);writeFileSync(p,source);
execFileSync('node',['.github/scripts/ten-property-audit.mjs'],{stdio:'ignore',env:{...process.env,PREVIEW_ONLY:'true',EXPECTED_ACTIVE_SHA:'13fa6a9a6fd75ec8d1db9b40f5af8f2d9fc3795b6f6fdf1c4140429dc951a60f'}});
const release=JSON.parse(readFileSync('audit-output/release.json'));
const base=`https://${release.candidate.slice(0,8)}-prototype-1-torontohousemarket.7h57cb8fzs.workers.dev`;
const r=await fetch(base+'/api/diagnostic-'+nonce);const body=await r.json();console.log(JSON.stringify({diagnostic:body.results,status:r.status}));
