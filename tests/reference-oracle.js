"use strict";
// Independent binary64 test oracle. Never loaded by the application.
function referenceOrbit(cx,cy,limit=5000,frequency=2,bits=0) {
  let x=0,y=0,dx=1,dy=0,a=0;
  let bx=0n,by=0n;
  for(let n=0;n<limit;n++) {
    const ndx=2*(dx*x-dy*y)+1; dy=2*(dx*y+dy*x); dx=ndx;
    if(bits) {
      const nx=(bx*bx-by*by)/(1n<<BigInt(bits))+cx;
      by=2n*bx*by/(1n<<BigInt(bits))+cy;bx=nx;
      x=Number(bx)/2**bits;y=Number(by)/2**bits;
    } else {const nx=x*x-y*y+cx; y=2*x*y+cy; x=nx;}
    const q=frequency>0?(Math.sin(frequency*Math.atan2(y,x))+1)/2:0;
    const r=Math.hypot(x,y);
    if(r*r>1e10) {
      const f=1-Math.log2(Math.log(r)/Math.log(1e5));
      a=(a*(1+f*(-.1))+q*f*.1)/(1-Math.pow(.9,n)*(1-f*.1));
      const dn=Math.hypot(dx,dy), ux=(x*dx+y*dy)/(r*dn),uy=(y*dx-x*dy)/(r*dn);
      return {mu:n+f,attrs:[frequency>0?a:0,ux,uy,Math.log(r)+Math.log(Math.log(r))-Math.log(dn)-Math.LN2]};
    }
    a=a*.9+q*.1;
  }
  return {mu:-1,attrs:[0,0,0,0]};
}
function referenceColor(mu,a,settings,diagonal) {
  if(mu<0)return [0,0,0];
  const overlay=(x,y)=>y<.5?2*x*y:1-2*(1-x)*(1-y);
  const phase=(Math.sqrt(mu)/Math.sqrt(settings.cycle||32))%1;
  let index=Math.round(phase*4095),shader=0,count=0;
  const [stripe,nx,ny,ld]=a,phi=Math.PI/4,theta=Math.PI/4,half=(Math.PI/2+phi)/2;
  const diffuse=(nx*Math.cos(theta)*Math.cos(phi)+ny*Math.sin(theta)*Math.cos(phi)+Math.sin(phi))/(1+Math.sin(phi));
  const spec=(nx*Math.cos(theta)*Math.sin(half)+ny*Math.sin(theta)*Math.sin(half)+Math.cos(half))/(1+Math.cos(half));
  let bright=(.2+.5*diffuse+.5*Math.pow(spec,20))*.75+.125;
  const dem=1/(1+Math.exp(-10*((-(ld-Math.log(diagonal))/12)-.5)));
  if(stripe>0){shader+=stripe;count++;}
  if(settings.step>0){
    const step=1/settings.step; index=Math.round((phase-phase%step)*4095);
    const x=(phase%step)/step,y=(phase%(step/8))/(step/8);
    shader+=overlay(6*(1-Math.pow(y,5)-Math.pow(1-y,30))/10,6*(1-Math.pow(x,5)-Math.pow(1-x,100))/10);count++;
  }
  if(count)bright=overlay(bright,shader/count)*(1-dem)+dem*bright;
  return settings.phases.map(p=>Math.floor(255*Math.max(0,Math.min(1,overlay(.5+.5*Math.sin(2*Math.PI*(index/4095+p)),bright)))));
}
