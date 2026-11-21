#!/usr/bin/env python3
"""Fetch cam images, compute SHA-1 hashes, update data/cam-status.json.

Schema:
    {
        "<wsrv.nl URL>" | "halle": {
            "hash": "<sha1>",
            "lastChange": <ms_epoch>,
            "source": "origin" | "bot"
        }
    }

Preferred timestamp source is the origin server's HTTP Last-Modified header
(exact file mtime). When that's unavailable, we fall back to the bot's run
time -- which is imprecise because GitHub Actions cron drifts heavily.

Flugzeughalle (since 21.11.2026): its image address is in neither the page nor
the repo (the page keeps it encrypted since 16.11.2026). The job reads it from
the repository secret HALLE_SRC (environment variable, set only for the step
"Refresh cam status") and stores the status under the neutral key "halle",
never under the address. The log never shows the address nor error texts that
may contain it: GitHub masks only the exact secret value, not the origin
address derived from it. Without the secret the hall has no entry.
"""
import email.utils
import hashlib
import json
import os
import re
import sys
import time
from datetime import timezone
from pathlib import Path
from urllib.parse import unquote

import requests

ROOT = Path(__file__).resolve().parent.parent
# Scan every HTML file in the repo root. The SRC_PATTERN below only picks up
# wsrv.nl cam URLs, so unrelated HTML files (404 page etc.) are ignored.
HTML_FILES = sorted(ROOT.glob("*.html"))
STATUS_FILE = ROOT / "data" / "cam-status.json"

# Only cams that route through wsrv.nl participate. LSPV cams (Wangen-Lachen)
# use data-cam= and have their own client-side timestamping.
# data-locksrc = code-protected cam with a plain wsrv URL in the page (no longer
# used on EDSF: the Flugzeughalle comes from HALLE_SRC, see below).
SRC_PATTERN = re.compile(r'data-(?:src|locksrc)="(https://wsrv\.nl/\?url=[^"]+)"')

TIMEOUT = 20
USER_AGENT = "Mozilla/5.0 (compatible; CamStatusBot/1.0)"

# Flugzeughalle: key in cam-status.json (also the name in the log) and the
# environment variable with its image address (wsrv.nl or direct http(s) URL)
HALLE_KEY = "halle"
HALLE_ENV = "HALLE_SRC"


def collect_cam_urls():
    urls = set()
    for html_path in HTML_FILES:
        text = html_path.read_text(encoding="utf-8")
        urls.update(SRC_PATTERN.findall(text))
    return sorted(urls)


def origin_url(wsrv_url):
    prefix = "https://wsrv.nl/?url="
    if not wsrv_url.startswith(prefix):
        return wsrv_url
    raw = unquote(wsrv_url[len(prefix):])
    if not raw.startswith(("http://", "https://")):
        raw = "http://" + raw
    return raw


def halle_origin():
    """Origin URL of the hall camera from HALLE_SRC, or None (unset or not an
    http(s) URL). Never logs the value. Expected value: the wsrv.nl URL as the
    page uses it (https://wsrv.nl/?url=<host>/<path>.jpg) or the direct http(s)
    URL of the image; for the wsrv form only the url parameter counts (display
    parameters such as &w=900 are cut off, like in ai_briefing.py)."""
    raw = os.environ.get(HALLE_ENV, "").strip()
    if not raw:
        return None
    if not re.match(r"https?://\S+$", raw):
        print(f"[warn] {HALLE_KEY}: {HALLE_ENV} is not an http(s) URL, skipped",
              file=sys.stderr)
        return None
    if raw.startswith("https://wsrv.nl/?url="):
        raw = raw.split("&", 1)[0]
    return origin_url(raw)


def fetch_meta(url, label=None):
    """Return (sha1_hex, last_modified_ms_or_None) or (None, None) on error.

    label: name for the log instead of the URL (hall camera); then the log
    shows only the error type and the HTTP status, no error text (it may
    contain the URL). That line is printed after the except block, so that no
    traceback can chain the error text to it."""
    try:
        r = requests.get(
            url,
            timeout=TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"},
            allow_redirects=True,
        )
        r.raise_for_status()
        if not r.content:
            return None, None
        h = hashlib.sha1(r.content).hexdigest()

        lm_ms = None
        lm = r.headers.get("Last-Modified")
        if lm:
            try:
                dt = email.utils.parsedate_to_datetime(lm)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                lm_ms = int(dt.timestamp() * 1000)
            except (TypeError, ValueError, OverflowError):
                pass
        return h, lm_ms
    except Exception as e:
        if label is None:
            print(f"[warn] {url}: {e}", file=sys.stderr)
            return None, None
        kind = type(e).__name__
        code = getattr(getattr(e, "response", None), "status_code", None)
    print(f"[warn] {label}: {kind}" + (f" {code}" if code else ""), file=sys.stderr)
    return None, None


def load_status():
    if STATUS_FILE.exists():
        try:
            return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print("[warn] cam-status.json malformed, starting fresh",
                  file=sys.stderr)
    return {}


def save_status(data):
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(
        json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main():
    now_ms = int(time.time() * 1000)
    status = load_status()
    # (key in cam-status.json, URL to fetch, name in the log; None = the URL)
    targets = [(u, origin_url(u), None) for u in collect_cam_urls()]
    halle = halle_origin()
    if halle:
        targets.append((HALLE_KEY, halle, HALLE_KEY))
    print(f"Checking {len(targets)} cams" + (f" (incl. {HALLE_KEY})" if halle else ""))

    new_status = {}
    changed = 0

    for key, origin, label in targets:
        h, lm_ms = fetch_meta(origin, label)
        prev = status.get(key, {})

        if h is None:
            # Transient error: keep previous entry so we don't lose history.
            if prev:
                new_status[key] = prev
            continue

        if prev.get("hash") == h:
            # Same image bytes. Refine lastChange if origin now reports a
            # better (Last-Modified) timestamp than what we stored.
            if lm_ms and prev.get("lastChange") != lm_ms:
                new_status[key] = {
                    "hash": h, "lastChange": lm_ms, "source": "origin",
                }
            else:
                new_status[key] = prev
        else:
            # Image changed. Prefer origin's Last-Modified; fall back to "now".
            last_change = lm_ms if lm_ms else now_ms
            source = "origin" if lm_ms else "bot"
            new_status[key] = {
                "hash": h, "lastChange": last_change, "source": source,
            }
            changed += 1
            print(f"[update/{source}] {label or key}")

        if h is not None and lm_ms is None:
            print(f"[no-last-modified] {label or origin}", file=sys.stderr)

    save_status(new_status)
    print(f"Done. {changed} entry/entries updated.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # Cancelled run (Actions sends SIGINT): exit without a traceback, so
        # that no chained error text (it may contain the hall URL) is logged
        sys.exit(130)
