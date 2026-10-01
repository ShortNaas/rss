#!/usr/bin/env python3
"""
Generates the PWA icon set into public/.

The mark is a rasterized vector construction rather than hand-placed pixels: a
broadcast mark anchored bottom-left on a warm ground that matches the app's
sepia theme, so the installed icon belongs to the same world as the UI.

Regenerate with:  npm run icons

Provenance for every raster this writes is embedded in the PNG metadata
(`provenance` key) so the shipping assets are self-describing.
"""

from math import atan2, cos, pi
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

# --- palette (mirrors the sepia + dark themes in app/globals.css) -----------
SEPIA_GROUND = (59, 52, 40)  # #3b3428 warm near-black, as the field
CREAM = (242, 233, 216)  # #f2e9d8 the sepia page tone, as the ink

# --- geometry, in fractions of the canvas --------------------------------
# The broadcast mark: two concentric partial arc bands plus an origin dot.
# Both arcs share the dot's centre, so the rings stay exactly concentric — an
# off-centre origin reads as wobble at small sizes. The arcs sweep from straight
# up down to just short of the dot's own angle.
#
# `MARK_SCALE` sizes the whole mark. It is set so the assembled mark's bounding
# box is centred in the canvas and occupies ~76% of it, which is the proportion
# that keeps an app icon from looking lost inside its own tile.
MARK_SCALE = 1.24

# Base geometry at MARK_SCALE = 1, before centring is applied.
_BASE_ORIGIN = (0.212, 0.606)
BASE_DOT_R = 0.053
BASE_STROKE = 0.069
BASE_GAP = 0.047
BASE_ARC_RADII = (0.256, 0.256 + BASE_STROKE + BASE_GAP)  # -> 0.256, 0.372
# Fraction of the quadrant where the sweep begins: 1.0 is the horizon, 0 is
# straight up. The dot's own edge sits near 0.78, so this clears it clearly.
ARC_MIN_T = 0.26

TOUCH_R = 0.223  # rounded-square corner radius for the non-maskable icons

SUPERSAMPLE = 4
# Width of the anti-aliasing ramp, in units of (normalized distance * 1000).
# Small enough to stay crisp, large enough that supersampling has something to
# average. Values much above ~600 start visibly eroding thin strokes.
EDGE_SHARPNESS = 260.0


def mark_bounds() -> tuple[float, float, float, float]:
    """
    Left, top, right, bottom of the assembled mark, in canvas fractions.
    Derived rather than hand-tuned: the dot sets the low side and the outer arc
    the high side, in each axis.
    """
    ox, oy = origin()
    dot_r = DOT_R
    outer = ARC_RADII[-1] + STROKE / 2.0
    # The sweep stops before the horizon, so the arcs' right extent is set by
    # the terminal angle; their top is the vertical tangent.
    terminal = ARC_MIN_T * (pi / 2.0)
    x_max = ox + outer * cos(terminal)
    y_min = oy - outer
    return ox - dot_r, y_min, x_max, oy + dot_r


def origin() -> tuple[float, float]:
    """
    The dot centre, shifted so the mark's bounding box is centred.

    Applied at import time by main() rewriting _BASE_ORIGIN once; kept as a
    function so the offset is computed from the geometry, not typed in.
    """
    return _BASE_ORIGIN


# Scaled constants, filled by _solve_centring().
DOT_R = BASE_DOT_R * MARK_SCALE
STROKE = BASE_STROKE * MARK_SCALE
GAP = BASE_GAP * MARK_SCALE
ARC_RADII = tuple(r * MARK_SCALE for r in BASE_ARC_RADII)


def _solve_centring() -> None:
    """Slides the origin so the mark's box is centred, in place."""
    global _BASE_ORIGIN
    left, top, right, bottom = mark_bounds()
    _BASE_ORIGIN = (
        _BASE_ORIGIN[0] + (0.5 - (left + right) / 2.0),
        _BASE_ORIGIN[1] + (0.5 - (top + bottom) / 2.0),
    )


def mark_reach() -> float:
    """Furthest extent of the mark from the origin, for bounds checks."""
    return ARC_RADII[-1] + STROKE / 2.0


def in_arc_sweep(nx: float, ny: float, ox: float, oy: float) -> bool:
    """True while the ray from the origin is inside the drawn arc sweep."""
    dx = nx - ox
    dy = ny - oy
    # Above the origin and to the right of it only.
    if dx < 0 or dy > 0:
        return False
    if dx <= 1e-9:
        return True  # straight up
    if dy >= -1e-9:
        return True  # on the horizon
    angle = atan2(-dy, dx)  # radians, 0..pi/2
    return angle >= ARC_MIN_T * (pi / 2.0)


def _arc_coverage(nx: float, ny: float, ox: float, oy: float, radius: float, half: float) -> float:
    """
    Anti-aliased coverage for one arc band at normalized point (nx, ny),
    with a linear ramp across roughly one pixel in normalized units.
    """
    dx = nx - ox
    dy = ny - oy
    dist = (dx * dx + dy * dy) ** 0.5
    band = abs(dist - radius) - half
    return max(0.0, min(1.0, 0.5 - band * EDGE_SHARPNESS))


def render_mark(size: int, scale: float) -> Image.Image:
    """Renders the mark alone as a greyscale mask of `size` pixels."""
    hi = size * SUPERSAMPLE
    mask = Image.new("L", (hi, hi), 0)
    pixels = mask.load()

    ox, oy = origin()
    # `scale` shrinks the mark toward the centre for the maskable safe zone.
    if scale != 1.0:
        ox = 0.5 + (ox - 0.5) * scale
        oy = 0.5 + (oy - 0.5) * scale

    radii = tuple(r * scale for r in ARC_RADII)
    dot_r = DOT_R * scale
    half = (STROKE * scale) / 2.0
    reach = (radii[-1] + half) + 0.02

    # Only the region the mark can occupy needs scanning.
    x_lo, x_hi = 0, int(min(1.0, ox + reach) * hi)
    y_lo, y_hi = int(max(0.0, oy - reach) * hi), int(min(1.0, oy + dot_r + 0.02) * hi)

    for py in range(max(0, y_lo), min(hi, y_hi)):
        ny = (py + 0.5) / hi
        for px in range(max(0, x_lo), min(hi, x_hi)):
            nx = (px + 0.5) / hi

            # Dot at the origin.
            dist = ((nx - ox) ** 2 + (ny - oy) ** 2) ** 0.5
            value = max(0.0, min(1.0, (dot_r - dist) * EDGE_SHARPNESS + 0.5))

            # Arc bands, only inside their angular sweep.
            if in_arc_sweep(nx, ny, ox, oy):
                for radius in radii:
                    value = max(value, _arc_coverage(nx, ny, ox, oy, radius, half))

            if value > 0:
                pixels[px, py] = int(round(value * 255))

    return mask.resize((size, size), Image.LANCZOS)


def rounded_square(size: int, radius_fraction: float) -> Image.Image:
    """A rounded-square alpha mask, for icons that are not full-bleed."""
    hi = size * SUPERSAMPLE
    mask = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, hi - 1, hi - 1),
        radius=int(radius_fraction * hi),
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def compose(
    size: int,
    *,
    background: tuple[int, int, int] | None,
    mark_scale: float,
    corner_radius: float | None,
) -> Image.Image:
    """Builds one icon: ground, then the mark in cream."""
    ground = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    if background is not None:
        field = Image.new("RGBA", (size, size), (*background, 255))
        if corner_radius is not None:
            field.putalpha(rounded_square(size, corner_radius))
        ground = Image.alpha_composite(ground, field)

    mark = render_mark(size, mark_scale)
    ink = Image.new("RGBA", (size, size), (*CREAM, 255))
    ink.putalpha(mark)
    return Image.alpha_composite(ground, ink)


PROVENANCE = (
    "Drawn construction: two concentric anti-aliased quarter-arc bands plus an "
    "origin dot, bottom-left anchored, rendered through Pillow at 4x supersample. "
    "Palette inherited from the app's sepia theme (ground #3b3428, ink #f2e9d8). "
    "Generated by scripts/make-icons.py; no third-party asset."
)


def save(image: Image.Image, path: Path) -> None:
    meta = PngInfo()
    meta.add_text("provenance", PROVENANCE)
    image.save(path, "PNG", optimize=True, pnginfo=meta)
    print(f"  {path.relative_to(path.parent.parent)}  {image.size[0]}x{image.size[1]}")


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public"
    out.mkdir(exist_ok=True)

    # Re-centre from the actual geometry, so the mark's box lands dead centre
    # rather than wherever the hand-set base numbers happened to put it.
    _solve_centring()
    left, top, right, bottom = mark_bounds()
    print(
        f"mark box: x {left:.3f}-{right:.3f}  y {top:.3f}-{bottom:.3f}  "
        f"(centre {((left + right) / 2):.3f}, {((top + bottom) / 2):.3f})"
    )
    print("writing icons ->", out)

    # Standard icons: rounded-square field, mark at natural size.
    for size in (192, 512):
        save(
            compose(size, background=SEPIA_GROUND, mark_scale=1.0, corner_radius=TOUCH_R),
            out / f"icon-{size}.png",
        )

    # Maskable: full-bleed ground, mark pulled into the 80% safe circle so
    # Android's circle/squircle crops never clip it.
    save(
        compose(512, background=SEPIA_GROUND, mark_scale=0.72, corner_radius=None),
        out / "icon-maskable-512.png",
    )

    # iOS home screen: square and opaque, iOS applies its own corner radius.
    save(
        compose(180, background=SEPIA_GROUND, mark_scale=1.0, corner_radius=None),
        out / "apple-touch-icon.png",
    )

    # Favicon, multi-resolution so the browser picks the right one.
    fav = compose(64, background=SEPIA_GROUND, mark_scale=1.0, corner_radius=TOUCH_R)
    fav.save(
        out / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print(f"  public/favicon.ico  16/32/48/64")

    # A 512 PNG of the standard icon doubles as the install-prompt asset.
    print("done")


if __name__ == "__main__":
    main()
