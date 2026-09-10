import numpy as np
from PIL import Image
SRC_DIR='/sessions/kind-pensive-sagan/mnt/Eleonore/Idle'
def load(i):
    return np.array(Image.open(f'{SRC_DIR}/Idle{i}.png').convert('RGBA')).astype(np.int32)
def masks_for(fr):
    a=fr[:,:,3]; R=fr[:,:,0]; G=fr[:,:,1]; B=fr[:,:,2]
    op=a==255
    glow=(a>0)&(a<255)
    X=np.arange(64)[None,:]; Y=np.arange(64)[:,None]
    book=np.zeros_like(op); book[28:46,41:56]=op[28:46,41:56]
    warm=(R>170)&((R-B)>90)&op
    crest=(X>=25)&(Y<=13)
    flame=warm&(X<=27)&~crest
    flame|=warm&(X<=24)&(Y<=16)          # sparks left of crest
    rest=op&~book&~flame
    return glow,book,flame,rest
def compose(canvas_layers, size=64):
    out=np.zeros((size,size,4),np.int32)
    for lay in canvas_layers:
        al=lay[:,:,3:4]/255.0
        out[:,:,:3]=(out[:,:,:3]*(1-al)+lay[:,:,:3]*al).astype(np.int32)
        out[:,:,3:4]=np.maximum(out[:,:,3:4],lay[:,:,3:4])
    return out
def blank(): return np.zeros((64,64,4),np.int32)
def extract(fr,mask):
    o=blank(); o[mask]=fr[mask]; return o
def shift(img,dy=0,dx=0):
    o=blank()
    ys,xs=np.nonzero(img[:,:,3]>0)
    ny=ys+dy; nx=xs+dx
    ok=(ny>=0)&(ny<64)&(nx>=0)&(nx<64)
    o[ny[ok],nx[ok]]=img[ys[ok],xs[ok]]
    return o
def rowmap(img,mapping):
    """mapping: dict dest_row -> src_row (rows not present = empty)"""
    o=blank()
    for dy,sy in mapping.items():
        if 0<=dy<64 and 0<=sy<64: o[dy]=img[sy]
    return o
def widen(img,rows,n=1):
    o=img.copy()
    for _ in range(n):
        p=o.copy()
        for y in rows:
            for x in range(1,63):
                if p[y,x,3]==0 and (p[y,x-1,3]>0 or p[y,x+1,3]>0):
                    srcx=x-1 if p[y,x-1,3]>0 else x+1
                    o[y,x]=p[y,srcx]
    return o
def scale_alpha(img,f):
    o=img.copy(); o[:,:,3]=(o[:,:,3]*f).astype(np.int32); return o
def put(o,pts,col):
    for y,x in pts:
        if 0<=y<64 and 0<=x<64: o[y,x]=[*col,255]
def save_png(img,path):
    Image.fromarray(img.astype(np.uint8),'RGBA').save(path)
def render_preview(frames,path_gif,path_strip,zoom=4,ms=100,shadow=None):
    imgs=[]
    for i,f in enumerate(frames):
        bg=Image.new('RGBA',(64,64),(43,38,48,255))
        if shadow is not None:
            sh=Image.fromarray(shadow[i].astype(np.uint8),'RGBA')
            bg.alpha_composite(sh)
        bg.alpha_composite(Image.fromarray(f.astype(np.uint8),'RGBA'))
        imgs.append(bg.resize((64*zoom,64*zoom),Image.NEAREST))
    imgs[0].save(path_gif,save_all=True,append_images=imgs[1:],duration=ms,loop=0,disposal=2)
    n=len(imgs); cols=min(n,7); rows=(n+cols-1)//cols
    strip=Image.new('RGBA',(64*zoom*cols+cols*2,64*zoom*rows+rows*2),(25,22,28,255))
    from PIL import ImageDraw
    d=ImageDraw.Draw(strip)
    for i,im in enumerate(imgs):
        cx=(i%cols)*(64*zoom+2); cy=(i//cols)*(64*zoom+2)
        strip.paste(im,(cx,cy))
        d.text((cx+4,cy+2),str(i+1),fill=(255,255,160,255))
    strip.save(path_strip)
