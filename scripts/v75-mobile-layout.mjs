import {webkit} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,'');
const css=readFileSync('styles.css','utf8');
mkdirSync('mobile-qa',{recursive:true});
const browser=await webkit.launch();
try{
 for(const width of [320,375,390,430,1280]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width<760,deviceScaleFactor:1});
  await page.setContent(html);
  await page.addStyleTag({content:css});
  await page.locator('#propertyInput').fill('2737 keele');
  await page.evaluate(()=>{
   document.querySelector('#buyerSuggestions').hidden=false;
   document.querySelector('.address-suggestion-note').textContent='Tap your address below.';
   document.querySelector('#buyerAddressOptions').innerHTML='<li role="option">2737 Keele Street, North York, ON</li><li role="option">2737 Keeler Rd, Mississauga, ON</li>';
  });
  const result=await page.evaluate(()=>{
   const selectors=['.hero-inner','.hero h1','.hero-copy','.search-box','#propertyInput','#lookupButton','#buyerSuggestions'];
   return {width:innerWidth,scroll:document.documentElement.scrollWidth,font:parseFloat(getComputedStyle(document.querySelector('#propertyInput')).fontSize),bounds:selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,left:r.left,right:r.right};})};
  });
  assert(result.scroll<=width+1,JSON.stringify(result));
  for(const r of result.bounds)assert(r.left>=-1&&r.right<=width+1,JSON.stringify({width,...r}));
  assert(result.font>=16);
  await page.screenshot({path:'mobile-qa/width-'+width+'.png',fullPage:true});
  console.log(JSON.stringify({width,scroll:result.scroll,inputFont:result.font,status:'passed'}));
  await page.close();
 }
}finally{await browser.close();}
