# 겹 Layer System (Dynamic) for ComfyUI

This custom node for ComfyUI provides a powerful and flexible dynamic layering system, similar to what you would find in image editing software like Photoshop. It allows you to stack multiple images and masks, control blending modes, opacity, and transformations for each layer individually.

This system is built to be intuitive, enabling complex composites directly within your workflow.

-----

## 🎛️ Node Parameters

The entire system is managed through a single node: **Layer System (Dynamic)**. When you connect an image to a `layer_` input, a new set of controls (widgets) for that layer appears directly in the node's properties panel. A new empty `layer_` and `mask_` input pair is then added automatically.

## Per-Layer Controls

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **Enabled** | Toggle | A master switch to enable or disable the layer entirely. |
| **Up / Down** | Buttons | Moves the layer up or down in the stacking order. |
| **blend_mode** | Combo | Sets the blending mode (`normal`, `multiply`, `screen`, `overlay`, etc.). |
| **opacity** | Number | Controls the opacity of the layer from 0.0 (transparent) to 1.0 (opaque). |
| **Color Adjustments** | Toggle | A collapsible section to show or hide all color-related controls. |
| **Brightness** | Number | Adjusts the overall brightness of the layer (-1.0 to 1.0). |
| **Contrast** | Number | Adjusts the overall contrast of the layer (-1.0 to 1.0). |
| **Saturation** | Number | Controls the color intensity of the layer (0.0 is grayscale, 1.0 is original). |
| **R / G / B** | Number | Adjusts the intensity of the Red, Green, and Blue channels individually. |
| **Invert Mask** | Toggle | Inverts the connected mask (visible only if a mask is connected). |
| **resize_mode** | Combo | Determines how the layer is placed: `stretch`, `fit`, `cover`, or `crop`. |
| **scale** | Number | Scales the layer (visible only in `crop` mode). |
| **offset_x / offset_y** | Number | Controls the X and Y position of the layer (visible only in `crop` mode). |
-----
<img width="2411" height="1158" alt="Capture d'écran 2025-07-20 152255" src="https://github.com/user-attachments/assets/bf77959e-2db6-49db-be49-dbb83bf12fbd" />

<img width="2387" height="1158" alt="Capture d'écran 2025-07-20 221503" src="https://github.com/user-attachments/assets/4f926a4c-8720-4904-ba68-b581972e4ce9" />

<img width="2220" height="1167" alt="Capture d'écran 2025-07-22 024959" src="https://github.com/user-attachments/assets/60568c4e-7d72-44c8-b4cf-ca2fee33fa27" />






This system allows for building complex, multi-element scenes in a dynamic and non-destructive way.
