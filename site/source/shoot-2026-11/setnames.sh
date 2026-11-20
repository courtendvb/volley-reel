#!/bin/bash
# usage: setnames.sh "m1|m2|m3|m4" "scene1|scene2" "headline"   (English UI; scene select found by its two scene names in $4|$5)
L="$(cat lib.js)"
H='(async()=>{ const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; const out=[];
const typeInto=async(el,to)=>{ el.focus(); set.call(el,to); el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); el.blur(); await sleep(350) };
const rename=async(sp,to)=>{ sp.click(); await sleep(300); const el=document.activeElement; if(el.tagName!=="INPUT"){out.push("noinput "+to);return} await typeInto(el,to); out.push("ok "+to) };
const tab=n=>[...document.querySelectorAll("button,[role=tab]")].filter(b=>b.textContent.trim().startsWith(n)).pop();'
# 1: go to scene 1 and name its markers
timeout 100 node cdp.mjs js "$L
$H
tab('scene').click(); await sleep(500);
const s=[...document.querySelectorAll('select')].filter(x=>[...x.options].length===2&&[...x.options].some(o=>o.text==='$4'||o.text==='$5')).pop(); pick(s,s.options[0].value); await sleep(1000);
const m='$1'.split('|'); const heads=[...document.querySelectorAll('span.group-title')].slice(0,4); for(let i=0;i<4;i++) await rename(heads[i],m[i]);
return out })()"
# 2: scene names (Video tab; the names are inputs)
timeout 100 node cdp.mjs js "$L
(async()=>{ const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; const out=[];
[...document.querySelectorAll('button,[role=tab]')].filter(b=>b.textContent.trim()==='Video'||b.textContent.trim()==='動画の構成').pop().click(); await sleep(700);
const sc='$2'.split('|'); const ins=[...document.querySelectorAll('li.video-scene input.scene-name')];
for(let i=0;i<2;i++){ const el=ins[i]; el.focus(); set.call(el,sc[i]); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.blur(); await sleep(350); out.push(el.value) }
return out })()"
# 3: headline on the block clip
timeout 100 node cdp.mjs js "$L
$H
tab('scene').click(); await sleep(500);
{ const s=[...document.querySelectorAll('select')].filter(x=>[...x.options].length===2&&[...x.options].some(o=>o.text==='$2'.split('|')[0])).pop(); if(s) pick(s,s.options[0].value); await sleep(900) }
[...document.querySelectorAll('.clip-row')].find(e=>/S1 07-07/.test(e.textContent)).click(); await sleep(1300);
[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Objects').click(); await sleep(700);
const h=[...document.querySelectorAll('input')].find(i=>/^Type here|^ここに/.test(i.placeholder||'')||['Take away the line','Block kill at the net','ブロックで決める','ラインを抑える'].includes(i.value)); if(!h) return 'no headline input '+[...document.querySelectorAll('input')].map(i=>i.placeholder+'|'+i.value).slice(0,20); await typeInto(h,'$3'); return 'headline '+h.value })()"
