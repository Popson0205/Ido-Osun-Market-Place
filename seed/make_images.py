"""Generates the placeholder demo images in seed/images. Replace any file with a real photo
(same file name, JPEG, under 400 KB) and re-load the demo data from the admin screen."""
import json, os, random, textwrap
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'demo.json'), encoding='utf-8'))
os.makedirs(os.path.join(HERE, 'images'), exist_ok=True)
PAL = {'Fresh Produce': ('#2e7d32', '#9ccc65'), 'Food': ('#e65100', '#ffb74d'), 'Fashion': ('#6a1b9a', '#ec407a'),
       'Electronics': ('#1565c0', '#4dd0e1'), 'Home & Kitchen': ('#00695c', '#4db6ac'), 'Beauty & Care': ('#ad1457', '#f48fb1'),
       'Beads & Crafts': ('#f9a825', '#ff7043'), 'Pre-owned': ('#4e342e', '#a1887f'), 'Services': ('#283593', '#7986cb')}
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
S = 640
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

def art(path, title, cat, size=60):
    a, b = (hexrgb(c) for c in PAL[cat])
    im = Image.composite(Image.new('RGB', (S, S), b), Image.new('RGB', (S, S), a), Image.linear_gradient('L').resize((S, S))).convert('RGBA')
    rnd = random.Random(title); layer = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(5):
        r = rnd.randint(70, 190); x, y = rnd.randint(-40, S), rnd.randint(-40, S)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(22, 48)))
    im = Image.alpha_composite(im, layer)
    f, fs, fr = ImageFont.truetype(BOLD, size), ImageFont.truetype(BOLD, 24), ImageFont.truetype(REG, 18)
    txt = '\n'.join(textwrap.wrap(title, 15))
    ov = Image.new('RGBA', (S, S), (0, 0, 0, 0)); od = ImageDraw.Draw(ov)   # soft shadow, pill and footer on a transparent layer
    bb = od.multiline_textbbox((0, 0), txt, font=f, spacing=10, align='center')
    x, y = (S - (bb[2] - bb[0])) / 2, (S - (bb[3] - bb[1])) / 2
    od.multiline_text((x + 2, y + 3), txt, font=f, fill=(0, 0, 0, 70), spacing=10, align='center')
    tw = od.textlength(cat.upper(), font=fs)
    od.rounded_rectangle([24, 24, 24 + tw + 28, 24 + 40], 20, fill=(0, 0, 0, 60))
    od.text((S / 2, S - 28), 'demo image', font=fr, fill=(255, 255, 255, 150), anchor='mm')
    im = Image.alpha_composite(im, ov); d = ImageDraw.Draw(im)
    d.multiline_text((x, y), txt, font=f, fill='white', spacing=10, align='center')
    d.text((38, 29), cat.upper(), font=fs, fill='white')
    im.convert('RGB').save(os.path.join(HERE, 'images', path), 'JPEG', quality=80, optimize=True)

n = 0
for s in data['stores']:
    art(f"store-{s['slug']}.jpg", s['name'], s['category'], 56); n += 1
    for p in s['products']:
        art(f"{p['slug']}.jpg", p['name'], s['category']); n += 1
print(n, 'images')
