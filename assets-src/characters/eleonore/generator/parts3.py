import sys; sys.path.insert(0,'/tmp/eleo')
from common import *
import numpy as np
def fire_mask(fr):
    a=fr[:,:,3]; R=fr[:,:,0]; G=fr[:,:,1]; B=fr[:,:,2]
    op=a==255
    X=np.arange(64)[None,:]; Y=np.arange(64)[:,None]
    zoneA=(Y<=23)&(X<=28); zoneB=(Y>=24)&(Y<=34)&(X<=27)
    pure=(R>=250)&(G<=145)                      # saturated flame orange
    darkf=(B<=30)&(R>=140)&(G<=80)              # dark fire base
    yell=(R>=250)&(G>=180)&(B<=120)             # yellow core
    cream_tip=(R>=250)&(G>=200)&(B>120)&(X<=23) # hottest tip (avoid sala head)
    col=pure|darkf|yell|cream_tip
    m=op&((zoneA&col)|(zoneB&col))
    return m
def split3(fr):
    a=fr[:,:,3]; op=a==255
    glow=(a>0)&(a<255)
    fire=fire_mask(fr)
    book=np.zeros((64,64),bool); book[28:46,41:56]=op[28:46,41:56]
    rest=op&~fire&~book
    return glow,book,fire,rest
def char_tail(img):
    """recolor exposed salmon tail to charred maroon + thin it"""
    o=img.copy()
    for y in range(12,28):
        for x in range(14,28):
            p=o[y,x]
            if p[3]==255 and p[0]>=180 and 45<=p[2]<=165 and p[1]<=175:
                if p[0]>=240 and p[1]<=110: o[y,x]=[139,45,34,255]   # bright red
                elif p[1]>=140:            o[y,x]=[102,57,49,255]   # pale salmon
                else:                      o[y,x]=[139,58,48,255]   # mid
    # thin isolated
    p=o.copy()
    for y in range(12,28):
        for x in range(14,28):
            if p[y,x,3]==255:
                n=sum(p[y+dy,x+dx,3]==255 for dy in(-1,0,1) for dx in(-1,0,1) if (dy,dx)!=(0,0))
                if n<=1: o[y,x]=0
    return o
