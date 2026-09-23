import {webkit} from 'playwright';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function verifyPhotoBrowser(base,listings){
 const browser=await webkit.launch();mkdirSync('mobile-qa',{recursive:true});
 try{
  for(const width of [390,1280])for(const key of listings){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width<768});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let release,expected;
   const gate=new Promise(resolve=>{release=resolve;});
   try{
    await page.route('**/api/**',async route=>{
     const url=new URL(route.request().url());
     if(url.pathname==='/api/property'){
      if(url.searchParams.get('defer_photos')==='1')return route.continue();
      await gate;
      const response=await route.fetch();const data=await response.json();
      assert(response.ok()&&data.ok&&data.property.listingKey===key);
      expected=data.property;return route.fulfill({response});
     }
     // Photo verification never creates leads, sends reports or runs unrelated AI requests.
     return route.fulfill({status:503,json:{ok:false,error:'Outside photo verification scope'}});
    });
    await page.route('**/www.googletagmanager.com/**',route=>route.abort());
    await page.goto(`${base}/?listingKey=${key}`,{waitUntil:'domcontentloaded'});
    await page.locator('#snapshotSection:not(.hidden)').waitFor({timeout:45000});
    assert((await page.locator('#snapshotMeta').textContent()).includes(key));
    assert.equal(await page.locator('#photoPlaceholderTitle').textContent(),'Loading listing photos…');
    assert.equal(await page.locator('#lookupButton').isDisabled(),false);
    await page.locator('#headerReportButton').click();await page.locator('#leadModal:not(.hidden)').waitFor();await page.locator('#closeModal').click();
    release();
    await page.waitForFunction(()=>!document.querySelector('#photoMainButton').classList.contains('hidden')&&document.querySelector('#mainPhoto').naturalWidth>0,null,{timeout:45000});
    assert(expected?.photos.length>0);
    const cover=expected.photos[0],chosen=width<768?cover.mobile||cover:cover;
    assert.equal(await page.locator('#mainPhoto').getAttribute('src'),chosen.url);
    assert.equal(await page.locator('#snapshotThumbImg').getAttribute('src'),(cover.thumbnail||cover.mobile||cover).url);
    assert.equal(await page.locator('#photoCountBadge').textContent(),`${expected.photos.length} photos`);
    assert.equal(await page.locator('#snapshotProperty').textContent(),expected.address.split(',')[0]);
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(geometry.scroll<=width+1,'Horizontal overflow');
    await page.locator('.listing-cockpit').screenshot({path:`mobile-qa/photos-${key}-${width}.png`});
    await page.locator('#photoMainButton').click();
    assert.equal(await page.locator('#galleryImage').getAttribute('src'),cover.url);
    await page.waitForFunction(()=>document.querySelector('#galleryImage').naturalWidth>0);
    await page.locator('#galleryNext').click();assert.equal(await page.locator('#galleryImage').getAttribute('src'),expected.photos[1].url);
    await page.locator('#galleryClose').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({stage:'browser-photo-check',listingKey:key,width,detailsBeforeGallery:true,coverUnchanged:true,selectedVariant:chosen.key,fullGallery:cover.key,photoCount:expected.photos.length,overflow:false}));
   }finally{release?.();await context.close();}
  }
 }finally{await browser.close();}
}
