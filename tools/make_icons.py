"""
Khata app icon.

The mark is the Devanagari letter ख (kha) — the first letter of खाता — set in
cream on the app's own green, entered on a ruled line. Beneath that line sits a
second, thinner rule in sindoor red: in bookkeeping a double rule closes a
total, and in a bahi-khata the red thread binds the book.

Rendered at 4x and downsampled so the hairlines stay clean.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf"
GLYPH = "ख"

GREEN = "#1C6A49"   # khata green — the app's income/primary
PAPER = "#F2EBDA"   # aged ledger cream
SINDOOR = "#B8452F" # binding thread

SS = 4  # supersample factor


def draw_group(size, scale=1.0, sindoor=True):
    """The glyph plus its rules, on transparency, as one composable group."""
    S = size
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # Glyph, sized so its ink height lands at ~34% of the canvas.
    target_h = S * 0.34 * scale
    pt = int(target_h * 1.55)
    font = ImageFont.truetype(FONT, pt)
    bb = d.textbbox((0, 0), GLYPH, font=font)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]

    gx = (S - gw) / 2 - bb[0]
    gy = S * 0.30 - bb[1]
    d.text((gx, gy), GLYPH, font=font, fill=PAPER)

    # Rules, centred under the glyph.
    rule_w = S * 0.50 * scale
    x0 = (S - rule_w) / 2
    y1 = S * 0.30 + gh + S * 0.135 * scale
    h1 = max(1, S * 0.026 * scale)
    d.rectangle([x0, y1, x0 + rule_w, y1 + h1], fill=PAPER)

    if sindoor:
        y2 = y1 + h1 + S * 0.030 * scale
        h2 = max(1, S * 0.015 * scale)
        d.rectangle([x0, y2, x0 + rule_w, y2 + h2], fill=SINDOOR)
        bottom = y2 + h2
    else:
        bottom = y1 + h1

    # Recentre the group vertically on its true ink extent.
    top = S * 0.30 + bb[1] - bb[1]  # glyph top after placement
    top = gy + bb[1]
    shift = (S - (bottom - top)) / 2 - top
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(layer, (0, int(round(shift))), layer)
    return out


def render(size, maskable=False, sindoor=True, path=None):
    S = size * SS
    img = Image.new("RGB", (S, S), GREEN)
    # Maskable icons must keep their content inside the centred 80% circle.
    group = draw_group(S, scale=0.74 if maskable else 1.0, sindoor=sindoor)
    img.paste(group, (0, 0), group)
    img = img.resize((size, size), Image.LANCZOS)
    if path:
        img.save(path, "PNG", optimize=True)
    return img


if __name__ == "__main__":
    out = str(pathlib.Path(__file__).resolve().parent.parent / "client" / "public") + "/"
    render(512, path=out + "icon-512.png")
    render(192, path=out + "icon-192.png")
    render(512, maskable=True, path=out + "icon-maskable-512.png")
    render(192, maskable=True, path=out + "icon-maskable-192.png")
    render(180, path=out + "apple-touch-icon.png")

    # Favicon: no sindoor rule — at 16px it would only muddy the mark.
    ico = render(256, sindoor=False)
    ico.save(out + "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons written")
