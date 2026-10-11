# Original error fixtures

These fixtures contain only original synthetic material, never CTET/NET content.

- `image-only.pdf`: one embedded RGB PNG depicting lines on a paper; no selectable text. Created by `app/scripts/make-error-fixtures.mjs` using pdf-lib and a PNG encoder.
- `password.pdf`: the original bundled demo encrypted with AES-256 by qpdf. Test-only password: `study`. No real credentials.
- `oversize.pdf`: a sparse 41 MB file, rejected by the size preflight before PDF bytes are read. Git-ignored; regenerate before browser tests. It is deliberately not a valid PDF.

From `app/`, regenerate with:

```bash
rtk proxy node scripts/make-error-fixtures.mjs
rtk proxy qpdf --encrypt study fixture-owner 256 -- public/demo/pdf-smart-synthetic-demo.pdf ../fixtures/synthetic/password.pdf
```

qpdf is a local fixture-generation tool, not an app/runtime dependency. The small image and password fixtures can be distributed. None of these fixtures is copied into `public/` or `dist/`.
