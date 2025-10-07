# 겹 Layer System (Dynamic) for ComfyUI

This custom node for ComfyUI provides a powerful and flexible dynamic layering system, similar to what you would find in image editing software like Photoshop. It allows you to stack multiple images and masks, control blending modes, opacity, and transformations for each layer individually. Real-time preview(beta), position your layers with the mouse.

This system is built to be intuitive, enabling complex composites directly within your workflow.

-----


https://github.com/user-attachments/assets/643df32d-82e7-451a-99bf-55741b8c6506



<img width="2557" height="1230" alt="Capture d'écran 2025-10-02 105223" src="https://github.com/user-attachments/assets/d8354495-87f4-47c0-a086-5ebebe286194" />


<img width="2557" height="1235" alt="Capture d'écran 2025-10-02 095629" src="https://github.com/user-attachments/assets/84796310-a2a5-4cab-8405-619665742e2b" />


https://github.com/user-attachments/assets/38f8afcc-1ac6-4967-b6aa-cd40360a7d56



https://github.com/user-attachments/assets/a0c129e8-a624-49b8-9c36-fed70e3b91a0



https://github.com/user-attachments/assets/d99582e5-0f7d-45b7-9c21-a1f1cfa2835d




https://github.com/user-attachments/assets/26ae1586-7582-4a72-909d-0e59cdad9fa9



https://github.com/user-attachments/assets/ba1f3f98-6541-40f4-8269-3cfe23dec4a4



https://github.com/user-attachments/assets/db8d28b5-e52e-4ae2-a3de-6ff8ce54fe67


<img width="2557" height="1235" alt="Capture d'écran 2025-08-10 021011" src="https://github.com/user-attachments/assets/e319a062-5948-47a4-b88d-d8bd348fad95" />




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


This system allows for building complex, multi-element scenes in a dynamic and non-destructive way.
