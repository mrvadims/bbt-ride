#!/usr/bin/env python3
"""Build prototype/index.html: inline seed data, fallback forecast, and logo into src/app.html.

Usage: python3 prototype/build.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def inline_json(path):
    # Compact, and escape "</" so the payload can't close its <script> tag.
    data = json.loads((ROOT / path).read_text())
    return json.dumps(data, separators=(",", ":")).replace("</", "<\\/")


def main():
    src = (ROOT / "prototype/src/app.html").read_text()
    logo = (ROOT / "brand/web/bbt-logo.svg").read_text().strip()
    logo = logo.replace('<svg ', '<svg class="logo" ', 1)
    out = (
        src.replace("/*SEED_JSON*/", inline_json("data/seed.json"))
        .replace("/*FALLBACK_JSON*/", inline_json("data/raw/om_purchase.json"))
        .replace("<!--BBT_LOGO-->", logo)
    )
    dest = ROOT / "prototype/index.html"
    dest.write_text(out)
    print(f"wrote {dest.relative_to(ROOT)} ({len(out.encode()) // 1024} KB)")


if __name__ == "__main__":
    main()
