"""
tools/make_tags.py — A4 sheet of QR hang tags for a shop.

    python tools/make_tags.py --bot YourShopBot --shop S1 --from 1 --to 32 --out tags_S1.pdf
    python tools/make_tags.py --bot YourShopBot --shop S1 --from 1 --to 32 --shop-name "ဆိုင် ၁" --out tags_S1.pdf

Each tag: QR (deep link https://t.me/<bot>?start=<ID>), the id in large text so it can be
typed if the camera fails, and the shop name. 32 tags per A4 (4 x 8), cut on the dotted lines.
Print on 200-300 gsm card, punch a hole, tie with string. Stickers peel off fabric.
"""
import argparse
import os
import sys

import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

COLS, ROWS = 4, 8
PAGE_W, PAGE_H = A4
CELL_W, CELL_H = PAGE_W / COLS, PAGE_H / ROWS


def burmese_font():
    """Windows ships 'Myanmar Text'; fall back to Helvetica (Latin only) elsewhere."""
    candidates = [
        r"C:\Windows\Fonts\mmrtext.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Myanmar Sangam MN.ttc",
    ]
    for p in candidates:
        if os.path.exists(p) and p.endswith(".ttf"):
            try:
                pdfmetrics.registerFont(TTFont("Burmese", p))
                return "Burmese"
            except Exception:
                pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", required=True, help="bot username without @")
    ap.add_argument("--shop", default="S1")
    ap.add_argument("--from", dest="start", type=int, default=1)
    ap.add_argument("--to", dest="end", type=int, default=32)
    ap.add_argument("--shop-name", default="")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    out = a.out or f"tags_{a.shop}_{a.start:04d}-{a.end:04d}.pdf"
    font = burmese_font()
    c = canvas.Canvas(out, pagesize=A4)
    c.setTitle(f"QR tags {a.shop} {a.start:04d}-{a.end:04d}")
    ids = [f"{a.shop}-{n:04d}" for n in range(a.start, a.end + 1)]

    for i, item_id in enumerate(ids):
        slot = i % (COLS * ROWS)
        if i and slot == 0:
            c.showPage()
        col, row = slot % COLS, slot // COLS
        x0 = col * CELL_W
        y0 = PAGE_H - (row + 1) * CELL_H

        # cut guides
        c.setDash(2, 3)
        c.setStrokeColorRGB(0.7, 0.7, 0.7)
        c.rect(x0, y0, CELL_W, CELL_H)
        c.setDash()

        # QR
        url = f"https://t.me/{a.bot}?start={item_id}"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=1)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        size = CELL_H - 8 * mm
        c.drawImage(ImageReader(img), x0 + 3 * mm, y0 + 4 * mm, size, size)

        # text
        tx = x0 + size + 5 * mm
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(tx, y0 + CELL_H - 12 * mm, item_id)
        if a.shop_name:
            c.setFont(font or "Helvetica", 9)
            c.drawString(tx, y0 + CELL_H - 18 * mm, a.shop_name if font else a.shop)
        c.setFont("Helvetica", 6.5)
        c.drawString(tx, y0 + 6 * mm, "scan")
        c.drawString(tx, y0 + 3.5 * mm, "\u2192 START")

    c.save()
    print(f"wrote {out}: {len(ids)} tags, {(len(ids) + COLS * ROWS - 1) // (COLS * ROWS)} page(s)"
          + ("" if font else " (no Burmese font found; shop name printed in Latin)"))


if __name__ == "__main__":
    sys.exit(main())
