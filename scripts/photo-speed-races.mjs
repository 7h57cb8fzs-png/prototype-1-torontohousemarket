import {webkit} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await webkit.launch();
const A='N10000001',B='N10000002',C='N10000003';
const photo=key=>({key:key+'-l',url:`https://photos.example/${key}-l.jpg`,fallbackUrl:'/api/media?key='+key+'-l',mobile:{key:key+'-m',url:`https://photos.example/${key}-m.jpg`,fallbackUrl:'/api/media?key='+key+'-m'},thumbnail:{key:key+'-t',url:`https://photos.example/${key}-t.jpg`,fallbackUrl:'/api/media?key='+key+'-t'}});
let releaseA;
let gateA=new Promise(resolve=>{releaseA=resolve;});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='photos.example')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#d3ded6"/></svg>'});
  if(url.hostname!=='thm.test')return route.abort();
  if(url.pathname==='/api/property'){
   const key=url.searchParams.get('listingKey')||url.searchParams.get('q');
   const deferred=url.searchParams.get('defer_photos')==='1';
   if(key===A&&!deferred)await gateA;
   if(key===C&&!deferred)return route.fulfill({status:503,json:{ok:false,error:'Photo provider unavailable'}});
   const listing={listingKey:key,address:`${key===A?10:key===B?20:30} Example Street, Toronto, ON`,forSale:true,foundInMls:true,listPrice:1200000,beds:3,baths:2,propertySubType:'Detached',details:{},photos:deferred?[]:[photo(key),photo(key+'second')],photosPending:deferred,inputValidation:{label:'MLS '+key+' verified'}};
   return route.fulfill({json:{ok:true,property:listing}}).catch(()=>{});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{ok:false,error:'Outside photo test scope'}});
  try{const file=url.pathname==='/'?'index.html':url.pathname.slice(1);return route.fulfill({body:readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://thm.test/?listingKey='+A);
 await page.locator('#snapshotSection:not(.hidden)').waitFor();
 assert.equal(await page.locator('#photoPlaceholderTitle').textContent(),'Loading listing photos…');
 assert.equal(await page.locator('#livePrice').textContent(),'$1,200,000');
 await page.locator('#headerReportButton').click();await page.locator('#leadModal:not(.hidden)').waitFor();await page.locator('#closeModal').click();
 releaseA();await page.waitForFunction(()=>document.querySelector('#mainPhoto').naturalWidth>0);
 assert((await page.locator('#mainPhoto').getAttribute('src')).endsWith(A+'-m.jpg'));
 assert((await page.locator('#snapshotThumbImg').getAttribute('src')).endsWith(A+'-t.jpg'));
 await page.locator('#photoMainButton').click();assert((await page.locator('#galleryImage').getAttribute('src')).endsWith(A+'-l.jpg'));await page.locator('#galleryClose').click();
 console.log('PASS: usable details and report form while gallery waits; mobile, thumbnail and full-gallery sizes remain distinct');
 // A second slow response must never replace the next property's photos.
 gateA=new Promise(resolve=>{releaseA=resolve;});
 await page.locator('#propertyInput').fill(A);await page.locator('#lookupButton').click();
 await page.getByText('Loading listing photos…',{exact:true}).waitFor();
 await page.locator('#propertyInput').fill(B);await page.locator('#lookupButton').click();
 await page.waitForFunction(key=>document.querySelector('#mainPhoto').getAttribute('src')?.includes(key),B);
 releaseA();await page.waitForTimeout(200);
 assert((await page.locator('#mainPhoto').getAttribute('src')).includes(B));
 assert((await page.locator('#snapshotMeta').textContent()).includes(B));
 console.log('PASS: cancelled or late gallery cannot overwrite a subsequent property');
 await page.locator('#propertyInput').fill(C);await page.locator('#lookupButton').click();
 await page.getByText('Listing found — photos unavailable',{exact:true}).waitFor();
 assert(await page.locator('#snapshotSection').isVisible());
 assert.equal(await page.locator('#livePrice').textContent(),'$1,200,000');
 assert.equal(await page.locator('#lookupButton').isDisabled(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: gallery outage preserves the property facts and usable search');
}finally{releaseA?.();await browser.close();}
