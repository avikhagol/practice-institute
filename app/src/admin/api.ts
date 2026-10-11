export interface Session {username: string; role: 'owner'|'editor'; csrf_token: string}
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again to continue.';
let csrf = '';
export function setSession(session: Session | null) { csrf = session?.csrf_token ?? ''; }
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const headers: Record<string,string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/admin/${path}`, {method, credentials:'same-origin', headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)});
  if (!response.ok) {
    if (response.status === 401 && csrf && path !== 'login') {
      window.dispatchEvent(new Event('admin-session-expired'));
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
    const data = await response.json().catch(()=>({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : data.error ?? `Request failed (${response.status}). Check your input.`);
  }
  return response.json() as Promise<T>;
}
export interface Option {key: string; en: string|null; hi: string|null}
export interface BankQuestion {id:number; version:number; stem_en:string|null; stem_hi:string|null; context_en:string|null; context_hi:string|null; options:Option[]; answer_key:string|null; key_verified:boolean; status:'needs-review'|'reviewed'|'excluded'; origin:string; source_id:number|null; source_number:number|null; source_page:number|null; crop_json?:string|null; subject:string|null; year:string|null; explanation_en:string|null; explanation_hi:string|null; warnings:string[]}
export interface Source {id:number; label:string; filename:string; page_count:number; provenance:string; consent:boolean; subject:string|null; year:string|null}
export interface Exam {id:number; title:string; code:string; status:string; mode:string; scored:boolean; attempts:number; max_attempts:number; subset_count:number|null; opens_at:number; closes_at:number; release_scores:boolean; release_answers:boolean; release_ranks:boolean; question_ids_json:string}
export interface Attempt {id:string; alias:string; attempt_number:number; status:string; score:number|null; answered:number; deadline_at:number; correct:number|null; wrong:number|null; unanswered:number|null}
