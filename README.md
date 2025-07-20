# 겹 Layer System (Dynamic) for ComfyUI

This custom node for ComfyUI provides a powerful and flexible dynamic layering system, similar to what you would find in image editing software like Photoshop. It allows you to stack multiple images and masks, control blending modes, opacity, and transformations for each layer individually.

This system is built to be intuitive, enabling complex composites directly within your workflow.

-----

## 🎛️ Node Parameters

The entire system is managed through a single node: **Layer System (Dynamic)**. When you connect an image to a `layer_` input, a new set of controls (widgets) for that layer appears directly in the node's properties panel. A new empty `layer_` and `mask_` input pair is then added automatically.

## Per-Layer Controls

| Parameter             | Type     | Description |
|-----------------------|----------|-------------|
| **Enabled**           | Toggle   | A master switch to enable or disable the layer entirely. |
| **Up / Down**         | Buttons  | Moves the layer up or down in the stacking order, automatically re-wiring the connections. |
| **blend_mode**        | Combo    | Sets the blending mode for the layer. Options include `normal`, `multiply`, `screen`, `overlay`, `soft_light`, and `hard_light`. |
| **opacity**           | Number   | Controls the opacity of the layer, from `0.0` (transparent) to `1.0` (opaque). |
| **resize_mode**       | Combo    | Determines how to handle layers with a different size than the base image canvas:  <br> • **stretch**: Stretches the layer to fit the canvas, ignoring aspect ratio.  <br> • **fit**: Resizes the layer to fit inside the canvas while maintaining aspect ratio.  <br> • **cover**: Resizes the layer to cover the entire canvas while maintaining aspect ratio (parts may be cropped).  <br> • **crop**: Places the layer on the canvas without resizing. |
| **scale**             | Number   | *(Visible only in crop mode).* Scales the layer before placing it on the canvas. |
| **offset_x / offset_y** | Number | *(Visible only in crop mode).* Controls the X and Y position of the layer on the canvas. |

-----
<img width="2411" height="1158" alt="Capture d'écran 2025-07-20 152255" src="https://github.com/user-attachments/assets/bf77959e-2db6-49db-be49-dbb83bf12fbd" />


This system allows for building complex, multi-element scenes in a dynamic and non-destructive way.
