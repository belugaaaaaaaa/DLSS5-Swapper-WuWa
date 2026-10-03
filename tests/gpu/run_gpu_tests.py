"""PRODUCT full-edited-cache GPU fixtures freshly compiled and executed.

This validates numerical shader behavior, never NGX hooking/game performance.
"""
from pathlib import Path
import sys,struct,json,subprocess,hashlib,argparse
import numpy as np
VALIDATION=Path(__file__).resolve().parents[2]/'validation'
sys.path.insert(0,str(VALIDATION))
from shader_reference import Constants,RECORD,refresh,reproject,read,store,half_d3d
HERE=Path(__file__).resolve().parent
BUILD=HERE/'build'
FIX=BUILD/'fixtures'

def default():
    c=Constants(8,8,8,8,8,8,depth_absolute=.0001,depth_relative=.01,
                luma_stops=.20,color_relative=.15,color_absolute=.02,reserved=0)
    base=np.empty((8,8,4),np.float32);base[...,:3]=[.25,.3125,.375]
    base[...,3]=np.arange(64,dtype=np.float32).reshape(8,8)/128+.25
    edit=base.copy();edit[...,:3]+=[.03125,-.015625,.0625];edit[...,3]=1
    depth=np.full((8,8),.5,np.float32);motion=np.zeros((8,8,2),np.float32)
    hist=refresh(base,edit,depth,c)
    return c,base,edit,motion,depth,hist

def case(name,mode,modify=None,fmt='rgba32'):
    values=default()
    if modify:modify(*values)
    return name,mode,values,fmt

def large_edit(c,b,e,m,d,h):e[...,:3]=[8.125,100,2];h[:]=refresh(b,e,d,c)
def invalid_refresh(c,b,e,m,d,h):
    e[1,1,0]=np.nan;d[2,2]=np.nan;e[3,3,1]=np.inf;b[4,4,2]=np.inf
def overflow(c,b,e,m,d,h):b[...,:3]=100000;e[...,:3]=1000000;h[:]=refresh(b,e,d,c)
def no_cache(c,b,e,m,d,h):h[:]=0
def invalid_guide(c,b,e,m,d,h):d[:]=np.nan;h[:]=0
def invalid_reference(c,b,e,m,d,h):b[...,:3]=np.inf;h[:]=0
def dark_hdr(c,b,e,m,d,h):b[...,:3]=1024;e[...,:3]=.001;h[:]=refresh(b,e,d,c)
def max_half(c,b,e,m,d,h):b[...,:3]=65504;e[...,:3]=65504;h[:]=refresh(b,e,d,c)
def dark_sdr(c,b,e,m,d,h):c.encoding=1;b[...,:3]=.99;e[...,:3]=.01;h[:]=refresh(b,e,d,c)
def sdr(c,b,e,m,d,h):c.encoding=1;h[:]=refresh(b,e,d,c)
def varying(c,b,e,m,d,h):
    for x in range(8):e[:,x,:3]=b[:,x,:3]+[x/512,x/1024,x/256]
    h[:]=refresh(b,e,d,c)
def translation(c,b,e,m,d,h):varying(c,b,e,m,d,h);m[...]=[-1,0]
def fractional(c,b,e,m,d,h):varying(c,b,e,m,d,h);m[...]=[-.5,-.25]
def depth_reject(c,b,e,m,d,h):h[3:5,3:5]['depth']=.25;m[...]=[.5,.5]
def color_reject(c,b,e,m,d,h):b[...,0]+=.15;b[...,1]-=.15*.2126/.7152;c.color_absolute=.001;c.color_relative=.01
def invalid_reuse(c,b,e,m,d,h):
    h[1,1]['valid']=0;m[2,2]=np.nan;m[3,3]=np.inf;m[4,4]=[100,0]
    h[5,5]['words'][0]=0x7c007c00;d[6,6]=np.nan
def small_cap(c,b,e,m,d,h):c.maximum_motion_pixels=.25;m[...]=[.5,0]
def lowres(c,b,e,m,d,h):
    varying(c,b,e,m,d,h);c.motion_width=c.motion_height=4;c.motion_x=c.motion_y=2
    c.depth_width=c.depth_height=4;c.depth_x=c.depth_y=1;c.mv_to_output_x=2
    m[:]=np.nan;m[2:6,2:6]=[-.5,0];d[:]=np.nan;d[1:5,1:5]=.5
def zero_weight(c,b,e,m,d,h):h[1,2]['depth']=.25
def hdr_overflow(c,b,e,m,d,h):
    b[...,:3]=65000;e[...,:3]=65000
    for y in range(8):
        for x in range(8):store(h,(x,y),np.full(3,65504,np.float32),b[y,x,:3],.5,True)
def quantum(c,b,e,m,d,h):
    e[...,:3]=b[...,:3]+[1e-5,-1e-6,3e-4];h[:]=refresh(b,e,d,c);m[...]=[.125,-.125]

CASES=[case('refresh_basic',0),case('refresh_large_nr_rgb_unclipped',0,large_edit),
       case('refresh_nonfinite_nr_rgb_preserved_history_invalid',0,invalid_refresh),case('refresh_uncacheable_hdr_nr_rgb_preserved',0,overflow),
       case('refresh_srgb',0,sdr),case('reuse_zero_motion_all_edges',1),
       case('reuse_integer_translation',1,translation),case('reuse_fractional_motion',1,fractional),
       case('reuse_raw_depth_rejection',1,depth_reject),case('reuse_equal_luma_rgb_rejection',1,color_reject),
       case('reuse_nonfinite_invalid_offscreen',1,invalid_reuse),case('reuse_max_motion_cap',1,small_cap),
       case('reuse_lowres_guides_with_offsets',1,lowres),case('reuse_zero_weight_bad_neighbor',1,zero_weight),
       case('reuse_srgb',1,sdr),case('reuse_hdr_composite_overflow',1,hdr_overflow),
       case('reuse_half_quantization',1,quantum)]
CASES.extend([case('refresh_no_previous_cache_nr_preserved',0,no_cache),
              case('refresh_invalid_depth_nr_preserved',0,invalid_guide),
              case('refresh_invalid_reference_valid_nr_preserved',0,invalid_reference),
              case('reuse_large_nr_edit_not_clipped',1,large_edit),
              case('reuse_hdr1024_dark001_no_cancellation',1,dark_hdr),
              case('reuse_sdr_bright_reference_dark_edit',1,dark_sdr),
              case('refresh_exact_half_maximum',0,max_half),case('reuse_exact_half_maximum',1,max_half)])

def supported_format(fmt):
    def setup(c,b,e,m,d,h):
        c.encoding=2 if fmt=='rgba16' else 1
        e[...,:3]=1
        if fmt=='rgba16':b[:]=half_d3d(b).astype(np.float32);e[:]=half_d3d(e).astype(np.float32)
        else:
            b[:]=np.rint(np.clip(b,0,1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
            e[:]=np.rint(np.clip(e,0,1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
        h[:]=refresh(b,e,d,c)
    return setup
for fmt in ('rgba16','rgba8'):
    CASES.extend([case('refresh_'+fmt+'_large_static_nr_alpha',0,supported_format(fmt),fmt),
                  case('reuse_'+fmt+'_zero_motion_full_edit_alpha',1,supported_format(fmt),fmt)])

def format_dark_hdr(c,b,e,m,d,h):
    dark_hdr(c,b,e,m,d,h);b[:]=half_d3d(b).astype(np.float32);e[:]=half_d3d(e).astype(np.float32);h[:]=refresh(b,e,d,c)
def format_dark_sdr(c,b,e,m,d,h):
    dark_sdr(c,b,e,m,d,h)
    b[:]=np.rint(np.clip(b,0,1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
    e[:]=np.rint(np.clip(e,0,1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
    h[:]=refresh(b,e,d,c)
CASES.extend([case('refresh_rgba16_hdr1024_dark001',0,format_dark_hdr,'rgba16'),
              case('reuse_rgba16_hdr1024_dark001',1,format_dark_hdr,'rgba16'),
              case('refresh_rgba8_bright_dark_precision',0,format_dark_sdr,'rgba8'),
              case('reuse_rgba8_bright_dark_precision',1,format_dark_sdr,'rgba8')])

def serialize(c):
    return struct.pack('<11I9f',c.width,c.height,c.motion_width,c.motion_height,c.depth_width,c.depth_height,
                       c.motion_x,c.motion_y,c.depth_x,c.depth_y,c.encoding,c.maximum_motion_pixels,
                       c.mv_to_output_x,c.mv_to_output_y,c.depth_absolute,c.depth_relative,c.luma_stops,
                       c.color_relative,c.color_absolute,c.reserved)

def run(adapter_filter='RTX 5070'):
    FIX.mkdir(parents=True,exist_ok=True)
    results=[];adapter=None
    for name,mode,(c,b,e,m,d,h),fmt in CASES:
        source=FIX/(name+'.bin');prefix=FIX/(name+'.gpu')
        raw=struct.pack('<2I',0x51555757,mode)+serialize(c)+b.tobytes()+e.tobytes()+m.tobytes()+d.tobytes()+h.tobytes()
        assert len(raw)==4184;source.write_bytes(raw)
        shader=BUILD/('wuwa_cache_refresh.cso' if mode==0 else 'wuwa_cache_reproject.cso')
        proc=subprocess.run([str(BUILD/'shader_qa.exe'),str(source),str(shader),str(prefix),adapter_filter,fmt],capture_output=True,text=True,timeout=9)
        if proc.returncode:raise RuntimeError(name+': '+proc.stdout+proc.stderr)
        adapter=json.loads(proc.stdout)
        actual=np.fromfile(str(prefix)+'.output.bin',dtype='<f4').reshape(8,8,4)
        history=np.fromfile(str(prefix)+'.history.bin',dtype=RECORD).reshape(8,8)
        if mode==0:expected_hist,expected=refresh(b,e,d,c,return_display=True)
        else:expected,expected_hist,_=reproject(b,m,d,h,c)
        if fmt=='rgba16':expected=half_d3d(expected).astype(np.float32)
        elif fmt=='rgba8':expected=np.rint(np.clip(expected,0,1)*255).astype(np.uint8).astype(np.float32)/np.float32(255)
        np.testing.assert_allclose(actual,expected,rtol=3e-6,atol=3e-6,equal_nan=True,err_msg=name+' output')
        np.testing.assert_array_equal(history['valid'],expected_hist['valid'],err_msg=name+' valid')
        np.testing.assert_array_equal(history['depth'],expected_hist['depth'],err_msg=name+' depth')
        # FP16 values are compared with one-half-ULP tolerance because GPU pow
        # and float32 fused operations need not reproduce CPU packing bitwise.
        half_actual=history['words'].view('<u2').reshape(8,8,6).view('<f2').astype(np.float32)
        half_expected=expected_hist['words'].view('<u2').reshape(8,8,6).view('<f2').astype(np.float32)
        np.testing.assert_allclose(half_actual,half_expected,rtol=.0011,atol=6e-8,err_msg=name+' half record')
        if fmt=='rgba8':
            np.testing.assert_array_equal(np.rint(actual[...,3]*255),np.rint(b[...,3]*255),err_msg=name+' alpha byte')
        else:np.testing.assert_array_equal(actual[...,3],b[...,3],err_msg=name+' alpha')
        finite=np.isfinite(expected)&np.isfinite(actual)
        max_diff=float(np.max(abs(actual[finite]-expected[finite]))) if finite.any() else 0
        result={'name':name,'kernel':'refresh' if mode==0 else 'reproject','format':fmt,'passed':True,
                'valid_pixels':int(history['valid'].sum()),'max_output_abs_error':max_diff,
                'history_words_exact':bool(np.array_equal(history['words'],expected_hist['words']))}
        results.append(result);print(name+': PASS',flush=True)
    sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.glob('wuwa_cache*') if p.is_file()}
    for name in ('wuwa_cache_refresh.cso','wuwa_cache_reproject.cso','shader_qa.exe'):
        p=BUILD/name;sources[name]=hashlib.sha256(p.read_bytes()).hexdigest()
    for name in ('shader_qa.cpp','run_gpu_tests.py'):
        p=HERE/name;sources[name]=hashlib.sha256(p.read_bytes()).hexdigest()
    sources['validation/shader_reference.py']=hashlib.sha256((VALIDATION/'shader_reference.py').read_bytes()).hexdigest()
    report={'generation':'product-full-edited-cache; previous prototype results are separate provenance',
            'qualification':'isolated D3D12 GPU numerical shader fixtures; not NGX/game/performance/power qualification',
            'adapter':adapter,'fixture_count':len(results),'passed':all(r['passed'] for r in results),
            'output_tolerance':{'relative':3e-6,'absolute':3e-6},'history_half_tolerance':{'relative':.0011,'absolute':6e-8},
            'fixture_size':[8,8],'history_words_exact_all_fixtures':all(r['history_words_exact'] for r in results),
            'source_and_shader_sha256':sources,'results':results}
    (BUILD/'gpu_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(results),'adapter':adapter},ensure_ascii=False))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter',default='RTX 5070',help='Physical DXGI adapter-name substring; no WARP fallback')
    run(parser.parse_args().adapter)
