"use strict";

// Base 2^16 limbs keep a*b + existing digit + carry within a u32 exactly.
// Four integer limbs leave room for the bailout; the remaining limbs are fractional.
function gpuMath(bits,fast=false) {
  const fraction = bits / 16, limbs = fraction + 4;
  return `
const N: u32 = ${limbs}u;
const F: u32 = ${fraction}u;
const FAST:bool=${fast};
struct MP { d: array<u32, ${limbs}>, negative: u32 }
// Exact 64-bit integer significands with a separate exponent. Float expansion
// tricks are unsafe under GPU compiler reassociation; limb arithmetic is exact.
struct Extended { m:f32,e:i32,low:u32,high:u32 }
struct ComplexFE { x:Extended,y:Extended }
fn signedValue(low:u32,high:u32,e:i32,negative:bool)->Extended {
  let m=f32(high)/2147483648.0+f32(low)/9223372036854775808.0;
  return Extended(select(m,-m,negative),e,low,high);
}
fn fromDigits(d:array<u32,8>,base:i32,negative:bool)->Extended {
  var top=-1;
  for(var k=8;k>0;k--){if(d[k-1]!=0u){top=(k-1)*16+31-i32(countLeadingZeros(d[k-1]));break;}}
  if(top<0){return Extended(0.0,0,0u,0u);}
  var v:array<u32,4>;
  // Extract the leading 64 bits; all retained bits are integer operations.
  for(var j=0;j<4;j++) {
    let source=top-63+j*16;let word=i32(floor(f32(source)/16.0));let bits=u32(source-word*16);
    if(word>=0&&word<8){v[j]=d[word]>>bits;}
    if(bits>0u&&word+1>=0&&word+1<8){v[j]|=(d[word+1]<<(16u-bits))&65535u;}
  }
  return signedValue(v[0]|(v[1]<<16u),v[2]|(v[3]<<16u),base+top,negative);
}
fn FE(m:f32,e:i32)->Extended {
  if(m==0.0){return Extended(0.0,0,0u,0u);}
  let bits=bitcast<u32>(m);let power=i32((bits>>23u)&255u)-127;
  return signedValue(0u,((bits&8388607u)|8388608u)<<8u,e+power,m<0.0);
}
fn limbsOf(a:Extended)->array<u32,4>{return array<u32,4>(a.low&65535u,a.low>>16u,a.high&65535u,a.high>>16u);}
fn shifted(a:Extended,shift:i32)->array<u32,4>{
  let v=limbsOf(a);var r:array<u32,4>;
  if(shift>=64){return r;}
  let words=shift/16;let bits=u32(shift%16);
  for(var i=0;i<4;i++){let j=i+words;if(j<4){r[i]=v[j]>>bits;if(bits>0u&&j+1<4){r[i]|=(v[j+1]<<(16u-bits))&65535u;}}}
  return r;
}
fn neg(a: MP) -> MP { var r=a; r.negative ^= 1u; return r; }
fn cmp(a: MP,b: MP) -> i32 {
  for(var k=N; k>0u; k--) { let i=k-1u;
    if(a.d[i]>b.d[i]) { return 1; } if(a.d[i]<b.d[i]) { return -1; }
  } return 0;
}
fn add(a: MP,b: MP) -> MP {
  var anyA=0u; var anyB=0u;
  for(var i=0u;i<N;i++) { anyA|=a.d[i]; anyB|=b.d[i]; }
  if(anyA==0u) { return b; } if(anyB==0u) { return a; }
  var r: MP; var carry=0u;
  if(a.negative==b.negative) {
    r.negative=a.negative;
    for(var i=0u;i<N;i++) { let v=a.d[i]+b.d[i]+carry; r.d[i]=v&65535u; carry=v>>16u; }
  } else {
    var hi=a; var lo=b;
    if(cmp(a,b)<0) { hi=b; lo=a; }
    r.negative=hi.negative;
    for(var i=0u;i<N;i++) { let v=65536u+hi.d[i]-lo.d[i]-carry;
      r.d[i]=v&65535u; carry=1u-(v>>16u); }
  } return r;
}
fn mul(a: MP,b: MP) -> MP {
  var digits: array<u32, ${limbs*2}>;
  for(var i=0u;i<N;i++) { var carry=0u;
    for(var j=0u;j<N;j++) { let v=a.d[i]*b.d[j]+digits[i+j]+carry;
      digits[i+j]=v&65535u; carry=v>>16u; }
    digits[i+N]=carry;
  }
  var r: MP; r.negative=a.negative^b.negative;
  for(var i=0u;i<N;i++) { r.d[i]=digits[i+F]; } return r;
}
fn small(a: MP,v: i32) -> MP {
  var r: MP; var carry=0u; let m=u32(abs(v));
  if(m>65535u) {
    var factor:MP;factor.d[F]=m&65535u;factor.d[F+1u]=m>>16u;factor.negative=select(0u,1u,v<0);
    return mul(a,factor);
  }
  r.negative=a.negative^select(0u,1u,v<0);
  for(var i=0u;i<N;i++) { let x=a.d[i]*m+carry; r.d[i]=x&65535u; carry=x>>16u; }
  return r;
}
fn divide(a: MP,v: u32) -> MP {
  var r: MP; r.negative=a.negative; var rem=0u;
  // Two base-256 steps also support supersampled native-display denominators
  // above 65535 without overflowing the intermediate remainder product.
  for(var k=N;k>0u;k--) { let i=k-1u;let hi=rem*256u+(a.d[i]>>8u);
    let q=hi/v;rem=hi%v;let lo=rem*256u+(a.d[i]&255u);
    r.d[i]=(q<<8u)+(lo/v);rem=lo%v; } return r;
}
fn norm(m:f32,e:i32)->Extended {return FE(m,e);}
fn extended(a:MP)->Extended {
  for(var k=N;k>0u;k--){let i=k-1u;if(a.d[i]!=0u){
    var v:array<u32,8>;
    for(var j=0u;j<5u;j++){if(i>=j){v[4u-j]=a.d[i-j];}}
    return fromDigits(v,16*(i32(i)-i32(F)-4),a.negative!=0u);
  }}return FE(0.0,0);
}
fn fa(a:Extended,b:Extended)->Extended {
  if(a.m==0.0){return b;}if(b.m==0.0){return a;}
  if(FAST){let e=max(a.e,b.e);return FE(a.m*exp2(f32(max(-126,a.e-e)))+b.m*exp2(f32(max(-126,b.e-e))),e);}
  let e=max(a.e,b.e);var av=shifted(a,e-a.e);var bv=shifted(b,e-b.e);
  var r:array<u32,8>;var carry=0u;var negative=a.m<0.0;
  if((a.m<0.0)==(b.m<0.0)){
    for(var i=0;i<4;i++){let sum=av[i]+bv[i]+carry;r[i]=sum&65535u;carry=sum>>16u;}r[4]=carry;
  }else{
    var swap=false;
    for(var k=4;k>0;k--){if(av[k-1]!=bv[k-1]){swap=av[k-1]<bv[k-1];break;}}
    if(swap){let tmp=av;av=bv;bv=tmp;negative=b.m<0.0;}
    for(var i=0;i<4;i++){let v=65536u+av[i]-bv[i]-carry;r[i]=v&65535u;carry=1u-(v>>16u);}
  }
  return fromDigits(r,e-63,negative);
}
fn fm(a:Extended,b:Extended)->Extended {
  if(FAST){return FE(a.m*b.m,a.e+b.e);}
  let av=limbsOf(a);let bv=limbsOf(b);var r:array<u32,8>;
  for(var i=0;i<4;i++){var carry=0u;for(var j=0;j<4;j++){
    let v=av[i]*bv[j]+r[i+j]+carry;r[i+j]=v&65535u;carry=v>>16u;
  }r[i+4]=carry;}
  return fromDigits(r,a.e+b.e-126,(a.m<0.0)!=(b.m<0.0));
}
fn fnn(a:Extended)->Extended{return Extended(-a.m,a.e,a.low,a.high);}
fn fd(a:Extended,b:Extended)->Extended {
  if(FAST){return FE(a.m/b.m,a.e-b.e);}
  var q=FE(a.m/b.m,a.e-b.e);
  for(var i=0;i<3;i++){let rem=fa(a,fnn(fm(b,q)));q=fa(q,FE(rem.m/b.m,rem.e-b.e));}
  return q;
}
fn lessPositive(a:Extended,b:Extended)->bool {
  if(b.m==0.0){return false;}if(a.m==0.0){return true;}
  if(a.e!=b.e){return a.e<b.e;}if(a.high!=b.high){return a.high<b.high;}return a.low<b.low;
}
fn positive(a:Extended)->Extended {if(a.m<0.0){return fnn(a);}return a;}
fn l1(x:Extended,y:Extended)->Extended{return fa(positive(x),positive(y));}
fn modulus(x:Extended,y:Extended)->Extended {
  let r=fa(fm(x,x),fm(y,y));let half=i32(floor(f32(r.e)*0.5));
  return norm(sqrt(max(0.0,r.m)*exp2(f32(r.e-2*half))),half);
}
fn real(a: Extended) -> f32 { return a.m*exp2(f32(clamp(a.e,-126,126))); }
fn packed(x: Extended,y: Extended) -> ComplexFE { return ComplexFE(x,y); }
fn rx(v: ComplexFE) -> Extended { return v.x; }
fn ry(v: ComplexFE) -> Extended { return v.y; }
`;
}

function gpuKernels(bits,fast=false) {
  return `${gpuMath(bits,fast)}
struct Params { width:u32,height:u32,limit:u32,begin:u32,end:u32,offset:u32,count:u32,pad:u32,referenceQuality:u32,stripe:f32,sampleX:u32,sampleY:u32,samples:u32,endpoint:u32,unused0:u32,unused1:u32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read_write> view: array<MP>;
@group(0) @binding(2) var<storage,read_write> reference: array<MP>;
@group(0) @binding(3) var<storage,read_write> orbit: array<ComplexFE>;
@group(0) @binding(4) var<storage,read_write> stop: array<u32>;
@group(0) @binding(5) var<storage,read_write> delta: array<ComplexFE>;
@group(0) @binding(6) var<storage,read_write> result: array<f32>;
@group(0) @binding(7) var<storage,read_write> exact: array<MP>;
fn pixel(index:u32) -> vec2<i32> {
  if(p.endpoint==1u) {
    return vec2(i32(2u*((index%p.width)*p.samples+p.sampleX))-i32(p.width*p.samples-1u),
      i32(p.height*p.samples-1u)-i32(2u*((index/p.width)*p.samples+p.sampleY)));
  }
  return vec2(i32(2u*(index%p.width)+1u)-i32(p.width),i32(p.height)-i32(2u*(index/p.width)+1u));
}
fn smoothEscape(n:u32,r2:f32) -> f32 {
  if(p.referenceQuality==1u) { return f32(n)-log2(log(r2)/log(1e10)); }
  return f32(n)-log2(log2(sqrt(r2)));
}
fn bailout() -> f32 { return select(256.0,1e10,p.referenceQuality==1u); }
fn pixelDenominator() -> u32 { return 2u*select(p.height,p.height*p.samples-1u,p.endpoint==1u); }
// Per-pixel derivative uses an extended exponent. Stripe history and derivative
// survive dispatch boundaries and reference rebasing, unlike the reference index.
fn beginAttributes(i:u32) {
  delta[3u*i+1u]=packed(FE(1.0,0),FE(0.0,0)); delta[3u*i+2u]=packed(FE(0.0,0),FE(0.0,0));
  for(var j=0u;j<4u;j++) { result[p.count+4u*i+j]=0.0; }
}
fn derivative(i:u32,x:Extended,y:Extended) {
  if(p.referenceQuality==0u) { return; }
  let dx=rx(delta[3u*i+1u]); let dy=ry(delta[3u*i+1u]);
  delta[3u*i+1u]=packed(fa(fm(FE(2.0,0),fa(fm(x,dx),fnn(fm(y,dy)))),FE(1.0,0)),
    fm(FE(2.0,0),fa(fm(x,dy),fm(y,dx))));
}
fn attributes(i:u32,n:u32,x:Extended,y:Extended,r2:f32) {
  if(p.referenceQuality==0u) { return; }
  let xf=real(x); let yf=real(y);
  let q=select(0.0,0.5+0.5*sin(p.stripe*atan2(yf,xf)),p.stripe>0.0);
  var a=delta[3u*i+2u].x.m;
  if(r2>bailout()) {
    let f=1.0-log2(log(r2)/log(1e10));
    a=(a*(1.0-f*0.1)+q*f*0.1)/max(1e-20,1.0-pow(0.9,f32(n))*(1.0-f*0.1));
    let dx=rx(delta[3u*i+1u]); let dy=ry(delta[3u*i+1u]);
    let e=max(dx.e,dy.e);
    let d=vec2(dx.m*exp2(f32(max(-126,dx.e-e))),dy.m*exp2(f32(max(-126,dy.e-e))));
    let dn=max(length(d),1e-30); let z=normalize(vec2(xf,yf));
    let normal=vec2(z.x*d.x+z.y*d.y,z.y*d.x-z.x*d.y)/dn;
    let logR=0.5*log(r2);
    let logDistance=logR+log(logR)-log(dn)-f32(e)*log(2.0)-log(2.0);
    let base=p.count+4u*i;
    result[base]=a;result[base+1u]=normal.x;result[base+2u]=normal.y;result[base+3u]=logDistance;
  } else { delta[3u*i+2u].x.m=a*0.9+q*0.1; }
}
@compute @workgroup_size(1) fn classify() {
  let x=real(extended(view[0])); let y=real(extended(view[1]));
  let radius=abs(real(extended(view[2])))*(1.0+f32(p.width)/f32(p.height));
  // Conservative disks wholly inside the cardioid / period-two bulb. The
  // margin exceeds f32 conversion error; boundary views never use this shortcut.
  if(min(abs(x),abs(x+1.0))+abs(y)+radius<0.24) { stop[1]=1u; }
}
@compute @workgroup_size(1) fn cameraDelta() {
  reference[3]=add(view[2],neg(reference[0]));
}
@compute @workgroup_size(1) fn cameraOffsets() {
  reference[4]=mul(reference[3],reference[1]);
  reference[5]=mul(reference[3],reference[2]);
}
@compute @workgroup_size(1) fn camera() {
  view[0]=add(view[0],reference[4]);
  view[1]=add(view[1],reference[5]);
  view[2]=reference[0];
}
@compute @workgroup_size(1) fn referenceOrbit() {
  if(p.begin>=stop[0]) { return; }
  var x=reference[0]; var y=reference[1];
  for(var n=p.begin;n<p.end;n++) {
    orbit[n]=packed(extended(x),extended(y));
    let xx=mul(x,x); let yy=mul(y,y);
    y=add(small(mul(x,y),2),view[1]); x=add(add(xx,neg(yy)),view[0]);
    let xf=real(extended(x)); let yf=real(extended(y));
    orbit[n+1u]=packed(extended(x),extended(y));
    if(xf*xf+yf*yf>bailout()) { stop[0]=n+1u; break; }
  } reference[0]=x; reference[1]=y;
}
@compute @workgroup_size(64) fn perturb(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count) { return; }
  if(p.begin==0u) { result[i]=select(-2.0,-3.0,p.pad==1u); delta[3u*i]=packed(FE(0.0,0),FE(0.0,0)); beginAttributes(i); stop[i+2u]=0u; }
  if(stop[1]==1u) { result[i]=-1.0; return; }
  if(result[i]!=-2.0) { return; }
  let xy=pixel(p.offset+i);
  let scale=extended(view[2]);
  var fractionX=fd(FE(f32(xy.x),0),FE(f32(pixelDenominator()),0));
  if(p.endpoint==1u) {fractionX=fd(fm(FE(f32(xy.x),0),FE(f32(p.width),0)),fm(FE(2.0*f32(p.height),0),FE(f32(p.width*p.samples-1u),0)));}
  let cx=fm(scale,fractionX);
  let cy=fm(scale,fd(FE(f32(xy.y),0),FE(f32(pixelDenominator()),0)));
  var x=rx(delta[3u*i]); var y=ry(delta[3u*i]);
  var error=delta[3u*i+2u].y;
  var refIndex=stop[i+2u];
  for(var n=p.begin;n<p.end;n++) {
    let zx=rx(orbit[refIndex]); let zy=ry(orbit[refIndex]);
    // Propagate a conservative rounding estimate. A cancellation ratio alone
    // misses accumulated error on long, sensitive orbits (the Crown fixture).
    let size=l1(x,y);let zsize=l1(zx,zy);
    let roundoff=fm(norm(1.0e-17,0),fa(fm(fa(zsize,size),size),l1(cx,cy)));
    error=fa(fm(fm(FE(2.0,0),modulus(fa(zx,x),fa(zy,y))),error),roundoff);
    derivative(i,fa(zx,x),fa(zy,y));
    let xx=fm(x,x); let yy=fm(y,y);
    let nx=fa(fa(fm(FE(2.0,0),fa(fm(zx,x),fnn(fm(zy,y)))),fa(xx,fnn(yy))),cx);
    y=fa(fa(fm(FE(2.0,0),fa(fm(zx,y),fm(zy,x))),fm(FE(2.0,0),fm(x,y))),cy); x=nx;
    let ax=fa(rx(orbit[refIndex+1u]),x); let ay=fa(ry(orbit[refIndex+1u]),y);
    let magnitude=fa(fm(ax,ax),fm(ay,ay));
    let r2=real(magnitude);
    let rzx=rx(orbit[refIndex+1u]); let rzy=ry(orbit[refIndex+1u]);
    let ref2=fa(fm(rzx,rzx),fm(rzy,rzy));
    if(p.referenceQuality==1u && !FAST && lessPositive(fm(norm(1e-7,0),l1(ax,ay)),error)) {result[i]=-3.0;break;}
    // Compare extended-range values before converting for coloring. Otherwise
    // tiny critical orbits could underflow together and hide cancellation.
    if(lessPositive(magnitude,fm(norm(0.01,0),ref2))) { result[i]=-3.0; break; }
    attributes(i,n,ax,ay,r2);
    if(r2>bailout()) { result[i]=smoothEscape(n+1u,r2); break; }
    if(n+1u==p.limit) { result[i]=-1.0; }
    // Rebase on Z[0]=0 when the reference ends. A still-unescaped pixel can
    // continue from its actual z without rebuilding a high-precision orbit.
    refIndex++;
    if(refIndex>=stop[0]) {
      x=ax;y=ay;refIndex=0u;
      error=fa(error,fm(norm(1.0e-17,0),l1(ax,ay)));
    }
  } delta[3u*i]=packed(x,y);delta[3u*i+2u].y=error; stop[i+2u]=refIndex;
}
// Glitched pixels are recomputed with full GPU limb arithmetic. The state is
// retained between small dispatches: no unbounded per-pixel shader loop.
// Separate real/imaginary passes also bound large composite temporaries; keeping
// the entire large-limb iteration in one shader failed the 1536-bit GPU fixtures.
@compute @workgroup_size(1) fn directInit(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
  // A compact repair batch carries original image indices in the reused
  // per-pixel reference-index buffer, after perturbation has finished.
  let xy=pixel(select(p.offset+i,stop[i+2u],p.pad==2u));
  var offsetX=small(view[2],xy.x); var offsetY=small(view[2],xy.y);
  offsetX=divide(offsetX,pixelDenominator()); offsetY=divide(offsetY,pixelDenominator());
  if(p.endpoint==1u) {offsetX=divide(small(divide(small(view[2],xy.x),2u*(p.width*p.samples-1u)),i32(p.width)),p.height);}
  exact[6u*i+2u]=add(view[0],offsetX); exact[6u*i+3u]=add(view[1],offsetY);
  beginAttributes(i);
  var zero:MP; exact[6u*i]=zero; exact[6u*i+1u]=zero;
}
@compute @workgroup_size(1) fn directReal(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
  derivative(i,extended(exact[6u*i]),extended(exact[6u*i+1u]));
  var xx=mul(exact[6u*i],exact[6u*i]);
  var yy=mul(exact[6u*i+1u],exact[6u*i+1u]);
  var difference=add(xx,neg(yy));
  exact[6u*i+4u]=add(difference,exact[6u*i+2u]);
}
// Modest precision fits a short local iteration loop, avoiding three GPU
// passes per iteration. Large limb counts retain the split-pass kernels below.
@compute @workgroup_size(64) fn directBatch(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
  var x=exact[6u*i]; var y=exact[6u*i+1u];
  let cx=exact[6u*i+2u]; let cy=exact[6u*i+3u];
  for(var n=p.begin;n<p.end;n++) {
    derivative(i,extended(x),extended(y));
    let xx=mul(x,x); let yy=mul(y,y);
    y=add(small(mul(x,y),2),cy); x=add(add(xx,neg(yy)),cx);
    let xf=real(extended(x)); let yf=real(extended(y));
    let r2=xf*xf+yf*yf;
    attributes(i,n,extended(x),extended(y),r2);
    if(r2>bailout()) { result[i]=smoothEscape(n+1u,r2); break; }
    if(n+1u==p.limit) { result[i]=-1.0; }
  }
  exact[6u*i]=x; exact[6u*i+1u]=y;
}
@compute @workgroup_size(1) fn directImag(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
  var product=mul(exact[6u*i],exact[6u*i+1u]);
  var twice=small(product,2);
  exact[6u*i+5u]=add(twice,exact[6u*i+3u]);
}
@compute @workgroup_size(1) fn direct(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
  exact[6u*i]=exact[6u*i+4u]; exact[6u*i+1u]=exact[6u*i+5u];
  let x=real(extended(exact[6u*i])); let y=real(extended(exact[6u*i+1u]));
  let r2=x*x+y*y;
  attributes(i,p.begin,extended(exact[6u*i]),extended(exact[6u*i+1u]),r2);
  if(r2>bailout()) { result[i]=smoothEscape(p.begin+1u,r2); }
  else if(p.begin+1u==p.limit) { result[i]=-1.0; }
}
@compute @workgroup_size(1) fn referenceInit() {
  beginAttributes(0u);
  var zero:MP; exact[0]=zero; exact[1]=zero;
  exact[2]=view[0]; exact[3]=view[1]; result[0]=-3.0;
}
@compute @workgroup_size(1) fn referenceRecord() {
  orbit[p.begin+1u]=packed(extended(exact[0]),extended(exact[1]));
  if(result[0]>=0.0) { stop[0]=min(stop[0],p.begin+1u); }
}
`;
}
