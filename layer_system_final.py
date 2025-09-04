import server
from aiohttp import web
import time
import torch
import torch.nn.functional as F
import json
import numpy as np
import folder_paths
from PIL import Image, ImageOps, ImageDraw, ImageFont
import os
import http.server
import socketserver
import threading
import math
from rembg import remove, new_session

# ▼▼▼ DÉBUT DE LA MODIFICATION ▼▼▼

# 1. Définir le chemin vers notre modèle haute performance
# On cherche le dossier 'models/rembg' que tu as créé
# ▼▼▼ NOUVELLE MÉTHODE CORRECTE ▼▼▼
# On trouve le dossier de base de ComfyUI en remontant depuis le dossier 'input'
base_path = os.path.dirname(folder_paths.get_input_directory())
# On construit le chemin vers notre dossier de modèles rembg
rembg_dir = os.path.join(base_path, "models", "rembg")
# On définit le chemin complet du modèle
model_path = os.path.join(rembg_dir, "rmbg-1.4.onnx")
# ▲▲▲ FIN DE LA CORRECTION ▲▲▲

# 2. Vérifier si le modèle existe
if not os.path.exists(model_path):
    print(f"[Layer System] ATTENTION : Modèle rmbg-1.4 non trouvé à l'emplacement : {model_path}")
    print(f"[Layer System] Le détourage utilisera le modèle par défaut 'u2net'. Pour une meilleure qualité, téléchargez rmbg-1.4.onnx.")
    # On se rabat sur le modèle par défaut si le fichier n'est pas trouvé
    session = new_session("u2net")
else:
    # On crée la session en utilisant le chemin du fichier .onnx
    print(f"[Layer System] INFO: Chargement du modèle haute performance rmbg-1.4...")
    session = new_session(model_path=model_path)

# ▲▲▲ FIN DE LA MODIFICATION ▲▲▲

preview_server_thread = None
PREVIEW_SERVER_PORT = 8189

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

def tensor_to_pil(tensor):
    return Image.fromarray(np.clip(255. * tensor.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

def pil_to_tensor(image):
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def prepare_layer(top_image, base_image, resize_mode, scale, offset_x, offset_y):
    B, base_H, base_W, C = base_image.shape
    _, top_H, top_W, top_C = top_image.shape
    if scale != 1.0:
        new_H, new_W = int(top_H * scale), int(top_W * scale)
        if new_H > 0 and new_W > 0:
            top_image = F.interpolate(top_image.permute(0, 3, 1, 2), size=(new_H, new_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
            top_H, top_W = new_H, new_W
            
    canvas = torch.zeros(B, base_H, base_W, top_C, device=base_image.device)
    if resize_mode == 'stretch':
        return F.interpolate(top_image.permute(0, 3, 1, 2), size=(base_H, base_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
    elif resize_mode == 'fit':
        if top_W == 0 or top_H == 0: return canvas
        ratio = min(base_W / top_W, base_H / top_H)
        fit_H, fit_W = int(top_H * ratio), int(top_W * ratio)
        resized_top = F.interpolate(top_image.permute(0, 3, 1, 2), size=(fit_H, fit_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)
        y_start, x_start = (base_H - fit_H) // 2, (base_W - fit_W) // 2
        canvas[:, y_start:y_start+fit_H, x_start:x_start+fit_W, :] = resized_top
        return canvas
    elif resize_mode == 'cover':
        if top_W == 0 or top_H == 0: return canvas
        ratio = max(base_W / top_W, base_H / top_H)
        cover_H, cover_W = int(top_H * ratio), int(top_W * ratio)
        resized_top = F.interpolate(top_image.permute(0, 3, 1, 2), size=(cover_H, cover_W), mode='bilinear', align_corners=False)
        y_start, x_start = (cover_H - base_H) // 2, (cover_W - base_W) // 2
        src_y_end = min(y_start + base_H, cover_H)
        src_x_end = min(x_start + base_W, cover_W)
        canvas_permuted = resized_top[:, :, y_start:src_y_end, x_start:src_x_end]
        return canvas_permuted.permute(0, 2, 3, 1)
    elif resize_mode == 'crop':
        x_start_abs = (base_W // 2) + offset_x
        y_start_abs = (base_H // 2) + offset_y
        
        x_start_centered = x_start_abs - (top_W // 2)
        y_start_centered = y_start_abs - (top_H // 2)

        src_x_start = max(0, -x_start_centered)
        src_y_start = max(0, -y_start_centered)
        dst_x_start = max(0, x_start_centered)
        dst_y_start = max(0, y_start_centered)

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
            "required": { "base_image": ("IMAGE",), },
            "optional": optional_inputs
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "composite_layers"
    CATEGORY = "Layer System"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")
    
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
        B, base_H, base_W, C = base_image.shape
        
        base_pil = tensor_to_pil(base_image)
        base_filename = "layersys_base.png"
        base_pil.save(os.path.join(temp_dir, base_filename))
        previews_data["base_image"] = {
          "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{base_filename}",
          "filename": base_filename
        }

        if final_image.shape[-1] == 4:
            final_image = final_image[..., :3]

        try:
            full_properties = json.loads(_properties_json)
        except json.JSONDecodeError:
            full_properties = {}
        
        layers_properties = full_properties.get("layers", {})

        layers = {k: v for k, v in kwargs.items() if k.startswith("layer_")}
        masks = {k: v for k, v in kwargs.items() if k.startswith("mask_")}
        sorted_layer_names = sorted(layers.keys())

        for layer_name in sorted_layer_names:
            layer_image_full = layers.get(layer_name)
            if layer_image_full is None: continue
            
            layer_pil = tensor_to_pil(layer_image_full)
            layer_filename = f"layersys_{layer_name}.png"
            layer_pil.save(os.path.join(temp_dir, layer_filename))
            previews_data[layer_name] = {
               "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{layer_filename}",
               "filename": layer_filename # <--- AJOUTE CETTE LIGNE
            }

            mask_name = layer_name.replace("layer_", "mask_")
            mask = masks.get(mask_name)
            
            props = layers_properties.get(layer_name, {})

            # ▼▼▼ DÉBUT DE LA MODIFICATION : CHARGEMENT DU MASQUE INTERNE (CORRECTION D'INVERSION) ▼▼▼
            # S'il n'y a pas de masque externe connecté...
            if mask is None:
                # ...on cherche un masque interne dans les propriétés JSON.
                internal_mask_filename = props.get("internal_mask_filename")
                if internal_mask_filename:
                    # On construit le chemin complet du fichier (il est dans le dossier 'input')
                    image_path = os.path.join(folder_paths.get_input_directory(), internal_mask_filename)
                    
                    if os.path.exists(image_path):
                        try:
                            print(f"[Layer System] INFO: Chargement du masque interne : {image_path}")
                            i = Image.open(image_path)
                            i = ImageOps.exif_transpose(i)
                            
                            mask = pil_to_tensor(i) 

                            if mask.shape[-1] > 1:
                                if mask.shape[-1] == 4:
                                    mask = mask[..., 3:4]
                                else:
                                    mask = mask[..., 0:1]
                            
                            # ▼▼▼ LA CORRECTION D'INVERSION EST ICI ▼▼▼
                            # Le masque est inversé pour correspondre à l'attente du pipeline.
                            mask = 1.0 - mask 
                            # ▲▲▲ FIN DE LA CORRECTION D'INVERSION ▲▲▲

                        except Exception as e:
                            print(f"[Layer System] ERREUR: Impossible de charger le masque interne '{internal_mask_filename}': {e}")
                    else:
                        print(f"[Layer System] ATTENTION: Fichier de masque interne non trouvé: {image_path}")
            # ▲▲▲ FIN DE LA MODIFICATION ▲▲▲
            
            if mask is not None:
                mask_for_preview = mask
                if mask_for_preview.dim() == 3:
                    mask_for_preview = mask_for_preview.unsqueeze(-1)
                mask_for_preview_rgb = mask_for_preview.repeat(1, 1, 1, 3)
                mask_pil = tensor_to_pil(mask_for_preview_rgb)
                mask_filename = f"layersys_{mask_name}.png"
                mask_pil.save(os.path.join(temp_dir, mask_filename))
                previews_data[mask_name] = {
                  "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{mask_filename}",
                  "filename": mask_filename
                }

            if not props.get("enabled", True): continue


            resize_mode = props.get("resize_mode", "fit")
            scale = props.get("scale", 1.0)
            offset_x = props.get("offset_x", 0)
            offset_y = props.get("offset_y", 0)
            rotation = props.get("rotation", 0.0)
            
            prepared_layer = None
            layer_alpha = None

            if resize_mode == 'crop' and rotation != 0.0:
                pil_layer = tensor_to_pil(layer_image_full)
                if pil_layer.mode != 'RGBA':
                    pil_layer = pil_layer.convert('RGBA')

                new_w = int(pil_layer.width * scale)
                new_h = int(pil_layer.height * scale)
                if new_w > 0 and new_h > 0:
                    pil_layer = pil_layer.resize((new_w, new_h), Image.Resampling.BICUBIC)
                
                pil_layer = pil_layer.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)

                final_canvas_pil = Image.new('RGBA', (base_W, base_H), (0, 0, 0, 0))
                paste_x = (base_W // 2) + offset_x - (pil_layer.width // 2)
                paste_y = (base_H // 2) + offset_y - (pil_layer.height // 2)
                
                final_canvas_pil.paste(pil_layer, (paste_x, paste_y), pil_layer)
                
                prepared_tensor = pil_to_tensor(final_canvas_pil)
                prepared_layer = prepared_tensor[..., :3]
                layer_alpha = prepared_tensor[..., 3:4]
            else:
                if layer_image_full.shape[-1] == 4:
                    layer_alpha = layer_image_full[..., 3:4]
                    layer_image = layer_image_full[..., :3]
                else:
                    layer_image = layer_image_full
                
                prepared_layer = prepare_layer(layer_image, final_image, resize_mode, scale, offset_x, offset_y)
                if layer_alpha is not None:
                    prepared_alpha = prepare_layer(layer_alpha, final_image, resize_mode, scale, offset_x, offset_y)
                    layer_alpha = prepared_alpha

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
            
            mode = props.get("blend_mode", "normal").replace('-', '_')
            opacity = props.get("opacity", 1.0)
            blended_image = self._blend(final_image, prepared_layer, mode)
            
            content_alpha_mask = layer_alpha
            if content_alpha_mask is None and resize_mode != 'stretch':
                content_alpha_mask = (prepared_layer.sum(dim=-1, keepdim=True) > 0.001).float()
            
            if content_alpha_mask is not None:
                blended_image = final_image * (1.0 - content_alpha_mask) + blended_image * content_alpha_mask
            
            final_mask = None
            if mask is not None:
                if mask.dim() == 3: mask = mask.unsqueeze(-1)
                if resize_mode == 'crop' and rotation != 0.0:
                    pil_mask = tensor_to_pil(mask)
                    if pil_mask.mode != 'L': pil_mask = pil_mask.convert('L')
                    
                    mask_w = int(pil_mask.width * scale)
                    mask_h = int(pil_mask.height * scale)
                    if mask_w > 0 and mask_h > 0:
                        pil_mask = pil_mask.resize((mask_w, mask_h), Image.Resampling.BICUBIC)
                    
                    if rotation != 0.0:
                        pil_mask = pil_mask.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)

                    mask_canvas_pil = Image.new('L', (base_W, base_H), 0)
                    mask_paste_x = (base_W // 2) + offset_x - (pil_mask.width // 2)
                    mask_paste_y = (base_H // 2) + offset_y - (pil_mask.height // 2)
                    mask_canvas_pil.paste(pil_mask, (mask_paste_x, mask_paste_y))
                    final_mask = pil_to_tensor(mask_canvas_pil)
                else:
                    final_mask = prepare_layer(mask, final_image, resize_mode, scale, offset_x, offset_y)

            if final_mask is not None:
                if final_mask.dim() == 3:
                    final_mask = final_mask.unsqueeze(-1)
                if props.get("invert_mask", False):
                    final_mask = 1.0 - final_mask
                
                if final_mask.shape[1:3] != final_image.shape[1:3]:
                    final_mask = F.interpolate(final_mask.permute(0, 3, 1, 2), size=(base_H, base_W), mode='bilinear', align_corners=False).permute(0, 2, 3, 1)

                final_mask_with_opacity = final_mask * opacity
                final_image = final_image * (1.0 - final_mask_with_opacity) + blended_image * final_mask_with_opacity
            else:
                final_image = (1.0 - opacity) * final_image + blended_image * opacity

        text_elements = full_properties.get("texts", [])
        if text_elements:
            pil_image = tensor_to_pil(final_image).convert('RGBA')

            image_width = pil_image.width
            image_height = pil_image.height
            center_x = image_width // 2
            center_y = image_height // 2

            text_canvas = Image.new('RGBA', (image_width, image_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(text_canvas)

            import sys
            FONT_MAP = {
                "Arial": "arial.ttf", "Verdana": "verdana.ttf", "Tahoma": "tahoma.ttf", 
                "Trebuchet MS": "trebuc.ttf", "Impact": "impact.ttf", "Lucida Sans Unicode": "l_10646.ttf",
                "Georgia": "georgia.ttf", "Times New Roman": "times.ttf", "Garamond": "gara.ttf",
                "Courier New": "cour.ttf", "Lucida Console": "lucon.ttf"
            }
            font_dirs = []
            if sys.platform == "win32":
                font_dirs.append("C:/Windows/Fonts")
            elif sys.platform == "darwin":
                font_dirs.extend(["/System/Library/Fonts/Supplemental", "/Library/Fonts"])
            else: # Linux
                font_dirs.extend(["/usr/share/fonts/truetype/msttcorefonts", "/usr/share/fonts/truetype/dejavu"])
            
            def find_font_path(font_name):
                font_file = FONT_MAP.get(font_name)
                if not font_file: return None
                for d in font_dirs:
                    path = os.path.join(d, font_file)
                    if os.path.exists(path): return path
                return None

            for text_el in text_elements:
                text_content = text_el.get("text", "")
                if not text_content: 
                    continue

                offset_x = text_el.get("offset_x", 0.0)
                offset_y = text_el.get("offset_y", 0.0)
                final_size = int(text_el.get("size", 24))

                if final_size <= 0:
                    continue

                final_x = int(center_x + offset_x)
                final_y = int(center_y + offset_y)

                color = text_el.get("color", "#FFFFFF")
                font_family = text_el.get("fontFamily", "Arial")
                
                font_path = find_font_path(font_family)
                font = None
                try:
                    if font_path:
                        font = ImageFont.truetype(font_path, final_size)
                    else:
                        print(f"[Layer System] ATTENTION : Police '{font_family}' non trouvée. Utilisation de la police par défaut.")
                        font = ImageFont.load_default()
                except Exception as e:
                    print(f"[Layer System] ERREUR : Impossible de charger la police {font_family}: {e}")
                    font = ImageFont.load_default()
                
                draw.text((final_x, final_y), text_content, font=font, fill=color, anchor="lt")

            pil_image.alpha_composite(text_canvas)
            
            final_image = pil_to_tensor(pil_image)

        return {
            "result": (final_image,),
            "ui": {
                "layer_previews": [previews_data]
            }
        }
        
@server.PromptServer.instance.routes.post("/layersystem/remove_bg")
async def remove_background_route(request):
    try:
        post_data = await request.json()
        filename = post_data.get("filename")
        layer_index_str = post_data.get("layer_index_str")
        if not filename:
            return web.Response(status=400, text="Nom de fichier manquant")

        # On appelle notre fonction de traitement
        mask_details = process_remove_bg(filename, layer_index_str)
        
        return web.json_response(mask_details)
    except Exception as e:
        print(f"[Layer System] ERREUR API remove_bg: {e}")
        return web.Response(status=500, text=str(e))

# C'est la fonction qui fait le vrai travail de détourage
def process_remove_bg(filename, layer_index_str):
    image_path = os.path.join(folder_paths.get_temp_directory(), filename)
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image source non trouvée dans le dossier temp: {filename}")

    input_image = Image.open(image_path)
    
    # On exécute le détourage en utilisant notre session (qui contient maintenant le bon modèle)
    image_with_alpha = remove(
        input_image,
        session=session, # On passe la session que nous avons créée
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=445,
        alpha_matting_erode_size=25
    )

    if image_with_alpha.mode != 'RGBA':
        raise ValueError("rembg n'a pas renvoyé une image RGBA attendue.")

    # La suite de la logique pour créer les deux masques reste inchangée
    alpha_mask = image_with_alpha.split()[-1]

    # VERSION 1 : Pour la PREVIEW JS (Blanc sur Noir)
    preview_mask_image = Image.new("RGB", alpha_mask.size, "black")
    preview_mask_image.paste((255, 255, 255), mask=alpha_mask)

    # VERSION 2 : Pour le RENDU PYTHON (Noir sur Blanc)
    render_mask_image = ImageOps.invert(preview_mask_image.convert("L")).convert("RGB")
    
    timestamp = int(time.time())
    
    preview_mask_filename = f"internal_mask_preview_{layer_index_str}.png"
    preview_mask_path = os.path.join(folder_paths.get_input_directory(), preview_mask_filename)
    preview_mask_image.save(preview_mask_path)
    
    render_mask_filename = f"internal_mask_render_{layer_index_str}.png"
    render_mask_path = os.path.join(folder_paths.get_input_directory(), render_mask_filename)
    render_mask_image.save(render_mask_path)

    print(f"[Layer System] INFO: Masques HQ (rmbg-1.4) créés : {preview_mask_filename} (preview) et {render_mask_filename} (rendu)")

    return {
        "preview_mask_details": { "name": preview_mask_filename, "subfolder": "", "type": "input" },
        "render_mask_details": { "name": render_mask_filename, "subfolder": "", "type": "input" }
    }

NODE_CLASS_MAPPINGS = { "LayerSystem": LayerSystem }
NODE_DISPLAY_NAME_MAPPINGS = { "LayerSystem": "Layer System" }