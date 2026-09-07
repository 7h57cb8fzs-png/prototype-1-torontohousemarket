import test from "node:test";
import assert from "node:assert/strict";
import { propertyReportEmail } from "../worker-v11.js";

test("zero comparables suppress stale scores and explain the recorded reason", () => {
  const message = propertyReportEmail("981 Avenue Road", {}, {
    facts: { list_price: 1499000 }, comparables: [],
    valuation: { available: true, low: 1000000, high: 2000000, basis: "No same-type local sales were returned in the searched data." },
    value_rating: { available: true, score: 8.5, label: "Strong value" },
    narrative: { executive_summary: "Strong value", market_read: "Strong value" }
  });
  assert.ok(message.html.includes("Value rating unavailable"));
  assert.ok(message.html.includes("No same-type local sales were returned"));
  assert.ok(message.text.includes("This does not prove"));
  for (const value of ["BUYER READ", "BUYER OPPORTUNITY SNAPSHOT", "8.5", "Worth a closer look", "Strong value"]) {
    assert.ok(!message.html.includes(value), value);
    assert.ok(!message.subject.includes(value), value);
  }
});

test("buyer report email leads with a clear decision and showing action", () => {
  const message = propertyReportEmail(
    "331 Davos Road, Vaughan, ON L4H 0M8",
    { display_name: "Alireza", email: "alireza@example.com" },
    {
      facts: { list_price: 1128000, property_type: "Att/Row/Townhouse", beds: 3, baths: 3, neighbourhood: "Vellore Village", living_area: "1500-2000" },
      valuation: { available: true, low: 885000, midpoint: 930000, high: 935000, newest_sold_date: "2026-08-21" },
      value_rating: { available: true, score: 2.3, label: "Caution", reason: "The asking price is above the sold range." },
      comparable_policy: { windowDays: 100, expandedWindow: false },
      comparables: [
        { address: "32 Laurelhurst Crescent", soldPrice: 885000, soldDate: "2026-08-20", similarity: 98 },
        { address: "259 Wardlaw Place", soldPrice: 930000, soldDate: "2026-08-21", similarity: 96 },
        { address: "60 Monte Carlo Drive", soldPrice: 935000, soldDate: "2026-08-19", similarity: 69 }
      ],
      narrative: {
        executive_summary: "The asking price is above the recent sold range.",
        market_read: "Three recent qualifying sales support the range.",
        buyer_strategy: "Inspect condition before discussing price.",
        strengths: ["Three bedrooms"],
        risks: ["Condition is not verified"],
        inspection_priorities: ["Check the major systems"],
        questions_for_realtor: ["Which sale is closest in condition?"]
      }
    }
  );

  // Recompute from the supplied facts; a stored score must not override evidence.
  assert.equal(message.subject, "AI Property Report Ready: 331 Davos Road, Vaughan, ON L4H 0M8 | Value Rating 2.7/10");
  for (const label of ["YOUR BUYER DECISION REPORT", "YOUR PRICE PICTURE", "Recent comparable sales", "WHAT THE NUMBERS SAY", "YOUR NEXT MOVE", "Choose a showing time", "tel:+16478904704"]) {
    assert.ok(message.html.includes(label), `missing ${label}`);
  }
  assert.ok(!message.html.includes("THM BUYER INTELLIGENCE"));
  assert.ok(!message.html.includes("AI EVIDENCE READ"));
});

const graphicFixture = (patch={}) => ({
 generated_at:'2026-09-06T00:00:00Z', facts:{for_sale:true,list_price:1200000},
 valuation:{available:true,low:900000,midpoint:1000000,high:1100000,confidence:'Medium'},
 comparable_policy:{windowDays:100},comparables:[1,2,3].map(i=>({address:`${i} Example Road`,soldPrice:900000+i*50000,soldDate:'2026-08-15'})),...patch
});
test('email infographic places the ask against the verified range and retains a plain text equivalent', () => {
 const email=propertyReportEmail('Example home',{},graphicFixture());
 for(const body of [email.html,email.text]) {assert.match(body,/100,000.*above/);assert.match(body,/900,000/);assert.match(body,/1,100,000/);assert.match(body,/Medium/);}
 assert.match(email.html,/table-layout:fixed/);assert.ok(!/<svg|<script|<img/i.test(email.html));
});
test('email infographic cannot resurrect a stale price window or an off-market asking price', () => {
 const none=propertyReportEmail('Example home',{},graphicFixture({comparables:[]}));
 assert.ok(!none.html.includes('PRICE WINDOW TO DISCUSS'));assert.ok(!none.html.includes('$900,000'));assert.match(none.html,/Not established confidence/);
 const off=propertyReportEmail('Example home',{},graphicFixture({facts:{for_sale:false,list_price:1200000}}));
 assert.ok(!off.html.includes('Dark marker'));assert.ok(!off.html.includes('$1,200,000'));assert.match(off.html,/PRICE WINDOW TO DISCUSS/);
});
test('expanded-window confidence is consistently low in the graphic and email preview', () => {
 const report=graphicFixture({comparable_policy:{windowDays:300,expandedWindow:true}});
 report.valuation.confidence='High';
 const email=propertyReportEmail('Example home',{},report);
 assert.match(email.html,/Low confidence/);assert.match(email.html,/Low evidence confidence/);assert.ok(!email.html.includes('High confidence'));
});
