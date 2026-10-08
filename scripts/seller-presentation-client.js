import {PDFDocument, rgb, PDFName, PDFString} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
const ASSETS='/marketing/seller-presentation/',H=792;
const green=rgb(21/255,63/255,57/255),muted=rgb(83/255,102/255,96/255),white=rgb(1,1,1);
async function asset(name){const r=await fetch(ASSETS+name);if(!r.ok)throw Error('The approved presentation template could not be loaded.');return r.arrayBuffer();}
let assetPromise;
function assets(){return assetPromise ||= Promise.all(['approved-template-v1.pdf','DejaVuSans.ttf','DejaVuSans-Bold.ttf','DejaVuSerif.ttf'].map(asset)).catch(e=>{assetPromise=null;throw e;});}
const dateText=value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'America/Toronto'}).format(new Date(value.length===10?value+'T12:00:00Z':value)).toUpperCase();
async function photo(data){
 if(typeof data!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,/.test(data)||data.length>3e6)return null;
 try{const blob=await (await fetch(data)).blob();const im=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=672;canvas.height=376;const ctx=canvas.getContext('2d');const scale=Math.max(672/im.width,376/im.height);ctx.drawImage(im,(672-im.width*scale)/2,(376-im.height*scale)/2,im.width*scale,im.height*scale);im.close();return canvas.toDataURL('image/jpeg',0.88);}catch{return null;}
}
export async function generatePresentation(data){
 if(data.templateVersion!=='approved-v1'||data.sales?.length!==3||!data.address||!data.fullAddress)throw Error('Presentation details are incomplete. Refresh this property.');
 const expected='https://torontohousemarket.com/seller?'+new URLSearchParams({address:data.fullAddress});if(data.sellerUrl!==expected)throw Error('The property QR destination is invalid.');
 const [template,sansBytes,boldBytes,serifBytes]=await assets(),pdf=await PDFDocument.load(template);pdf.registerFontkit(fontkit);
 const [sans,bold,serif]=await Promise.all([sansBytes,boldBytes,serifBytes].map(b=>pdf.embedFont(b,{subset:true})));const [p1,p2]=pdf.getPages();
 const clean=s=>String(s??'').replace(/[\x00-\x1f\x7f]/g,' ');
 function text(p,s,x,y,size=11,font=sans,color=green,maxWidth=null){s=clean(s);if(maxWidth){while(size>6&&font.widthOfTextAtSize(s,size)>maxWidth)size-=0.25;if(font.widthOfTextAtSize(s,size)>maxWidth)throw Error('An address is too long for the approved layout. Please use a manually prepared PDF.');}p.drawText(s,{x,y:H-y-size,size,font,color});}
 function wrap(p,s,x,y,w,size=11,font=sans,color=muted,leading=14,maxLines=3){const words=clean(s).split(/\s+/),lines=[];let line='';for(const word of words){const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)>w&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);if(lines.length>maxLines)throw Error('An address is too long for the approved layout. Please use a manually prepared PDF.');lines.forEach((s,i)=>text(p,s,x,y+i*leading,size,font,color,w));}
 function link(p,url,x,y,w,h){const ref=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,H-y-h,x+w,H-y],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}}));p.node.addAnnot(ref);}
 pdf.setTitle(data.address+' | Golestan Team Seller Presentation');pdf.setAuthor('Golestan Team | Toronto House Market');pdf.setSubject('Customized seller presentation');pdf.setCreationDate(new Date(data.generatedAt));
 for(const p of [p1,p2])text(p,dateText(data.generatedAt),470,52,7.6,sans,muted,100);
 // Two lines fit in the original address area; normal addresses retain the approved 34pt serif.
 if(serif.widthOfTextAtSize(data.address,34)<=528)text(p1,data.address,40,133,34,serif);else wrap(p1,data.address,40,133,530,23,serif,green,25,2);
 text(p1,data.locality,42,187,10,sans,muted,528);
 text(p1,'Three local examples to start the conversation.',42,389,10,sans,muted);
 const pictures=await Promise.all(data.sales.map(s=>photo(s.photoData))),missingPhotos=[];
 for(let i=0;i<3;i++){const s=data.sales[i],x=42+i*180;
  if(pictures[i]){const im=await pdf.embedJpg(pictures[i]);p1.drawImage(im,{x,y:H-415-94,width:168,height:94});}else{missingPhotos.push(s.address);p1.drawRectangle({x,y:H-415-94,width:168,height:94,color:rgb(229/255,235/255,229/255)});text(p1,'Photo unavailable',x+25,454,10,sans,muted);}
  text(p1,'SOLD · '+dateText(s.date),x,520,7.5,bold,muted,168);
  text(p1,s.address,x,537,10,bold,green,168);text(p1,new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(s.price),x,555,19,bold,green,168);text(p1,s.type,x,582,8.5,sans,muted,168);
 }
 wrap(p1,'Neighbourhood activity, not an estimate of your home’s value or sales attributed to our team. Selected sales from the last 180 days; homes differ in size and condition.',42,607,528,8.3,sans,muted,11,3);
 text(p1,'Text '+data.keyword+' to start a no-obligation conversation.',58,716,10,sans,white,490);
 text(p2,'LET’S TALK ABOUT '+data.address.toUpperCase(),42,616,9,bold,muted,415);
 text(p2,'Text '+data.keyword+' · No obligation to list.',42,696,10,sans,muted,410);
 const qr=await QRCode.toDataURL(data.sellerUrl,{errorCorrectionLevel:'M',margin:4,width:728,color:{dark:'#000000',light:'#FFFFFF'}});const qrImage=await pdf.embedPng(qr);p2.drawImage(qrImage,{x:474,y:H-607-91,width:91,height:91});link(p2,data.sellerUrl,474,607,91,91);
 const bytes=await pdf.save();if(bytes.length>8*1024*1024)throw Error('This PDF exceeds the mailing size limit. Try again with a smaller manually prepared PDF.');
 return {file:new File([bytes],data.address.replace(/[^a-zA-Z0-9 ._-]/g,'-').slice(0,80)+'-Seller-Presentation.pdf',{type:'application/pdf'}),missingPhotos,sellerUrl:data.sellerUrl};
}
