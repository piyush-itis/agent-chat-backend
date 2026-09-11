---
name: image-generation
description: Generate or edit images with GPT Image 2, then optionally crop. Use for new images from a prompt or edits when the user provides an image.
---

# Image generation

Call `gpt_image_2` from user intent. Do not ask the user to pick a model.

- `mode: text` when creating a new image from a prompt (`subModelId` gpt-image-2-text).
- `mode: edit` when the user attached or referenced an image to modify (`gpt-image-2-edit`).
- After a successful generate, you may chain `crop_image` if they want a tighter frame.
- Keep prompts specific. Pass durable image URLs, never secrets.
