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
