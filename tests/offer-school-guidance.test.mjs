import test from 'node:test';
import assert from 'node:assert/strict';
import {detectOfferTiming,buildSchoolSummary,reportPriceSuggestion,propertyReportEmail} from '../worker-v11.js';

test('offer timing distinguishes a stated deadline, anytime, unknown and conflicting instructions',()=>{
 const scheduled=detectOfferTiming({PublicRemarks:'Offers will be reviewed September 12, 2026 at 5pm. Closing October 20, 2026.'});
 assert.equal(scheduled.type,'scheduled');assert.match(scheduled.label,/September 12, 2026/);assert.ok(!scheduled.label.includes('October'));
 assert.equal(detectOfferTiming({PublicRemarks:'Offers anytime.'}).type,'anytime');
 for(const text of ['Lovely home.','No offers anytime.','Offers not accepted anytime.','Closing September 12, 2026.']) assert.equal(detectOfferTiming({PublicRemarks:text}).type,'unknown');
 assert.equal(detectOfferTiming({PublicRemarks:'Offers anytime. Offers reviewed September 12, 2026.'}).type,'unclear');
 assert.equal(detectOfferTiming({PrivateRemarks:'Offers reviewed September 12, 2026. Secret instructions.'}).type,'unknown');
});
test('school display keeps the MLS source and suppresses out-of-range scores',()=>{
 const school=buildSchoolSummary({ElementarySchool:'Example School',ElementarySchoolRating:8.2,SchoolRatingScale:10,SchoolRatingYear:'2025'});
 assert.equal(school.rating,8.2);assert.equal(school.ratingYear,'2025');assert.equal(school.source,'AMPRE MLS');assert.equal(school.ratingScale,10);assert.equal(buildSchoolSummary({ElementarySchool:'Example',ElementarySchoolRating:8.2}).ratingScale,null);
 for(const score of [null,99,-1]) assert.equal(buildSchoolSummary({ElementarySchool:'Example School',ElementarySchoolRating:score}).rating,null);
});
const priceFixture=()=>({generated_at:'2026-09-06T00:00:00Z',facts:{for_sale:true,list_price:1100000,neighbourhood:'Vellore Village',property_type:'Detached'},valuation:{available:true,low:900000,midpoint:1000000,high:1100000,confidence:'Medium'},value_rating:{available:true},comparable_policy:{windowDays:100},comparables:[1,2,3].map(n=>({address:`${n} Example Road`,cityRegion:'Vellore Village',propertySubType:'Detached',soldPrice:900000+n*50000,soldDate:'2026-08-15'}))});
test('specific price suggestions require fresh exact-community evidence and established confidence',()=>{
 assert.equal(reportPriceSuggestion(priceFixture()).price,1000000);
 for(const change of [r=>r.valuation.confidence='Low',r=>r.facts.for_sale=false,r=>r.comparables[0].cityRegion='Patterson',r=>r.comparables[0].propertySubType='Semi-Detached',r=>r.comparables[0].soldDate='2025-01-01',r=>r.comparable_policy.expandedWindow=true,r=>r.comparables.pop(),r=>r.generated_at=null]) {
  const r=priceFixture();change(r);assert.equal(reportPriceSuggestion(r).available,false);assert.equal(reportPriceSuggestion(r).price,null);
 }
});
test('email makes calling and showing choices clear without the removed refresh request',()=>{
 const message=propertyReportEmail('Example', {email:'agent@example.com'},priceFixture());
 assert.match(message.html,/Choose a showing time/);assert.match(message.html,/tel:\+16478904704/);
 assert.ok(!message.html.includes('Request a fresh price analysis'));assert.match(message.text,/Toronto time/);
});
