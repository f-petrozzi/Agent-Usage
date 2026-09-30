# App icon

The purple flowing ribbon is reconstructed from the user's selected reference.
Its six separated sections surround a star-shaped opening. The background and
opening are transparent; there is no enclosing tile or baked-in JPEG.

Canonical vector: `../../desktop/resources/icon.svg`. The artwork uses SVG paths
with gently blended shading, clipped to the original ribbon contours.
`icon-small.svg` frames the same artwork for a 16 px canvas.

Both ICOs contain independently rendered 16, 20, 24, 32, 40, 48, 64, 96, 128, and
256 px PNG entries. Each size has exactly one transparent pixel of vertical
padding, and its original proportions are preserved. The 256 px mark occupies
254 px (99.2%) of the canvas height. All four outer pixel rows/columns are checked
for transparency during generation, so antialiasing does not get cropped.

The same ICO supplies the executable/installer, Start menu shortcut, app windows,
tray, and notification icon. The documentation PNGs are 1024 px renders.

Regenerate with:

    PLAYWRIGHT_MODULE=/path/to/playwright node scripts/build-icons.cjs /tmp/ribbon-icons

The generator reads the canonical SVG, fits it separately to each target canvas,
checks the painted bounds, and writes both ICOs and documentation PNGs. A native
size preview on light/dark taskbar backgrounds is written to the output directory.
