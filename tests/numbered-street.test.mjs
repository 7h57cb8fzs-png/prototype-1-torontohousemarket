import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../worker-v11.js',import.meta.url),'utf8');
const c=vm.createContext({});vm.runInContext(source.replace(/export \{[\s\S]*?\};\s*\/\/# sourceMappingURL=[^\n]+\s*$/,''),c);
test('numbered highway keeps the street number separate from the condo unit',()=>{
 const row={StreetNumber:'2916',StreetName:'Highway 7',UnitNumber:'401',ListingKey:'expected',StandardStatus:'Active',TransactionType:'For Sale'};
 for(const query of ['2916 Highway 7 401','2916 Hwy 7 Unit 401','401 - 2916 Highway 7','2916 Highway 7 Road 401']){
  const parsed=c.parseAddress5(query);assert.equal(parsed.name,'highway 7');assert.equal(parsed.unit,'401');
  assert.equal(c.selectExactAddressMatch(parsed,[{...row,UnitNumber:'402',ListingKey:'wrong'},row]).ListingKey,'expected');
 }
 assert.equal(c.parseAddress5('2916 Highway 7').unit,null);
});
