// Pages is public HTTPS hosting. Refuse an unset or non-origin API variable.
const raw = process.env.VITE_PI_API_BASE;
try {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('invalid origin');
  console.log('Public HTTPS API origin configured.');
} catch {
  console.error('Set repository Actions variable VITE_PI_API_BASE to your HTTPS API origin (no path, credentials, query or fragment).');
  process.exitCode = 1;
}
