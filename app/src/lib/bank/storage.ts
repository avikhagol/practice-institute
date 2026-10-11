import { makeBank, parseBank, type Bank } from './bank';

export const STORAGE_KEY = 'pdf-smart-bank-v1';
export const SAVE_WARNING = 'Your latest changes could not be saved on this device. Keep this tab open and export your bank as JSON. Browser storage may be blocked or full.';
export interface BankStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function loadBank(storage: Pick<BankStorage, 'getItem'>): Bank | null {
  const text = storage.getItem(STORAGE_KEY);
  return text === null ? null : parseBank(text);
}

export function saveBank(storage: Pick<BankStorage, 'setItem'>, bank: Bank): void {
  // Only metadata and question text. Never PDF handles, bytes, canvases or reader pages.
  const text = JSON.stringify(makeBank(bank.sources, bank.questions));
  parseBank(text); // A bank that exceeds the import bounds must not become an unreadable save.
  storage.setItem(STORAGE_KEY, text);
}
