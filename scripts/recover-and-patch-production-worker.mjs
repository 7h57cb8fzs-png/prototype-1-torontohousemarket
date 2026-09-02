import fs from "node:fs";

const [inputPath, replacementPath, outputPath] = process.argv.slice(2);
if (!inputPath || !replacementPath || !outputPath) {
  throw new Error("Usage: node recover-and-patch-production-worker.mjs <input> <replacement> <output>");
}

const source = fs.readFileSync(inputPath, "utf8");
const replacement = fs.readFileSync(replacementPath, "utf8").trimEnd();

const startMarker = "async function buildComparableContext(subject, env, activeForSale) {";
const endMarker = '__name(prepareComparableCandidates, "prepareComparableCandidates");';
const oldVersion = 'var VERSION4 = "stage4-fast-private-buyer-intelligence-v84-20260901";';
const newVersion = 'var VERSION4 = "stage4-sold-query-comparables-v85-20260902";';

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

for (const marker of [startMarker, endMarker, oldVersion]) {
  const count = occurrences(source, marker);
  if (count !== 1) throw new Error(`Expected exactly one occurrence of ${marker}, found ${count}`);
}

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start) + endMarker.length;
let patched = source.slice(0, start) + replacement + source.slice(end);
patched = patched.replace(oldVersion, newVersion);

if (occurrences(patched, newVersion) !== 1) throw new Error("Version replacement failed");
if (patched.includes("prepareComparableCandidates")) throw new Error("Legacy comparable helper remains after patch");
if (!patched.includes("querySoldComparableRows")) throw new Error("Sold-query helper is missing after patch");

fs.writeFileSync(outputPath, patched);
console.log(`Patched ${outputPath} safely from the active production version.`);
