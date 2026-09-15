import {spawn} from 'node:child_process';
// Never expose request headers, query strings, application logs or MLS data.
const child=spawn('npx',['--yes','wrangler@4.129.0','tail','prototype-1-torontohousemarket','--format','json','--version-id','9039b6ee-62a2-4a2f-96fe-8502d8d7c87b'],{detached:true,stdio:['ignore','pipe','pipe']});
let buffer='';
child.stderr.on('data',()=>{});
child.stdout.on('data',chunk=>{buffer+=chunk;});
console.log('Observing request outcomes for 180 seconds.');
const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}},180000);
child.on('close',(exitCode,signal)=>{
  console.log(JSON.stringify({tailExitCode:exitCode,tailSignal:signal}));
  clearTimeout(timer);
  let start=-1,depth=0,quoted=false,escape=false,count=0;
  for(let i=0;i<buffer.length;i++){
    const c=buffer[i];
    if(start<0){if(c==='{'){start=i;depth=1;}continue;}
    if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){
      try{
        const event=JSON.parse(buffer.slice(start,i+1)),request=event.event?.request;
        if(request&&new URL(request.url).pathname==='/api/admin/seller-preview'){
          console.log(JSON.stringify({outcome:event.outcome,status:event.event?.response?.status,exceptions:(event.exceptions||[]).map(e=>({name:e.name,message:/CPU|memory|subrequest|limit|exceed|timeout/i.test(e.message||'')?String(e.message).slice(0,200):'Application exception'}))}));count++;
        }
      }catch{}
      start=-1;
    }
  }
  console.log(JSON.stringify({observedSellerRequests:count}));
});
