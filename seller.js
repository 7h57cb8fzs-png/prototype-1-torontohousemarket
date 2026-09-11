/* Phase 6 · seller reports. Owner expectations never enter the valuation input. */
(() => {
  const $ = id => document.getElementById(id);
  const upgradeOptions = [
    ['kitchen','Kitchen','Cabinets, counters & appliances'],['bathrooms','Bathrooms','Fixtures, finishes & layout'],['flooring','Floors & finishes','Flooring, paint & lighting'],
    ['basement','Basement','Finish, layout or extra living space'],['windows','Windows & doors','Replacements & insulation'],['roof','Roof','Materials & replacement'],
    ['systems','Heating & cooling','Furnace, heat pump or A/C'],['exterior','Outdoor space','Landscaping, deck or exterior'],['layout','Layout & additions','Open plan or added living area']
  ];
  let address = '', matched = null, step = 0, requestKey = crypto.randomUUID();
  const esc = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setValue = (id,value) => {if(value!=null){$(id).value=String(value);$(id).dispatchEvent(new Event('change',{bubbles:true}));}};
  function fillSizes(value = '') {
    const condo = /condo/i.test($('sellerType').value);
    const bands = condo ? ['400-499','500-599','600-699','700-799','800-899','900-999','1000-1199','1200-1399','1400-1599','1600-1799','1800-1999','2000-2249','2250-2499','2500-2749','2750-2999','3000-3499','3500-3999','4000-4499','4500-4999'] : ['700-1100','1100-1500','1500-2000','2000-2500','2500-3000','3000-3500','3500-5000'];
    value=String(value||'').replace(/[–—]/g,'-').replace(/,/g,'').trim();
    if(condo && /^(\d{3,5})-(\d{3,5})$/.test(value) && !bands.includes(value))bands.unshift(value);
    $('sellerSize').innerHTML='<option value="">Choose the interior size</option>'+bands.map(b=>`<option value="${b}">${b.replace('-', '–')} sq ft</option>`).join('')+'<option value="unknown">I’m not sure</option>';
    setValue('sellerSize',bands.includes(String(value).replace(/[–—]/g,'-')) ? String(value).replace(/[–—]/g,'-') : value ? 'unknown' : '');
  }
  $('sellerType').addEventListener('change',()=>fillSizes($('sellerSize').value));
  fillSizes();
  $('sellerUpgradeGrid').innerHTML=upgradeOptions.map(([id,label,detail])=>`<article class="seller-upgrade"><label class="seller-upgrade-choice"><input type="checkbox" data-upgrade="${id}"><span><strong>${label}</strong><small>${detail}</small></span><span class="seller-upgrade-check" aria-hidden="true">✓</span></label><div class="seller-upgrade-detail" data-upgrade-detail="${id}" hidden><label>When was it completed?<select data-recency="${id}"><option value="unknown">Not sure</option><option value="0_2">Within 2 years</option><option value="3_5">3–5 years ago</option><option value="6_plus">More than 5 years ago</option></select></label><label class="seller-document"><input type="checkbox" data-documents="${id}"><span>I have receipts or documents</span></label></div></article>`).join('');
  document.querySelectorAll('[data-upgrade]').forEach(input=>input.addEventListener('change',()=>{document.querySelector(`[data-upgrade-detail="${input.dataset.upgrade}"]`).hidden=!input.checked;input.closest('article').classList.toggle('selected',input.checked);}));
  function showStep(index) {
    step=index;
    document.querySelectorAll('.seller-step').forEach(el=>el.hidden=Number(el.dataset.step)!==step);
    document.querySelectorAll('[data-progress]').forEach(el=>{el.classList.toggle('active',Number(el.dataset.progress)===step);el.setAttribute('aria-current',Number(el.dataset.progress)===step?'step':'false');});
    $('sellerError').textContent='';
    const title=document.querySelector(`.seller-step[data-step="${step}"] h3`) || document.querySelector(".seller-builder-heading h2");if(title){title.tabIndex=-1;title.focus({preventScroll:true});title.scrollIntoView({block:'start',behavior:'smooth'});}
  }
  function validateStep(index) {
    const fields=[...document.querySelectorAll(`.seller-step[data-step="${index}"] input,.seller-step[data-step="${index}"] select,.seller-step[data-step="${index}"] textarea`)];
    const invalid=fields.find(input=>!input.disabled&&!input.checkValidity());
    if(invalid){showStep(index);invalid.reportValidity();invalid.focus();return false;}return true;
  }
  document.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>{if(validateStep(step))showStep(step+1);}));
  document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>showStep(step-1)));
  $('sellerChangeAddress').addEventListener('click',()=>{$('sellerBuilder').hidden=true;$('sellerLookup').scrollIntoView({block:'center',behavior:'smooth'});$('sellerAddress').focus();});
  $('sellerLookup').addEventListener('submit',async event=>{
    event.preventDefault();if(!$('sellerLookup').reportValidity())return;
    const entered=$('sellerAddress').value.trim();
    if(!/^\d+[A-Za-z]?\s+\S+/.test(entered) && !/^(unit|suite|apt|#)\s*\w+/i.test(entered)){$('sellerLookupStatus').textContent='Enter the street number and street name, including the unit for a condo.';return;}
    $('sellerFind').disabled=true;$('sellerLookupStatus').textContent='Looking for home details…';
    try {
      const response=await fetch(`/api/property?q=${encodeURIComponent(entered)}&mode=public_snapshot`,{signal:AbortSignal.timeout(25000)});
      const data=await response.json();const p=data?.property;
      matched=response.ok && p?.listingKey && !p.displayRestricted ? p : null;
    }catch{matched=null;}
    // The address always remains the owner's input. A lookup supplies optional facts only.
    address=entered;requestKey=crypto.randomUUID();
    $('sellerForm').reset();fillSizes();
    document.querySelectorAll('[data-upgrade-detail]').forEach(el=>el.hidden=true);document.querySelectorAll('.seller-upgrade').forEach(el=>el.classList.remove('selected'));
    $('sellerSelectedAddress').textContent=address;
    $('sellerMatch').hidden=false;$('sellerPhoto').hidden=true;
    $('sellerMatchText').textContent=matched?'Listing details found. Please confirm the facts below and update anything that has changed.':'Your home doesn’t need an active listing. Add its details below so we can look for relevant sold homes.';
    if(matched){
      setValue('sellerType',matched.propertySubType);fillSizes(matched.livingAreaRange);
      const city=String(matched.city||'').startsWith('Toronto')?'Toronto':matched.city;
      setValue('sellerCity',city);setValue('sellerCommunity',matched.cityRegion);
      setValue('sellerBeds',matched.publicListing?.bedroomsAboveGrade ?? matched.beds);
      setValue('sellerBelowBeds',matched.publicListing?.bedroomsBelowGrade);
      setValue('sellerPostal',matched.postalCode);
      const photo=matched.mainPhoto || matched.photos?.[0]?.url || (typeof matched.photos?.[0]==='string'?matched.photos[0]:null);
      if(photo && (/^https:\/\//.test(photo)||/^\/api\//.test(photo))){$('sellerPhoto').src=photo;$('sellerPhoto').hidden=false;}
    }
    if(!$('sellerCity').value){const cities=[...$('sellerCity').options].map(o=>o.value).filter(Boolean);const city=cities.find(city=>entered.toLowerCase().includes(city.toLowerCase()));if(city)setValue('sellerCity',city);}
    $('sellerLookupStatus').textContent=matched?'Home details ready to review.':'Add your home details to continue.';
    $('sellerBuilder').hidden=false;$('sellerSuccess').hidden=true;$('sellerFind').disabled=false;showStep(0);
    window.gtag?.('event','seller_address_started',{lookup_matched:!!matched});
  });
  function phone(value){
    const raw=value.trim();if(!/^\+?[\d\s().-]+$/.test(raw)||raw.length>24)return null;
    let digits=raw.replace(/\D/g,'');if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);else if(raw.startsWith('+'))return null;
    if(!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)||digits.slice(1,3)==='11'||digits.slice(4,6)==='11'||/^(\d)\1{9}$/.test(digits)||['1234567890','0123456789','9876543210'].includes(digits))return null;return '+1'+digits;
  }
  $('sellerMobile').addEventListener('input',()=>$('sellerMobile').setCustomValidity(''));
  $('sellerTarget').addEventListener('input',()=>$('sellerTarget').setCustomValidity(''));
  $('sellerForm').noValidate=true;
  $('sellerForm').addEventListener('submit',async event=>{
    event.preventDefault();if(step<2){if(validateStep(step))showStep(step+1);return;}
    const mobile=phone($('sellerMobile').value);$('sellerMobile').setCustomValidity(mobile?'':'Enter a valid 10-digit mobile number, with optional +1.');
    const targetText=$('sellerTarget').value.trim(), target=targetText?Number(targetText.replace(/[$,\s]/g,'')):null;
    $('sellerTarget').setCustomValidity(targetText&&(!Number.isFinite(target)||target<50000||target>100000000)?'Enter a price between $50,000 and $100,000,000, or leave it blank.':'');
    for(let i=0;i<3;i++)if(!validateStep(i))return;
    const optionalNumber=id=>$(id).value===''?null:Number($(id).value);
    const profile={version:1,homeType:$('sellerType').value,city:$('sellerCity').value,community:$('sellerCommunity').value.trim(),sizeBand:$('sellerSize').value,beds:Number($('sellerBeds').value),belowBeds:optionalNumber('sellerBelowBeds'),basement:$('sellerBasement').value,entrance:$('sellerEntrance').value,kitchens:optionalNumber('sellerKitchens'),postal:$('sellerPostal').value.trim(),condition:document.querySelector('[name=condition]:checked')?.value,upgrades:upgradeOptions.filter(([id])=>document.querySelector(`[data-upgrade="${id}"]`).checked).map(([id])=>({id,recency:document.querySelector(`[data-recency="${id}"]`).value,documents:document.querySelector(`[data-documents="${id}"]`).checked})),targetPrice:target,timing:$('sellerTiming').value,notes:$('sellerNotes').value.trim(),ownerConsent:$('sellerOwnerConsent').checked,contactConsent:$('sellerContactConsent').checked};
    $('sellerSubmit').disabled=true;$('sellerSubmit').textContent='Preparing your request…';$('sellerError').textContent='';
    try {
      const response=await fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_mode:'seller',showing_requested:false,name:$('sellerName').value.trim(),email:$('sellerEmail').value.trim(),mobile,property_input:address,resolved_address:address,seller_profile:profile,request_key:requestKey,page_url:location.href,website:$('sellerWebsite').value})});
      const data=await response.json();if(!response.ok||!data.ok||!data.lead_id)throw new Error(data.error||'Your request could not be saved. Please try again.');
      $('sellerBuilder').hidden=true;$('sellerSuccess').hidden=false;$('sellerSuccessNote').textContent=`We’ve saved your review for ${address}. Your seller report will be sent to ${$('sellerEmail').value.trim()}.`;$('sellerSuccess').focus();$('sellerSuccess').scrollIntoView({block:'center',behavior:'smooth'});window.gtag?.('event','seller_report_requested');
    }catch(error){$('sellerError').textContent=error.message||'Please try again.';}finally{$('sellerSubmit').disabled=false;$('sellerSubmit').textContent='Email my seller report';}
  });
  const initial=new URLSearchParams(location.search).get('address');if(initial)$('sellerAddress').value=initial.slice(0,500);
})();
