"""Independent float32 oracle for the frozen PRODUCT full-edited cache.

20-byte records hold full edited RGB and baseline RGB halves, not residuals.
Fresh NR RGB is preserved even when a guide makes its history invalid.
No NGX/game/runtime qualification is implied by this CPU model.
"""
from dataclasses import dataclass
import numpy as np

RECORD=np.dtype([("words","<u4",(3,)),("depth","<f4"),("valid","<u4")])

@dataclass
class Constants:
    width:int
    height:int
    motion_width:int
    motion_height:int
    depth_width:int
    depth_height:int
    motion_x:int=0
    motion_y:int=0
    depth_x:int=0
    depth_y:int=0
    encoding:int=2
    maximum_motion_pixels:float=32
    mv_to_output_x:float=1
    mv_to_output_y:float=1
    depth_absolute:float=1e-5
    depth_relative:float=.01
    luma_stops:float=.2
    color_relative:float=.1
    color_absolute:float=.01
    reserved:float=0

def linear(x,encoding):
    x=np.asarray(x,dtype=np.float32)
    if encoding==2:return x
    x=np.maximum(x,0)
    return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**np.float32(2.4))

def encoded(x,encoding):
    x=np.asarray(x,dtype=np.float32)
    if encoding==2:return x
    x=np.maximum(x,0)
    return np.clip(np.where(x<=.0031308,12.92*x,1.055*x**np.float32(1/2.4)-.055),0,1)

def luma(x):
    return np.dot(np.maximum(x,0),np.array([.2126,.7152,.0722],np.float32))

def guide(p,w,h,x,y,c):
    # Explicit float32 arithmetic as in cs_5_1, before integer truncation.
    gx=min(int(np.float32(np.float32(p[0]+.5)*w/c.width)),w-1)+x
    gy=min(int(np.float32(np.float32(p[1]+.5)*h/c.height)),h-1)+y
    return gx,gy

def current_depth(p,depth,c):
    x,y=guide(p,c.depth_width,c.depth_height,c.depth_x,c.depth_y,c)
    return depth[y,x]

def half_d3d(values):
    """D3D narrowing conversion rounds toward zero, unlike numpy float16.

    https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-data-conversion
    The oracle deliberately follows f32tof16 shader conversion semantics.
    """
    values=np.asarray(values,np.float32)
    rounded=values.astype('<f2')
    bits=rounded.view('<u2').copy()
    overshoot=np.isfinite(values)&(np.abs(rounded.astype(np.float32))>np.abs(values))
    magnitude=bits&np.uint16(0x7fff)
    bits=np.where(overshoot,(bits&np.uint16(0x8000))|(magnitude-1),bits).astype('<u2')
    return bits.view('<f2')

def store(dst,p,edited,reference,depth,valid):
    edited=np.asarray(edited,np.float32);reference=np.asarray(reference,np.float32)
    valid=bool(valid and np.all(np.isfinite(edited)) and np.all(np.isfinite(reference))
               and np.isfinite(depth) and np.all(np.abs(edited)<=65504)
               and np.all(np.abs(reference)<=65504))
    values=np.r_[edited,reference] if valid else np.zeros(6,np.float32)
    half=half_d3d(values).view("<u2").astype(np.uint32)
    words=half[::2] | (half[1::2]<<16)
    x,y=p;dst[y,x]["words"]=words;dst[y,x]["depth"]=depth if valid else 0
    dst[y,x]["valid"]=int(valid)

def read(src,p):
    x,y=p;row=src[y,x];words=row["words"]
    halves=np.stack([words&65535,words>>16],axis=-1).astype("<u2").ravel()
    values=halves.view("<f2").astype(np.float32)
    edited,reference=values[:3],values[3:]
    depth=row["depth"]
    valid=row["valid"]==1 and np.all(np.isfinite(values)) and np.isfinite(depth)
    return bool(valid),edited,reference,depth

def consistent(history,history_depth,current,depth,c):
    if abs(history_depth-depth)>c.depth_absolute+c.depth_relative*max(abs(history_depth),abs(depth)):
        return False
    l0=max(luma(history),1e-4);l1=max(luma(current),1e-4)
    if abs(np.log2(l0/l1))>c.luma_stops:return False
    scale=max(abs(history))
    return bool(max(abs(history-current))<=c.color_absolute+c.color_relative*max(scale,luma(current)))

def refresh(current,edited,depth,c,return_display=False):
    dst=np.zeros((c.height,c.width),RECORD)
    display=np.asarray(edited,np.float32).copy()
    for y in range(c.height):
        for x in range(c.width):
            p=(x,y);reference=linear(current[y,x,:3],c.encoding)
            neural=linear(edited[y,x,:3],c.encoding);z=current_depth(p,depth,c)
            valid=(np.all(np.isfinite(reference)) and np.all(np.isfinite(neural))
                   and np.isfinite(z) and np.all(abs(reference)<=65504) and np.all(abs(neural)<=65504))
            # Record validity never replaces a fresh NR pixel. Even malformed
            # edited RGB remains the incoming NR pixel; only alpha is restored.
            display[y,x,3]=current[y,x,3]
            store(dst,p,neural,reference,z,valid)
    return (dst,display) if return_display else dst

def reproject(current,motion,depth,previous,c):
    output=np.asarray(current,np.float32).copy()
    nxt=np.zeros((c.height,c.width),RECORD)
    accepted=np.zeros((c.height,c.width),bool)
    for y in range(c.height):
        for x in range(c.width):
            p=(x,y);reference=linear(current[y,x,:3],c.encoding);z=current_depth(p,depth,c)
            mx,my=guide(p,c.motion_width,c.motion_height,c.motion_x,c.motion_y,c)
            mv=motion[my,mx];edited_weighted=np.zeros(3,np.float32)
            reference_weighted=np.zeros(3,np.float32);valid=False
            if np.all(np.isfinite(reference)) and np.isfinite(z) and np.all(np.isfinite(mv)):
                displacement=mv*np.array([c.mv_to_output_x,c.mv_to_output_y],np.float32)
                prev=np.array(p,np.float32)+displacement
                if (np.all(abs(displacement)<=c.maximum_motion_pixels) and np.all(prev>=0)
                    and prev[0]<=c.width-1 and prev[1]<=c.height-1):
                    q=np.floor(prev).astype(int);f=prev-q
                    valid=True
                    for dy in range(2):
                        for dx in range(2):
                            weight=np.float32((1-f[0] if dx==0 else f[0])*(1-f[1] if dy==0 else f[1]))
                            if weight<=0:continue
                            tap=(q[0]+dx,q[1]+dy)
                            if tap[0]>=c.width or tap[1]>=c.height:valid=False;continue
                            t=read(previous,tap)
                            if t[0] and consistent(t[2],t[3],reference,z,c):
                                edited_weighted+=weight*t[1];reference_weighted+=weight*t[2]
                            else:valid=False
                    valid=valid and np.all(np.isfinite(edited_weighted)) and np.all(np.isfinite(reference_weighted))
            composite=np.zeros(3,np.float32)
            if valid:
                correction=reference if c.encoding==2 else half_d3d(reference).astype(np.float32)
                composite=edited_weighted+(correction-reference_weighted)
                if np.all(np.isfinite(composite)) and np.all(abs(composite)<=65504):
                    output[y,x,:3]=encoded(composite,c.encoding)
                else:valid=False;composite[:]=0
            if not valid:composite[:]=0
            accepted[y,x]=valid
            store(nxt,p,composite,reference,z,valid)
    return output,nxt,accepted
