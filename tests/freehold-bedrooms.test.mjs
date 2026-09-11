import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../worker-v11.js',import.meta.url),'utf8');
const c=vm.createContext({});vm.runInContext(source.replace(/export \{[\s\S]*?\};\s*\/\/# sourceMappingURL=[^\n]+\s*$/,''),c);
test('detached primary bedrooms match independently of basement; community, type, size and condo guards remain',()=>{
 const subject={ListingKey:'C10000000',StreetNumber:'1',StreetName:'Example',City:'Toronto',CityRegion:'Oakwood Village',PropertySubType:'Detached',PropertyType:'Residential Freehold',LivingAreaRange:'700-1100',BedroomsAboveGrade:3,BedroomsBelowGrade:3,BedroomsTotal:6,ListPrice:999000,StandardStatus:'Active',TransactionType:'For Sale'};
 const row={...subject,ListingKey:'C10000001',StreetNumber:'2',BedroomsBelowGrade:0,BedroomsTotal:3};
 assert.equal(c.priceCheckSelection(subject,[row]).count,1);
 assert.equal(c.priceCheckSelection(subject,[row]).matches[0].bedroomLayout,'3+0');
 for(const change of [{CityRegion:'Another community'},{PropertySubType:'Semi-Detached'},{LivingAreaRange:'2000-2500'}]) assert.equal(c.priceCheckSelection(subject,[{...row,...change}]).count,0);
 assert.equal(c.priceCheckSelection(subject,[{...row,BedroomsAboveGrade:4,BedroomsTotal:4}]).count,0);
 assert.equal(c.priceCheckSelection(subject,[row]).available,false);
 const condo={...subject,PropertyType:'Residential Condo & Other',PropertySubType:'Condo Apartment',LivingAreaRange:'600-699',BedroomsAboveGrade:1,BedroomsBelowGrade:1,BedroomsTotal:2};
 assert.equal(c.priceCheckSelection(condo,[{...condo,ListingKey:'C10000001',StreetNumber:'2',BedroomsAboveGrade:2,BedroomsBelowGrade:0}]).count,0);
});
