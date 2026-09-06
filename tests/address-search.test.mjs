import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../worker-v11.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace(/export \{[\s\S]*?\};\s*\/\/# sourceMappingURL=[^\n]+\s*$/, ''), context);

for (const query of ['981 avenue rd', '981 Avenue Road', '981 AVENUE RD.', '981 Avenue Rd, Toronto']) {
  test(`address parser preserves Avenue as the street name: ${query}`, () => {
    const parsed = context.parseAddress5(query);
    assert.equal(parsed.number, '981');
    assert.equal(parsed.name.toLowerCase(), 'avenue');
    assert.equal(parsed.suffix.toLowerCase(), 'road');
    assert.equal(parsed.unit, null);
    const fallback = context.parseAddress(query);
    assert.equal(fallback.streetName.toLowerCase(), 'avenue');
    assert.equal(fallback.streetSuffix, 'Road');
  });
}

for (const [query, name, suffix, direction, unit] of [
  ['100 Bay Street', 'bay', 'street', null, null],
  ['100 Park Lawn Road', 'park lawn', 'road', null, null],
  ['100 Royal Park Road', 'royal park', 'road', null, null],
  ['100 Forest Hill Road', 'forest hill', 'road', null, null],
  ['100 King Street W Unit 12', 'king', 'street', 'west', '12'],
  ['100 Avenue Road Unit 2', 'avenue', 'road', null, '2'],
]) {
  test(`address parser handles ${query}`, () => {
    const p = context.parseAddress5(query);
    assert.equal(p.name.toLowerCase(), name);
    assert.equal(p.suffix.toLowerCase(), suffix);
    assert.equal(p.direction?.toLowerCase() ?? null, direction);
    assert.equal(p.unit, unit);
  });
}
