import test from 'node:test';
import assert from 'node:assert/strict';
import {propertyReportEmail,sellerReportEmail} from '../worker-v11.js';

const report={generated_at:'2026-09-22T12:00:00Z',facts:{listing_key:'N10000001',for_sale:true,list_price:1200000,property_type:'Detached'},valuation:{available:true,low:1050000,midpoint:1100000,high:1150000,confidence:'Medium'},comparables:[1,2,3].map(n=>({address:`${n} Example Street`,soldPrice:1050000+n*25000,soldDate:'2026-09-01',propertySubType:'Detached'})),seller:{evidence:{listingMatched:true}},narrative:{}};
test('buyer and seller emails remove incentives while retaining price, address and contact actions',()=>{
  for(const email of [propertyReportEmail('10 Example Street',{},report),propertyReportEmail('10 Example Street',{}, {...report,facts:{...report.facts,for_sale:false}}),sellerReportEmail('10 Example Street',report),sellerReportEmail('10 Example Street',{facts:{},valuation:{available:false},comparables:[]})]){
    for(const body of [email.html,email.text]){
      assert.doesNotMatch(body,/cash\s*back|YOUR BUYER BENEFIT|eligible purchase|10,000 back/i);
      assert.match(body,/10 Example Street/);
      assert.match(body,/647.?890.?4704/);
    }
    assert.match(email.html,/font-family:Georgia,Times New Roman,serif;font-size:16px;font-weight:400;line-height:1.25/);
  }
  const email=propertyReportEmail('10 Example Street',{},report,{appointmentUrl:'https://torontohousemarket.com/showing.html#token=fixture'});
  assert.match(email.html,/href="https:\/\/torontohousemarket.com\/showing.html#token=fixture"/);
  assert.match(email.html,/\$1,200,000/);
  assert.match(email.html,/font:400 18px\/1.4 Georgia,serif/);
});
