// Genuine local OCR of retained, original synthetic PNG fixtures. No remote inference.
import { chromium } from '@playwright/test';
import { createWorker } from 'tesseract.js';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir, cpus, platform } from 'node:os';
import { createHash } from 'node:crypto';
const fixtures = resolve('../fixtures/ocr'); mkdirSync(fixtures,{recursive:true});
const reports = resolve('../reports');
const langPath = resolve('public/tesseract/lang-data');
const assetManifest = JSON.parse(readFileSync(join(langPath,'manifest.json'),'utf8'));
const cases = [
  {name:'english',lang:'eng',text:'1. Which colour is made by mixing blue and yellow?\n(A) Green\n(B) Red\n(C) Purple\n(D) Orange'},
  {name:'hindi',lang:'hin',text:'1. नीले और पीले रंग को मिलाने पर कौन सा रंग बनता है?\n(1) हरा\n(2) लाल\n(3) बैंगनी\n(4) नारंगी'},
  {name:'bilingual',lang:'eng+hin',text:'1. Which planet is known as the red planet?\n(A) Mars\n(B) Earth\n(C) Venus\n(D) Jupiter\n2. लाल ग्रह के नाम से कौन सा ग्रह जाना जाता है?\n(1) मंगल\n(2) पृथ्वी\n(3) शुक्र\n(4) बृहस्पति'}
];
function distance(a,b) {
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;}return prev[b.length];
}
const clean = text => text.normalize('NFC').replace(/\s+/gu,' ').trim();
function metrics(truth,output){const a=clean(truth),b=clean(output);return {cer:distance([...a],[...b])/[...a].length,wer:distance(a.split(' '),b.split(' '))/a.split(' ').length};}
let executablePath=process.env.PW_CHROMIUM;
if(!executablePath && !existsSync(chromium.executablePath())){
  const cache=join(homedir(),'.cache/ms-playwright');
  executablePath=readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort().reverse().map(x=>join(cache,x,'chrome-linux64/chrome')).find(existsSync);
}
const browser=await chromium.launch({executablePath});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1100},deviceScaleFactor:1});
 const font=readFileSync('node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2').toString('base64');
 for(const item of cases){
  await page.setContent(`<style>@font-face{font-family:Hindi;src:url(data:font/woff2;base64,${font})}body{margin:0}pre{font:32px/1.8 Hindi,Arial,sans-serif;white-space:pre-wrap;background:white;color:black;padding:40px;width:1200px;box-sizing:border-box;margin:0}</style><pre></pre>`);
  await page.locator('pre').evaluate((el,text)=>{el.textContent=text;},item.text);
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('pre').screenshot({path:join(fixtures,item.name+'.png')});
  writeFileSync(join(fixtures,item.name+'.txt'),item.text+'\n');
 }
} finally { await browser.close(); }
const results=[];
for(const item of cases){
 const image=join(fixtures,item.name+'.png');
 const started=performance.now();
 const worker=await createWorker(item.lang,1,{langPath,cacheMethod:'none',gzip:true,errorHandler:e=>{throw new Error(String(e));}});
 const initMs=Math.round(performance.now()-started);
 try {
  const recognitionStart=performance.now();const {data}=await worker.recognize(image);
  const recognitionMs=Math.round(performance.now()-recognitionStart);
  const result={name:item.name,language:item.lang,fixture: '../fixtures/ocr/'+item.name+'.png',fixtureSha256:createHash('sha256').update(readFileSync(image)).digest('hex'),groundTruth:item.text,recognized:data.text.trim(),confidence:data.confidence,initMs,recognitionMs,...metrics(item.text,data.text)};
  results.push(result); console.log(JSON.stringify(result));
 }finally{await worker.terminate();}
}
const runtimeFiles=['worker.min.js','tesseract-core-relaxedsimd-lstm.wasm.js'];
const runtime=runtimeFiles.map(file=>({file,bytes:statSync(join('public/tesseract',file)).size}));
const report={generatedAt:new Date().toISOString(),engine:'tesseract.js 7.0.0 / tessdata_fast LSTM',fixtureKind:'original synthetic PNGs, Chromium-shaped Devanagari; not official-paper accuracy',hardware:{platform:platform(),cpu:cpus()[0].model,node:process.version},assetManifest,runtime,transferBytes:runtime.reduce((n,a)=>n+a.bytes,0)+assetManifest.assets.reduce((n,a)=>n+a.gzipBytes,0),results};
writeFileSync(join(reports,'ocr-benchmark.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(reports,'ocr-benchmark.md'),`# OCR benchmark — Codex Turn 3\n\nGenerated ${report.generatedAt}. Reproduce from app/: \`rtk npm run assets:tesseract\`, \`rtk npm run assets:ocr:download\`, \`rtk npm run benchmark:ocr\`.\n\nOriginal synthetic PNGs and exact ground truth are retained in fixtures/ocr. Chromium shapes the bundled Noto Sans Devanagari font; no unshaped ImageMagick text. These small clean images are not a general accuracy claim or authentic exam benchmark. NFC + whitespace normalization; CER uses Unicode code points, WER space-delimited tokens. One measured run, no cold browser/RAM claim.\n\nCPU: ${report.hardware.cpu}; Node ${report.hardware.node}.\n\n| Mode | Init ms | Recognize ms | CER | WER | Confidence |\n|---|---:|---:|---:|---:|---:|\n${results.map(r=>`| ${r.language} | ${r.initMs} | ${r.recognitionMs} | ${(r.cer*100).toFixed(2)}% | ${(r.wer*100).toFixed(2)}% | ${r.confidence}% |`).join('\n')}\n\nRelaxed-SIMD LSTM script + worker + compressed models: **${report.transferBytes} bytes**. Includes worker JS, the WASM-embedded loader script and both language files; excludes fonts/PDF.js and HTTP compression. The .wasm.js file embeds WASM; do not count the separate .wasm binary as another browser request. Fallback cores are copied, but each worker loads only one variant. Full copied static OCR directory is about 53 MB (all variants plus raw/gzip language files); browser requests only selected assets. Two workers can repeat loader requests; HTTP cache/wire bytes are not measured. Full sizes, hashes, pinned revision and actual download times are in ocr-asset-download.json and ocr-benchmark.json. Downloads were actually repeated this turn.\n\nAll imported OCR is needs-review with unverified keys. Confidence does not measure accuracy. Layout, missing numbering, mixed-script lines and options require human correction; OCR cannot invent keys or translate.\n`);
if(results.some(r=>!r.recognized || (r.language==='hin' && !/[\u0900-\u097f]/.test(r.recognized))))throw new Error('OCR smoke failed');
