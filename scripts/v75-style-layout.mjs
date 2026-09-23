import {webkit} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {propertyReportEmail,sellerReportEmail,buildEmail} from '../worker-v11.js';
const root='https://thm.test';
const address='150 Example Avenue Unit 1205, Toronto, ON';
const report={generated_at:'2026-09-22T12:00:00Z',facts:{listing_key:'N10000001',for_sale:true,list_price:1200000,property_type:'Detached'},valuation:{available:true,low:1050000,midpoint:1100000,high:1150000,confidence:'Medium'},comparables:[1,2,3].map(n=>({address:`${n} Example Street, Toronto`,soldPrice:1050000+n*25000,soldDate:'2026-09-01',propertySubType:'Detached'})),seller:{evidence:{listingMatched:true}},narrative:{}};
const emails={'confirmation-email':buildEmail({job_type:'email_recipient',payload:{reason:'buyer_request_confirmation',vow_action_link:'https://torontohousemarket.com/api/verify?token=fixture'}},{lead_mode:'buyer',resolved_address:address,metadata:{}}).html,'buyer-email':propertyReportEmail(address,{},report).html,'seller-email':sellerReportEmail(address,report).html,'seller-review-email':sellerReportEmail(address,{facts:{},valuation:{available:false},comparables:[]}).html};
mkdirSync('mobile-qa',{recursive:true});
for(const [key,value]of Object.entries(emails))writeFileSync(`mobile-qa/${key}.html`,value);
const browser=await webkit.launch();
try{
 for(const width of [320,375,390,430,768,1280]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<760});
  const page=await context.newPage(),errors=[],leads=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(url.hostname!=='thm.test')return route.abort();
   if(emails[path.slice(1)])return route.fulfill({contentType:'text/html',body:emails[path.slice(1)]});
   if(path==='/api/lead'){leads.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}
   if(path==='/api/property')return route.fulfill({json:{ok:true,normalizedAddress:address,city:'Toronto',property:{listingKey:'N10000001',address,forSale:true,foundInMls:true,listPrice:1200000,beds:3,baths:2,kitchens:1,photos:[],details:{},propertySubType:'Detached',city:'Toronto',cityRegion:'Example',inputValidation:{label:'Address matched'}}}});
   if(path==='/api/price-check')return route.fulfill({json:{ok:true,listingKey:'N10000001',available:false,count:0,matches:[],reason:'Example comparison'}});
   if(path==='/api/home-assistant')return route.fulfill({json:{ok:true,listingKey:'N10000001',mode:'ai',facts:[],checks:[]}});
   if(path.startsWith('/api/'))return route.fulfill({json:{ok:true,available:false,suggestions:[]}});
   try {const file=path==='/'?'index.html':path.slice(1);return route.fulfill({body:readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html'});}catch{return route.fulfill({status:404,body:''});}
  });
  async function fits(label){
   const r=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert(r.scroll<=r.width+1,`${label} overflow ${JSON.stringify(r)}`);
   assert.doesNotMatch(await page.locator('body').innerText(),/cashback|10,000 back/i);
  }
  async function buttons(selectors){
   const styles=await page.locator(selectors).evaluateAll(nodes=>nodes.filter(e=>e.getBoundingClientRect().height>0).map(e=>{const s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,radius:s.borderRadius,background:s.backgroundColor,height:e.getBoundingClientRect().height};}));
   for(const s of styles){assert.match(s.font,/Georgia/);assert.equal(s.size,'16px');assert.equal(s.weight,'400');assert.equal(s.radius,'10px');assert.equal(s.background,'rgb(32, 59, 60)');assert(s.height>=44);}
  }
  await page.goto(root+'/?listingKey=N10000001');await page.locator('#snapshotSection:not(.hidden)').waitFor();
  await fits('buyer '+width);
  assert.equal(await page.locator('.footer-team-names').evaluate(e=>getComputedStyle(e).fontWeight),'400');
  await page.locator('.professional-footer').scrollIntoViewIfNeeded();
  await page.screenshot({path:`mobile-qa/footer-${width}.png`,fullPage:false});
  assert.equal(await page.locator('#offerTimingValue,#offerTimingNote,.brief-schools summary').count(),0);
  assert(await page.locator('#schoolName').isVisible());
  assert(await page.locator('.school-links').isVisible());
  for(const selector of ['#propertyInput','#homeSearchQuery']){
   await page.locator(selector).focus();
   assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  }
  await buttons('#headerReportButton,#seeHomeButton,#mobileShowingButton');
  await page.locator('#snapshotSection').scrollIntoViewIfNeeded();
  await page.screenshot({path:`mobile-qa/buyer-${width}.png`});
  await page.locator('#seeHomeButton').click();await page.locator('#leadModal:not(.hidden)').waitFor();await fits('buyer form '+width);await buttons('#leadSubmit');await page.locator('#closeModal').click();
  await page.goto(root+'/seller.html');await fits('seller '+width);await buttons('#sellerFind');
  await page.screenshot({path:`mobile-qa/seller-${width}.png`});
  await page.locator('#sellerAddress').focus();assert.equal(await page.locator('#sellerAddress').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
  await page.locator('#sellerAddress').fill(address);await page.locator('#sellerFind').click();await page.locator('#sellerBuilder').waitFor({state:'visible'});
  await fits('seller form '+width);await buttons('#sellerSubmit');
  const optional=page.locator('.seller-optional-details');
  assert.equal(await optional.getAttribute('open'),null);
  assert(await page.locator('#sellerMobile').evaluate(e=>e.getBoundingClientRect().bottom<document.querySelector('.seller-optional-details').getBoundingClientRect().top));
  await page.locator('#sellerName').fill('Example Owner');await page.locator('#sellerEmail').fill('fixture@example.com');await page.locator('#sellerMobile').fill('6478904704');
  for(const selector of ['#sellerOwnerConsent','#sellerContactConsent']){
   const metrics=await page.locator(selector).evaluate(e=>{const b=e.getBoundingClientRect(),r=e.nextElementSibling.getBoundingClientRect(),style=getComputedStyle(e.nextElementSibling);return {height:b.height,offset:b.y-r.y,line:Number.parseFloat(style.lineHeight)};});
   assert.equal(metrics.height,18);assert(Math.abs(metrics.offset+metrics.height/2-metrics.line/2)<3,'Checkbox first-line alignment');
   await page.locator(selector).check();
  }
  await page.locator('#sellerSubmit').click();await page.locator('#sellerSuccess').waitFor({state:'visible'});
  assert.equal(leads.at(-1).seller_profile.renovationPct,null);assert.equal(leads.at(-1).seller_profile.condition,'unknown');assert.equal(leads.at(-1).seller_profile.targetMin,null);assert.equal(leads.at(-1).seller_profile.targetMax,null);
  await page.locator('#sellerFind').click();await page.locator('#sellerBuilder').waitFor({state:'visible'});
  await page.locator('.seller-optional-details>summary').click();
  await page.locator('#sellerTargetMin').fill('900000');await page.locator('#sellerTargetMax').fill('1000000');
  await fits('seller optional details '+width);
  await page.locator('#sellerBuilder').scrollIntoViewIfNeeded();await page.screenshot({path:`mobile-qa/seller-form-${width}.png`});
  if(width===375||width===1280)for(const key of Object.keys(emails)){await page.goto(root+'/'+key);await fits(key+' '+width);await page.screenshot({path:`mobile-qa/${key}-${width}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS: ${width}px buyer, report form, seller, seller form, buttons${width===375||width===1280?', and four email previews':''}`);
 }
}finally{await browser.close();}
