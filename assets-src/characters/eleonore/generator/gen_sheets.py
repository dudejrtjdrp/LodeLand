import sys; sys.path.insert(0,'/tmp/eleo')
from common import *
import numpy as np
from PIL import Image
OUT='/sessions/kind-pensive-sagan/mnt/moveSword/public/player'

# 1) idle: originals untouched
frames=[Image.open(f'{SRC_DIR}/Idle{i}.png').convert('RGBA') for i in range(1,10)]
sheet=Image.new('RGBA',(64*9,64),(0,0,0,0))
for i,f in enumerate(frames): sheet.paste(f,(i*64,0))
sheet.save(f'{OUT}/eleonoreIdle.png')

# 2) hurt: 4 frames — recoil + flash (base=Idle1 full original)
base=Image.open(f'{SRC_DIR}/Idle1.png').convert('RGBA')
def shifted(img,dx,dy):
    o=Image.new('RGBA',(64,64),(0,0,0,0)); o.paste(img,(dx,dy),img); return o
def flash(img,amt):
    a=np.array(img).astype(np.int32)
    op=a[:,:,3]==255
    for c in range(3):
        ch=a[:,:,c]
        ch[op]=np.clip(ch[op]+(255-ch[op])*amt,0,255).astype(np.int32)
    return Image.fromarray(a.astype(np.uint8),'RGBA')
h=[shifted(base,1,1),shifted(flash(base,0.55),2,1),shifted(flash(base,0.25),1,0),base]
sheet=Image.new('RGBA',(64*4,64),(0,0,0,0))
for i,f in enumerate(h): sheet.paste(f,(i*64,0))
sheet.save(f'{OUT}/eleonoreHurt.png')

# 3) death: 12 frames from approved concept A
fr=np.load('/tmp/eleo/frames_A.npy')
sheet=Image.new('RGBA',(64*12,64),(0,0,0,0))
for i in range(12):
    sheet.paste(Image.fromarray(fr[i].astype(np.uint8),'RGBA'),(i*64,0))
sheet.save(f'{OUT}/eleonoreDeath.png')
for n in ('eleonoreIdle','eleonoreHurt','eleonoreDeath'):
    im=Image.open(f'{OUT}/{n}.png'); print(n,im.size)
