import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { recognizeCanvas, recognizeCrop, recognizePdfPages } from './engine';
const pdf = { numPages: 30 } as PDFDocumentProxy;
describe('bounded OCR jobs', () => {
  it('rejects empty, repeated, excessive and invalid pages before rendering', async () => {
    for (const pages of [[], [1,1], [0], [31], [1.5], Array.from({length:21},(_,i)=>i+1)]) {
      await expect(recognizePdfPages(pdf,pages)).rejects.toThrow('1–20 distinct valid pages');
    }
  });
  it('rejects pre-cancelled work without initializing assets', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(recognizeCanvas({} as HTMLCanvasElement,{signal:abort.signal})).rejects.toThrow('OCR cancelled');
  });
  it('bounds canvas pixels before encoding or worker startup', async () => {
    await expect(recognizeCanvas({width:4000,height:4000} as HTMLCanvasElement)).rejects.toThrow('8 megapixel');
  });
  it('rejects crops outside the source, non-finite and zero-sized rectangles', async () => {
    const source = {width:100,height:100} as HTMLCanvasElement;
    for (const crop of [{x:90,y:0,width:20,height:10},{x:-1,y:0,width:10,height:10},{x:0,y:0,width:0,height:1},{x:NaN,y:0,width:1,height:1}]) {
      await expect(recognizeCrop(source,crop)).rejects.toThrow('Invalid crop bounds');
    }
  });
});
