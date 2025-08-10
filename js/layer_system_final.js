import { app } from "/scripts/app.js";

// L'objet `LiteGraph` est disponible globalement.
function applyMask(layerImage, maskImage) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // On s'assure que le canvas temporaire a la même taille que l'image du calque
    canvas.width = layerImage.width;
    canvas.height = layerImage.height;

    // 1. On dessine le MASQUE et on récupère ses données de pixels
    // On l'étire à la taille du calque au cas où il y aurait une différence
    ctx.drawImage(maskImage, 0, 0, layerImage.width, layerImage.height);
    const maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // 2. On efface, on dessine le CALQUE et on récupère ses données
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layerImage, 0, 0);
    const layerData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 3. Pixel par pixel, on applique la luminance du masque à la transparence du calque
    for (let i = 0; i < maskData.data.length; i += 4) {
        // La valeur de gris du masque est dans le canal rouge (puisque R=G=B)
        const luminance = maskData.data[i];
        // On assigne cette valeur au canal alpha (transparence) du calque
        layerData.data[i + 3] = luminance;
    }

    // 4. On remet les données modifiées sur le canvas
    ctx.putImageData(layerData, 0, 0);
    return canvas; // On retourne le canvas avec le calque correctement masqué
}

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "difference", "color-dodge", "color-burn"];
const RESIZE_MODES = ["stretch", "fit", "cover", "crop"];
const MAX_LAYERS = 10;

const eyeIconPath = new Path2D("M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z");
const eyeSlashPath = new Path2D("M2 4.27l2.28 2.28L3.27 7.5C1.94 8.85 1 10.34 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l2.12 2.12L19.73 19 2 4.27zM12 17c-2.76 0-5-2.24-5-5 0-.77.18-1.5.49-2.14l1.57 1.57c-.01.19-.02.38-.02.57 0 1.66 1.34 3 3 3 .19 0 .38-.01.57-.02l1.57 1.57C13.5 16.82 12.77 17 12 17zm7.88-8.13C21.06 10.15 22 11.08 23 12c-1.73 4.39-6 7.5-11 7.5-.94 0-1.84-.13-2.69-.36l2.03 2.03c.85.22 1.74.33 2.66.33 5 0 9.27-3.11 11-7.5-.73-1.83-2.1-3.38-3.73-4.54l-1.39 1.39zM12 9c.99 0 1.89.28 2.67.77l-1.1-1.1C13.04 8.28 12.53 8 12 8c-2.76 0-5 2.24-5 5 0 .53.08 1.04.23 1.53l-1.1-1.1c-.49-.78-.73-1.68-.73-2.63 0-2.76 2.24-5 5-5z");
const lockIconPath = new Path2D("M17 8v-1a5 5 0 00-10 0v1H5v12h14V8h-2zm-5 7a2 2 0 110-4 2 2 0 010 4zM9 7V6a3 3 0 116 0v1H9z");
const unlockIconPath = new Path2D("M9 7V6a3 3 0 116 0v1h2V6a5 5 0 00-10 0v1H5v12h14V8H9zm3 9a2 2 0 110-4 2 2 0 010 4z");
const arrowUpPath = new Path2D("M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z");
const arrowDownPath = new Path2D("M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z");
const moveIconPath = new Path2D("M12 2 L12 22 M2 12 L22 12 M12 2 L8 6 M12 2 L16 6 M12 22 L8 18 M12 22 L16 18 M2 12 L6 8 M2 12 L6 16 M22 12 L18 8 M22 12 L18 16");

app.registerExtension({
    name: "LayerSystem.DynamicLayers",
    
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "LayerSystem") {
            return;
        }

        const resizeHeight = function() {
            if (!this.size) return;
            const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
            if (anchorWidget && this.basePreviewImage) {
                const aspectRatio = this.basePreviewImage.naturalHeight / this.basePreviewImage.naturalWidth;
                const contentWidth = this.size[0] - 20;
                anchorWidget.computeSize = () => [this.size[0], contentWidth * aspectRatio];
            }
            const newSize = this.computeSize();
            this.size[1] = newSize[1]; 
            this.onResize?.(this.size);
            this.graph.setDirtyCanvas(true, true);
            if (anchorWidget?.computeSize) {
                delete anchorWidget.computeSize;
            }
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            onExecuted?.apply(this, arguments);
            if (message?.layer_previews && message.layer_previews[0]) {
                const previewData = message.layer_previews[0];
                this.preview_data = previewData;
                const imagePromises = Object.entries(previewData).map(([name, url]) => {
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                        img.src = url + `?t=${Date.now()}`;
                        img.onload = () => resolve({ name, img });
                        img.onerror = (err) => {
                            console.error(`[LayerSystem] Impossible de charger l'image ${url}.`);
                            reject(err);
                        };
                    });
                });
                Promise.all(imagePromises)
                    .then(loadedImages => {
                        this.loaded_preview_images = loadedImages.reduce((acc, {name, img}) => {
                            acc[name] = img;
                            return acc;
                        }, {});
                        this.basePreviewImage = this.loaded_preview_images.base_image;
                        resizeHeight.call(this);
                        this.redrawPreviewCanvas();
                    })
                    .catch(e => console.error("[LayerSystem] Au moins une image d'aperçu n'a pas pu être chargée.", e));
            }
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            if (!this.layer_properties) { this.layer_properties = {}; }
            this.basePreviewImage = null;
            this.preview_data = {};
            this.loaded_preview_images = {};
            this.redraw_req = null;
            this.previewCanvasScale = 1.0;
            this.movingLayer = null;
            this.isDragging = false;
            this.dragStart = { x: 0, y: 0 };
            this.initialOffsets = { x: 0, y: 0 };
            this.accordionMode = true;
            
            setTimeout(() => {
                const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
                if (anchorWidget && anchorWidget.inputEl) {
                    const canvas = document.createElement("canvas");
                    const container = anchorWidget.inputEl.parentElement;
                    container.style.padding = "0px";
                    container.style.margin = "0px";

                    // --- MODIFICATION APPROCHE 1 (Aperçu Principal) ---
                    // On ne remplace pas l'élément, on le cache et on ajoute le nôtre.
                    anchorWidget.inputEl.style.display = "none";
                    container.appendChild(canvas);
                    // --- FIN DE LA MODIFICATION ---

                    this.previewCanvas = canvas;
                    this.previewCtx = canvas.getContext("2d");
                    const anchorIndex = this.widgets.indexOf(anchorWidget);
                    if (anchorIndex > 0) {
                       this.widgets.splice(anchorIndex, 1);
                       this.widgets.unshift(anchorWidget);
                    }
                    this.redrawPreviewCanvas();
                    this.previewCanvas.addEventListener('mousedown', this.onCanvasMouseDown.bind(this));
                    this.previewCanvas.addEventListener('mousemove', this.onCanvasMouseMove.bind(this));
                    this.previewCanvas.addEventListener('mouseup', this.onCanvasMouseUp.bind(this));
                    this.previewCanvas.addEventListener('mouseleave', this.onCanvasMouseLeave.bind(this));
                }

                this.initializeHeaderCanvases();
                
                const p_widget = this.widgets.find(w => w.name === "_properties_json");
                if(p_widget) {
                    p_widget.hidden = true;
                    p_widget.computeSize = () => [0, -4];
                }

                this.refreshUI();
            }, 0);
        };
        
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function(size) {
            // --- CORRECTION FINALE ---
            // Protection contre le contexte invalide lors de l'appel par addInput
            if (!this.widgets) {
                return;
            }

            onResize?.apply(this, arguments);
            if (this.previewCanvas) {
                if (this.redraw_req) cancelAnimationFrame(this.redraw_req);
                this.redraw_req = requestAnimationFrame(() => {
                    this.redrawPreviewCanvas();
                    this.redraw_req = null;
                });
            }
            for (let i = 1; i <= MAX_LAYERS; i++) {
                const anchor = this.widgets.find(w => w.name === `header_anchor_${i}`);
                if (anchor && anchor.canvas) {
                    this.drawHeaderCanvas(anchor.canvas, `layer_${i}`);
                }
            }
        };

        nodeType.prototype.onCanvasMouseDown = function(e) {
            if (!this.movingLayer) return;
            const props = this.layer_properties[this.movingLayer];
            if (!props) return;
            this.isDragging = true;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.initialOffsets = { x: props.offset_x, y: props.offset_y };
            e.preventDefault();
            e.stopPropagation();
        };

        nodeType.prototype.onCanvasMouseMove = function(e) {
            if (!this.isDragging || !this.movingLayer) return;
            const props = this.layer_properties[this.movingLayer];
            const baseImg = this.basePreviewImage;
            if (!props || !baseImg) return;
            const canvas = this.previewCanvas;
            const imgRatio = baseImg.naturalWidth / baseImg.naturalHeight;
            const canvasRatio = canvas.width / canvas.height;
            let destWidth = (imgRatio > canvasRatio) ? canvas.width : canvas.height * imgRatio;
            if (destWidth === 0) return;
            const scaleFactor = baseImg.naturalWidth / destWidth;
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            props.offset_x = Math.round(this.initialOffsets.x + (dx * scaleFactor));
            props.offset_y = Math.round(this.initialOffsets.y + (dy * scaleFactor));
            const offsetXWidget = this.widgets.find(w => w.name === `offset_x_${this.movingLayer}`);
            const offsetYWidget = this.widgets.find(w => w.name === `offset_y_${this.movingLayer}`);
            if (offsetXWidget) offsetXWidget.value = props.offset_x;
            if (offsetYWidget) offsetYWidget.value = props.offset_y;
            this.redrawPreviewCanvas();
        };

        nodeType.prototype.onCanvasMouseUp = function(e) {
            if (this.isDragging) {
                this.isDragging = false;
                this.updatePropertiesJSON();
            }
        };

        nodeType.prototype.onCanvasMouseLeave = function(e) {
            if (this.isDragging) {
                this.isDragging = false;
                this.updatePropertiesJSON();
            }
        };

nodeType.prototype.redrawPreviewCanvas = function() {
    if (!this.previewCanvas) return;
    const canvas = this.previewCanvas;
    const ctx = this.previewCtx;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.basePreviewImage && this.basePreviewImage.naturalWidth > 0) {
        const img = this.basePreviewImage;
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const canvasRatio = canvas.width / canvas.height;
        let destWidth, destHeight, destX, destY;
        if (imgRatio > canvasRatio) {
            destWidth = canvas.width; destHeight = canvas.width / imgRatio;
            destX = 0; destY = (canvas.height - destHeight) / 2;
        } else {
            destHeight = canvas.height; destWidth = canvas.height * imgRatio;
            destY = 0; destX = (canvas.width - destWidth) / 2;
        }
        ctx.drawImage(img, destX, destY, destWidth, destHeight);
        this.previewCanvasScale = destWidth / this.basePreviewImage.naturalWidth;

        const sortedLayerNames = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1])).map(i => i.name);
        
        for (const layerName of sortedLayerNames) {
            const props = this.layer_properties[layerName];
            const layerImage = this.loaded_preview_images[layerName];
            const maskName = layerName.replace("layer_", "mask_");
            const maskImage = this.loaded_preview_images[maskName];

            if (!props || !props.enabled || !layerImage || !layerImage.naturalWidth || !layerImage.naturalHeight) {
                continue;
            }

            ctx.save();
            
            let imageToDraw = layerImage;
            // ... (color correction logic is unchanged) ...
            if (props.brightness !== 0.0 || props.contrast !== 0.0 || props.saturation !== 1.0 || props.color_r !== 1.0 || props.color_g !== 1.0 || props.color_b !== 1.0) {
                try {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = layerImage.naturalWidth; tempCanvas.height = layerImage.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                    tempCtx.drawImage(layerImage, 0, 0);
                    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                    const data = imageData.data;
                    const brightness = props.brightness, contrastFactor = 1.0 + props.contrast, saturation = props.saturation, color_r = props.color_r, color_g = props.color_g, color_b = props.color_b;
                    for (let i = 0; i < data.length; i += 4) {
                        let r = data[i] / 255.0, g = data[i + 1] / 255.0, b = data[i + 2] / 255.0;
                        if (brightness !== 0.0) { r += brightness; g += brightness; b += brightness; }
                        if (props.contrast !== 0.0) { r = (r - 0.5) * contrastFactor + 0.5; g = (g - 0.5) * contrastFactor + 0.5; b = (b - 0.5) * contrastFactor + 0.5; }
                        if (color_r !== 1.0 || color_g !== 1.0 || color_b !== 1.0) { r *= color_r; g *= color_g; b *= color_b; }
                        if (saturation !== 1.0) { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = gray * (1.0 - saturation) + r * saturation; g = gray * (1.0 - saturation) + g * saturation; b = gray * (1.0 - saturation) + b * saturation; }
                        data[i] = Math.max(0, Math.min(255, r * 255)); data[i + 1] = Math.max(0, Math.min(255, g * 255)); data[i + 2] = Math.max(0, Math.min(255, b * 255));
                    }
                    tempCtx.putImageData(imageData, 0, 0);
                    imageToDraw = tempCanvas;
                } catch (e) {
                    console.error(`[LayerSystem] ERREUR lors du traitement du calque ${layerName}:`, e);
                    imageToDraw = layerImage;
                }
            }

            let final_sx = 0, final_sy = 0, final_sw = imageToDraw.width, final_sh = imageToDraw.height;
            let final_dx = destX, final_dy = destY, final_dw = destWidth, final_dh = destHeight;
            
            if (props.resize_mode === 'crop') {
                final_dx = destX + (props.offset_x * this.previewCanvasScale);
                final_dy = destY + (props.offset_y * this.previewCanvasScale);
                final_dw = final_sw * props.scale * this.previewCanvasScale;
                final_dh = final_sh * props.scale * this.previewCanvasScale;
            } else {
                const layerRatio = final_sw / final_sh;
                const destContainerRatio = destWidth / destHeight;
                switch(props.resize_mode) {
                    case 'fit':
                        if (layerRatio > destContainerRatio) { final_dh = final_dw / layerRatio; final_dy += (destHeight - final_dh) / 2; }
                        else { final_dw = final_dh * layerRatio; final_dx += (destWidth - final_dw) / 2; }
                        break;
                    case 'cover':
                        if (layerRatio > destContainerRatio) { final_sw = final_sh * destContainerRatio; final_sx = (imageToDraw.width - final_sw) / 2; }
                        else { final_sh = final_sw / destContainerRatio; final_sy = (imageToDraw.height - final_sh) / 2; }
                        break;
                    case 'stretch': default: break;
                }
            }
            
            let finalImageToDraw = imageToDraw;

            if (maskImage && maskImage.naturalWidth > 0) {
                let maskToApply = maskImage;
                // NOUVEAU : On gère l'inversion du masque ici
                if (props.invert_mask) {
                    const invertedMaskCanvas = document.createElement('canvas');
                    invertedMaskCanvas.width = maskImage.naturalWidth;
                    invertedMaskCanvas.height = maskImage.naturalHeight;
                    const invertedCtx = invertedMaskCanvas.getContext('2d');
                    // On utilise un filtre CSS pour inverser les couleurs du masque
                    invertedCtx.filter = 'invert(1)';
                    invertedCtx.drawImage(maskImage, 0, 0);
                    maskToApply = invertedMaskCanvas;
                }
                
                finalImageToDraw = applyMask(imageToDraw, maskToApply);
            }
            
            ctx.globalAlpha = props.opacity;
            ctx.globalCompositeOperation = props.blend_mode === 'normal' ? 'source-over' : props.blend_mode;
            
            ctx.drawImage(finalImageToDraw, final_sx, final_sy, final_sw, final_sh, final_dx, final_dy, final_dw, final_dh);

            if (this.movingLayer === layerName) {
                ctx.strokeStyle = "red"; ctx.lineWidth = 2; ctx.strokeRect(final_dx, final_dy, final_dw, final_dh);
            }
            
            ctx.restore();
        }
    }
};
        
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            if (info.widgets_values) {
                const p_widget = this.widgets.find(w => w.name === "_properties_json");
                const p_index = this.widgets.indexOf(p_widget);
                if (p_index > -1 && info.widgets_values[p_index]) {
                    try { this.layer_properties = JSON.parse(info.widgets_values[p_index]); }
                    catch (e) { this.layer_properties = {}; }
                }
            }
        };
        
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, is_connected, link_info, io_slot) {
            onConnectionsChange?.apply(this, arguments);
            if (side === 1) { setTimeout(() => this.refreshUI(), 0); }
        };

        nodeType.prototype.initializeHeaderCanvases = function() {
            for (let i = 1; i <= MAX_LAYERS; i++) {
                const layerName = `layer_${i}`;
                const layer_index = i;
                const anchor = this.widgets.find(w => w.name === `header_anchor_${i}`);
                if (!anchor || !anchor.inputEl || anchor.canvas) continue;

                const canvas = document.createElement("canvas");
                anchor.canvas = canvas;
                
                const container = anchor.inputEl.parentElement;

                // --- MODIFICATION APPROCHE 1 (En-têtes) ---
                // On vide plus le conteneur. On cache l'ancien élément et on ajoute le nôtre.
                anchor.inputEl.style.display = "none";
                container.appendChild(canvas);
                // --- FIN DE LA MODIFICATION ---

                container.style.padding = "0px";
                container.style.margin = "0px";
                
                canvas.addEventListener("mousedown", (e) => {
                    const props = this.layer_properties[layerName];
                    if (!props) return;
                    
                    const widgetWidth = this.size[0] - 20;
                    const x = e.offsetX;
                    const y = e.offsetY;

                    const topPadding = 4;
                    const padding = 8;
                    const moveIconSize = 36;
                    const arrowSize = 24;
                    const lockSize = 36;
                    const thumbSize = 48;
                    const eyeSize = 36;
                    const allocatedHeight = 64;

                    const eyeX = widgetWidth - eyeSize - padding;
                    const thumbX = eyeX - thumbSize - padding;
                    const lockX = thumbX - lockSize - padding;
                    const arrowBlockX = lockX - arrowSize - padding;
                    const moveIconX = arrowBlockX - moveIconSize - (padding * 2);

                    const eyeY = topPadding + (thumbSize - eyeSize) / 2;
                    const lockY = topPadding + (thumbSize - lockSize) / 2;
                    const arrowUpY = topPadding + (thumbSize / 2 - arrowSize) + 4;
                    const arrowDownY = topPadding + (thumbSize / 2) - 4;
                    const moveIconY = topPadding + (thumbSize - moveIconSize) / 2;

                    const isInEye = x >= eyeX && x <= eyeX + eyeSize && y >= eyeY && y <= eyeY + eyeSize;
                    const isInLock = x >= lockX && x <= lockX + lockSize && y >= lockY && y <= lockY + lockSize;
                    const isInUpArrow = x >= arrowBlockX && x <= arrowBlockX + arrowSize && y >= arrowUpY && y <= arrowUpY + arrowSize;
                    const isInDownArrow = x >= arrowBlockX && x <= arrowBlockX + arrowSize && y >= arrowDownY && y <= arrowDownY + arrowSize;
                    const isInMoveIcon = x >= moveIconX && x <= moveIconX + moveIconSize && y >= moveIconY && y <= moveIconY + moveIconSize;

                    if (isInLock) {
                        this.accordionMode = !this.accordionMode;
                        this.refreshUI();
                    } else if (isInEye) {
                        props.enabled = !props.enabled;
                        this.redrawPreviewCanvas();
                        this.drawHeaderCanvas(canvas, layerName);
                    } else if (isInUpArrow) {
                        if (layer_index > 1) { this.moveLayer(layer_index, "up"); }
                    } else if (isInDownArrow) {
                        const total_layers = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).length;
                        if (layer_index < total_layers) { this.moveLayer(layer_index, "down"); }
                    } else if (isInMoveIcon) {
                        if (props.resize_mode === 'crop') {
                            if (this.movingLayer === layerName) {
                                this.movingLayer = null;
                            } else {
                                this.movingLayer = layerName;
                            }
                            this.refreshUI();
                        }
                    } else {
                        const isExpanding = props.layer_collapsed;

                        if (isExpanding) {
                            if (this.accordionMode) {
                                for (const otherLayerName in this.layer_properties) {
                                    if (otherLayerName !== layerName) {
                                        this.layer_properties[otherLayerName].layer_collapsed = true;
                                    }
                                }
                            }
                            props.layer_collapsed = false;
                        } else {
                            let expanded_count = 0;
                            for (const key in this.layer_properties) {
                                if (!this.layer_properties[key].layer_collapsed) {
                                    expanded_count++;
                                }
                            }
                            if (expanded_count > 1) {
                                props.layer_collapsed = true;
                            }
                        }
                        
                        this.refreshUI();
                    }

                    this.updatePropertiesJSON();
                });
            }
        };

        nodeType.prototype.drawHeaderCanvas = function(canvas, layerName) {
            if (!canvas || !this.layer_properties[layerName]) return;

            const props = this.layer_properties[layerName];
            const layer_index = parseInt(layerName.split("_")[1]);
            const total_layers = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).length;
            const layerImage = this.loaded_preview_images ? this.loaded_preview_images[layerName] : null;

            const ctx = canvas.getContext("2d");
            const widgetWidth = this.size[0] - 20;
            const allocatedHeight = 64;
            const ratio = window.devicePixelRatio || 1;

            canvas.style.width = widgetWidth + "px";
            canvas.style.height = allocatedHeight + "px";
            canvas.width = widgetWidth * ratio;
            canvas.height = allocatedHeight * ratio;

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(ratio, ratio);

            ctx.clearRect(0, 0, widgetWidth, allocatedHeight);

            ctx.strokeStyle = "#555555";
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, widgetWidth - 2, allocatedHeight - 10);
            
            const topPadding = 4;
            const padding = 8;
            const moveIconSize = 36;
            const arrowSize = 24;
            const lockSize = 36;
            const thumbSize = 48;
            const eyeSize = 36;
            
            const eyeX = widgetWidth - eyeSize - padding;
            const thumbX = eyeX - thumbSize - padding;
            const lockX = thumbX - lockSize - padding;
            const arrowBlockX = lockX - arrowSize - padding;
            const moveIconX = arrowBlockX - moveIconSize - (padding * 2);
            const textMaxWidth = moveIconX - padding * 2;
            
            const thumbY = topPadding;
            const eyeY = topPadding + (thumbSize - eyeSize) / 2;
            const lockY = topPadding + (thumbSize - lockSize) / 2;
            const textY = topPadding + thumbSize / 2;
            const arrowUpY = topPadding + (thumbSize / 2 - arrowSize) + 4;
            const arrowDownY = topPadding + (thumbSize / 2) - 4;
            const moveIconY = topPadding + (thumbSize - moveIconSize) / 2;

            if (!props.layer_collapsed) {
                ctx.fillStyle = "#4CAF50"; 
            } else {
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
            }

            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.font = "14px Arial";
            const triangle = props.layer_collapsed ? "▶" : "▼";
            ctx.fillText(`${triangle} Layer ${layer_index} Settings`, 5, textY, textMaxWidth);

            const isFirst = layer_index <= 1;
            const isLast = layer_index >= total_layers;
            const disabledColor = "#555";
            ctx.save();
            ctx.translate(arrowBlockX, arrowUpY);
            ctx.strokeStyle = isFirst ? disabledColor : LiteGraph.WIDGET_TEXT_COLOR;
            ctx.lineWidth = 3;
            ctx.stroke(arrowUpPath);
            ctx.restore();
            ctx.save();
            ctx.translate(arrowBlockX, arrowDownY);
            ctx.strokeStyle = isLast ? disabledColor : LiteGraph.WIDGET_TEXT_COLOR;
            ctx.lineWidth = 3;
            ctx.stroke(arrowDownPath);
            ctx.restore();
            
            const isMoving = this.movingLayer === layerName;
            ctx.save();
            ctx.translate(moveIconX, moveIconY);
            ctx.scale(moveIconSize / 24, moveIconSize / 24);
            ctx.strokeStyle = isMoving ? "#F44" : (props.resize_mode === 'crop' ? LiteGraph.WIDGET_TEXT_COLOR : disabledColor);
            ctx.lineWidth = 2;
            ctx.stroke(moveIconPath);
            ctx.restore();
            
            ctx.save();
            ctx.translate(lockX, lockY);
            ctx.scale(lockSize / 24, lockSize / 24);
            ctx.strokeStyle = this.accordionMode ? "#F44" : "#6C6";
            ctx.lineWidth = 2;
            ctx.stroke(this.accordionMode ? lockIconPath : unlockIconPath);
            ctx.restore();

            ctx.fillStyle = "#353535";
            ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);
            if (layerImage && layerImage.naturalWidth > 0) {
                const imgRatio = layerImage.naturalWidth / layerImage.naturalHeight;
                let destWidth, destHeight, destX, destY;
                if (imgRatio > 1) { destWidth = thumbSize; destHeight = thumbSize / imgRatio; } 
                else { destHeight = thumbSize; destWidth = thumbSize * imgRatio; }
                destX = thumbX + (thumbSize - destWidth) / 2;
                destY = thumbY;
                ctx.drawImage(layerImage, 0, 0, layerImage.naturalWidth, layerImage.naturalHeight, destX, destY, destWidth, destHeight);
            }
            ctx.save();
            ctx.translate(eyeX, eyeY);
            ctx.scale(eyeSize / 24, eyeSize / 24);
            ctx.strokeStyle = props.enabled ? "#4CAF50" : "#F44";
            ctx.lineWidth = 1.5;
            ctx.stroke(eyeIconPath);
            if (!props.enabled) { ctx.stroke(eyeSlashPath); }
            ctx.restore();
        };

        nodeType.prototype.updateLayerVisibility = function(layerName) {
            const props = this.layer_properties[layerName];
            if (!props) return;

            const isLayerCollapsed = props.layer_collapsed;
            const isColorCollapsed = props.color_section_collapsed;
            const showTransformForCrop = props.resize_mode === 'crop';

            const allWidgets = this.widgets.filter(w => 
                (w.name && typeof w.name === 'string' && w.name.endsWith(`_${layerName}`)) || 
                (w.value && typeof w.value === 'string' && w.value.endsWith(`_${layerName}`))
            );
            
            for(const w of allWidgets) {
                if (w.name.startsWith(`header_anchor_`)) continue;

                let isHidden = isLayerCollapsed;

                if (w.name.startsWith("spacer_for_")) {
                    isHidden = false;
                } else if (w.name === `toggle_color_${layerName}`) {
                } else if (["brightness", "contrast", "saturation", "color_r", "color_g", "color_b"].some(p => w.name.startsWith(p))) {
                    isHidden = isLayerCollapsed || isColorCollapsed;
                } else if (["scale", "offset_x", "offset_y"].some(p => w.name.startsWith(p))) {
                    isHidden = isLayerCollapsed || !showTransformForCrop;
                } else if (w.value === `move_btn_${layerName}`){
                    isHidden = isLayerCollapsed || !showTransformForCrop;
                }
                
                w.hidden = isHidden;
                w.computeSize = isHidden ? () => [0, -4] : w.originalComputeSize;
            }
            
            resizeHeight.call(this);
        };

        nodeType.prototype.refreshUI = function() {
            this.handleDisconnectedInputs();
            this.updateLayerWidgets();
            this.ensureWildcardInputs();
            
            const activeLayers = new Set(this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).map(i => i.name));
            for (let i = 1; i <= MAX_LAYERS; i++) {
                const layerName = `layer_${i}`;
                const anchor = this.widgets.find(w => w.name === `header_anchor_${i}`);
                if (!anchor) continue;

                if (activeLayers.has(layerName)) {
                    anchor.hidden = false;
                    anchor.computeSize = (width) => [width, 64];
                    if (anchor.canvas) {
                        this.drawHeaderCanvas(anchor.canvas, layerName);
                    }
                    this.updateLayerVisibility(layerName);
                } else {
                    anchor.hidden = true;
                    anchor.computeSize = () => [0, -4];
                }
            }
            this.updatePropertiesJSON();
            resizeHeight.call(this);
        };
        
        nodeType.prototype.moveLayer = function(layer_index, direction) {
            const swap_index = direction === "up" ? layer_index - 1 : layer_index + 1;
            const name_A = `layer_${layer_index}`;
            const name_B = `layer_${swap_index}`;
            const mask_name_A = name_A.replace("layer_", "mask_");
            const mask_name_B = name_B.replace("layer_", "mask_");

            const input_A = this.inputs.find(i => i.name === name_A);
            const input_B = this.inputs.find(i => i.name === name_B);
            const mask_input_A = this.inputs.find(i => i.name === mask_name_A);
            const mask_input_B = this.inputs.find(i => i.name === mask_name_B);
            
            if (!input_A || !input_B) return;
            
            [input_A.link, input_B.link] = [input_B.link, input_A.link];
            if (mask_input_A && mask_input_B) { [mask_input_A.link, mask_input_B.link] = [mask_input_B.link, mask_input_A.link]; }
            
            const props_A = this.layer_properties[name_A];
            this.layer_properties[name_A] = this.layer_properties[name_B]; this.layer_properties[name_B] = props_A;
            
            const img_A = this.loaded_preview_images[name_A];
            this.loaded_preview_images[name_A] = this.loaded_preview_images[name_B]; this.loaded_preview_images[name_B] = img_A;
            
            const mask_img_A = this.loaded_preview_images[mask_name_A];
            this.loaded_preview_images[mask_name_A] = this.loaded_preview_images[mask_name_B]; this.loaded_preview_images[mask_name_B] = mask_img_A;
            
            if (input_A.link !== null) this.graph.links[input_A.link].target_slot = this.inputs.indexOf(input_A);
            if (input_B.link !== null) this.graph.links[input_B.link].target_slot = this.inputs.indexOf(input_B);
            if (mask_input_A && mask_input_A.link !== null) this.graph.links[mask_input_A.link].target_slot = this.inputs.indexOf(mask_input_A);
            if (mask_input_B && mask_input_B.link !== null) this.graph.links[mask_input_B.link].target_slot = this.inputs.indexOf(mask_input_B);

            if (this.movingLayer === name_A) {
                this.movingLayer = name_B;
            } else if (this.movingLayer === name_B) {
                this.movingLayer = name_A;
            }

            this.refreshUI();
            this.redrawPreviewCanvas();
        };

        nodeType.prototype.addLayerWidgets = function(layer_name) {
            if (!this.layer_properties[layer_name]) {
                this.layer_properties[layer_name] = {
                    blend_mode: "normal", opacity: 1.0, enabled: true, resize_mode: "fit", scale: 1.0, offset_x: 0, offset_y: 0,
                    brightness: 0.0, contrast: 0.0, color_r: 1.0, color_g: 1.0, color_b: 1.0, saturation: 1.0, 
                    invert_mask: false, color_section_collapsed: true, layer_collapsed: true,
                };
            }
            const props = this.layer_properties[layer_name];
            
            const allWidgets = [];

            const topSpacer = { name: `top_spacer_for_${layer_name}`, type: "CUSTOM_SPACER", draw: () => {}, computeSize: () => [0, 10] };
            this.widgets.push(topSpacer);
            allWidgets.push(topSpacer);

            allWidgets.push(this.addWidget("combo", `blend_mode_${layer_name}`, props.blend_mode, (v) => { props.blend_mode = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {values: BLEND_MODES}));
            allWidgets.push(this.addWidget("number", `opacity_${layer_name}`, props.opacity, (v) => { props.opacity = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {min: 0.0, max: 1.0, step: 0.1, precision: 2}));
            const colorToggle = this.addWidget("toggle", `toggle_color_${layer_name}`, !props.color_section_collapsed, (v) => {
                props.color_section_collapsed = !v; this.updateLayerVisibility(layer_name); this.updatePropertiesJSON();
            }, { on: "▼ Color Adjust", off: "▶ Color Adjust" });
            allWidgets.push(colorToggle);
            const redrawCallback = (prop, v) => { props[prop] = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); };
            allWidgets.push(this.addWidget("number", `brightness_${layer_name}`, props.brightness, (v) => redrawCallback('brightness', v), { label: "Brightness", min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `contrast_${layer_name}`, props.contrast, (v) => redrawCallback('contrast', v), { label: "Contrast", min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `saturation_${layer_name}`, props.saturation, (v) => redrawCallback('saturation', v), { label: "Saturation", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `color_r_${layer_name}`, props.color_r, (v) => redrawCallback('color_r', v), { label: "R", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `color_g_${layer_name}`, props.color_g, (v) => redrawCallback('color_g', v), { label: "G", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `color_b_${layer_name}`, props.color_b, (v) => redrawCallback('color_b', v), { label: "B", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("toggle", `invert_mask_${layer_name}`, !!props.invert_mask, (v) => { 
                props.invert_mask = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas();
            }, { label: "Invert Mask" }));
            const resizeModeWidget = this.addWidget("combo", `resize_mode_${layer_name}`, props.resize_mode, (v) => {
                props.resize_mode = v; if (v !== 'crop' && this.movingLayer === layer_name) { this.movingLayer = null; }
                this.updateLayerVisibility(layer_name); this.updatePropertiesJSON(); this.redrawPreviewCanvas();
            }, { values: RESIZE_MODES });
            allWidgets.push(resizeModeWidget);
            allWidgets.push(this.addWidget("number", `scale_${layer_name}`, props.scale, (v) => redrawCallback('scale', v), { min: 0.01, max: 10.0, step: 0.1, precision: 2 }));
            allWidgets.push(this.addWidget("number", `offset_x_${layer_name}`, props.offset_x, (v) => redrawCallback('offset_x', v), { min: -8192, max: 8192, step: 1 }));
            allWidgets.push(this.addWidget("number", `offset_y_${layer_name}`, props.offset_y, (v) => redrawCallback('offset_y', v), { min: -8192, max: 8192, step: 1 }));

            const bottomSpacer = { name: `bottom_spacer_for_${layer_name}`, type: "CUSTOM_SPACER", draw: () => {}, computeSize: () => [0, 10] };
            this.widgets.push(bottomSpacer);
            allWidgets.push(bottomSpacer);

            for (const w of allWidgets) { 
                w.originalComputeSize = w.computeSize;
            }
        };
        
        nodeType.prototype.updateLayerWidgets = function() {
            this.widgets = this.widgets.filter(w => w.name.includes("_anchor") || w.name === "_properties_json");
            const connectedInputs = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null);
            connectedInputs.sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
            for (const input of connectedInputs) {
                this.addLayerWidgets(input.name);
            }
        };

        nodeType.prototype.handleDisconnectedInputs = function() {
            const connected_layer_names = new Set(this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).map(i => i.name));
            const inputs_to_remove = [], props_to_remove = [];
            for (const key in this.layer_properties) {
                if (!connected_layer_names.has(key)) {
                    props_to_remove.push(key);
                    const layer_input = this.inputs.find(i => i.name === key); if(layer_input) inputs_to_remove.push(layer_input);
                    const mask_input = this.inputs.find(i => i.name === key.replace("layer_", "mask_")); if(mask_input) inputs_to_remove.push(mask_input);
                }
            }
            props_to_remove.forEach(key => delete this.layer_properties[key]);
            inputs_to_remove.sort((a,b) => this.inputs.indexOf(b) - this.inputs.indexOf(a)).forEach(i => this.removeInput(this.inputs.indexOf(i)));
            const new_props = {};
            const remaining_layers = this.inputs.filter(i => i.name.startsWith("layer_"));
            const remaining_masks = this.inputs.filter(i => i.name.startsWith("mask_"));
            remaining_layers.sort((a,b)=> parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1])).forEach((input, i) => {
                const old_name = input.name, new_name = `layer_${i + 1}`;
                if(this.layer_properties[old_name]) new_props[new_name] = this.layer_properties[old_name];
                const old_mask_name = old_name.replace("layer_", "mask_");
                const mask_input = remaining_masks.find(m => m.name === old_mask_name);
                if(mask_input) mask_input.name = new_name.replace("layer_", "mask_");
                input.name = new_name;
            });
            this.layer_properties = new_props;
        };
        
        nodeType.prototype.ensureWildcardInputs = function () {
            const layerInputs = this.inputs.filter(i => i.name.startsWith("layer_"));
            if(layerInputs.length >= MAX_LAYERS) return;

            const lastLayerInput = layerInputs.sort((a,b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1])).pop();
            if (!lastLayerInput || lastLayerInput.link !== null) {
                const newIndex = lastLayerInput ? parseInt(lastLayerInput.name.split("_")[1]) + 1 : 1;
                if (newIndex > MAX_LAYERS) return;
                this.addInput(`layer_${newIndex}`, ["IMAGE", "MASK", "*"]);
                this.addInput(`mask_${newIndex}`, "MASK");
            }
        };
        
        nodeType.prototype.updatePropertiesJSON = function() { 
            const p = this.widgets.find(w => w.name === "_properties_json"); 
            if (p) { p.value = JSON.stringify(this.layer_properties); } 
        };
    },
});