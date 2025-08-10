import torch
import torch.nn.functional as F
import json
import numpy as np
import folder_paths
from PIL import Image
import os
import http.server
import socketserver
import threading

# --- DÉBUT DE LA LOGIQUE DU SERVEUR D'APERÇU ---
preview_server_thread = None
PREVIEW_SERVER_PORT = 8189 # Port pour notre serveur

def start_preview_server():
    global preview_server_thread
    if preview_server_thread is None or not preview_server_thread.is_alive():
        class SecureHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=folder_paths.get_temp_directory(), **kwargs)

            def end_headers(self):
                self.send_header('Access-Control-Allow-Origin', '*')
                super().end_headers()

            def do_GET(self):
                if self.path == '/' or self.path.endswith('/'):
                    self.send_error(403, "Directory listing is not allowed")
                    return
                super().do_GET()

            def log_message(self, format, *args):
                return

        address = ("127.0.0.1", PREVIEW_SERVER_PORT)
        socketserver.TCPServer.allow_reuse_address = True
        httpd = socketserver.TCPServer(address, SecureHandler)
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = True
        thread.start()
        preview_server_thread = thread
        print(f"\n[Layer System] INFO: Démarrage du serveur d'aperçu local sur http://127.0.0.1:{PREVIEW_SERVER_PORT}")
# --- FIN DE LA LOGIQUE DU SERVEUR D'APERÇU ---


def prepare_layer(top_image, base_image, resize_mode, scale, offset_x, offset_y):
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
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        header_anchors = {}
        for i in range(1, 11):
            header_anchors[f"header_anchor_{i}"] = ("STRING", {"multiline": True, "default": ""})

        optional_inputs = {
            "_properties_json": ("STRING", {"multiline": True, "default": "{}"}),
            "_preview_anchor": ("STRING", {"multiline": True, "default": "PREVIEW_ANCHOR"}),
        }
        optional_inputs.update(header_anchors)

        return {
            "required": {
                "base_image": ("IMAGE",),
            },
            "optional": optional_inputs
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "composite_layers"
    CATEGORY = "Layer System"
    DESCRIPTION = "This custom node for ComfyUI provides a powerful and flexible dynamic layering system, similar to what you would find in image editing software like Photoshop."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")
    
    def tensor_to_pil(self, tensor):
        return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

    def _blend(self, base, top, mode):
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
        start_preview_server()
        final_image = base_image.clone()
        previews_data = {}
        temp_dir = folder_paths.get_temp_directory()
        
        base_pil = self.tensor_to_pil(base_image)
        base_filename = "layersys_base.png"
        base_pil.save(os.path.join(temp_dir, base_filename))
        previews_data["base_image"] = f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{base_filename}"

        if final_image.shape[-1] == 4:
            final_image = final_image[..., :3]

        properties = json.loads(_properties_json)
        layers = {k: v for k, v in kwargs.items() if k.startswith("layer_")}
        masks = {k: v for k, v in kwargs.items() if k.startswith("mask_")}
        sorted_layer_names = sorted(layers.keys())

        for layer_name in sorted_layer_names:
            layer_image_full = layers.get(layer_name)
            if layer_image_full is None: continue

            layer_pil = self.tensor_to_pil(layer_image_full)
            layer_filename = f"layersys_{layer_name}.png"
            layer_pil.save(os.path.join(temp_dir, layer_filename))
            previews_data[layer_name] = f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{layer_filename}"

            mask_name = layer_name.replace("layer_", "mask_")
            mask = masks.get(mask_name)
            
            # MODIFIÉ : On gère la sauvegarde du masque correctement
            if mask is not None:
                # On s'assure que le masque est un tensor 4D (B, H, W, C)
                mask_for_preview = mask
                if mask_for_preview.dim() == 3:
                    mask_for_preview = mask_for_preview.unsqueeze(-1)
                
                # On convertit le masque (1 canal) en image RGB (3 canaux) pour la sauvegarde
                mask_for_preview_rgb = mask_for_preview.repeat(1, 1, 1, 3)
                
                mask_pil = self.tensor_to_pil(mask_for_preview_rgb)
                mask_filename = f"layersys_{mask_name}.png"
                mask_pil.save(os.path.join(temp_dir, mask_filename))
                previews_data[mask_name] = f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{mask_filename}"

            layer_alpha = None
            if layer_image_full.shape[-1] == 4:
                layer_alpha = layer_image_full[..., 3:4]
                layer_image = layer_image_full[..., :3]
            else:
                layer_image = layer_image_full
            
            props = properties.get(layer_name, {})
            if not props.get("enabled", True): continue
            
            resize_mode = props.get("resize_mode", "fit")
            scale = props.get("scale", 1.0)
            offset_x = props.get("offset_x", 0)
            offset_y = props.get("offset_y", 0)
            
            prepared_layer = prepare_layer(layer_image, final_image, resize_mode, scale, offset_x, offset_y)
            
            brightness = props.get("brightness", 0.0)
            if brightness != 0.0: prepared_layer = torch.clamp(prepared_layer + brightness, 0.0, 1.0)
            contrast = props.get("contrast", 0.0)
            if contrast != 0.0:
                contrast_factor = 1.0 + contrast
                prepared_layer = torch.clamp((prepared_layer - 0.5) * contrast_factor + 0.5, 0.0, 1.0)
            color_r, color_g, color_b = props.get("color_r", 1.0), props.get("color_g", 1.0), props.get("color_b", 1.0)
            if color_r != 1.0 or color_g != 1.0 or color_b != 1.0:
                prepared_layer[..., 0] = torch.clamp(prepared_layer[..., 0] * color_r, 0.0, 1.0)
                prepared_layer[..., 1] = torch.clamp(prepared_layer[..., 1] * color_g, 0.0, 1.0)
                prepared_layer[..., 2] = torch.clamp(prepared_layer[..., 2] * color_b, 0.0, 1.0)
            saturation = props.get("saturation", 1.0)
            if saturation != 1.0:
                grayscale = prepared_layer[..., 0] * 0.299 + prepared_layer[..., 1] * 0.587 + prepared_layer[..., 2] * 0.114
                grayscale = grayscale.unsqueeze(-1)
                prepared_layer = torch.clamp(grayscale * (1.0 - saturation) + prepared_layer * saturation, 0.0, 1.0)
            
            mode = props.get("blend_mode", "normal")
            mode = mode.replace('-', '_')
            opacity = props.get("opacity", 1.0)
            blended_image = self._blend(final_image, prepared_layer, mode)
            
            final_mask = None
            if mask is not None:
                if mask.dim() == 3: mask = mask.unsqueeze(-1)
                final_mask = prepare_layer(mask, final_image, resize_mode, scale, offset_x, offset_y)
                if props.get("invert_mask", False):
                    final_mask = 1.0 - final_mask
            elif layer_alpha is not None:
                final_mask = prepare_layer(layer_alpha, final_image, resize_mode, scale, offset_x, offset_y)
            
            if final_mask is not None:
                final_mask_with_opacity = final_mask * opacity
                final_image = final_image * (1.0 - final_mask_with_opacity) + blended_image * final_mask_with_opacity
            else:
                if resize_mode != 'stretch':
                    mask_from_content = (prepared_layer.sum(dim=-1, keepdim=True) > 0.001).float()
                    mask_with_opacity = mask_from_content * opacity
                    final_image = final_image * (1.0 - mask_with_opacity) + blended_image * mask_with_opacity
                else:
                    final_image = (1.0 - opacity) * final_image + blended_image * opacity

        return {
            "result": (final_image,),
            "ui": {
                "layer_previews": [previews_data]
            }
        }

NODE_CLASS_MAPPINGS = { "LayerSystem": LayerSystem, }
NODE_DISPLAY_NAME_MAPPINGS = { "LayerSystem": "Layer System (Dynamic)" }