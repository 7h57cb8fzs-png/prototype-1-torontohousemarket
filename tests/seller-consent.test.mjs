import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {webkit} from 'playwright';

let browser;
before(async()=>{browser=await webkit.launch();mkdirSync('mobile-qa',{recursive:true});});
after(async()=>{await browser?.close();});

async function form(t,width=1280){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768});
 const page=await context.newPage(),leads=[],errors=[];
 let respond=route=>route.fulfill({json:{ok:true}});
 page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
 // Every request is intercepted. Fixtures cannot create real leads or send emails.
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='thm.test')return route.abort();
  if(path==='/api/property')return route.fulfill({json:{ok:true,normalizedAddress:'101 Example Street, Toronto',city:'Toronto'}});
  if(path==='/api/lead'){leads.push(route.request().postDataJSON());return respond(route);}
  if(path.startsWith('/api/'))return route.fulfill({json:{ok:true,available:false,suggestions:[]}});
  const file=path==='/seller'?'seller.html':path.slice(1);
  if(file.includes('..'))return route.abort();
  try{return route.fulfill({body:readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html'});}
  catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://thm.test/seller');
 await page.locator('#sellerAddress').fill('101 Example Street, Toronto');
 await page.locator('#sellerFind').click();
 await page.locator('#sellerBuilder').waitFor({state:'visible'});
 async function details(){
  await page.locator('#sellerName').fill('Example Owner');
  await page.locator('#sellerEmail').fill('fixture@example.invalid');
  await page.locator('#sellerMobile').fill('4165550198');
 }
 return {page,leads,details,respond:fn=>{respond=fn;}};
}

async function layout(page,width){
 const boxes=await page.locator('#sellerForm input[type=checkbox]').evaluateAll(els=>els.map(e=>({id:e.id,required:e.required,checked:e.checked})));
 assert.deepEqual(boxes,[{id:'sellerOwnerConsent',required:true,checked:false},{id:'sellerMarketingConsent',required:false,checked:false}]);
 assert.match(await page.locator('.seller-consents').textContent(),/owner’s permission.*receive it by email.*contacted by Toronto House Market/);
 assert.equal(await page.locator('#sellerError').isVisible(),false);
 const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.querySelector('#sellerError').getBoundingClientRect().height}));
 assert(geometry.scroll<=width+1,'Form must fit the viewport');assert.equal(geometry.height,0);
 await page.locator('.seller-consents').evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
 await page.screenshot({path:`mobile-qa/seller-two-consents-${width}.png`});
}

test('1. Desktop has exactly two unchecked boxes and no empty red box',async t=>{
 const {page}=await form(t);await layout(page,1280);
});

test('2. Mobile has the same two boxes, no empty red box and no horizontal overflow',async t=>{
 const {page}=await form(t,390);await layout(page,390);
});

test('3. Combined permission is required; report-only submission retains both server permissions',async t=>{
 const {page,leads,details}=await form(t);await details();
 await page.locator('#sellerSubmit').click();
 await page.locator('#sellerOwnerConsentError').waitFor({state:'visible'});
 assert.equal(leads.length,0);
 await page.locator('#sellerOwnerConsent').check();
 await page.locator('#sellerSubmit').click();await page.locator('#sellerSuccess').waitFor({state:'visible'});
 assert.equal(leads.length,1);
 const p=leads[0].seller_profile;
 assert.equal(p.ownerConsent,true);assert.equal(p.contactConsent,true);assert.equal(p.marketingConsent,false);
 assert.equal(p.renovationPct,null);assert.equal(p.condition,'unknown');assert.equal(p.targetMin,null);assert.equal(p.targetMax,null);
 assert.equal(leads[0].lead_mode,'seller');assert.equal(leads[0].showing_requested,false);
});

test('4. Optional marketing opt-in is submitted independently',async t=>{
 const {page,leads,details}=await form(t);await details();
 await page.locator('#sellerOwnerConsent').check();await page.locator('#sellerMarketingConsent').check();
 await page.locator('#sellerSubmit').click();await page.locator('#sellerSuccess').waitFor({state:'visible'});
 assert.equal(leads.length,1);assert.equal(leads[0].seller_profile.marketingConsent,true);
 assert.equal(leads[0].seller_profile.ownerConsent,true);assert.equal(leads[0].seller_profile.contactConsent,true);
});

test('5. Real errors remain visible and clear on retry and a new address',async t=>{
 const {page,leads,details,respond}=await form(t);await details();await page.locator('#sellerOwnerConsent').check();
 respond(route=>route.fulfill({status:503,json:{ok:false,error:'Please try again shortly.'}}));
 await page.locator('#sellerSubmit').click();await page.getByText('Please try again shortly.',{exact:true}).waitFor();
 assert.equal(await page.locator('#sellerError').isVisible(),true);assert.equal(await page.locator('#sellerSubmit').isEnabled(),true);
 await page.locator('#sellerChangeAddress').click();await page.locator('#sellerFind').click();
 await page.locator('#sellerBuilder').waitFor({state:'visible'});assert.equal(await page.locator('#sellerError').isVisible(),false);
 await details();await page.locator('#sellerOwnerConsent').check();
 await page.locator('#sellerSubmit').click();await page.getByText('Please try again shortly.',{exact:true}).waitFor();
 let release;const gate=new Promise(resolve=>{release=resolve;});
 respond(async route=>{await gate;return route.fulfill({json:{ok:true}});});
 try{
  await page.locator('#sellerSubmit').click();
  assert.equal(await page.locator('#sellerError').isVisible(),false);assert.equal(await page.locator('#sellerSubmit').isDisabled(),true);
 }finally{release();}
 await page.locator('#sellerSuccess').waitFor({state:'visible'});
 assert.equal(leads.length,3);assert.equal(leads[1].request_key,leads[2].request_key);
});
