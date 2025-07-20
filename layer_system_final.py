import torch
import torch.nn.functional as F
import json

# +++ FONCTION HELPER (INCHANGÉE) +++
def prepare_layer(top_image, base_image, resize_mode, scale, offset_x, offset_y):
    B, base_H, base_W, C = base_image.shape
    # Gérer les masques (1 canal) et les images (3+ canaux)
    top_C = top_image.shape[3] if top_image.dim() > 3 else 1
    
    _, top_H, top_W, _ = top_image.shape

    if scale != 1.0:
        new_H, new_W = int(top_H * scale), int(top_W * scale)
        if new_H > 0 and new_W > 0:
            top_image = F.interpolate(top_image.permute(0, 3, 1, 2), size=(new_H, new_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
            top_H, top_W = new_H, new_W

    # Créer un canevas avec le bon nombre de canaux (important pour les masques)
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
        # S'assurer que le rognage ne dépasse pas les dimensions
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
        if mode == 'normal': return top
        if mode == 'multiply': return base * top
        if mode == 'screen': return 1.0 - (1.0 - base) * (1.0 - top)
        if mode == 'overlay': return torch.where(base < 0.5, 2.0 * base * top, 1.0 - 2.0 * (1.0 - base) * (1.0 - top))
        if mode == 'soft_light': return torch.where(top < 0.5, 2.0 * base * top + base.pow(2.0) * (1.0 - 2.0 * top), torch.sqrt(base) * (2.0 * top - 1.0) + 2.0 * base * (1.0 - top))
        if mode == 'hard_light': return torch.where(top < 0.5, 2.0 * top * base, 1.0 - 2.0 * (1.0 - top) * (1.0 - base))
        return top

    def composite_layers(self, base_image, _properties_json="{}", **kwargs):
        final_image = base_image.clone()
        
        # --- MODIFICATION AJOUTÉE ICI ---
        # S'assurer que l'image de base est en RGB (3 canaux) en ignorant l'alpha
        if final_image.shape[-1] == 4:
            final_image = final_image[..., :3]

        properties = json.loads(_properties_json)
        
        layers = {k: v for k, v in kwargs.items() if k.startswith("layer_")}
        masks = {k: v for k, v in kwargs.items() if k.startswith("mask_")}
        
        sorted_layer_names = sorted(layers.keys())

        for layer_name in sorted_layer_names:
            layer_image = layers.get(layer_name)
            if layer_image is None: continue

            # --- MODIFICATION AJOUTÉE ICI ---
            # Si l'image du calque a 4 canaux (RGBA), on ne garde que les 3 premiers (RGB)
            if layer_image.shape[-1] == 4:
                layer_image = layer_image[..., :3]

            props = properties.get(layer_name, {})
            if not props.get("enabled", True): continue
            
            # On récupère les propriétés de transformation
            resize_mode = props.get("resize_mode", "fit")
            scale = props.get("scale", 1.0)
            offset_x = props.get("offset_x", 0)
            offset_y = props.get("offset_y", 0)
            
            # On applique les transformations à l'image du calque
            prepared_layer = prepare_layer(layer_image, final_image, resize_mode, scale, offset_x, offset_y)

            mode = props.get("blend_mode", "normal")
            opacity = props.get("opacity", 1.0)
            
            blended_image = self._blend(final_image, prepared_layer, mode)
            composited_image = (1.0 - opacity) * final_image + opacity * blended_image
            
            # --- LOGIQUE D'APPLICATION DU MASQUE CORRIGÉE ---
            mask_name = layer_name.replace("layer_", "mask_")
            mask = masks.get(mask_name)

            if mask is not None:
                # On s'assure que le masque est un tenseur 4D (B, H, W, C=1)
                if mask.dim() == 3:
                    mask = mask.unsqueeze(-1)
                
                # On applique les MÊMES transformations au masque pour qu'il suive l'image
                prepared_mask = prepare_layer(mask, final_image, resize_mode, scale, offset_x, offset_y)

                # Appliquer le masque
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