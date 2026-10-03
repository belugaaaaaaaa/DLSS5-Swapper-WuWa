/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
Texture2D<float4> Current : register(t0);
Texture2D<float4> Edited : register(t1);
Texture2D<float2> Motion : register(t2);
Texture2D<float> Depth : register(t3);
RWTexture2D<float4> Output : register(u0);
RWByteAddressBuffer Previous : register(u1);
RWByteAddressBuffer Next : register(u2);
cbuffer CacheConstants : register(b0) {
  uint Width, Height, MotionWidth, MotionHeight;
  uint DepthWidth, DepthHeight, MotionX, MotionY;
  uint DepthX, DepthY, Encoding;
  float MaximumMotionPixels;
  float MVToOutputX, MVToOutputY, DepthAbsolute, DepthRelative;
  float LumaStops, ColorRelative, ColorAbsolute, Reserved;
};
float3 ToLinear(float3 x) {
  float3 linearColor = x;
  if (Encoding != 2) {
    float3 nonnegative = max(x, 0);
    linearColor = float3(nonnegative.x <= .04045 ? nonnegative.x / 12.92 : pow((nonnegative.x + .055) / 1.055, 2.4),
                    nonnegative.y <= .04045 ? nonnegative.y / 12.92 : pow((nonnegative.y + .055) / 1.055, 2.4),
                    nonnegative.z <= .04045 ? nonnegative.z / 12.92 : pow((nonnegative.z + .055) / 1.055, 2.4));
  }
  return linearColor;
}
float3 FromLinear(float3 x) {
  float3 encoded = x;
  if (Encoding != 2) {
    float3 nonnegative = max(x, 0);
    encoded = saturate(float3(nonnegative.x <= .0031308 ? 12.92*nonnegative.x : 1.055*pow(nonnegative.x,1/2.4)-.055,
                              nonnegative.y <= .0031308 ? 12.92*nonnegative.y : 1.055*pow(nonnegative.y,1/2.4)-.055,
                              nonnegative.z <= .0031308 ? 12.92*nonnegative.z : 1.055*pow(nonnegative.z,1/2.4)-.055));
  }
  return encoded;
}
float Luma(float3 x) { return dot(max(x,0), float3(.2126,.7152,.0722)); }
uint Address(uint2 p) { return (p.y * Width + p.x) * 20; }
uint Pack(float a, float b) { return f32tof16(a) | (f32tof16(b) << 16); }
float2 Unpack(uint x) { return float2(f16tof32(x & 65535), f16tof32(x >> 16)); }
float3 HalfPrecision(float3 color) {
  return float3(f16tof32(f32tof16(color.x)),f16tof32(f32tof16(color.y)),
                f16tof32(f32tof16(color.z)));
}
void Store(uint2 p, float3 edited, float3 reference, float depth, bool valid) {
  // Never evaluate NaN*0: bad records get explicit finite zeros before pack.
  valid = valid && all(isfinite(edited)) && all(isfinite(reference)) && isfinite(depth)
       && all(abs(edited) <= 65504) && all(abs(reference) <= 65504);
  if (!valid) { edited=0; reference=0; depth=0; }
  uint a=Address(p);
  Next.Store3(a, uint3(Pack(edited.x,edited.y),Pack(edited.z,reference.x),
                      Pack(reference.y,reference.z)));
  Next.Store(a+12, asuint(depth)); Next.Store(a+16, valid ? 1 : 0);
}
bool Read(uint2 p, out float3 edited, out float3 reference, out float depth) {
  uint a=Address(p); uint3 words=Previous.Load3(a);
  float2 xy=Unpack(words.x), zr=Unpack(words.y), gb=Unpack(words.z);
  edited=float3(xy,zr.x); reference=float3(zr.y,gb);
  depth=asfloat(Previous.Load(a+12));
  return Previous.Load(a+16)==1 && all(isfinite(edited))
      && all(isfinite(reference)) && isfinite(depth);
}
uint2 GuidePixel(uint2 p, uint w, uint h, uint x, uint y) {
  return uint2(min((uint)((p.x+.5)*w/Width),w-1)+x,
               min((uint)((p.y+.5)*h/Height),h-1)+y);
}
float CurrentDepth(uint2 p) {
  return Depth.Load(int3(GuidePixel(p,DepthWidth,DepthHeight,DepthX,DepthY),0));
}
bool Consistent(float3 history, float historyDepth, float3 current, float currentDepth) {
  // Raw depth is a conservative heuristic, not camera-space disocclusion.
  bool depthConsistent = abs(historyDepth-currentDepth) <= DepthAbsolute
        + DepthRelative*max(abs(historyDepth),abs(currentDepth));
  float l0=max(Luma(history),1e-4), l1=max(Luma(current),1e-4);
  bool lumaConsistent = abs(log2(l0/l1)) <= LumaStops;
  // Luma alone misses equal-luma hue changes.
  float scale=max(max(abs(history.x),abs(history.y)),abs(history.z));
  float3 difference=abs(history-current);
  bool colorConsistent = max(max(difference.x,difference.y),difference.z)
      <= ColorAbsolute + ColorRelative*max(scale,Luma(current));
  return depthConsistent && lumaConsistent && colorConsistent;
}
