"use strict";
const embedded=document.querySelector('#app'), results=document.querySelector('#results');
embedded.addEventListener('load',async()=>{
 const page=embedded.contentWindow, doc=embedded.contentDocument;
 const errors=[];let maxGap=0,frames=0,lastFrame,monitor=true;
 const sample=time=>{if(lastFrame!==undefined)maxGap=Math.max(maxGap,time-lastFrame);lastFrame=time;frames++;if(monitor)page.requestAnimationFrame(sample);};
 page.addEventListener('error',event=>{errors.push(event.message);results.textContent+=`\nERROR: ${event.message} ${event.error?.stack}`;});
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const key=code=>{page.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));page.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));};
 try {
  doc.querySelector('#mode').click();await wait(100);
  key('KeyV');await wait(150);
  const display=doc.querySelector('#display'), bounds=display.getBoundingClientRect();
  display.dispatchEvent(new PointerEvent('pointerdown',{clientX:bounds.left+bounds.width*281.017/640,clientY:bounds.top+bounds.height*218.908/480,bubbles:true}));
  page.requestAnimationFrame(sample);
  for(let i=0;i<200;i++) {key('Equal');await wait(20);}
  for(let i=0;i<140;i++) {key('Minus');await wait(20);}
  await wait(2000);
  results.textContent+=`\nSIZE: ${display.width} × ${display.height}\nSTATUS: ${doc.querySelector('#fractal-status').textContent}`;
  if(errors.length)throw new Error('Application redraw threw');
  if(!doc.querySelector('#fractal-status').textContent.includes('WEBGPU'))throw new Error('Display never crossed into deep mode');
  const before=doc.querySelector('#display').toDataURL();
  key('ArrowRight');await wait(100);
  if(doc.querySelector('#display').toDataURL()===before)throw new Error('Cursor did not redraw');
  results.textContent+=`\nFrame count: ${frames}; longest gap: ${Math.round(maxGap)} ms`;
  if(maxGap>500)throw new Error('Animation loop stalled for more than 500 ms');
  results.textContent+='\nPASS: Actual app crosses deep boundary and continues redrawing';
 }catch(error){results.textContent+=`\nFAIL: ${error.message}`;}finally{monitor=false;}
});
