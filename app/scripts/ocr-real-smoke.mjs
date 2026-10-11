// Optional ignored official fixture; no paper text enters the distributable report.
import { execFileSync } from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createWorker} from 'tesseract.js';
import {resolve} from 'node:path';
const pdf=resolve('../fixtures/real/ctet-dec2024-paper1-setH.pdf');
const hash=createHash('sha256').update(readFileSync(pdf)).digest('hex');
if(hash!=='1dcf1ba4129cdffd343b572a693209f244b9f2af1550aa7173641aa831153005')throw new Error('Unexpected official fixture identity');
const prefix=resolve('../fixtures/real/ocr-page4');
execFileSync('pdftoppm',['-f','4','-l','4','-scale-to','1800','-png','-singlefile',pdf,prefix]);
const started=performance.now();const worker=await createWorker('eng+hin',1,{langPath:resolve('public/tesseract/lang-data'),cacheMethod:'none'});
try{
 const {data}=await worker.recognize(prefix+'.png');
 writeFileSync(prefix+'.txt',data.text);
 const summary={generatedAt:new Date().toISOString(),source:'Official CTET Dec 2024 Paper I Set H',sha256:hash,page:4,language:'eng+hin',elapsedMs:Math.round(performance.now()-started),confidence:data.confidence,characters:data.text.length,devanagariCharacters:(data.text.match(/[\u0900-\u097f]/g)||[]).length,accuracy:'Not measured: no audited full-page ground truth',provenance:'fixtures/real/PROVENANCE.md',privateOutput:'fixtures/real/ocr-page4.txt',reviewFindings:['Unicode Hindi recovered from rendered legacy-font PDF','Visual comparison: some Hindi words, Roman assertion labels and English option words are wrong','Hindi stems are unnumbered; pairing by printed question number cannot establish their identity','No answer key in source. Needs review; use crop correction, never publish automatically']};
 writeFileSync('../reports/ocr-real-smoke.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await worker.terminate();}
