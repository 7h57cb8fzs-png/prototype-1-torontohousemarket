from pathlib import Path
from urllib.parse import urlencode
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.lib.utils import ImageReader
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]/'marketing'/'seller-presentation'
OUT=ROOT/'approved-template-v1.pdf'
W,H=612,792
GREEN=HexColor('#153F39'); INK=HexColor('#183B35'); MUTED=HexColor('#536660')
IVORY=HexColor('#F7F5EF'); GOLD=HexColor('#AF8C48'); LINE=HexColor('#D6DED8')
for name,fn in [('Sans','DejaVuSans.ttf'),('Bold','DejaVuSans-Bold.ttf'),('Serif','DejaVuSerif.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'/usr/share/fonts/truetype/dejavu/'+fn))
pdfmetrics.registerFontFamily('Sans',normal='Sans',bold='Bold')
c=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1)
c.setTitle('Golestan Team Seller Presentation Template')
c.setAuthor('Golestan Team | Toronto House Market')
c.setSubject('Approved seller presentation layout, October 2026')

def rect(x,y,w,h,fill,stroke=None,r=0):
    c.setFillColor(fill);c.setStrokeColor(stroke or fill)
    if r: c.roundRect(x,H-y-h,w,h,r,stroke=bool(stroke),fill=1)
    else:c.rect(x,H-y-h,w,h,stroke=bool(stroke),fill=1)

def txt(s,x,y,size=11,font='Sans',color=INK):
    c.setFillColor(color);c.setFont(font,size);c.drawString(x,H-y-size,s)

def para(s,x,y,w,size=11,leading=16,color=INK,font='Sans'):
    p=Paragraph(s,ParagraphStyle('p',fontName=font,fontSize=size,leading=leading,textColor=color))
    _,h=p.wrap(w,H);p.drawOn(c,x,H-y-h);return h

def line(x,y,w):
    c.setStrokeColor(LINE);c.setLineWidth(.7);c.line(x,H-y,x+w,H-y)

def photo(path,x,y,w,h):
    im=Image.open(path);iw,ih=im.size;scale=max(w/iw,h/ih)
    dw,dh=iw*scale,ih*scale
    c.saveState();p=c.beginPath();p.rect(x,H-y-h,w,h);c.clipPath(p,stroke=0)
    c.drawImage(ImageReader(im),x+(w-dw)/2,H-y-h+(h-dh)/2,dw,dh,mask='auto')
    c.restoreState()

def link(url,x,y,w,h):c.linkURL(url,(x,H-y-h,x+w,H-y),relative=0,thickness=0)

def header(page):
    rect(0,0,W,H,IVORY)
    rect(42,30,42,42,GREEN,r=9);txt('THM',47,43,13,'Bold',white)
    txt('TORONTO HOUSE MARKET',98,33,10,'Bold')
    txt('.COM',98+pdfmetrics.stringWidth('TORONTO HOUSE MARKET','Bold',10)+4,35.8,7.2,'Bold')
    link('https://torontohousemarket.com',98,30,211,19)
    txt('G O L E S T A N  T E A M',98,51,9,color=MUTED)
    txt('PERSONALIZED PREVIEW',429,35,7.6,'Bold',MUTED)
    line(42,89,528)

def footer(page):
    txt('Alireza Golestan & Mehrdad Golestan · Sales Representatives',72,748,8.0,'Bold')
    txt('CENTURY 21 Leading Edge Realty Inc., Brokerage',72,761,7.8,color=MUTED)
    brokerage_logo(761,7.8)
    txt(f'{page} / 2',548,760,8,color=MUTED)

def brokerage_logo(y,size):
    c.drawImage(str(ROOT/'c21-seal-gold.png'),42,H-y-8,18,22.95,mask='auto',preserveAspectRatio=True,anchor='c')

header(1)
txt('PREPARED FOR THE HOMEOWNER AT',42,111,9,'Bold',MUTED)
txt('Your next chapter',40,214,31,'Serif')
txt('starts with a plan.',40,253,31,'Serif')
para('Thinking about your next move? We’ll help you present your home, reach buyers, make selling costs clear, and save you thousands in selling commission.',42,304,510,11.5,17)

txt('Recent sales on your street / neighbourhood',42,361,17,'Bold')

rect(42,645,528,90,GREEN,r=4)
txt('CALL OR TEXT MEHRDAD',58,655,10,'Bold',white)
txt('647-772-4704',56,672,35,'Bold',white)
link('tel:+16477724704',58,652,485,62)
footer(1)
c.showPage()

header(2)
txt('A clearer plan.',40,110,29,'Serif')
txt('A personal approach.',40,147,29,'Serif')

photo(ROOT.parent/'thm-team-v1.png',42,205,190,253.34)
txt('ALIREZA & MEHRDAD',42,469,9,'Bold')
txt('Golestan Team',42,484,11,'Serif')

txt('OUR PROPOSED APPROACH',253,204,9,'Bold',MUTED)
items=[
 ('01','Position your home','Review relevant sales and current competition to shape a clear pricing plan.'),
 ('02','Make the first impression count','Plan preparation, professional photography and a compelling property story.'),
 ('03','Put the plan in front of buyers','Coordinate listing exposure, digital promotion and personal follow-up.'),
 ('04','Stay involved, every step','Review feedback together and guide offers, negotiations and next steps.'),
]
for i,(num,title,body) in enumerate(items):
    y=232+i*65
    txt(num,253,y,10,'Bold',GOLD)
    txt(title,279,y-1,10.3,'Bold')
    para(body,279,y+17,287,9.5,13.5,color=MUTED)

rect(42,514,528,83,HexColor('#E5EBE5'),r=4)
txt('1%',56,520,42,'Serif')
txt('LISTING-SIDE FEE + HST',148,528,11,'Bold')
para('Any agreed buyer-brokerage compensation is separate. Your written proposal confirms included services and any additional costs.',148,549,401,9.4,13.5)

txt('Call or text Mehrdad',42,634,12,'Bold')
txt('647-772-4704',40,652,34,'Bold')
link('tel:+16477724704',42,632,375,61)

txt('Scan to start your',474,701,8,color=MUTED)
txt('THM seller report',474,712,8,'Bold')
txt('Address prefilled',474,723,7.3,color=MUTED)
txt('Not intended to solicit sellers under contract with another brokerage or real estate agent.',42,723,7,color=HexColor('#7C8781'))

line(42,737,528)
txt('Alireza Golestan & Mehrdad Golestan · Sales Representatives',72,747,7.8,'Bold')
txt('CENTURY 21 Leading Edge Realty Inc., Brokerage',72,759,7.7,color=MUTED)
brokerage_logo(759,7.7)
txt('1053 McNicoll Ave, Toronto, ON M1W 3W6 · torontohousemarket.com',72,771,7.2,color=MUTED)
txt('2 / 2',548,759,8,color=MUTED)
c.showPage();c.save()

print(OUT)
