/* Phase 6 · seller reports. Owner expectations never enter the valuation input. */
(() => {
  const $ = id => document.getElementById(id);
  let address = '', matched = null, requestKey = crypto.randomUUID();
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
  $('sellerAddress').addEventListener('input',()=>{$('sellerBuilder').hidden=true;matched=null;address='';$('sellerLookupStatus').classList.remove('is-error');$('sellerAddress').setCustomValidity('');THMInputs.error($('sellerAddress'),'');$('sellerLookupStatus').textContent='Condo: 9201 Yonge St, Unit 1405, Richmond Hill. House: 18 Ferris Rd, Toronto.';});
  fillSizes();
  function validateForm(){return THMInputs.validate($('sellerForm'));}
  $('sellerChangeAddress').addEventListener('click',()=>{$('sellerBuilder').hidden=true;$('sellerLookup').scrollIntoView({block:'center',behavior:'smooth'});$('sellerAddress').focus();});
  $('sellerLookup').addEventListener('submit',async event=>{
    event.preventDefault();if(!THMInputs.validate($('sellerLookup')))return;
    const entered=$('sellerAddress').value.trim();
    $('sellerLookupStatus').classList.remove('is-error');THMInputs.error($('sellerAddress'),'');
    $('sellerFind').disabled=true;$('sellerLookupStatus').textContent='Looking for home details…';
    let canonical=entered;
    try {
      const response=await fetch(`/api/property?q=${encodeURIComponent(entered)}&mode=public_snapshot&strict_address=1`,{signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(!response.ok)throw Object.assign(new Error(data.error||'We couldn’t check the address. Please try again or call 647-890-4704.'),{inputError:!!data.inputError});
      const p=data?.property;canonical=data.normalizedAddress||entered;
      matched=response.ok && p?.listingKey && !p.displayRestricted ? p : null;
    }catch(error){matched=null;$('sellerBuilder').hidden=true;$('sellerLookupStatus').textContent=error.inputError?'':error.message;$('sellerAddress').setCustomValidity(error.inputError?error.message:'');if(error.inputError)THMInputs.error($('sellerAddress'),error.message);$('sellerLookupStatus').classList.add('is-error');$('sellerFind').disabled=false;return;}
    // Keep the matched canonical address and exact unit; otherwise retain the entered address.
    address=matched?.address||canonical;$('sellerAddress').value=address;requestKey=crypto.randomUUID();
    $('sellerForm').reset();fillSizes();
    $('sellerHomeDetails').open=false;
    $('sellerSelectedAddress').textContent=address;
    $('sellerMatch').hidden=false;$('sellerPhoto').hidden=true;
    $('sellerMatchText').textContent=matched?'Address matched to a listing record. You can check or correct its details below.':'We’ll check past listing records for this address when preparing your report. Please confirm the address and unit shown above.';
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
    if(!$('sellerCity').value){const cities=[...$('sellerCity').options].map(o=>o.value).filter(Boolean);const city=cities.find(city=>address.toLowerCase().includes(city.toLowerCase()));if(city)setValue('sellerCity',city);}
    $('sellerLookupStatus').textContent=matched?'Home details ready to review.':'Address format checked. Please confirm your home below.';
    $('sellerBuilder').hidden=false;$('sellerSuccess').hidden=true;$('sellerFind').disabled=false;$('sellerAddressBadge').textContent=matched?'ADDRESS MATCHED':'ADDRESS TO CONFIRM';$('sellerFactsSummary').textContent=[matched?.propertySubType,matched?.livingAreaRange?matched.livingAreaRange+' sq ft':null,matched?.cityRegion].filter(Boolean).join(' · ');$('sellerBuilder').scrollIntoView({block:'start',behavior:'smooth'});
    window.gtag?.('event','seller_address_started',{lookup_matched:!!matched});
  });
  for(const id of ['sellerTargetMin','sellerTargetMax'])$(id).addEventListener('input',()=>{ $('sellerTargetMin').setCustomValidity('');$('sellerTargetMax').setCustomValidity('');});
  $('sellerForm').noValidate=true;
  $('sellerForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const mobile=THMInputs.phone($('sellerMobile').value);$('sellerMobile').setCustomValidity(mobile?'':THMInputs.phoneHelp);
    const price=id=>$(id).value.trim()?Number($(id).value.replace(/[$,\s]/g,'')):null;
    const targetMin=price('sellerTargetMin'),targetMax=price('sellerTargetMax');
    let priceError='';
    if(targetMin!==null||targetMax!==null){if(targetMin===null||targetMax===null)priceError='Enter both minimum and maximum, or leave both blank.';else if(!Number.isFinite(targetMin)||!Number.isFinite(targetMax)||targetMin<50000||targetMax>100000000)priceError='Enter a valid price range between $50,000 and $100,000,000.';else if(targetMin>targetMax)priceError='The maximum must be at least the minimum.';}
    $('sellerTargetMin').setCustomValidity(priceError);$('sellerTargetMax').setCustomValidity(priceError);if(!validateForm())return;
    const optionalNumber=id=>$(id).value===''?null:Number($(id).value);
    const profile={version:2,homeType:$('sellerType').value||'unknown',city:$('sellerCity').value,community:$('sellerCommunity').value.trim(),sizeBand:$('sellerSize').value||'unknown',beds:optionalNumber('sellerBeds'),belowBeds:optionalNumber('sellerBelowBeds'),basement:$('sellerBasement').value,entrance:$('sellerEntrance').value,kitchens:optionalNumber('sellerKitchens'),postal:$('sellerPostal').value.trim(),condition:'unknown',upgrades:[],targetMin,targetMax,targetPrice:null,timing:$('sellerTiming').value,notes:'',ownerConsent:$('sellerOwnerConsent').checked,contactConsent:$('sellerContactConsent').checked};
    $('sellerSubmit').disabled=true;$('sellerSubmit').textContent='Preparing your request…';$('sellerError').textContent='';
    try {
      const response=await fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_mode:'seller',showing_requested:false,name:$('sellerName').value.trim(),email:$('sellerEmail').value.trim(),mobile,property_input:address,resolved_address:address,seller_profile:profile,request_key:requestKey,page_url:location.href,website:$('sellerWebsite').value})});
      const data=await response.json();if(!response.ok||!data.ok||!data.lead_id)throw new Error(data.error||'Your request could not be saved. Please try again.');
      $('sellerBuilder').hidden=true;$('sellerSuccess').hidden=false;$('sellerSuccessNote').textContent=`We’ve saved your review for ${address}. Your seller report will be sent to ${$('sellerEmail').value.trim()}.`;$('sellerSuccess').focus();$('sellerSuccess').scrollIntoView({block:'center',behavior:'smooth'});window.gtag?.('event','seller_report_requested');
    }catch(error){$('sellerError').textContent=error.message||'Please try again.';}finally{$('sellerSubmit').disabled=false;$('sellerSubmit').textContent='Get my selling price report';}
  });
  const initial=new URLSearchParams(location.search).get('address');if(initial)$('sellerAddress').value=initial.slice(0,500);
})();
