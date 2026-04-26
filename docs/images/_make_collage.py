"""Build two collage images for the README.

collage-tour.png  : 3x3 grid of all 9 product screenshots (board, task,
                    runs, comments, roles, skills, themes, sessions list,
                    session detail). Acts as the single visual tour.
collage-hero.png  : 2x1 side-by-side (active board + task detail) — the
                    one-shot "what is this" image.

Layout: tile each source onto a fixed cell at uniform width preserving
aspect, padding cells with the README's neutral background. Drop a thin
border between cells so adjacent screenshots stay visually distinct.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
BG = (245, 244, 240)         # warm neutral matches AgentBoard palette
BORDER = (210, 205, 195)
GAP = 24                     # px between cells
PAD = 32                     # px outer padding


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    """Resize keeping aspect, then center-pad onto (w, h) BG canvas."""
    src_w, src_h = img.size
    scale = min(w / src_w, h / src_h)
    new_w, new_h = int(src_w * scale), int(src_h * scale)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), BG)
    canvas.paste(resized, ((w - new_w) // 2, (h - new_h) // 2))
    # 1px border for cell separation
    from PIL import ImageDraw
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, w - 1, h - 1], outline=BORDER, width=1)
    return canvas


def grid(images: list[Image.Image], cols: int, cell_w: int, cell_h: int) -> Image.Image:
    rows = (len(images) + cols - 1) // cols
    W = PAD * 2 + cols * cell_w + (cols - 1) * GAP
    H = PAD * 2 + rows * cell_h + (rows - 1) * GAP
    out = Image.new("RGB", (W, H), BG)
    for i, im in enumerate(images):
        r, c = divmod(i, cols)
        x = PAD + c * (cell_w + GAP)
        y = PAD + r * (cell_h + GAP)
        out.paste(fit(im, cell_w, cell_h), (x, y))
    return out


def main() -> None:
    tour_files = [
        "02-board-active.png",
        "03-new-task.png",
        "04-task-detail-runs.png",
        "05-task-comments.png",
        "06-roles.png",
        "07-skills.png",
        "08-themes.png",
        "09-sessions-list.png",
        "10-session-detail.png",
    ]
    imgs = [Image.open(HERE / f).convert("RGB") for f in tour_files]
    tour = grid(imgs, cols=3, cell_w=900, cell_h=560)
    tour.save(HERE / "collage-tour.png", optimize=True)
    print(f"collage-tour.png  {tour.size}")

    hero_files = ["02-board-active.png", "04-task-detail-runs.png"]
    himgs = [Image.open(HERE / f).convert("RGB") for f in hero_files]
    hero = grid(himgs, cols=2, cell_w=1100, cell_h=680)
    hero.save(HERE / "collage-hero.png", optimize=True)
    print(f"collage-hero.png  {hero.size}")


if __name__ == "__main__":
    main()
