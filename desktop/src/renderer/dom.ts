// Tiny DOM helper. Text is always set via textContent/createTextNode, never innerHTML.
export type Child = Node | string | null | false | undefined;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}
