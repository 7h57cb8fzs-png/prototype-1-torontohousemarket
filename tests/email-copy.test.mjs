import test from "node:test";
import assert from "node:assert/strict";
import { propertyReportEmail } from "../worker-v11.js";

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

  assert.equal(message.subject, "AI Property Report Ready: 331 Davos Road, Vaughan, ON L4H 0M8 | Value Rating 2.3/10");
  for (const label of ["YOUR BUYER DECISION REPORT", "BOTTOM LINE", "Recent comparable sales", "WHAT THE NUMBERS SAY", "READY TO SEE IT?", "Request a showing with Alireza"]) {
    assert.ok(message.html.includes(label), `missing ${label}`);
  }
  assert.ok(!message.html.includes("THM BUYER INTELLIGENCE"));
  assert.ok(!message.html.includes("AI EVIDENCE READ"));
});
