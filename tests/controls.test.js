"use strict";
document.querySelector('#app').addEventListener('load',async event=>{
  const page=event.target.contentWindow,doc=event.target.contentDocument,out=document.querySelector('#results');
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const down=(code,key=code)=>page.dispatchEvent(new KeyboardEvent('keydown',{code,key,bubbles:true}));
  const up=code=>page.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
  const tap=(code,key)=>{down(code,key);up(code);};
  const check=(value,message)=>{if(!value)throw new Error(message);out.textContent+=`\nPASS: ${message}`;};
  try {
    tap('Slash','?');await wait(50);
    check(doc.querySelector('#keymap')?.hidden===false,'? opens the cheatsheet');
    tap('KeyM');check(doc.querySelector('#fractal-controls').hidden,'Cheatsheet blocks scene shortcuts');
    tap('Slash','?');check(doc.querySelector('#keymap').hidden,'? closes the cheatsheet');
    tap('Slash','?');tap('Escape');check(doc.querySelector('#keymap').hidden,'Escape closes the cheatsheet');
    tap('KeyD');await wait(600);
    check(!doc.querySelector('#debug-info').hidden && /UI FPS/.test(doc.querySelector('#debug-info').textContent),'D shows measured debug information');
    tap('KeyD');check(doc.querySelector('#debug-info').hidden,'D hides debug information');
    tap('Space',' ');await wait(50);
    check(doc.querySelector('#palette-name').textContent==='Green phosphor','Space rotates colors once');
    check(doc.querySelector('#origin-state').textContent.includes('FREE'),'Space does not pin the origin');
    tap('KeyX');check(doc.querySelector('#origin-state').textContent.includes('PINNED'),'X pins the origin');
    const pad={index:0,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false}))};
    Object.defineProperty(page.navigator,'getGamepads',{configurable:true,value:()=>[pad]});
    pad.buttons[7].pressed=true;await wait(80);pad.buttons[7].pressed=false;await wait(50);
    check(doc.querySelector('#palette-name').textContent==='Amber phosphor','Xbox trigger uses the same one-step color rotation');
    down('Space',' ');await wait(420);up('Space');await wait(50);
    check(doc.querySelector('#palette-name').textContent==='Soft magenta','Holding Space keeps rotating colors');
    tap('KeyM');await wait(150);
    const names=new Set();
    for(let i=0;i<15;i++) {names.add(doc.querySelector('#fractal-palette-name').textContent);tap('KeyB');await wait(40);}
    check(names.size===15 && names.has('Crown') && names.has('Velvet'),'B cycles fifteen different palettes including gallery ramps');
    check(doc.querySelector('#fractal-palette-name').textContent==='Spectrum','Palette list wraps around');
    pad.buttons[1].pressed=true;await wait(80);pad.buttons[1].pressed=false;await wait(50);
    check(doc.querySelector('#fractal-palette-name').textContent==='Ocean','Xbox B selects the next palette');
    tap('KeyV');await wait(150);tap('Slash','?');
    check(!doc.querySelector('#keymap').hidden && doc.body.classList.contains('display-expanded'),'Cheatsheet opens in expanded display');
    tap('Escape');check(doc.querySelector('#keymap').hidden,'Escape closes expanded-display help');
    out.textContent+='\nPASS: All controls checks completed';
  }catch(error){out.textContent+=`\nFAIL: ${error.message}`;}
});
