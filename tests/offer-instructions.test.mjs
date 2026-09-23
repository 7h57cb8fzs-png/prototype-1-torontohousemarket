import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOfferInstructions as extract,offerEmailLines} from '../offer-instructions.js';
import {propertyReportEmail,sellerReportEmail} from '../worker-v11.js';
const now=new Date('2026-09-23T15:00:00Z');
const record=remarks=>({PrivateRemarks:remarks,ModificationTimestamp:'2026-09-21T13:37:33Z'});
test('brokerage offer date and time exclude acceptance expiry',()=>{
 const o=extract(record('Offers presented September 22nd at 4:00pm. Please provide irrevocable until 11:59pm.'),now);
 assert.equal(o.type,'scheduled');assert.equal(o.date,'September 22');assert.equal(o.time,'4:00 PM');assert.equal(o.past,true);
 assert.equal(extract(record('Offers on September 22 at 4pm, irrevocable 11:59pm'),now).time,'4:00 PM');
});
test('offer remarks, future dates, missing time and conflicting instructions',()=>{
 assert.equal(extract({OfferRemarks:'Offers reviewed September 28, 2026 at 7pm'},now).past,false);
 assert.equal(extract({OfferRemarks:'Offers on September 28, 2026'},now).time,null);
 assert.equal(extract({...record('Offers September 22 at 4pm'),OfferRemarks:'Offers on September 25, 2026 at 7pm'},now).type,'unclear');
 assert.equal(extract({...record('Offers on September 22 at 4pm'),OfferRemarks:'Offers on September 25, 2026 at 7pm'},now).type,'unclear');
 assert.equal(extract(record('Offers on September 22 at 4pm or 7pm'),now).type,'unclear');
 assert.equal(extract(record('Offers anytime. Irrevocable September 23 at 11:59pm.'),now),null);
 assert.equal(extract(record('Open house September 23 at 4pm.'),now),null);
});
test('below-range explanation is conditional; rendering never changes numbers or comparable evidence',()=>{
 const r={facts:{for_sale:true,list_price:900000,offer_instructions:extract(record('Offers presented September 22nd at 4:00pm. Irrevocable 11:59pm.'),now)},valuation:{available:true,low:1000000,high:1100000,midpoint:1050000},comparables:[],seller:{evidence:{subjectMatched:true}}};
 const original=structuredClone(r);
 assert.match(offerEmailLines(r).join(' '),/Previously stated offer date: September 22 at 4:00 PM/);
 assert.match(offerEmailLines(r).join(' '),/below the range/);
 for(const renderer of [r=>propertyReportEmail('Example',{},r),r=>sellerReportEmail('Example',r)]){const email=renderer(r);assert.match(email.text,/Previously stated offer date/);assert.match(email.html,/4:00 PM/);assert.doesNotMatch(email.text,/irrevocable|11:59|listing brokerage/i);}
 assert.deepEqual(r,original);
 r.facts.list_price=1050000;assert.doesNotMatch(offerEmailLines(r).join(' '),/below the range/);
 r.facts.list_price=900000;r.valuation.available=false;assert.doesNotMatch(offerEmailLines(r).join(' '),/below the range/);
});

test('presentation time is separate from earlier registration deadline',()=>{
 const result=extract(record('Offers (If Any) Will Be Reviewed On October 6 at 7:00 pm (EMAIL), register by 5:00 pm. Seller reserves the right to accept pre emptive offers.'),now);
 assert.equal(result.type,'scheduled');assert.equal(result.date,'October 6');assert.equal(result.time,'7:00 PM');assert.equal(result.past,false);
});
