#!/bin/bash
# usage: setall.sh "m1|m2|m3|m4" "scene1|scene2" "headline"   (English UI; block clip is S1 10-09)
L="$(cat lib.js)"
timeout 150 node cdp.mjs js "$L
(async()=>{ const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; const out=[];
const typeInto=async(el,to)=>{ el.focus(); set.call(el,to); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); el.blur(); await sleep(350) };
const tab=n=>[...document.querySelectorAll('button,[role=tab]')].filter(b=>b.textContent.trim()===n).pop();
tab('scene').click(); await sleep(600);
const m='$1'.split('|'); const heads=[...document.querySelectorAll('span.group-title')].slice(0,4); for(let i=0;i<4;i++){ heads[i].click(); await sleep(300); const el=document.activeElement; if(el.tagName==='INPUT'){ await typeInto(el,m[i]); out.push('m') } }
tab('Video').click(); await sleep(900); const nm='$2'.split('|'); const lis=[...document.querySelectorAll('li.video-scene')];
for(let i=0;i<lis.length;i++){ let el=lis[i].querySelector('input.scene-name'); if(!el){ lis[i].querySelector('.scene-name').click(); await sleep(350); el=document.activeElement } if(el&&el.tagName==='INPUT'){ await typeInto(el,nm[i]); out.push('s') } }
tab('scene').click(); await sleep(600);
[...document.querySelectorAll('.clip-row')].find(e=>/S1 10-09/.test(e.textContent)).click(); await sleep(1500);
[...document.querySelectorAll('button,[role=tab]')].filter(b=>b.textContent.trim()==='Objects').forEach(b=>b.click()); await sleep(900);
const h=[...document.querySelectorAll('input')].find(i=>/^Type here/.test(i.placeholder||'')); if(!h) return out.concat('no headline input'); await typeInto(h,'$3'); out.push('headline '+h.value); return out })()"
