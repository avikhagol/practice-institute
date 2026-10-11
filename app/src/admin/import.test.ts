import { describe, it, expect } from 'vitest';
import type { Question } from '../lib/types';
import { pairQuestions, bilingualCandidates, ocrPagesToPageText } from './import';
function candidate(stem:string, options: {key:string;text:string}[], number=1):Question {
  return {id:'test',docId:'test',number,page:2,pageEnd:2,context:null,stem,options:options.map(o=>({...o,sourceLabel:o.key})),status:'needs-review',confidence:.8,warnings:[],answerKey:null,answerSource:'none',explanation:null,rawText:stem,edited:false};
}
const source={id:3,year:'2026',subject:'Learning'};
describe('original bilingual pairing',()=>{
  it('pairs matching printed numbers and option keys despite different order',()=>{
    const [q]=pairQuestions([candidate('Which choice?', [{key:'A',text:'First'},{key:'B',text:'Second'}]),candidate('कौन सा विकल्प?', [{key:'B',text:'दूसरा'},{key:'A',text:'पहला'}])],source);
    expect(q?.stem_en).toBe('Which choice?');expect(q?.stem_hi).toBe('कौन सा विकल्प?');
    expect(q?.options).toEqual([{key:'A',en:'First',hi:'पहला'},{key:'B',en:'Second',hi:'दूसरा'}]);
    expect(q?.status).toBe('needs-review');expect(q?.source_page).toBe(2);
  });
  it('does not invent a missing language or key',()=>{
    const [q]=pairQuestions([candidate('English only', [{key:'A',text:'One'},{key:'B',text:'Two'}])],source);
    expect(q?.stem_hi).toBeNull();expect(q).not.toHaveProperty('answer_key');
  });
  it('preserves and warns on ambiguous mixed-script text',()=>{
    const text='Choose one · एक चुनें';const [q]=pairQuestions([candidate(text,[{key:'A',text:'One'},{key:'B',text:'Two'}])],source);
    expect(q?.stem_en).toBe(text);expect(q?.stem_hi).toBeNull();expect(q?.warnings[0]).toContain('Mixed-script');
  });
  it('keeps repeated same-language blocks visible for review',()=>{
    const [q]=pairQuestions([candidate('First block',[{key:'A',text:'One'},{key:'B',text:'Two'}]),candidate('Second block',[{key:'A',text:'Three'},{key:'B',text:'Four'}])],source);
    expect(q?.stem_en).toBe('First block\nSecond block');expect(q?.warnings).toContain('Repeated question number in the same language; verify pairing.');
  });
});

it('parses repeated bilingual source numbers before the inherited parser drops a second set',()=>{
  const texts=['1. Which number?', '(1) One (2) Two', '1. कौन सी संख्या?', '(1) एक (2) दो', '2. Which colour?', '(1) Red (2) Blue', '2. कौन सा रंग?', '(1) लाल (2) नीला'];
  const pages=[{docId:'test',pageNumber:2,width:600,height:800,charCount:300,lowText:false,lines:texts.map(text=>({text,x:10,y:10,height:12}))}];
  const paired=pairQuestions(bilingualCandidates('test',pages,[]),source);
  expect(paired).toHaveLength(2);
  expect(paired[0]?.stem_en).toBe('Which number?');expect(paired[0]?.stem_hi).toBe('कौन सी संख्या?');
  expect(paired[0]?.options[1]).toEqual({key:'B',en:'Two',hi:'दो'});
  expect(paired[1]?.options[0]).toEqual({key:'A',en:'Red',hi:'लाल'});
});

it('supports origin=ocr and adds appropriate review warning', () => {
  const [q] = pairQuestions([candidate('Sample OCR Question', [{key:'A',text:'Opt 1'},{key:'B',text:'Opt 2'}])], source, 'ocr');
  expect(q?.origin).toBe('ocr');
  expect(q?.status).toBe('needs-review');
  expect(q?.warnings.some(w => w.includes('Extracted via OCR'))).toBe(true);
});


it('keeps unnumbered Hindi out of the final English option and requires manual recovery', () => {
  const texts = ['9. Which shape?', '(1) Circle (2) Square (3) Triangle (4) Rectangle', 'कौन सा आकार?', '(1) वृत्त (2) वर्ग (3) त्रिभुज (4) आयत'];
  const pages = [{docId:'test',pageNumber:4,width:600,height:800,charCount:200,lowText:false,lines:texts.map(text=>({text,x:10,y:10,height:12}))}];
  const fallback = [candidate('Which shape?', [{key:'A',text:'Circle'},{key:'B',text:'Square'},{key:'C',text:'Triangle'},{key:'D',text:'Rectangle कौन सा आकार?'}],9)];
  const [q] = pairQuestions(bilingualCandidates('test', pages, fallback), source, 'ocr');
  expect(q?.options[3]).toEqual({key:'D',en:'Rectangle',hi:null});
  expect(q?.stem_hi).toBeNull();
  expect(q?.warnings.join(' ')).toContain('restore Hindi manually');
  expect(q?.status).toBe('needs-review');
  expect(q).not.toHaveProperty('answer_key');
});

it('warns when printed language variants have different option-key sets', () => {
  const [q] = pairQuestions([candidate('Which choice?', [{key:'A',text:'First'},{key:'B',text:'Second'}]), candidate('कौन सा विकल्प?', [{key:'A',text:'पहला'},{key:'C',text:'तीसरा'}])],source);
  expect(q?.warnings.join(' ')).toContain('different option keys');
  expect(q?.options.find(o=>o.key==='B')?.hi).toBeNull();
  expect(q?.options.find(o=>o.key==='C')?.en).toBeNull();
});

it('flags OCR table layouts even when the text recognizer is confident', () => {
  const [q] = pairQuestions([candidate('Using the following table, choose the value.', [{key:'A',text:'One'},{key:'B',text:'Two'}])],source,'ocr');
  expect(q?.warnings.join(' ')).toContain('omit table values');
  expect(q?.status).toBe('needs-review');
});

it('keeps Hindi with stray Latin OCR words out of the English option stream', () => {
  const texts = ['9. Which shape?', '(1) Circle (2) Square (3) Triangle (4) Rectangle', 'कौन सा आकार?', '(1) वृत्त (2) वर्ग (3) त्रिभुज (4) आयत और OCR शब्द'];
  const pages = [{docId:'test',pageNumber:4,width:600,height:800,charCount:200,lowText:false,lines:texts.map(text=>({text,x:10,y:10,height:12}))}];
  const [q] = pairQuestions(bilingualCandidates('test',pages,[]),source,'ocr');
  expect(q?.options[3]).toEqual({key:'D',en:'Rectangle',hi:null});
  expect(q?.warnings.join(' ')).toContain('restore Hindi manually');
});

it('preserves predominantly Hindi stems with original Latin terminology in the Hindi editor', () => {
  const [q] = pairQuestions([candidate('कौन सा API विकल्प सही है?', [{key:'A',text:'पहला'},{key:'B',text:'दूसरा'}])],source);
  expect(q?.stem_hi).toBe('कौन सा API विकल्प सही है?');
  expect(q?.stem_en).toBeNull();
  expect(q?.warnings.join(' ')).toContain('Mixed-script text preserved in Hindi editor');
});

it('hides OCR booklet barcode footers without dropping mathematical bars or real options', () => {
  const texts = ['11. Which value?', '(1) |x| (2) ||y||', 'PU ॥॥॥॥॥॥॥॥ 4 H', '>-1 ॥॥॥॥॥॥॥ 4 I'];
  const [page] = ocrPagesToPageText('test',[{pageNumber:4,text:texts.join('\n'),confidence:91,lines:texts.map(text=>({text,pageNumber:4}))}]);
  expect(page?.lines.map(l=>l.text)).toEqual(texts.slice(0,2));
});
