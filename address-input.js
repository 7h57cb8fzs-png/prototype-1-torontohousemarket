/* Address selection is optional. Manual entry and MLS numbers remain available. */
(() => {
  const cities=['Richmond Hill','East Gwillimbury','Whitchurch-Stouffville','New Tecumseth','Newmarket','Mississauga','Brampton','Burlington','Pickering','Clarington','Toronto','Vaughan','Markham','Aurora','Oakville','Milton','Whitby','Oshawa','Ajax','King'];
  const nonAddress=value=>/^(?:https?:\/\/|[a-z]\d{7,9}$)/i.test(value.trim());
  function split(value){
    let street=String(value||'').trim(),unit='';
    if(nonAddress(street))return {street,unit};
    for(const city of cities){const re=new RegExp('(?:,|\\s)'+city.replace(/ /g,'\\s+')+'(?:[,\\s]*(?:ON|Ontario|Canada|[CEW]\\d{2}|[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d))*[,\\s]*$','i');const match=street.match(re);if(match){street=street.slice(0,match.index).trim().replace(/,$/,'')+', '+city;break;}}
    const first=street.match(/^(?:(?:unit|suite|apt|apartment|#)\s*)?([a-z0-9]+)\s*[-–—]\s*(\d+[a-z]?\s+.+)$/i)||street.match(/^(?:unit|suite|apt|apartment|#)\s*([a-z0-9-]+)\s*,?\s+(\d+[a-z]?\s+.+)$/i);
    if(first){unit=first[1];street=first[2];}
    const explicit=street.match(/(?:,?\s+(?:unit|suite|apt|apartment)\s*|\s*#\s*)([a-z0-9-]+)(?=\s*,|\s*$|\s+[a-z])/i);
    if(explicit){unit=explicit[1];street=street.slice(0,explicit.index)+street.slice(explicit.index+explicit[0].length);}
    if(!unit){
      const tail=street.match(/\b(st(?:reet)?|rd|road|ave(?:nue)?|dr(?:ive)?|cres(?:cent)?|circ(?:le)?|blvd|boulevard|crt|court|ct|ln|lane|pkwy|parkway|way|trail|tr|place|pl|terrace|ter)\.?\s+(?:(?:[nsew]|north|south|east|west)\s+)?(\d+[a-z]?|ph\d*)(?=\s*,|\s*$|\s+[a-z])/i);
      if(tail){unit=tail[2];const end=tail.index+tail[0].length;street=street.slice(0,end-unit.length).trimEnd()+street.slice(end);}
    }
    return {street:street.replace(/\s+,/g,',').trim(),unit:unit.toUpperCase()};
  }
  function combine(value,unit){
    if(nonAddress(value))return value.trim();
    const parsed=split(value),selected=String(unit||parsed.unit).trim().replace(/^(?:unit|suite|apt|#)\s*/i,'').toUpperCase();
    const comma=parsed.street.indexOf(',');
    return selected?(comma<0?`${parsed.street} Unit ${selected}`:`${parsed.street.slice(0,comma)} Unit ${selected}${parsed.street.slice(comma)}`):parsed.street;
  }
  function attach({input,unit,panel,status,onChange=()=>{}}){
    let timer,controller,sequence=0,rows=[],active=-1,pending=null,session=crypto.randomUUID(),disabled=false,linkedStreet=null,failedChoice=false;
    const list=panel.querySelector('[role=listbox]'),note=panel.querySelector('[role=status]'),credit=panel.querySelector('.address-attribution');
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',list.id);
    const close=()=>{panel.hidden=true;active=-1;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
    const cancel=()=>{clearTimeout(timer);controller?.abort();sequence++;close();};
    const say=message=>{note.textContent=message;};
    const normalize=()=>{const parsed=split(input.value);if(parsed.unit){unit.value=parsed.unit;input.value=parsed.street;linkedStreet=parsed.street;}return parsed;};
    const post=async(path,body,signal)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'Suggestions are unavailable. You can enter the address yourself.');return data;};
    function highlight(index){active=index;[...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===index)));input.setAttribute('aria-activedescendant',list.children[index].id);list.children[index].scrollIntoView({block:'nearest'});}
    async function select(index){
      const row=rows[index];if(!row)return;
      if(row.city){const chosen=split(input.value);input.value=chosen.street.replace(/,.*$/,'')+', '+row.city;linkedStreet=input.value;failedChoice=false;cancel();onChange();status.textContent='City selected. Continue to find your home.';input.focus();return;}
      cancel();const current=sequence;normalize();input.setAttribute('aria-busy','true');
      pending=(async()=>{
        try{
          const data=await post('/api/address-selection',{placeId:row.placeId,sessionToken:session},AbortSignal.timeout(6500));
          if(current!==sequence)return;
          if(!data.available||!data.address)throw new Error('Suggestions are unavailable. You can enter the address yourself.');
          failedChoice=false;input.value=data.address;linkedStreet=data.address;if(!unit.value&&data.unit)unit.value=data.unit;
          input.setCustomValidity('');THMInputs.error(input,'');onChange();
          status.textContent='Address selected. Add your unit if this is a condo.';
          input.focus();
        }catch(error){if(current===sequence){failedChoice=true;status.textContent=error.message;}}
        finally{if(current===sequence){input.removeAttribute('aria-busy');session=crypto.randomUUID();}}
      })();
      await pending;pending=null;
    }
    async function suggest(){
      normalize();const q=input.value.trim();
      if(disabled||nonAddress(q)||!/^\d+[a-z]?\s+[a-z]/i.test(q)||q.replace(/[^a-z]/ig,'').length<3)return;
      const current=sequence;const localController=new AbortController();controller=localController;const deadline=setTimeout(()=>localController.abort(),6500);
      try{
        const data=await post('/api/address-suggestions',{q,sessionToken:session},localController.signal);
        if(current!==sequence||document.activeElement!==input)return;
        if(!data.available){disabled=true;close();return;}
        rows=data.suggestions||[];list.replaceChildren();active=-1;
        rows.forEach((row,index)=>{const option=document.createElement('li');option.id=list.id+'-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=row.label;option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>select(index));list.append(option);});
        say(rows.length?'Choose your address':'No suggestions yet. Keep typing, or enter the full street address.');credit.hidden=!rows.length;panel.hidden=false;input.setAttribute('aria-expanded','true');
      }catch{if(current===sequence)close();}finally{clearTimeout(deadline);}
    }
    input.addEventListener('input',()=>{failedChoice=false;cancel();if(linkedStreet&&split(input.value).street!==linkedStreet){unit.value='';unit.required=false;unit.setCustomValidity('');THMInputs.error(unit,'');linkedStreet=null;}input.removeAttribute('aria-busy');input.setCustomValidity('');THMInputs.error(input,'');onChange();unit.disabled=nonAddress(input.value);unit.closest('.address-unit-row').hidden=unit.disabled;timer=setTimeout(suggest,400);});
    unit.addEventListener('input',()=>{unit.setCustomValidity('');THMInputs.error(unit,'');onChange();});
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){cancel();return;}
      if(panel.hidden||!rows.length)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();highlight((active+(event.key==='ArrowDown'?1:active<0?0:-1)+rows.length)%rows.length);}
      else if(event.key==='Enter'&&active>=0){event.preventDefault();select(active);}
      else if(event.key==='Tab')close();
    });
    document.addEventListener('pointerdown',event=>{if(event.target!==input&&!panel.contains(event.target))close();});
    input.addEventListener('blur',()=>{close();});
    return {
      async prepare(){await pending;if(failedChoice){input.focus();return null;}cancel();normalize();unit.setCustomValidity(unit.value&&!/^[a-z0-9]+(?:-[a-z0-9]+)?$/i.test(unit.value.trim())?'Enter just the unit number.':'');if(!THMInputs.check(unit))return null;linkedStreet=split(input.value).street;return combine(input.value,unit.value);},
      set(value){failedChoice=false;cancel();const parsed=split(value);input.value=parsed.street;unit.value=parsed.unit;unit.required=false;unit.setCustomValidity('');THMInputs.error(unit,'');linkedStreet=parsed.street;unit.disabled=nonAddress(value);unit.closest('.address-unit-row').hidden=unit.disabled;},
      requireUnit(){unit.required=true;unit.disabled=false;unit.closest('.address-unit-row').hidden=false;unit.setCustomValidity('Add your unit number so we can find the right condo.');THMInputs.check(unit);unit.focus();},
      showCities(cities){cancel();rows=cities.map(city=>({city,label:city}));list.replaceChildren();rows.forEach((row,index)=>{const option=document.createElement('li');option.id=list.id+'-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=row.label;option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>select(index));list.append(option);});credit.hidden=true;say('This street address matches more than one city. Which is yours?');panel.hidden=false;input.setAttribute('aria-expanded','true');input.focus();},
      cancel
    };
  }
  window.THMAddress={split,combine,attach};
})();
