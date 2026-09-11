/* Site-styled menus. Native selects retain values, form submission and validation. */
(() => {
  let opened;
  function enhance(select) {
    if(select.dataset.enhanced) return;
    select.dataset.enhanced='true';
    const wrap=document.createElement('div');wrap.className='thm-select';
    select.parentNode.insertBefore(wrap,select);wrap.append(select);
    const trigger=document.createElement('button');trigger.type='button';trigger.className='thm-select-trigger';
    trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=select.closest('label');
    trigger.setAttribute('aria-label',label?.childNodes[0]?.textContent.trim() || select.getAttribute('aria-label') || select.name || 'Choose an option');
    const menu=document.createElement('div');menu.className='thm-select-menu';menu.hidden=true;menu.setAttribute('role','listbox');
    menu.id=(select.id || 'select-'+Math.random().toString(36).slice(2))+'-options';trigger.setAttribute('aria-controls',menu.id);
    wrap.append(trigger,menu);select.classList.add('thm-select-native');select.tabIndex=-1;
    function close(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(opened===close)opened=null;}
    function sync(){trigger.textContent=select.selectedOptions[0]?.textContent || 'Choose';trigger.disabled=select.disabled;}
    function open(){
      if(opened)opened();menu.replaceChildren();
      for(const option of select.options){
        const button=document.createElement('button');button.type='button';button.textContent=option.textContent;button.disabled=option.disabled;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));
        button.addEventListener('click',e=>{e.preventDefault();select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();trigger.focus();});menu.append(button);
      }
      menu.hidden=false;trigger.setAttribute('aria-expanded','true');opened=close;
      wrap.classList.toggle('opens-up',innerHeight-trigger.getBoundingClientRect().bottom<220 && trigger.getBoundingClientRect().top>220);
      (menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
    }
    trigger.addEventListener('click',e=>{e.preventDefault();menu.hidden?open():close();});
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
    let typed='',timer;
    menu.addEventListener('keydown',e=>{
      const options=[...menu.querySelectorAll('button:not(:disabled)')],i=options.indexOf(document.activeElement);
      if(e.key==='Escape'){e.preventDefault();close();trigger.focus();return;}
      if(e.key==='Tab'){close();return;}
      let next;
      if(e.key==='ArrowDown')next=(i+1)%options.length;
      if(e.key==='ArrowUp')next=(i-1+options.length)%options.length;
      if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;
      if(next!=null){e.preventDefault();options[next]?.focus();}
      else if(e.key.length===1){typed+=e.key.toLowerCase();clearTimeout(timer);timer=setTimeout(()=>typed='',600);options.find(x=>x.textContent.toLowerCase().startsWith(typed))?.focus();}
    });
    document.addEventListener('pointerdown',e=>{if(!wrap.contains(e.target))close();});
    select.addEventListener('change',sync);select.addEventListener('focus',()=>trigger.focus());
    select.addEventListener('invalid',()=>{trigger.focus();trigger.setAttribute('aria-invalid','true');});
    select.form?.addEventListener('reset',()=>setTimeout(sync,0));
    new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true});sync();
  }
  document.querySelectorAll('select').forEach(enhance);
  new MutationObserver(()=>document.querySelectorAll('select:not([data-enhanced])').forEach(enhance)).observe(document.body,{childList:true,subtree:true});
})();
