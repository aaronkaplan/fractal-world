"use strict";

// Base 2^16 limbs keep a*b + existing digit + carry within a u32 exactly.
// Two integer limbs leave room for the bailout; the remaining limbs are fractional.
function gpuMath(bits) {
  const fraction = bits / 16, limbs = fraction + 2;
  return `
const N: u32 = ${limbs}u;
const F: u32 = ${fraction}u;
struct MP { d: array<u32, ${limbs}>, negative: u32 }
struct FE { m: f32, e: i32 }
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
  r.negative=a.negative^select(0u,1u,v<0);
  for(var i=0u;i<N;i++) { let x=a.d[i]*m+carry; r.d[i]=x&65535u; carry=x>>16u; }
  return r;
}
fn divide(a: MP,v: u32) -> MP {
  var r: MP; r.negative=a.negative; var rem=0u;
  for(var k=N;k>0u;k--) { let i=k-1u; let x=rem*65536u+a.d[i];
    r.d[i]=x/v; rem=x%v; } return r;
}
fn norm(m: f32,e: i32) -> FE {
  if(m==0.0) { return FE(0.0,0); }
  let p=i32(floor(log2(abs(m)))); return FE(m*exp2(f32(-p)),e+p);
}
fn extended(a: MP) -> FE {
  for(var k=N;k>0u;k--) { let i=k-1u;
    if(a.d[i]!=0u) { var m=f32(a.d[i]);
      if(i>0u) { m+=f32(a.d[i-1u])/65536.0; }
      return norm(select(m,-m,a.negative!=0u),16*(i32(i)-i32(F))); }
  } return FE(0.0,0);
}
fn fa(a: FE,b: FE) -> FE {
  if(a.m==0.0) { return b; } if(b.m==0.0) { return a; }
  let e=max(a.e,b.e);
  return norm(a.m*exp2(f32(max(-126,a.e-e)))+b.m*exp2(f32(max(-126,b.e-e))),e);
}
fn fm(a: FE,b: FE) -> FE { return norm(a.m*b.m,a.e+b.e); }
fn lessPositive(a: FE,b: FE) -> bool {
  if(b.m==0.0) { return false; } if(a.m==0.0) { return true; }
  return a.e<b.e || (a.e==b.e && a.m<b.m);
}
fn fnn(a: FE) -> FE { return FE(-a.m,a.e); }
fn real(a: FE) -> f32 { return a.m*exp2(f32(clamp(a.e,-126,126))); }
fn packed(x: FE,y: FE) -> vec4<f32> { return vec4(x.m,f32(x.e),y.m,f32(y.e)); }
fn rx(v: vec4<f32>) -> FE { return FE(v.x,i32(v.y)); }
fn ry(v: vec4<f32>) -> FE { return FE(v.z,i32(v.w)); }
`;
}

function gpuKernels(bits) {
  return `${gpuMath(bits)}
struct Params { width:u32,height:u32,limit:u32,begin:u32,end:u32,offset:u32,count:u32,pad:u32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read_write> view: array<MP>;
@group(0) @binding(2) var<storage,read_write> reference: array<MP>;
@group(0) @binding(3) var<storage,read_write> orbit: array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> stop: array<u32>;
@group(0) @binding(5) var<storage,read_write> delta: array<vec4<f32>>;
@group(0) @binding(6) var<storage,read_write> result: array<f32>;
@group(0) @binding(7) var<storage,read_write> exact: array<MP>;
fn pixel(index:u32) -> vec2<i32> {
  return vec2(i32(2u*(index%p.width)+1u)-i32(p.width),i32(p.height)-i32(2u*(index/p.width)+1u));
}
fn smoothEscape(n:u32,r2:f32) -> f32 { return f32(n)-log2(log2(sqrt(r2))); }
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
    if(xf*xf+yf*yf>256.0) { stop[0]=n+1u; break; }
  } reference[0]=x; reference[1]=y;
}
@compute @workgroup_size(64) fn perturb(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count) { return; }
  if(p.begin==0u) { result[i]=select(-2.0,-3.0,p.pad==1u); delta[i]=vec4(0.0); stop[i+2u]=0u; }
  if(stop[1]==1u) { result[i]=-1.0; return; }
  if(result[i]!=-2.0) { return; }
  let xy=pixel(p.offset+i);
  let scale=extended(view[2]);
  let cx=fm(scale,norm(f32(xy.x)/f32(2u*p.height),0));
  let cy=fm(scale,norm(f32(xy.y)/f32(2u*p.height),0));
  var x=rx(delta[i]); var y=ry(delta[i]);
  var refIndex=stop[i+2u];
  for(var n=p.begin;n<p.end;n++) {
    let zx=rx(orbit[refIndex]); let zy=ry(orbit[refIndex]);
    let xx=fm(x,x); let yy=fm(y,y);
    let nx=fa(fa(fm(FE(2.0,0),fa(fm(zx,x),fnn(fm(zy,y)))),fa(xx,fnn(yy))),cx);
    y=fa(fa(fm(FE(2.0,0),fa(fm(zx,y),fm(zy,x))),fm(FE(2.0,0),fm(x,y))),cy); x=nx;
    let ax=fa(rx(orbit[refIndex+1u]),x); let ay=fa(ry(orbit[refIndex+1u]),y);
    let magnitude=fa(fm(ax,ax),fm(ay,ay));
    let r2=real(magnitude);
    let rzx=rx(orbit[refIndex+1u]); let rzy=ry(orbit[refIndex+1u]);
    let ref2=fa(fm(rzx,rzx),fm(rzy,rzy));
    // Compare extended-range values before converting for coloring. Otherwise
    // tiny critical orbits could underflow together and hide cancellation.
    if(lessPositive(magnitude,fm(norm(0.01,0),ref2))) { result[i]=-3.0; break; }
    if(r2>256.0) { result[i]=smoothEscape(n+1u,r2); break; }
    if(n+1u==p.limit) { result[i]=-1.0; }
    // Rebase on Z[0]=0 when the reference ends. A still-unescaped pixel can
    // continue from its actual z without rebuilding a high-precision orbit.
    refIndex++;
    if(refIndex>=stop[0]) { x=ax; y=ay; refIndex=0u; }
  } delta[i]=packed(x,y); stop[i+2u]=refIndex;
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
  offsetX=divide(offsetX,2u*p.height); offsetY=divide(offsetY,2u*p.height);
  exact[6u*i+2u]=add(view[0],offsetX); exact[6u*i+3u]=add(view[1],offsetY);
  var zero:MP; exact[6u*i]=zero; exact[6u*i+1u]=zero;
}
@compute @workgroup_size(1) fn directReal(@builtin(global_invocation_id) id:vec3<u32>) {
  let i=id.x; if(i>=p.count || result[i]!=-3.0) { return; }
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
    let xx=mul(x,x); let yy=mul(y,y);
    y=add(small(mul(x,y),2),cy); x=add(add(xx,neg(yy)),cx);
    let xf=real(extended(x)); let yf=real(extended(y));
    let r2=xf*xf+yf*yf;
    if(r2>256.0) { result[i]=smoothEscape(n+1u,r2); break; }
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
  if(r2>256.0) { result[i]=smoothEscape(p.begin+1u,r2); }
  else if(p.begin+1u==p.limit) { result[i]=-1.0; }
}
@compute @workgroup_size(1) fn referenceInit() {
  var zero:MP; exact[0]=zero; exact[1]=zero;
  exact[2]=view[0]; exact[3]=view[1]; result[0]=-3.0;
}
@compute @workgroup_size(1) fn referenceRecord() {
  orbit[p.begin+1u]=packed(extended(exact[0]),extended(exact[1]));
  if(result[0]>=0.0) { stop[0]=min(stop[0],p.begin+1u); }
}
`;
}
