/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#include "wuwa_cache_common.hlsli"
[numthreads(8,8,1)]
void main(uint3 tid : SV_DispatchThreadID) {
  uint2 p=tid.xy; if (p.x>=Width || p.y>=Height) return;
  float4 source=Current.Load(int3(p,0));
  float3 reference=ToLinear(source.rgb); float depth=CurrentDepth(p);
  float2 motion=Motion.Load(int3(GuidePixel(p,MotionWidth,MotionHeight,MotionX,MotionY),0));
  float3 editedWeighted=0, referenceWeighted=0; bool valid=false;
  if (all(isfinite(reference)) && isfinite(depth) && all(isfinite(motion))) {
    // DLSS convention: current -> previous. Scale is base-DLSS scale only.
    float2 displacement=motion*float2(MVToOutputX,MVToOutputY);
    float2 previous=float2(p)+displacement;
    if (all(abs(displacement)<=MaximumMotionPixels)
        && all(previous>=0) && previous.x<=float(Width-1) && previous.y<=float(Height-1)) {
      uint2 q=(uint2)floor(previous); float2 f=frac(previous);
      bool accepted=true;
      [unroll] for (uint y=0;y<2;++y) {
        [unroll] for (uint x=0;x<2;++x) {
          float weight=(x==0 ? 1-f.x : f.x)*(y==0 ? 1-f.y : f.y);
          // Zero-weight neighbors neither read memory nor reject an edge.
          if (weight>0) {
            uint2 tap=q+uint2(x,y);
            float3 edited=0, baseline=0; float historyDepth=0;
            if (tap.x>=Width || tap.y>=Height) accepted=false;
            else {
              bool readable=Read(tap,edited,baseline,historyDepth);
              if (readable && Consistent(baseline,historyDepth,reference,depth)) {
                editedWeighted+=weight*edited;
                referenceWeighted+=weight*baseline;
              } else accepted=false;
            }
          }
        }
      }
      valid=accepted && all(isfinite(editedWeighted)) && all(isfinite(referenceWeighted));
    }
  }
  // Preserve exact current pixel (including alpha) on any rejection.
  precise float3 composite=reference;
  if (valid) {
    // Avoid quantizing a large residual and then cancelling it against a
    // bright reference. Static FP16 current/reference subtract to exactly 0.
    // SDR uses the same half reference precision on both sides, retaining
    // static parity without magnifying reference roundoff in dark NR results.
    float3 correctionReference=Encoding==2 ? reference : HalfPrecision(reference);
    precise float3 correction=correctionReference-referenceWeighted;
    composite=editedWeighted+correction;
    if (all(isfinite(composite)) && all(abs(composite)<=65504))
      Output[p]=float4(FromLinear(composite),source.a);
    else { valid=false; composite=0; Output[p]=source; }
  } else { composite=0; Output[p]=source; }
  // Transport edited RGB and current reference/guides every skipped BASE frame.
  Store(p,composite,reference,depth,valid);
}
