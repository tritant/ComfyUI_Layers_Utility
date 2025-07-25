import torch
import torch.nn.functional as F
import json

# +++ FONCTION HELPER (INCHANGÉE) +++
def prepare_layer(top_image, base_image, resize_mode, scale, offset_x, offset_y):
    """Prépare un calque (image ou masque) en le redimensionnant et en le positionnant."""
    B, base_H, base_W, C = base_image.shape
    top_C = top_image.shape[3] if top_image.dim() > 3 else 1
    
    _, top_H, top_W, _ = top_image.shape

    if scale != 1.0:
        new_H, new_W = int(top_H * scale), int(top_W * scale)
        if new_H > 0 and new_W > 0:
            top_image = F.interpolate(top_image.permute(0, 3, 1, 2), size=(new_H, new_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
            top_H, top_W = new_H, new_W

    canvas = torch.zeros(B, base_H, base_W, top_C, device=base_image.device)
    
    if resize_mode == 'stretch':
        return F.interpolate(top_image.permute(0, 3, 1, 2), size=(base_H, base_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
    elif resize_mode == 'fit':
        ratio = min(base_W / top_W, base_H / top_H)
        fit_H, fit_W = int(top_H * ratio), int(top_W * ratio)
        resized_top = F.interpolate(top_image.permute(0, 3, 1, 2), size=(fit_H, fit_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
        y_start, x_start = (base_H - fit_H) // 2, (base_W - fit_W) // 2
        canvas[:, y_start:y_start+fit_H, x_start:x_start+fit_W, :] = resized_top
        return canvas
    elif resize_mode == 'cover':
        ratio = max(base_W / top_W, base_H / top_H)
        cover_H, cover_W = int(top_H * ratio), int(top_W * ratio)
        resized_top = F.interpolate(top_image.permute(0, 3, 1, 2), size=(cover_H, cover_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
        y_start, x_start = (cover_H - base_H) // 2, (cover_W - base_W) // 2
        src_y_end = min(y_start + base_H, cover_H)
        src_x_end = min(x_start + base_W, cover_W)
        canvas = resized_top[:, y_start:src_y_end, x_start:src_x_end, :]
        return canvas
    elif resize_mode == 'crop':
        x_start, y_start = offset_x, offset_y
        src_x_start, src_y_start = max(0, -x_start), max(0, -y_start)
        dst_x_start, dst_y_start = max(0, x_start), max(0, y_start)
        copy_W = min(base_W - dst_x_start, top_W - src_x_start)
        copy_H = min(base_H - dst_y_start, top_H - src_y_start)
        if copy_W > 0 and copy_H > 0:
            src_slice = top_image[:, src_y_start:src_y_start+copy_H, src_x_start:src_x_start+copy_W, :]
            canvas[:, dst_y_start:dst_y_start+copy_H, dst_x_start:dst_x_start+copy_W, :] = src_slice
        return canvas
    return canvas


class LayerSystem:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_image": ("IMAGE",),
            },
            "optional": {
                "_properties_json": ("STRING", {"multiline": True, "default": "{}"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "composite_layers"
    CATEGORY = "Layer System"
    DESCRIPTION = "This custom node for ComfyUI provides a powerful and flexible dynamic layering system, similar to what you would find in image editing software like Photoshop."
    
    def _blend(self, base, top, mode):
        """Applique un mode de fusion entre deux images."""
        if mode == 'normal': return top
        if mode == 'multiply': return base * top
        if mode == 'screen': return 1.0 - (1.0 - base) * (1.0 - top)
        if mode == 'overlay': return torch.where(base < 0.5, 2.0 * base * top, 1.0 - 2.0 * (1.0 - base) * (1.0 - top))
        if mode == 'soft_light': return torch.where(top < 0.5, 2.0 * base * top + base.pow(2.0) * (1.0 - 2.0 * top), torch.sqrt(base) * (2.0 * top - 1.0) + 2.0 * base * (1.0 - top))
        if mode == 'hard_light': return torch.where(top < 0.5, 2.0 * top * base, 1.0 - 2.0 * (1.0 - top) * (1.0 - base))
        if mode == 'difference': return torch.abs(base - top)
        if mode == 'color_dodge':
            denominator = 1.0 - top
            return torch.where(denominator < 1e-6, torch.ones_like(base), torch.clamp(base / (denominator + 1e-6), 0, 1))
        if mode == 'color_burn':
            return torch.where(top < 1e-6, torch.zeros_like(base), 1.0 - torch.clamp((1.0 - base) / (top + 1e-6), 0, 1))
        return top

    def composite_layers(self, base_image, _properties_json="{}", **kwargs):
        final_image = base_image.clone()
        
        if final_image.shape[-1] == 4:
            final_image = final_image[..., :3]

        properties = json.loads(_properties_json)
        
        layers = {k: v for k, v in kwargs.items() if k.startswith("layer_")}
        masks = {k: v for k, v in kwargs.items() if k.startswith("mask_")}
        
        sorted_layer_names = sorted(layers.keys())

        for layer_name in sorted_layer_names:
            layer_image = layers.get(layer_name)
            if layer_image is None: continue

            if layer_image.shape[-1] == 4:
                layer_image = layer_image[..., :3]

            props = properties.get(layer_name, {})
            if not props.get("enabled", True): continue
            
            resize_mode = props.get("resize_mode", "fit")
            scale = props.get("scale", 1.0)
            offset_x = props.get("offset_x", 0)
            offset_y = props.get("offset_y", 0)
            
            prepared_layer = prepare_layer(layer_image, final_image, resize_mode, scale, offset_x, offset_y)

            # Appliquer les ajustements de couleur
            brightness = props.get("brightness", 0.0)
            if brightness != 0.0:
                prepared_layer = torch.clamp(prepared_layer + brightness, 0.0, 1.0)

            contrast = props.get("contrast", 0.0)
            if contrast != 0.0:
                contrast_factor = 1.0 + contrast
                prepared_layer = torch.clamp((prepared_layer - 0.5) * contrast_factor + 0.5, 0.0, 1.0)

            color_r = props.get("color_r", 1.0)
            color_g = props.get("color_g", 1.0)
            color_b = props.get("color_b", 1.0)
            if color_r != 1.0 or color_g != 1.0 or color_b != 1.0:
                prepared_layer[..., 0] = torch.clamp(prepared_layer[..., 0] * color_r, 0.0, 1.0)
                prepared_layer[..., 1] = torch.clamp(prepared_layer[..., 1] * color_g, 0.0, 1.0)
                prepared_layer[..., 2] = torch.clamp(prepared_layer[..., 2] * color_b, 0.0, 1.0)

            # --- NOUVELLE FONCTIONNALITÉ : SATURATION ---
            saturation = props.get("saturation", 1.0)
            if saturation != 1.0:
                grayscale = prepared_layer[..., 0] * 0.299 + prepared_layer[..., 1] * 0.587 + prepared_layer[..., 2] * 0.114
                grayscale = grayscale.unsqueeze(-1) # Garder la dimension du canal
                prepared_layer = torch.clamp(grayscale * (1.0 - saturation) + prepared_layer * saturation, 0.0, 1.0)

            mode = props.get("blend_mode", "normal")
            opacity = props.get("opacity", 1.0)
            
            blended_image = self._blend(final_image, prepared_layer, mode)
            composited_image = (1.0 - opacity) * final_image + opacity * blended_image
            
            mask_name = layer_name.replace("layer_", "mask_")
            mask = masks.get(mask_name)

            if mask is not None:
                if mask.dim() == 3:
                    mask = mask.unsqueeze(-1)
                
                prepared_mask = prepare_layer(mask, final_image, resize_mode, scale, offset_x, offset_y)

                if props.get("invert_mask", False):
                    prepared_mask = 1.0 - prepared_mask

                final_image = final_image * (1.0 - prepared_mask) + composited_image * prepared_mask
            else:
                final_image = composited_image

        return (final_image,)


NODE_CLASS_MAPPINGS = {
    "LayerSystem": LayerSystem,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "LayerSystem": "Layer System (Dynamic)"
}
