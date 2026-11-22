"""Cut one picture per feature for ja.html and index.html out of shots already in the repository.

Every picture comes out 800 x 500 (16:10): the crop is scaled to fit (at most 2x) and centred
on the colour of its own top-left pixel, so UI crops sit on the app's own background.
The app screens come from manual/img/<lang>/ (ja: the manual's own shots; en: the same screens
shot again with VR_LANG=en). Japanese pictures go to img/ja/feat/, English ones to img/feat/.
Run from the repository root: python site/source/feat_crops.py
"""
from pathlib import Path
from PIL import Image

SITE = Path(__file__).resolve().parent.parent
I = SITE / 'img'
W, H = 800, 500


def crops(M: Path, L: Path) -> dict:
    """name: (source, crop box or None for the whole image). M: app screens, L: the site's
    own shots in that language."""
    return {
        # How it works
        'step-import': (M / 'library.jpg', (0, 40, 1040, 330)),
        'step-search': (M / 'filter.jpg', (0, 0, 430, 420)),
        'step-build': (M / 'scene.jpg', (1082, 180, 1440, 560)),
        'step-show': (M / 'export.jpg', None),
        # What the data puts in
        'data-scoreboard': (M / 'video-settings.jpg', (586, 128, 966, 400)),
        'data-telop': (L / 'after.jpg', (0, 420, 640, 720)),
        'data-court': (M / 'view-tab.jpg', (98, 12, 554, 270)),
        'data-speed': (M / 'video-settings.jpg', (16, 50, 576, 363)),
        # What you add
        'you-annotate': (M / 'objects.jpg', (12, 12, 638, 520)),
        'you-card': (L / 'finish-card.jpg', None),
        'you-slide': (M / 'board.jpg', (0, 0, 880, 560)),
        'you-timing': (M / 'scene.jpg', (443, 505, 1068, 740)),
        # More
        'more-saved': (M / 'filter.jpg', (0, 0, 430, 230)),
        'more-library': (M / 'new-project.jpg', None),
        'more-walk': (M / 'scene.jpg', (443, 58, 1068, 410)),
        'more-pptx': (I / 'slide-setter.jpg', None),
        'more-batch': (M / 'import-scan.jpg', None),
        'more-compare': (M / 'compare.jpg', (0, 40, 1440, 900)),
    }


# Where the English screens sit differently: the Shows tab's video fills the column (the
# Japanese shot has black bars at the sides), and the Objects toolbar sits a little lower.
EN_BOXES = {
    'data-court': (12, 12, 638, 362),
    'you-annotate': (12, 12, 638, 600),
}


def fit(img: Image.Image) -> Image.Image:
    bg = img.convert('RGB').getpixel((0, 0))
    s = min(W / img.width, H / img.height, 2.0)
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    out = Image.new('RGB', (W, H), bg)
    out.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    return out


def photos() -> Image.Image:
    """The photo pack: the three players' photos side by side."""
    names = ['11-kudo', '12-noguchi', '3-hayashi']
    out = Image.new('RGB', (W, H), (241, 245, 249))
    pw, gap = 220, 24
    x = (W - 3 * pw - 2 * gap) // 2
    for n in names:
        p = Image.open(SITE / 'source' / 'photos' / f'{n}.jpg').convert('RGB')
        ph = round(p.height * pw / p.width)
        p = p.resize((pw, ph), Image.LANCZOS)
        out.paste(p, (x, (H - ph) // 2))
        x += pw + gap
    return out


def languages() -> Image.Image:
    """The same dialog in Japanese and English, side by side."""
    out = Image.new('RGB', (W, H), (241, 245, 249))
    half = (W - 24) // 2
    for i, src in enumerate([I / 'ja' / 'preset.jpg', I / 'preset.jpg']):
        p = Image.open(src).convert('RGB')
        p = p.crop((0, 0, 560, round(560 * H / half)))
        p = p.resize((half, H), Image.LANCZOS)
        out.paste(p, (i * (half + 24), 0))
    return out


def main() -> None:
    for lang, L in (('ja', I / 'ja'), ('en', I)):
        out = L / 'feat'
        out.mkdir(parents=True, exist_ok=True)
        cs = crops(SITE / 'manual' / 'img' / lang, L)
        if lang == 'en':
            cs.update({k: (cs[k][0], b) for k, b in EN_BOXES.items()})
        for name, (src, box) in cs.items():
            img = Image.open(src)
            if box:
                img = img.crop(box)
            fit(img).save(out / f'{name}.jpg', quality=84, optimize=True, progressive=True)
        photos().save(out / 'more-photos.jpg', quality=84, optimize=True, progressive=True)
        languages().save(out / 'more-lang.jpg', quality=84, optimize=True, progressive=True)
        print('wrote', len(cs) + 2, 'pictures to', out)


if __name__ == '__main__':
    main()
