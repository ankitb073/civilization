"""Contact sheet of images with labels: sheet.py out.png cols cell img1 [img2 ...]  (run with build/kit/venv python -I)."""
import sys
from PIL import Image, ImageDraw, ImageFont

def main():
    out, cols, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    paths = sys.argv[4:]
    rows = (len(paths) + cols - 1) // cols
    lab = 18
    try:
        a0 = Image.open(paths[0])
        ch = int(round(cell * a0.height / a0.width))
    except Exception:
        ch = cell
    sheet = Image.new('RGB', (cols * cell, rows * (ch + lab)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 13)
    except Exception:
        font = ImageFont.load_default()
    for i, p in enumerate(paths):
        try:
            im = Image.open(p).convert('RGB')
        except Exception:
            continue
        im.thumbnail((cell, ch))
        x, y = (i % cols) * cell, (i // cols) * (ch + lab)
        sheet.paste(im, (x + (cell - im.width) // 2, y + lab))
        name = p.rsplit('/', 1)[-1].rsplit('.', 1)[0]
        d.text((x + 3, y + 2), name[:40], fill=(230, 230, 230), font=font)
    sheet.save(out)

main()
