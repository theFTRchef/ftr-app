"""Upload a release .aab to Google Play internal testing.

Uses a short-lived access token (PLAY_TOKEN) from GitHub's keyless sign-in to
Google Cloud, so no service account key file is stored anywhere.
Usage: python3 play_upload.py <aab> [mapping.txt] <release name>
"""
import json, os, sys, urllib.request

PKG = "com.franklintiffinroom.app"
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
UP = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"
TOKEN = os.environ["PLAY_TOKEN"]


def call(method, url, body=None, data=None, ctype="application/json"):
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"Google Play said {e.code} for {method} {url.split('?')[0]}:\n{e.read().decode()[:2000]}")


aab, *rest = sys.argv[1:]
name = rest[-1]
mapping = rest[0] if len(rest) == 2 and os.path.exists(rest[0]) else None

edit = call("POST", f"{API}/edits", {})["id"]
with open(aab, "rb") as f:
    bundle = call("POST", f"{UP}/edits/{edit}/bundles?uploadType=media", data=f.read(), ctype="application/octet-stream")
code = bundle["versionCode"]
print(f"Uploaded bundle, version code {code}")
if mapping:
    with open(mapping, "rb") as f:
        call("POST", f"{UP}/edits/{edit}/bundles/{code}/deobfuscationFiles/proguard?uploadType=media", data=f.read(), ctype="application/octet-stream")
    print("Uploaded R8 mapping file")
call("PUT", f"{API}/edits/{edit}/tracks/internal", {
    "track": "internal",
    "releases": [{"name": name, "versionCodes": [str(code)], "status": "completed"}],
})
call("POST", f"{API}/edits/{edit}:commit")
print(f"Released {name} (version {code}) to Internal testing")
