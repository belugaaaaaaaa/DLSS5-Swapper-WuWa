/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#include "wuwa_cache_common.hlsli"
[numthreads(8,8,1)]
void main(uint3 tid : SV_DispatchThreadID) {
  uint2 p=tid.xy; if (p.x>=Width || p.y>=Height) return;
  float4 source=Current.Load(int3(p,0));
  float3 reference=ToLinear(source.rgb);
  // Typed UAV load/store of the SAME pixel is legal. The host requires
  // UAV_TYPED_LOAD/STORE support; no SRV/UAV aliasing of the edited image.
  float4 enhanced=Output[p];
  float3 edited=ToLinear(enhanced.rgb);
  float depth=CurrentDepth(p);
  bool valid=all(isfinite(reference)) && all(isfinite(edited)) && isfinite(depth)
      && all(abs(reference)<=65504) && all(abs(edited)<=65504);
  // Capture never clips, quantizes or replaces valid fresh NR RGB. A bad
  // guide/cache record only disables its later reuse. Preserve source alpha.
  Output[p]=float4(enhanced.rgb,source.a);
  Store(p,edited,reference,depth,valid);
}
