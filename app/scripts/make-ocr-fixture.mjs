import { PDFDocument } from 'pdf-lib';
import {readFileSync,writeFileSync} from 'node:fs';
const pdf=await PDFDocument.create();
const image=await pdf.embedPng(readFileSync('../fixtures/ocr/bilingual.png'));
const page=pdf.addPage([600,600*image.height/image.width]);
page.drawImage(image,{x:0,y:0,width:600,height:page.getHeight()});
writeFileSync('../fixtures/ocr/scan.pdf',await pdf.save());
