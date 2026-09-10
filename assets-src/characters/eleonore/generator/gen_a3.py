import sys; sys.path.insert(0,'/tmp/eleo')
from common import *
from parts3 import split3,char_tail
import numpy as np

base=load(1)
glowM,bookM,fireM,restM=split3(base)
X=np.arange(64)[None,:]; Y=np.arange(64)[:,None]
R=base[:,:,0]; G=base[:,:,1]; B=base[:,:,2]
navy=(B>=70)&(B>R)&(abs(R-G)<40)
hatsala=restM&(Y<=28)&(navy|(X<=32))
rembody=restM&~hatsala
HATS=extract(base,hatsala); HATS_CH=char_tail(HATS)
REMB=extract(base,rembody)
BOOK=extract(base,bookM); GLOW=extract(base,glowM); FL1=extract(base,fireM)

fr4=load(4); g4,_,f4m,_=split3(fr4)
FL4=extract(fr4,f4m); GL4=extract(fr4,g4)

TIP=(17,24)
def near_tip(img,rad):
    o=img.copy(); ys,xs=np.nonzero(o[:,:,3]>0)
    for y,x in zip(ys,xs):
        if (y-TIP[0])**2+(x-TIP[1])**2>rad*rad: o[y,x]=0
    return o
def erode_f(img,keep):
    o=img.copy(); ys,xs=np.nonzero(o[:,:,3]>0)
    idx=np.argsort((ys-TIP[0])**2+(xs-TIP[1])**2)
    for y,x in list(zip(ys[idx],xs[idx]))[max(1,int(len(ys)*keep)):]: o[y,x]=0
    return o
SM=(84,87,131); SMH=(122,126,168)
def puff(lo,hi=()):
    o=blank(); put(o,lo,SM); put(o,hi,SMH); return o

SK_LO,SK_HI,GY=42,56,57
def strip_boot(sk):
    o=sk.copy()
    for y in range(46,58):
        for x in range(29,43):
            p=o[y,x]
            r,g,b=int(p[0]),int(p[1]),int(p[2])
            if p[3]==255 and 45<=r<=125 and 28<=g<=68 and 25<=b<=58 and r>g>=b-6:
                o[y,x]=0
    return o
def pose(k,wn,slide,lean=0,boot_off=False):
    total=SK_HI-SK_LO+1; keep=max(1,total-k)
    src=[SK_HI-round(i*(total-1)/(keep-1)) for i in range(keep)] if keep>1 else [SK_HI]
    mapping={}; d=GY
    for s in src: mapping[d]=s; d-=1
    skirt=np.zeros_like(REMB); skirt[SK_LO:SK_HI+1]=REMB[SK_LO:SK_HI+1]
    if boot_off: skirt=strip_boot(skirt)
    torso=REMB-skirt
    sk=rowmap(skirt,mapping)
    if wn: sk=widen(sk,range(GY-keep+1,GY+1),wn)
    tdy=(GY-SK_HI)+k
    hats=HATS_CH if k>=2 else HATS
    return compose([sk,shift(torso,tdy,lean),shift(hats,tdy+slide,lean*2)])
def floatpose(dy,charred=False,dx=0):
    return shift(compose([REMB,char_tail(HATS) if charred else HATS]),dy,dx)

def book_flat():
    o=blank()
    OUT=(34,32,52); NAV=(62,69,115); NAVD=(42,47,84); ORG=(239,130,55); PAGE=(176,186,205)
    y=54
    for x in range(43,52): o[y,x]=[*OUT,255]
    for x in range(42,53): o[y+1,x]=[*NAV,255]
    for x in range(42,52): o[y+2,x]=[*PAGE,255]
    for x in range(42,53): o[y+3,x]=[*NAVD,255]
    for x in range(43,52): o[y+4,x]=[*OUT,255]
    o[y+1,41]=[*OUT,255]; o[y+2,41]=[*OUT,255]; o[y+3,41]=[*OUT,255]
    o[y+1,51]=[*ORG,255]; o[y+3,51]=[*ORG,255]
    o[y+2,52]=[*OUT,255]; o[y+1,53]=0; 
    return o
BOOKFLAT=book_flat()
sub=BOOK[28:46,41:56]
rot=np.zeros_like(BOOK); rot[33:48,38:56]=np.rot90(sub,-1)[:15,:18]

frames=[]
frames.append(compose([scale_alpha(GLOW,0.8),floatpose(0),BOOK,FL1]))                      # f1 own flame, dimmer glow
frames.append(compose([scale_alpha(near_tip(GL4,9),0.4),floatpose(0),shift(BOOK,2,0),erode_f(FL4,0.5)]))  # f2
frames.append(compose([scale_alpha(near_tip(GLOW,5),0.18),floatpose(1,charred=True),shift(rot,6,0),near_tip(erode_f(FL4,0.2),4),puff([(13,25)],[(12,24)])]))
frames.append(compose([floatpose(1,charred=True),shift(rot,10,1),puff([(11,26),(10,24)],[(9,25)])]))
frames.append(compose([pose(2,1,0,boot_off=False),BOOKFLAT,puff([(8,25)],[(7,26)])]))
frames.append(compose([pose(4,1,1,boot_off=True),BOOKFLAT,puff([(6,26)])]))
frames.append(compose([pose(6,2,2,-1,boot_off=True),BOOKFLAT]))
d8=puff([(57,22),(56,20),(57,46),(56,48)],[(55,21),(55,47)])
frames.append(compose([pose(8,2,3,-1,boot_off=True),BOOKFLAT,d8]))
d9=puff([(56,19),(56,49)])
frames.append(compose([pose(9,3,3,-1,boot_off=True),BOOKFLAT,d9]))
STILL=compose([pose(9,3,3,-1,boot_off=True),BOOKFLAT])
frames.append(STILL)
eb=blank(); put(eb,[(31,22)],(255,116,21)); put(eb,[(30,23)],(161,43,25))
frames.append(compose([STILL,eb]))
frames.append(STILL)

def shadow_ellipse(w):
    o=blank(); cy,cx=59,34
    for y in range(64):
        for x in range(64):
            if ((x-cx)/w)**2+((y-cy)/2.1)**2<=1: o[y,x]=[26,22,33,110]
    return o
sh=[shadow_ellipse(w) for w in (7,7,7.5,8,10,11.5,12.5,13,13,13,13,13)]
render_preview(frames,'/sessions/kind-pensive-sagan/mnt/outputs/death_A.gif',
               '/sessions/kind-pensive-sagan/mnt/outputs/death_A_strip.png',zoom=4,ms=110,shadow=sh)
np.save('/tmp/eleo/frames_A.npy',np.stack(frames)); np.save('/tmp/eleo/shadows_A.npy',np.stack(sh))
print('done')
