---
name: image-cropping
description: Crop an existing image with a complete rectangle. Use percent, pixel, or crop.{x,y,width,height} — never a partial box.
---

# Image cropping

Call `crop_image` with `image_url` plus exactly one complete rectangle:

- Percent coordinates, or
- Exact pixel coordinates, or
- `crop: { x, y, width, height }`

All four values are required. Width and height must be greater than 0. Do not mix encodings. Prefer crop over regenerating when the user only wants a tighter frame.

If the user already picked Square (1:1), Story / Reel (9:16), Portrait (4:5), or Landscape (16:9), do not ask again. Call `crop_image` with a centered percent rectangle for that ratio.
