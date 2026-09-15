import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('app.js','utf8').split('// PUBLIC LISTING SHARING START')[1].split('// PUBLIC LISTING SHARING END')[0];
function harness(navigator={}){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'',hidden:false,showModal(){this.open=true;},focus(){this.focused=true;},select(){this.selected=true;}});return elements.get(id);};
 const context=vm.createContext({URL,navigator,$});vm.runInContext(source,context);return {context,$};
}
const home={listingKey:'C12345678',address:'123 Example Street Unit 201, Toronto',forSale:true,email:'private@example.invalid',reportToken:'private-token'};
test('share link identifies only the public listing and preserves the displayed unit',()=>{
 const {context:c,$}=harness();const data=c.listingShareData(home);const u=new URL(data.url);
 assert.equal(u.origin,'https://torontohousemarket.com');assert.equal(u.search,'?listingKey=C12345678');assert.equal(u.hash,'#lookup');assert.equal(data.text,home.address);assert.ok(!JSON.stringify(data).includes('private'));
 c.openListingShare(home);assert.equal($('listingShareLink').value,data.url);assert.ok(decodeURIComponent($('shareWhatsApp').href).includes(data.url));assert.equal($('shareNative').hidden,true);
});
test('restricted, unmatched and unavailable properties cannot generate listing shares',()=>{
 const {context:c}=harness();for(const item of [{...home,displayRestricted:true},{...home,listingKey:'bad&email=secret'},{...home,forSale:false}])assert.equal(c.listingShareData(item),null);
});
test('copy success is reported only after clipboard write, and denied clipboard selects the link',async()=>{
 let copied;const {context:c,$}=harness({clipboard:{async writeText(text){copied=text;}}});c.openListingShare(home);await c.copyListingShare();assert.equal(copied,$('listingShareLink').value);assert.equal($('copyListingLink').textContent,'Copied ✓');
 const denied=harness({clipboard:{async writeText(){throw Error('denied');}}});denied.context.openListingShare(home);await denied.context.copyListingShare();assert.equal(denied.$('listingShareLink').selected,true);assert.equal(denied.$('copyListingLink').textContent,'Copy link');
});
test('native sharing gets the current public link; cancellation does not claim a share or error',async()=>{
 let shared;const {context:c,$}=harness({async share(data){shared=data;throw Object.assign(Error(),{name:'AbortError'});}});c.openListingShare(home);await c.shareListingNative();assert.equal(shared.url,$('listingShareLink').value);assert.equal($('listingShareStatus').textContent,'Anyone with the link can open this listing.');
});
