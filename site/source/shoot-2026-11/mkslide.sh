#!/bin/bash
# usage: mkslide.sh "<Kind button text>" ["<extra js run in dialog before Create>"]
L="$(cat lib.js)"
timeout 120 node cdp.mjs js "$L
(async()=>{ const out=[]; btn('Make a data slide').click(); await sleep(1000); const d=()=>document.querySelector('[role=dialog]');
const k=[...d().querySelectorAll('.segmented button')].find(b=>b.textContent.trim()==='$1'); k.click(); await sleep(900);
$2
[...d().querySelectorAll('button')].find(b=>b.textContent.trim()==='Title card (outside markers)').click(); await sleep(300);
[...d().querySelectorAll('button')].find(b=>b.textContent.trim()==='Create').click(); await sleep(3500);
const n=document.querySelectorAll('.slide-row').length; return '$1: slides now '+n+' dialog '+!!d() })()"
