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
import glob
from rembg import remove, new_session

base_path = os.path.dirname(folder_paths.get_input_directory())
rembg_dir = os.path.join(base_path, "models", "rembg")
model_path = os.path.join(rembg_dir, "RMBG-1.4.pth")

if not os.path.exists(model_path):
    print(f"[Layer System] ATTENTION: Model rmbg-1.4 not found at location : {model_path}")
    print(f"[Layer System] The clipping will use the default template 'u2net'. For better quality, download rmbg-1.4.pth.")
    session = new_session("u2net")
else:
    print(f"[Layer System] INFO: Loading the high-performance model rmbg-1.4...")
    session = new_session(model_path=model_path)

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
        print(f"\n[Layer System] INFO: Starting the local preview server on http://127.0.0.1:{PREVIEW_SERVER_PORT}")

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
        for i in range(1, 12):
            header_anchors[f"header_anchor_{i}"] = ("STRING", {"multiline": True, "default": ""})

        optional_inputs = {
            "_properties_json": ("STRING", {"multiline": True, "default": "{}"}),
            "_preview_anchor": ("STRING", {"multiline": True, "default": "PREVIEW_ANCHOR"}),
        }
        optional_inputs.update(header_anchors)

        return {
            "required": {},
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

    def composite_layers(self, _properties_json="{}", **kwargs):
       # print(f"[Layer System DEBUG] JSON reçu par Python: {_properties_json}")
        start_preview_server()

        try:
            full_properties = json.loads(_properties_json)
        except json.JSONDecodeError:
            full_properties = {}

        base_props = full_properties.get("base", {})
        base_filename = base_props.get("filename")

        if not base_filename:
            print("[Layer System] AVERTISSEMENT: Aucune image de base chargée. Retour d'une image vide.")
            return {"result": (torch.zeros(1, 512, 512, 3, dtype=torch.float32),)}

        base_image_path = folder_paths.get_annotated_filepath(base_filename)
        i = Image.open(base_image_path)
        i = ImageOps.exif_transpose(i)
        base_image = pil_to_tensor(i)
        
        final_image = base_image.clone()
        
        previews_data = {}
        temp_dir = folder_paths.get_temp_directory()
        B, base_H, base_W, C = base_image.shape

        base_pil = tensor_to_pil(base_image)
        base_preview_filename = "layersys_base.png"
        base_pil.save(os.path.join(temp_dir, base_preview_filename))
        previews_data["base_image"] = {
            "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{base_preview_filename}",
            "filename": base_filename
        }

        if final_image.shape[-1] == 4:
            final_image = final_image[..., :3]

        layers_properties = full_properties.get("layers", {})
        sorted_layer_names = sorted(layers_properties.keys(), key=lambda x: int(x.split('_')[1]))

        for layer_name in sorted_layer_names:
            props = layers_properties.get(layer_name, {})
            
            layer_filename = props.get("source_filename")
            if not layer_filename:
                continue
            
            layer_image_path = folder_paths.get_annotated_filepath(layer_filename)
            i_layer = Image.open(layer_image_path)
            i_layer = ImageOps.exif_transpose(i_layer)
            layer_image_full = pil_to_tensor(i_layer)

            layer_pil = tensor_to_pil(layer_image_full)
            layer_preview_filename_temp = f"layersys_{layer_name}.png"
            layer_pil.save(os.path.join(temp_dir, layer_preview_filename_temp))
            previews_data[layer_name] = {
               "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{layer_preview_filename_temp}",
               "filename": layer_filename
            }
            
            mask = None
            internal_mask_filename = props.get("internal_mask_filename")
            if internal_mask_filename:
                image_path = folder_paths.get_annotated_filepath(internal_mask_filename)
                if os.path.exists(image_path):
                    try:
                        i = Image.open(image_path)
                        i = ImageOps.exif_transpose(i)
                        mask = pil_to_tensor(i)
                        if mask.shape[-1] > 1:
                            if mask.shape[-1] == 4:
                                mask = mask[..., 3:4]
                            else:
                                mask = mask[..., 0:1]
                        mask = 1.0 - mask
                    except Exception as e:
                        print(f"[Layer System] ERROR: Unable to load internal mask '{internal_mask_filename}': {e}")
                else:
                    print(f"[Layer System] WARNING: Internal mask file not found: {image_path}")
            if mask is not None:
                mask_name = layer_name.replace("layer_", "mask_")
                mask_preview_filename_temp = f"layersys_{mask_name}.png"
                mask_pil_for_preview = tensor_to_pil(mask) 
                mask_pil_for_preview.convert("RGB").save(os.path.join(temp_dir, mask_preview_filename_temp))
        
                previews_data[mask_name] = {
                "url": f"http://127.0.0.1:{PREVIEW_SERVER_PORT}/{mask_preview_filename_temp}",
                "filename": internal_mask_filename 
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
            else: 
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
                        print(f"[Layer System] ATTENTION : font '{font_family}' not found. Utilisation de la police par défaut.")
                        font = ImageFont.load_default()
                except Exception as e:
                    print(f"[Layer System] ERROR: Unable to load font {font_family}: {e}")
                    font = ImageFont.load_default()
                
                draw.text((final_x, final_y), text_content, font=font, fill=color, anchor="lt")

            pil_image.alpha_composite(text_canvas)
            
            final_image = pil_to_tensor(pil_image)
        try:
            active_files = set()

            if base_props.get("source_filename"):
                active_files.add(base_props["source_filename"])
            elif base_props.get("filename"): 
                active_files.add(base_props["filename"])
    
            for layer_name, props in layers_properties.items():
                if props.get("source_filename"):
                    active_files.add(props["source_filename"])
                if props.get("internal_mask_filename"):
                    active_files.add(props["internal_mask_filename"])
                if props.get("internal_preview_mask_details"):
                     active_files.add(props["internal_preview_mask_details"]["name"])

            input_dir = folder_paths.get_input_directory()
            disk_files = glob.glob(os.path.join(input_dir, "layersystem_*.png"))
    
            for file_path in disk_files:
                filename = os.path.basename(file_path)
                if filename not in active_files:
                    print(f"[Layer System] Cleanup: Deleting the orphaned file {filename}")
                    os.remove(file_path)

        except Exception as e:
            print(f"[Layer System] ERREUR pendant le nettoyage automatique : {e}")            

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

        mask_details = process_remove_bg(filename, layer_index_str)
        
        return web.json_response(mask_details)
    except Exception as e:
        print(f"[Layer System] ERREUR API remove_bg: {e}")
        return web.Response(status=500, text=str(e))

def process_remove_bg(filename, layer_index_str):
    image_path = folder_paths.get_annotated_filepath(filename)
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image source non trouvée dans le dossier input: {filename}")

    input_image = Image.open(image_path)
    
    image_with_alpha = remove(
        input_image,
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=14
    )

    if image_with_alpha.mode != 'RGBA':
        raise ValueError("rembg n'a pas renvoyé une image RGBA attendue.")

    alpha_mask = image_with_alpha.split()[-1]

    preview_mask_image = Image.new("RGB", alpha_mask.size, "black")
    preview_mask_image.paste((255, 255, 255), mask=alpha_mask)

    render_mask_image = ImageOps.invert(preview_mask_image.convert("L")).convert("RGB")
    
    preview_mask_filename = f"internal_mask_preview_{layer_index_str}.png"
    preview_mask_path = os.path.join(folder_paths.get_input_directory(), preview_mask_filename)
    preview_mask_image.save(preview_mask_path)
    
    render_mask_filename = f"internal_mask_render_{layer_index_str}.png"
    render_mask_path = os.path.join(folder_paths.get_input_directory(), render_mask_filename)
    render_mask_image.save(render_mask_path)

    return {
        "preview_mask_details": { "name": preview_mask_filename, "subfolder": "", "type": "input" },
        "render_mask_details": { "name": render_mask_filename, "subfolder": "", "type": "input" }
    }
    
@server.PromptServer.instance.routes.post("/layersystem/delete_file")
async def delete_file_route(request):
    try:
        post_data = await request.json()
        filename = post_data.get("filename")
        subfolder = post_data.get("subfolder", "")

        if not filename:
            return web.Response(status=400, text="Nom de fichier manquant")

        input_dir = folder_paths.get_input_directory()
        file_path = os.path.join(input_dir, subfolder, filename)
        
        if os.path.commonpath([input_dir]) != os.path.commonpath([input_dir, file_path]):
            return web.Response(status=403, text="Accès interdit")

        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"[Layer System] deleted file : {file_path}")
            return web.json_response({"success": True, "message": f"file {filename} supprimé."})
        else:
            return web.json_response({"success": False, "message": "file not found."}, status=404)

    except Exception as e:
        print(f"[Layer System] ERREUR API delete_file: {e}")
        return web.Response(status=500, text=str(e))
        
@server.PromptServer.instance.routes.post("/layersystem/magic_wand")
async def magic_wand_route(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        start_x, start_y = data.get("x"), data.get("y")
        tolerance = data.get("tolerance", 32)
        contiguous = data.get("contiguous", True)

        image_path = folder_paths.get_annotated_filepath(filename)
        img_pil = Image.open(image_path).convert("RGB")

        pixels = np.array(img_pil)
        h, w, _ = pixels.shape

        start_color = pixels[start_y, start_x].astype(np.float32)
        pixels_float = pixels.astype(np.float32)

        if contiguous:
            mask = np.zeros((h, w), dtype=np.uint8)
            q = [(start_y, start_x)]
            visited = set([(start_y, start_x)])
            while len(q) > 0:
                y, x = q.pop(0)
                color_diff = np.sqrt(np.sum((pixels_float[y, x] - start_color) ** 2))
                if color_diff <= tolerance:
                    mask[y, x] = 255
                    for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and (ny, nx) not in visited:
                            q.append((ny, nx))
                            visited.add((ny, nx))
        else:
            color_diffs = np.sqrt(np.sum((pixels_float - start_color) ** 2, axis=2))
            mask = (color_diffs <= tolerance).astype(np.uint8) * 255

        mask_pil = Image.fromarray(mask, mode="L")
        mask_timestamp = int(time.time() * 1000)
        mask_filename = f"layersystem_mask_{mask_timestamp}.png"

        output_dir = folder_paths.get_input_directory()
        mask_pil.save(os.path.join(output_dir, mask_filename), "PNG")

        return web.json_response({
            "success": True, 
            "mask_details": { "name": mask_filename, "subfolder": "", "type": "input" }
        })
        
        

    except Exception as e:
        import traceback
        print(f"[Layer System] ERREUR API magic_wand: {e}")
        traceback.print_exc()
        return web.Response(status=500, text=str(e))
        
@server.PromptServer.instance.routes.post("/layersystem/apply_mask")
async def apply_mask_route(request):
    try:
        data = await request.json()
        new_mask_details = data.get("new_mask_details")
        existing_mask_filename = data.get("existing_mask_filename")
        fusion_mode = data.get("fusion_mode", "add")
        layer_index = data.get("layer_index")

        if not new_mask_details or layer_index is None:
            return web.Response(status=400, text="Données manquantes")

        new_mask_path = folder_paths.get_annotated_filepath(new_mask_details.get("name"))
        new_mask_pil = Image.open(new_mask_path).convert("L")

        if existing_mask_filename:
            fusion_source_filename = existing_mask_filename
            if "_render_" in existing_mask_filename:
                fusion_source_filename = existing_mask_filename.replace("_render_", "_preview_")
            
            existing_mask_path = folder_paths.get_annotated_filepath(fusion_source_filename)
            
            if os.path.exists(existing_mask_path):
                existing_mask_pil_raw = Image.open(existing_mask_path)
                if 'A' in existing_mask_pil_raw.getbands():
                    alpha_channel = existing_mask_pil_raw.getchannel('A')
                    existing_mask_pille = Image.fromarray((np.array(alpha_channel) > 128).astype(np.uint8) * 255)
                    existing_mask_pil = ImageOps.invert(existing_mask_pille.convert("L")) 
                else:
                    existing_mask_pil = existing_mask_pil_raw.convert("L")
            else:
                existing_mask_pil = Image.new("L", new_mask_pil.size, "black")
        else:
            existing_mask_pil = Image.new("L", new_mask_pil.size, "white")

        if existing_mask_pil.size != new_mask_pil.size:
            new_mask_pil = new_mask_pil.resize(existing_mask_pil.size, Image.LANCZOS)
        
        existing_arr = np.array(existing_mask_pil)
        new_arr = np.array(new_mask_pil)
        
        if fusion_mode == "add": combined_arr = np.maximum(existing_arr, new_arr)
        elif fusion_mode == "subtract": combined_arr = np.maximum(existing_arr - new_arr, 0)
        elif fusion_mode == "intersect": combined_arr = np.minimum(existing_arr, new_arr)
        else: combined_arr = np.maximum(existing_arr, new_arr)
        
        final_preview_pil = Image.fromarray(combined_arr, mode="L")
        
        output_dir = folder_paths.get_input_directory()
        editor_filename = f"internal_mask_{layer_index}.png"
        preview_filename = f"internal_mask_preview_{layer_index}.png"
        render_filename = f"internal_mask_render_{layer_index}.png"
        
        final_render_pil = ImageOps.invert(final_preview_pil.convert("L")).convert("RGB")
        
        final_preview_pil.save(os.path.join(output_dir, editor_filename), "PNG")
        final_preview_pil.save(os.path.join(output_dir, preview_filename), "PNG")
        final_render_pil.save(os.path.join(output_dir, render_filename), "PNG")
        
        return web.json_response({
            "success": True, 
            "editor_mask_details": { "name": editor_filename, "subfolder": "", "type": "input" },
            "preview_mask_details": { "name": preview_filename, "subfolder": "", "type": "input" },
            "render_mask_details": { "name": render_filename, "subfolder": "", "type": "input" }
        })

    except Exception as e:
        import traceback
        print(f"[Layer System] ERREUR API apply_mask: {e}")
        traceback.print_exc()
        return web.Response(status=500, text=str(e))       
        

NODE_CLASS_MAPPINGS = { "LayerSystem": LayerSystem }

NODE_DISPLAY_NAME_MAPPINGS = { "LayerSystem": "Layers System" }
