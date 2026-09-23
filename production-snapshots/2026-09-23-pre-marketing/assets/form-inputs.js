/* Shared, visible form feedback. Phone format checks do not verify ownership. */
(() => {
  const phone = value => {
    const raw=String(value||'').trim();
    if(!/^\+?[\d\s().-]+$/.test(raw)||raw.length>24)return null;
    let digits=raw.replace(/\D/g,'');
    if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);else if(raw.startsWith('+'))return null;
    if(!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)||digits.slice(1,3)==='11'||digits.slice(4,6)==='11'||/^(\d)\1{9}$/.test(digits)||['1234567890','0123456789','9876543210'].includes(digits))return null;
    return '+1'+digits;
  };
  const phoneHelp='Enter a 10-digit phone number, such as 647-890-4704. You can include +1.';
  function error(input,message){
    if(!input.id)return;
    const id=input.id+'Error';let note=document.getElementById(id);
    if(!note){note=document.createElement('small');note.id=id;note.className='field-error';note.setAttribute('aria-live','polite');const anchor=input.type==='checkbox'?input.closest('label'):input.closest('.seller-address-control')||input.closest('.search-box')||input.closest('.thm-select')||input;anchor.insertAdjacentElement('afterend',note);}
    note.textContent=message;note.hidden=!message;
    input.setAttribute('aria-invalid',String(!!message));
    const described=new Set((input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));described.add(id);input.setAttribute('aria-describedby',[...described].join(' '));
    input.closest('.thm-select')?.querySelector('.thm-select-trigger')?.setAttribute('aria-invalid',String(!!message));
  }
  function check(input){
    if(input.type==='tel')input.setCustomValidity(!input.value&&!input.required||phone(input.value)?'':phoneHelp);
    const message=input.validity.valueMissing?(input.type==='checkbox'?'Please confirm this to continue.':'Please complete this field.'):input.validity.typeMismatch&&input.type==='email'?'Enter a valid email address, such as name@example.com.':input.validationMessage;
    error(input,input.validity.valid?'':message);return input.validity.valid;
  }
  function validate(form){
    let first;
    for(const input of form.querySelectorAll('input,select,textarea'))if(!input.disabled&&input.willValidate&&!check(input))first ||= input;
    if(!first)return true;
    if(first.closest('details'))first.closest('details').open=true;
    first.focus();return false;
  }
  window.THMInputs={phone,phoneHelp,error,check,validate};
  document.addEventListener('blur',e=>{const input=e.target;if(input.matches('input:not([type=password]):not([type=hidden]),select,textarea')&&(input.value||input.getAttribute('aria-invalid')==='true'))check(input);},true);
  document.addEventListener('input',e=>{const input=e.target;if(input.matches('input:not([type=password]),textarea')&&input.getAttribute('aria-invalid')==='true'){if(input.type!=='tel')input.setCustomValidity('');check(input);}});
  document.addEventListener('change',e=>{if(e.target.matches('select,input[type=checkbox]'))check(e.target);});
  document.addEventListener('reset',e=>{for(const input of e.target.querySelectorAll('input,select,textarea')){input.setCustomValidity('');error(input,'');}});
  document.addEventListener('invalid',e=>{if(e.target.type!=='password')check(e.target);},true);
})();
