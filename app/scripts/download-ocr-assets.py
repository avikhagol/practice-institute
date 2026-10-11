"""Explicit opt-in download of two public, pinned Apache-2.0 language models.
No document upload. 16 MB per-file limit and 32 MB total raw download limit.
"""
import gzip, hashlib, json, time, urllib.request
from pathlib import Path
REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd"
root = Path(__file__).resolve().parents[1]
dest = root / "public/tesseract/lang-data"
dest.mkdir(parents=True, exist_ok=True)
EXPECTED = {"eng": "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2", "hin": "4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825"}
records = []
total = 0
for language in ("eng", "hin"):
    url = f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{REVISION}/{language}.traineddata"
    started = time.monotonic()
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(16_000_001)
    total += len(data)
    if len(data) > 16_000_000 or total > 32_000_000:
        raise ValueError("OCR asset budget exceeded")
    if hashlib.sha256(data).hexdigest() != EXPECTED[language]:
        raise ValueError("Pinned OCR checksum mismatch")
    compressed = gzip.compress(data, mtime=0)
    (dest / f"{language}.traineddata").write_bytes(data)
    (dest / f"{language}.traineddata.gz").write_bytes(compressed)
    records.append(dict(language=language, url=url, revision=REVISION, license="Apache-2.0",
                        rawBytes=len(data), gzipBytes=len(compressed), sha256=hashlib.sha256(data).hexdigest(),
                        gzipSha256=hashlib.sha256(compressed).hexdigest(), downloadMs=round((time.monotonic()-started)*1000)))
with urllib.request.urlopen(f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{REVISION}/LICENSE", timeout=30) as response:
    license_data = response.read(20_001)
if len(license_data) > 20_000:
    raise ValueError("Unexpected license file size")
(dest / "LICENSE").write_bytes(license_data)
manifest = dict(downloadedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), assets=records)
(dest / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
(root.parent / "reports/ocr-asset-download.json").write_text(json.dumps(manifest, indent=2)+"\n")
print(json.dumps(manifest, indent=2))
