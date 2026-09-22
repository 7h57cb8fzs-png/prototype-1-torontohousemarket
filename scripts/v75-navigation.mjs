import {webkit} from 'playwright';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const A='N10000001', B='N10000002', C='N10000003';
const names={[A]:'10 Example Street, Toronto, ON',[B]:'20 Sample Road, Toronto, ON',[C]:'30 Test Avenue, Toronto, ON'};
const browser=await webkit.launch();
mkdirSync('mobile-qa',{recursive:true});
async function setup(width){
 const context=await browser.newContext({viewport:{width,height:844},isMobile:width<760});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let delayed=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname==='prior.test')return route.fulfill({contentType:'text/html',body:'<h1>Previous website</h1>'});
  if(url.hostname!=='thm.test')return route.abort();
  if(path==='/api/property'){
   const input=url.searchParams.get('listingKey')||url.searchParams.get('q');
   const key=names[input]?input:input?.startsWith('10 Example')?A:input?.startsWith('20 Sample')?B:null;
   if(key===C&&delayed)await new Promise(r=>setTimeout(r,700));
   if(!key)return route.fulfill({status:404,json:{ok:false,error:'No matching test property'}});
   return route.fulfill({json:{ok:true,normalizedAddress:names[key],property:{listingKey:key,address:names[key],forSale:true,foundInMls:true,listPrice:1200000,beds:3,baths:2,photos:[],details:{},propertySubType:'Detached',city:'Toronto',cityRegion:'Test community',inputValidation:{label:'Address matched to MLS '+key}}}});
  }
  if(path==='/api/price-check')return route.fulfill({json:{ok:true,listingKey:url.searchParams.get('listingKey'),available:false,count:0,matches:[],reason:'Test comparison'}});
  if(path==='/api/home-assistant')return route.fulfill({json:{ok:true,listingKey:route.request().postDataJSON().listingKey,mode:'ai',facts:[],checks:[]}});
  if(path.startsWith('/api/'))return route.fulfill({json:{ok:true,available:false,suggestions:[]}});
  try{
   const filename=path==='/'?'index.html':path.slice(1);
   if(filename.includes('..'))return route.abort();
   const contentType=filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'text/html';
   return route.fulfill({body:readFileSync(filename),contentType});
  }catch{return route.fulfill({status:404,body:''});}
 });
 async function snapshot(key){
  await page.waitForFunction(key=>!document.querySelector('#snapshotSection').classList.contains('hidden')&&document.querySelector('#snapshotMeta').textContent.includes(key),key);
  assert(await page.locator('#leadModal').evaluate(e=>e.classList.contains('hidden')));
 }
 async function lookup(input,key){await page.locator('#propertyInput').fill(input);await page.locator('#lookupButton').click();await snapshot(key);}
 async function style(){
  const result=await page.evaluate(()=>{
   const header=document.querySelector('#headerReportButton'),value=document.querySelector('.home-value-link'),bottom=document.querySelector('#mobileShowingButton');
   const h=header.getBoundingClientRect(),v=value.getBoundingClientRect(),hs=getComputedStyle(header),bs=getComputedStyle(bottom);
   return {width:innerWidth,scroll:document.documentElement.scrollWidth,header:h.width>0,value:v.width>0,heightDiff:Math.abs(h.height-v.height),widthDiff:Math.abs(h.width-v.width),matched:hs.fontFamily===bs.fontFamily&&hs.fontSize===bs.fontSize&&hs.backgroundColor===bs.backgroundColor&&hs.borderRadius===bs.borderRadius};
  });
  assert(result.scroll<=result.width+1,JSON.stringify(result));assert(result.header&&result.value);assert(result.heightDiff<=1&&result.widthDiff<=1,JSON.stringify(result));
  if(width<760)assert(result.matched,JSON.stringify(result));
  await page.screenshot({path:`mobile-qa/navigation-${width}.png`,fullPage:true});
 }
 return {page,context,errors,snapshot,lookup,style,delay:()=>{delayed=true;}};
}
try{
 // 1. Address previews, Back/Forward, home, then the actual previous website.
 {
  const t=await setup(390),p=t.page;
  await p.goto('https://prior.test/');await p.goto('https://thm.test/');
  await t.lookup('10 Example Street',A);await t.lookup('20 Sample Road',B);await t.style();
  await p.goBack();await t.snapshot(A);assert.equal(new URL(p.url()).searchParams.get('listingKey'),A);
  await p.goForward();await t.snapshot(B);await p.goBack();await t.snapshot(A);await p.goBack();
  await p.waitForFunction(()=>document.querySelector('#snapshotSection').classList.contains('hidden'));
  assert.equal(await p.locator('#propertyInput').inputValue(),'');
  await p.goBack();assert.equal(new URL(p.url()).hostname,'prior.test');assert.deepEqual(t.errors,[]);await t.context.close();
  console.log('PASS 1: two previews and native Back/Forward without report requests');
 }
 // 2. A shared destination survives reload without inserting an extra step.
 {
  const t=await setup(375),p=t.page;
  await p.goto('https://prior.test/');await p.goto('https://thm.test/?listingKey='+A);await t.snapshot(A);await t.style();
  const length=await p.evaluate(()=>history.length);await p.reload();await t.snapshot(A);assert.equal(await p.evaluate(()=>history.length),length);
  await p.goBack();assert.equal(new URL(p.url()).hostname,'prior.test');assert.deepEqual(t.errors,[]);await t.context.close();
  console.log('PASS 2: shared listing and reload preserve browser history');
 }
 // 3. Repeat/failed searches do not add entries; a late response cannot undo Back.
 {
  const t=await setup(430),p=t.page;await p.goto('https://thm.test/');await t.lookup(A,A);
  const length=await p.evaluate(()=>history.length);await t.lookup(A,A);assert.equal(await p.evaluate(()=>history.length),length);
  await p.locator('#propertyInput').fill('N99999999');await p.locator('#lookupButton').click();await p.getByText('No matching test property',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>history.length),length);
  await t.lookup(B,B);await t.style();t.delay();await p.locator('#propertyInput').fill(C);await p.locator('#lookupButton').click();
  await p.goBack();await t.snapshot(A);await p.waitForTimeout(900);await t.snapshot(A);assert.equal(new URL(p.url()).searchParams.get('listingKey'),A);
  assert.deepEqual(t.errors,[]);await t.context.close();console.log('PASS 3: duplicates, failure, and stale request during Back');
 }
 // 4. Home Finder cards use the same single-entry navigation path.
 {
  const t=await setup(320),p=t.page;await p.goto('https://thm.test/?q=10%20Example%20Street');await t.snapshot(A);await t.style();
  await p.evaluate(key=>{const a=document.createElement('a');a.href='/?listingKey='+key;a.dataset.openListing=key;a.textContent='Open test home';document.querySelector('.finder-workspace').append(a);},B);
  const length=await p.evaluate(()=>history.length);await p.getByText('Open test home',{exact:true}).click();await t.snapshot(B);assert.equal(await p.evaluate(()=>history.length),length+1);
  await p.goBack();await t.snapshot(A);assert.deepEqual(t.errors,[]);await t.context.close();console.log('PASS 4: query links and Home Finder card navigation');
 }
 // 5. Desktop remains aligned; an explicit showing link opens the form only on entry.
 {
  const t=await setup(1280),p=t.page;await p.goto('https://thm.test/?listingKey='+A+'&showing=1');
  await p.locator('#leadModal:not(.hidden)').waitFor();assert(await p.locator('#showingChoice').isChecked());await p.locator('#closeModal').click();
  await t.lookup(B,B);await t.style();await p.goBack();
  await p.waitForFunction(key=>!document.querySelector('#snapshotSection').classList.contains('hidden')&&document.querySelector('#snapshotMeta').textContent.includes(key),A);
  assert(await p.locator('#leadModal').evaluate(e=>e.classList.contains('hidden')));assert.deepEqual(t.errors,[]);await t.context.close();console.log('PASS 5: desktop alignment and report modal stays closed on Back');
 }
}finally{await browser.close();}
