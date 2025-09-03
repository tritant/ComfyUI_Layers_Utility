import { app } from "/scripts/app.js";
import { Toolbar } from './toolbar.js';
function applyMask(layerImage, maskImage) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = layerImage.width;
    canvas.height = layerImage.height;
    ctx.drawImage(maskImage, 0, 0, layerImage.width, layerImage.height);
    const maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layerImage, 0, 0);
    const layerData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < maskData.data.length; i += 4) {
        const luminance = maskData.data[i];
        layerData.data[i + 3] = luminance;
    }
    ctx.putImageData(layerData, 0, 0);
    return canvas;
}
const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "difference", "color-dodge", "color-burn"];
const RESIZE_MODES = ["stretch", "fit", "cover", "crop"];
const MAX_LAYERS = 10;
const rotateCursorSVG = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M12 3A9 9 0 1 1 3 12" stroke="black" stroke-width="3.5" stroke-linecap="round"/><path d="M12 3A9 9 0 1 1 3 12" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const rotateCursorDataUri = `data:image/svg+xml;base64,${btoa(rotateCursorSVG)}`;
const rotateCursorStyle = `url(${rotateCursorDataUri}) 12 12, auto`;
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
                const toolbarWidth = this.toolbar ? this.toolbar.width : 0;
                const contentWidth = this.size[0] - 20 - toolbarWidth;
                const requiredHeight = contentWidth * aspectRatio;
                
                anchorWidget.computeSize = () => [this.size[0], requiredHeight];
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
                const imagePromises = Object.entries(previewData).map(([name, previewInfo]) => {
                // On extrait la propriété .url de l'objet previewInfo
                const url = previewInfo.url; 
				
				//const imagePromises = Object.entries(previewData).map(([name, url]) => {
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                 if (url) {
                    img.src = url + `?t=${Date.now()}`;
                    img.onload = () => resolve({ name, img });
                    img.onerror = (err) => reject(err);
                } else {
                    // Si pas d'URL, on considère que c'est une erreur pour ce calque
                    reject(new Error(`URL de preview manquante pour ${name}`));
                }
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
		
		
		const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function(ctx) {
        // On appelle la fonction originale de LiteGraph si elle existe
        onDrawBackground?.apply(this, arguments);

        // Si la toolbar et ses menus contextuels sont actifs, on met à jour leur position en continu
        if (this.toolbar) {
        // Mise à jour de la barre d'outils du MASQUE
        if (this.toolbar.maskManager?.contextualToolbar?.style.display !== 'none') {
            this.toolbar.maskManager.positionToolbar();
        }
        
        // Mise à jour de la barre d'outils du TEXTE
        if (this.toolbar.contextualToolbar?.style.display !== 'none') {
            this.toolbar.updateContextualToolbarPosition();
        }
    }
};
		
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.layer_properties = this.layer_properties || {};
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
            this.interactionMode = "none";
            this.movingLayerBounds = null;
            this.initialScale = 1.0;
            this.initialBounds = null; 
            this.layerAspectRatio = 1.0;
            this.initialRotation = 0.0;
            this.textActionMode = "none";
            this.activeTextObject = null;
            this.initialTextPos = { x: 0, y: 0 };
            this.isTextDragging = false;
            this.dragOffset = { x: 0, y: 0 };
            this.needsFirstSync = true;
            this._resizing = false;
            this.rotationOffsetAngle = 0.0;
            
            this.toolbar = new Toolbar(this);
			this.size[0] = 1000;
            
            setTimeout(() => {
                const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
                if (anchorWidget && anchorWidget.inputEl) {
                    const canvas = document.createElement("canvas");
                    const container = anchorWidget.inputEl.parentElement;
                    container.style.padding = "0px";
                    container.style.margin = "0px";
                    anchorWidget.inputEl.style.display = "none";
                    container.appendChild(canvas);
                    this.previewCanvas = canvas;
                    this.previewCtx = canvas.getContext("2d");
                    const anchorIndex = this.widgets.indexOf(anchorWidget);
                    if (anchorIndex > 0) {
                       this.widgets.splice(anchorIndex, 1);
                       this.widgets.unshift(anchorWidget);
                    }
                    this.redrawPreviewCanvas();
this.previewCanvas.addEventListener('mousedown', (e) => {
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    if (this.textActionMode === 'moving' && this.activeTextObject) {
        const targetText = this.findTextElementAtPos(mouseX, mouseY);
        if (targetText && targetText.id === this.activeTextObject.id) {
            this.dragOffset = {
                x: targetText.x - mouseX,
                y: targetText.y - mouseY
            };
            this.isTextDragging = true;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (this.toolbar.isClickOnToolbar(mouseX, mouseY)) {
        this.toolbar.handleClick(e, mouseX, mouseY);
        return;
    }
    
    if (this.toolbar.activeTool) {
        this.toolbar.handleCanvasClick(e);
        return;
    }
    if (!this.movingLayer) return;
    const props = this.layer_properties[this.movingLayer];
    if (!props) return;
    const handle = this.getHandleAtPos(e);
    if (handle && handle !== 'rotate') {
        this.interactionMode = "scaling_" + handle;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialScale = props.scale;
        this.initialOffsets = { x: props.offset_x, y: props.offset_y };
        this.initialBounds = { ...this.movingLayerBounds };
        this.layerAspectRatio = this.initialBounds.w / this.initialBounds.h;
    } else if (handle === 'rotate') {
        this.interactionMode = "rotating";
        const centerX = this.movingLayerBounds.x + this.movingLayerBounds.w / 2;
        const centerY = this.movingLayerBounds.y + this.movingLayerBounds.h / 2;
        this.dragStartAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
        this.initialRotation = props.rotation || 0;
    } else {
        this.interactionMode = "moving";
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialOffsets = { x: props.offset_x, y: props.offset_y };
    }
    e.preventDefault();
    e.stopPropagation();
});
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
        
nodeType.prototype.onResize = function(size) {
    // Utilise le flag pour éviter les boucles infinies
    if (this._resizing) return;
    this._resizing = true;
    // On s'assure que tout est prêt pour le calcul
    if (!this.widgets || !this.size || !this.basePreviewImage || this.basePreviewImage.naturalWidth <= 0) {
        this._resizing = false;
        return;
    }
    
    // --- Logique de recalcul de la hauteur ---
    const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
    if (anchorWidget) {
        const aspectRatio = this.basePreviewImage.naturalHeight / this.basePreviewImage.naturalWidth;
        const toolbarWidth = this.toolbar ? this.toolbar.width : 0;
        const contentWidth = size[0] - 20 - toolbarWidth;
        const requiredHeight = contentWidth * aspectRatio;
        
        // On force temporairement la hauteur du widget de l'aperçu
        anchorWidget.computeSize = () => [size[0], requiredHeight];
    }
    
    // On force le nœud à recalculer sa hauteur totale
    const newComputedSize = this.computeSize();
    this.size[1] = newComputedSize[1];
    // On nettoie notre modification temporaire
    if (anchorWidget?.computeSize) {
        delete anchorWidget.computeSize;
    }
    // --- Fin de la logique de recalcul ---
    // On planifie le redessinage du contenu du canevas
    if (this.previewCanvas) {
        if (this.redraw_req) cancelAnimationFrame(this.redraw_req);
        this.redraw_req = requestAnimationFrame(() => {
            this.redrawPreviewCanvas();
            this.redraw_req = null;
        });
    }
    // On redessine les en-têtes des calques
    for (let i = 1; i <= 10; i++) { // Remplacer 10 par MAX_LAYERS serait mieux
        const headerAnchor = this.widgets.find(w => w.name === `header_anchor_${i}`);
        if (headerAnchor && headerAnchor.canvas) {
            this.drawHeaderCanvas(headerAnchor.canvas, `layer_${i}`);
        }
    }
    
    // On baisse le drapeau pour la prochaine action
    this._resizing = false;
};
nodeType.prototype.onConfigure = function (info) {
    // On appelle la fonction originale de LiteGraph si elle existe
    const onConfigureOriginal = nodeType.prototype.__proto__.onConfigure;
    onConfigureOriginal?.apply(this, arguments);
    if (info.widgets_values) {
        // --- NOUVELLE LOGIQUE DE CHARGEMENT ROBUSTE ---
        let mainDataString = null;
        
        // On parcourt toutes les valeurs sauvegardées...
        for (const val of info.widgets_values) {
            // ... et on cherche la première qui est une chaîne de caractères et qui commence par '{"layers":'
            if (typeof val === 'string' && val.startsWith('{"layers":')) {
                mainDataString = val;
                break; // On a trouvé nos données, on arrête de chercher.
            }
        }
        // Si on a trouvé notre bloc de données, on le charge.
        if (mainDataString) {
            try {
                const props = JSON.parse(mainDataString);
                this.layer_properties = props.layers || {};
                
                // On s'assure que la toolbar existe avant de lui assigner les textes
                if (this.toolbar) {
                    this.toolbar.textElements = props.texts || [];
                } else {
                    // Si la toolbar n'est pas prête, on met les données en attente (sécurité)
                    this.loadedTextData = props.texts || [];
                }
                
                console.log("[LayerSystem] Données chargées avec succès depuis le bloc principal.");
            } catch(e) { console.error("[LayerSystem] Erreur lors de l'analyse du JSON principal dans onConfigure", e); }
        }
    }
    
    // On active les sauvegardes uniquement à la toute fin.
    this.isConfigured = true;
};
        
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, is_connected, link_info, io_slot) {
            onConnectionsChange?.apply(this, arguments);
            if (side === 1) { setTimeout(() => this.refreshUI(), 0); }
        };
		
        nodeType.prototype.redrawPreviewCanvas = function() {
            if (!this.previewCanvas || !this.size || !this.basePreviewImage || !this.basePreviewImage.naturalWidth) {
                if(this.previewCtx) this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
                return;
            }
            
            const canvas = this.previewCanvas;
            const ctx = this.previewCtx;
            const baseImg = this.basePreviewImage;
            const availableWidth = this.size[0] - 20; 
            const toolbarWidth = this.toolbar.width;
            const imageAreaWidth = availableWidth - toolbarWidth;
            const aspectRatio = baseImg.naturalHeight / baseImg.naturalWidth;
            const requiredHeight = imageAreaWidth * aspectRatio;
            if (canvas.width !== availableWidth) {
                canvas.width = availableWidth;
            }
            const finalHeight = Math.round(requiredHeight);
            if (canvas.height !== finalHeight) {
                canvas.height = finalHeight;
            }
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            const destX = toolbarWidth;
            const destY = 0;
            const destWidth = imageAreaWidth;
            const destHeight = finalHeight;
            ctx.drawImage(baseImg, destX, destY, destWidth, destHeight);
            this.previewCanvasScale = destWidth / baseImg.naturalWidth;
            
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
                let finalImageToDraw = imageToDraw;
                if (maskImage && maskImage.naturalWidth > 0) {
                    let maskToApply = maskImage;
                    if (props.invert_mask) {
                        const invertedMaskCanvas = document.createElement('canvas');
                        invertedMaskCanvas.width = maskImage.naturalWidth;
                        invertedMaskCanvas.height = maskImage.naturalHeight;
                        const invertedCtx = invertedMaskCanvas.getContext('2d');
                        invertedCtx.filter = 'invert(1)';
                        invertedCtx.drawImage(maskImage, 0, 0);
                        maskToApply = invertedMaskCanvas;
                    }
                    finalImageToDraw = applyMask(imageToDraw, maskToApply);
                }
                let final_sx = 0, final_sy = 0, final_sw = finalImageToDraw.width, final_sh = finalImageToDraw.height;
                let final_dx = destX, final_dy = destY, final_dw = destWidth, final_dh = destHeight;
                
                if (props.resize_mode === 'crop') {
                    final_dw = final_sw * props.scale * this.previewCanvasScale;
                    final_dh = final_sh * props.scale * this.previewCanvasScale;
                    final_dx = destX + (props.offset_x * this.previewCanvasScale) - final_dw/2 + destWidth/2;
                    final_dy = destY + (props.offset_y * this.previewCanvasScale) - final_dh/2 + destHeight/2;
                } else {
                    const layerRatio = final_sw / final_sh;
                    const destContainerRatio = destWidth / destHeight;
                    switch(props.resize_mode) {
                        case 'fit':
                            if (layerRatio > destContainerRatio) { final_dh = final_dw / layerRatio; final_dy += (destHeight - final_dh) / 2; }
                            else { final_dw = final_dh * layerRatio; final_dx += (destWidth - final_dw) / 2; }
                            break;
                        case 'cover':
                            if (layerRatio > destContainerRatio) { 
                                final_sw = final_sh * destContainerRatio; 
                                final_sx = (finalImageToDraw.width - final_sw) / 2; 
                            } else { 
                                final_sh = final_sw / destContainerRatio; 
                                final_sy = (finalImageToDraw.height - final_sh) / 2; 
                            }
                            break;
                        case 'stretch': default: break;
                    }
                }
                
                ctx.globalAlpha = props.opacity;
                ctx.globalCompositeOperation = props.blend_mode === 'normal' ? 'source-over' : props.blend_mode;
                if (props.resize_mode === 'crop') {
                    const centerX = final_dx + final_dw / 2;
                    const centerY = final_dy + final_dh / 2;
                    
                    ctx.save();
                    ctx.translate(centerX, centerY);
                    const angleInRadians = (props.rotation || 0) * Math.PI / 180;
                    ctx.rotate(angleInRadians);
                    ctx.drawImage(finalImageToDraw, final_sx, final_sy, final_sw, final_sh, -final_dw / 2, -final_dh / 2, final_dw, final_dh);
                    if (this.movingLayer === layerName) {
                        ctx.strokeStyle = "red"; 
                        ctx.lineWidth = 2; 
                        ctx.strokeRect(-final_dw / 2, -final_dh / 2, final_dw, final_dh);
                        
                        this.movingLayerBounds = { x: final_dx, y: final_dy, w: final_dw, h: final_dh, center_x: centerX, center_y: centerY };
                        
                        const handleSize = 8;
                        ctx.fillStyle = "white";
                        ctx.strokeStyle = "black";
                        ctx.lineWidth = 1;
                        const corners = [
                            {x: -final_dw/2, y: -final_dh/2}, {x: final_dw/2, y: -final_dh/2},
                            {x: -final_dw/2, y: final_dh/2}, {x: final_dw/2, y: final_dh/2}
                        ];
                        for(const corner of corners) {
                            ctx.fillRect(corner.x - handleSize/2, corner.y - handleSize/2, handleSize, handleSize);
                            ctx.strokeRect(corner.x - handleSize/2, corner.y - handleSize/2, handleSize, handleSize);
                        }
                        
                        const rotHandleOffset = 20;
                        const rotHandleY = -final_dh/2 - rotHandleOffset;
                        
                        ctx.beginPath();
                        ctx.moveTo(0, -final_dh/2);
                        ctx.lineTo(0, rotHandleY);
                        ctx.strokeStyle = "red";
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(0, rotHandleY, handleSize / 2, 0, 2 * Math.PI);
                        ctx.fillStyle = "white";
                        ctx.fill();
                        ctx.strokeStyle = "black";
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                    
                    ctx.restore(); 
                } else {
                    ctx.drawImage(finalImageToDraw, final_sx, final_sy, final_sw, final_sh, final_dx, final_dy, final_dw, final_dh);
                }
                
                ctx.restore();
            }
            
         if (this.toolbar && this.toolbar.selectedTextObject) {
            const el = this.toolbar.selectedTextObject;
            const metrics = this.getTextPreviewMetrics(el);
            if (metrics) {
                ctx.save();
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 3]);
                
                const padding = 5;
                ctx.strokeRect(
                    metrics.x - padding,
                    metrics.y - padding,
                    metrics.width + (padding * 2),
                    metrics.height + (padding * 2)
                );
                
                ctx.restore();
            }
        }
            
            this.toolbar.drawTextElements(ctx);
            this.toolbar.draw(ctx);
            //if (this.needsFirstSync) {
              //this.refreshUI();
              //this.needsFirstSync = false;
            //}
        };
        
nodeType.prototype.getTextPreviewMetrics = function(textEl) {
    if (!this.basePreviewImage || !this.previewCanvas || !this.toolbar) { return null; }
    const baseImageWidth = this.basePreviewImage.naturalWidth;
    const previewAreaWidth = this.previewCanvas.width - this.toolbar.width;
    if (baseImageWidth <= 0) return null;
    const inverseRatio = previewAreaWidth / baseImageWidth;
    const previewCenterX = previewAreaWidth / 2;
    const previewCenterY = this.previewCanvas.height / 2;
    const preview_size = textEl.size * inverseRatio;
    const preview_offset_x = textEl.offset_x * inverseRatio;
    const preview_offset_y = textEl.offset_y * inverseRatio;
    const preview_x = this.toolbar.width + previewCenterX + preview_offset_x;
    const preview_y = previewCenterY + preview_offset_y;
    const ctx = this.previewCtx;
    ctx.save();
    ctx.font = `${preview_size}px ${textEl.fontFamily || 'Arial'}`;
    const metrics = ctx.measureText(textEl.text);
    ctx.restore();
    const textHeight = (metrics.fontBoundingBoxAscent || 0) + (metrics.fontBoundingBoxDescent || 0);
    const finalHeight = textHeight > 0 ? textHeight : preview_size;
    return {
        x: preview_x,
        y: preview_y,
        size: preview_size,
        width: metrics.width,
        height: finalHeight -10
    };
};
nodeType.prototype.findTextElementAtPos = function(mouseX, mouseY) {
    if (!this.toolbar || !this.toolbar.textElements.length || !this.previewCanvas || !this.basePreviewImage) {
        return null;
    }
    const ctx = this.previewCtx;
    const baseImageWidth = this.basePreviewImage.naturalWidth;
    const previewAreaWidth = this.previewCanvas.width - this.toolbar.width;
    
    if (baseImageWidth <= 0) return null;
    const inverseRatio = previewAreaWidth / baseImageWidth;
    const previewCenterX = previewAreaWidth / 2;
    const previewCenterY = this.previewCanvas.height / 2;
    ctx.save();
    
    for (let i = this.toolbar.textElements.length - 1; i >= 0; i--) {
        const textEl = this.toolbar.textElements[i];
        const preview_offset_x = textEl.offset_x * inverseRatio;
        const preview_offset_y = textEl.offset_y * inverseRatio;
        const preview_size = textEl.size * inverseRatio;
        const preview_x = this.toolbar.width + previewCenterX + preview_offset_x;
        const preview_y = previewCenterY + preview_offset_y;
        
        ctx.font = `${preview_size}px ${textEl.fontFamily || 'Arial'}`;
        const metrics = ctx.measureText(textEl.text);
        const textWidth = metrics.width;
        const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || preview_size;
        if (mouseX >= preview_x && mouseX <= preview_x + textWidth &&
            mouseY >= preview_y && mouseY <= preview_y + textHeight) 
        {
            ctx.restore();
            return textEl;
        }
    }
    ctx.restore();
    return null;
};
nodeType.prototype.editTextElement = function(textElement) {
    if (this.toolbar.activeTextarea) this.toolbar.activeTextarea.remove();
    const metrics = this.getTextPreviewMetrics(textElement);
    if (!metrics) {
        console.error("LayerSystem: Impossible de trouver la position du texte pour l'édition.");
        return;
    }
    const canvasRect = this.previewCanvas.getBoundingClientRect();
    const finalLeft = canvasRect.left + metrics.x;
    const finalTop = canvasRect.top + metrics.y;
    const finalFontSize = metrics.size;
    const textInput = document.createElement("div");
    this.toolbar.activeTextarea = textInput;
    textInput.contentEditable = true;
    textInput.innerText = textElement.text;
    Object.assign(textInput.style, {
        position: 'fixed',
        left: `${finalLeft}px`,
        top: `${finalTop}px`,
        fontFamily: textElement.fontFamily,
        fontSize: `${finalFontSize}px`,
        color: 'white',
        background: 'rgba(20,20,20,0.9)',
        border: '1px solid #FFD700',
        padding: '5px',
        zIndex: '9999',
        minWidth: `${metrics.width}px`,
        whiteSpace: 'pre-wrap'
    });
    document.body.appendChild(textInput);
    textInput.focus();
    document.execCommand('selectAll', false, null);
    textInput.addEventListener('keydown', (evt) => evt.stopPropagation());
    const onFinish = () => {
        const newText = textInput.innerText;
        
        if (newText === "") {
            const index = this.toolbar.textElements.findIndex(el => el.id === textElement.id);
            if (index > -1) this.toolbar.textElements.splice(index, 1);
        } else {
            textElement.text = newText;
        }
        this.updatePropertiesJSON();
        this.redrawPreviewCanvas();
        
        if (textInput.parentElement) textInput.parentElement.removeChild(textInput);
        this.toolbar.activeTextarea = null;
        this.toolbar.hideContextualToolbar();
    };
    textInput.addEventListener('blur', onFinish);
    textInput.addEventListener('keydown', (evt) => {
        evt.stopPropagation();
        if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            onFinish();
        }
        if (evt.key === 'Escape') {
            textInput.innerText = textElement.text;
            onFinish();
        }
    });
};
nodeType.prototype.showTextContextMenu = function(clientX, clientY, textElement) {
    const existingMenu = document.getElementById("text-context-menu");
    if (existingMenu) existingMenu.remove();
    
    this.activeTextObject = textElement;
    const menu = document.createElement("div");
    menu.id = "text-context-menu";
    Object.assign(menu.style, {
        position: 'fixed', left: `${clientX}px`, top: `${clientY}px`, backgroundColor: '#333',
        border: '1px solid #555', borderRadius: '4px', padding: '5px', zIndex: '10000',
        display: 'flex', flexDirection: 'column',
    });
    const actionNames = ['Modifier le texte', 'Déplacer', 'Redimensionner', 'Pivoter', 'Supprimer'];
    
    actionNames.forEach(actionName => {
        const button = document.createElement("button");
        button.innerText = actionName;
        Object.assign(button.style, {
            backgroundColor: '#444', color: 'white', border: '1px solid #666',
            padding: '8px 12px', margin: '2px', textAlign: 'left', cursor: 'pointer'
        });
        button.onmouseover = () => button.style.backgroundColor = '#555';
        button.onmouseout = () => button.style.backgroundColor = '#444';
        
button.onclick = (e) => {
            menu.remove();
            const currentTextElement = this.toolbar.textElements.find(el => el.id === textElement.id);
            if (!currentTextElement) {
                console.log("L'élément texte a été supprimé, action annulée.");
                return;
            }
            switch (actionName) {
                case 'Modifier le texte':
                    this.editTextElement(currentTextElement);
                    break;
                case 'Déplacer':
                    this.textActionMode = 'moving';
                    this.activeTextObject = currentTextElement;
                    this.redrawPreviewCanvas();
                    break;
                case 'Supprimer':
                    const index = this.toolbar.textElements.findIndex(el => el.id === currentTextElement.id);
                    if (index > -1) {
                        this.toolbar.textElements.splice(index, 1);
                        this.updatePropertiesJSON();
                        this.redrawPreviewCanvas();
                    }
                    break;
            }
        };
        menu.appendChild(button);
    });
    document.body.appendChild(menu);
    const closeMenuHandler = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closeMenuHandler, true);
        }
    };
    
    setTimeout(() => document.addEventListener('mousedown', closeMenuHandler, true), 0);
};
nodeType.prototype.onCanvasMouseDown = function(e) {
    console.log("---");
    console.log("1. Clic détecté sur le canvas.");
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    if (this.toolbar.isClickOnToolbar(mouseX, mouseY)) {
        this.toolbar.handleClick(e, mouseX, mouseY);
        return;
    }
    if (this.toolbar.activeTool) {
        console.log("2. Condition 'this.toolbar.activeTool' est VRAIE. Appel de handleCanvasClick...");
        this.toolbar.handleCanvasClick(e);
        return;
    }
    if (!this.movingLayer) {
        console.log("-> Arrêt : Aucun outil actif et aucun calque en mouvement.");
        return;
    }
    const props = this.layer_properties[this.movingLayer];
    if (!props) return;
    const handle = this.getHandleAtPos(e);
    if (handle && handle !== 'rotate') {
        this.interactionMode = "scaling_" + handle;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialScale = props.scale;
        this.initialOffsets = { x: props.offset_x, y: props.offset_y };
        this.initialBounds = { ...this.movingLayerBounds };
        this.layerAspectRatio = this.initialBounds.w / this.initialBounds.h;
} else if (handle === 'rotate') {
    this.interactionMode = "rotating";
    const props = this.layer_properties[this.movingLayer];
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    const centerX = this.movingLayerBounds.x + this.movingLayerBounds.w / 2;
    const centerY = this.movingLayerBounds.y + this.movingLayerBounds.h / 2;
    this.dragStartAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
    this.initialRotation = props.rotation || 0;
} else {
        this.interactionMode = "moving";
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.initialOffsets = { x: props.offset_x, y: props.offset_y };
    }
    
    e.preventDefault();
    e.stopPropagation();
};
nodeType.prototype.getHandleAtPos = function(e) {
    if (!this.movingLayer || !this.movingLayerBounds || !this.previewCanvas) return null;
    
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    const handleSize = 12;
    const bounds = this.movingLayerBounds;
    
    const props = this.layer_properties[this.movingLayer];
    const angleInRadians = (props.rotation || 0) * Math.PI / 180;
    const centerX = bounds.x + bounds.w / 2;
    const centerY = bounds.y + bounds.h / 2;
    const cos = Math.cos(-angleInRadians);
    const sin = Math.sin(-angleInRadians);
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const rotatedMouseX = dx * cos - dy * sin + centerX;
    const rotatedMouseY = dx * sin + dy * cos + centerY;
    
    const rotHandleSize = 16;
    const rotHandleX_unrotated = bounds.x + bounds.w / 2;
    const rotHandleY_unrotated = bounds.y - 20;
    
    if (rotatedMouseX >= rotHandleX_unrotated - rotHandleSize / 2 && rotatedMouseX <= rotHandleX_unrotated + rotHandleSize / 2 &&
        rotatedMouseY >= rotHandleY_unrotated - rotHandleSize / 2 && rotatedMouseY <= rotHandleY_unrotated + rotHandleSize / 2) {
        return "rotate";
    }
    const corners = {
        tl: { x: bounds.x, y: bounds.y },
        tr: { x: bounds.x + bounds.w, y: bounds.y },
        bl: { x: bounds.x, y: bounds.y + bounds.h },
        br: { x: bounds.x + bounds.w, y: bounds.y + bounds.h }
    };
    for (const key in corners) {
        const corner = corners[key];
        const handleX = corner.x;
        const handleY = corner.y;
        if (rotatedMouseX >= handleX - handleSize/2 && rotatedMouseX <= handleX + handleSize/2 &&
            rotatedMouseY >= handleY - handleSize/2 && rotatedMouseY <= handleY + handleSize/2) {
            return key;
        }
    }
    return null;
};
        
        nodeType.prototype.onCanvasMouseMove = function(e) {
        if (this.textActionMode === 'moving' && this.activeTextObject) {
 if (this.isTextDragging && this.activeTextObject) {
        this.activeTextObject.x = e.offsetX + this.dragOffset.x;
        this.activeTextObject.y = e.offsetY + this.dragOffset.y;
        this.redrawPreviewCanvas();
        return;
    }
        }
            if (this.interactionMode.startsWith("scaling_")) {
                if (this.interactionMode === "scaling_tl" || this.interactionMode === "scaling_br") {
                    this.previewCanvas.style.cursor = "nwse-resize";
                } else {
                    this.previewCanvas.style.cursor = "nesw-resize";
                }
            } else if (this.interactionMode === "moving") {
                this.previewCanvas.style.cursor = "move";
            } else if (this.interactionMode === "rotating") {
                this.previewCanvas.style.cursor = rotateCursorStyle;
            } else {
                if (this.movingLayer) {
                    const rect = this.previewCanvas.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const mouseY = e.clientY - rect.top;
                    const handle = this.getHandleAtPos(e, mouseX, mouseY);
                    if (handle === "tl" || handle === "br") { this.previewCanvas.style.cursor = "nwse-resize"; }
                    else if (handle === "tr" || handle === "bl") { this.previewCanvas.style.cursor = "nesw-resize"; }
                    else if (handle === "rotate") { this.previewCanvas.style.cursor = rotateCursorStyle; }
                    else { this.previewCanvas.style.cursor = "move"; }
                } else {
                     this.previewCanvas.style.cursor = "default";
                }
            }
        
            if (this.interactionMode === "none") return;
            
            const props = this.layer_properties[this.movingLayer];
            if (!props) return;
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            if (this.interactionMode === "moving") {
                if (!this.isDragging) return;
                const baseImg = this.basePreviewImage;
                if (!baseImg) return;
                const scaleFactor = (baseImg.naturalWidth / this.movingLayerBounds.w) * props.scale;
                props.offset_x = Math.round(this.initialOffsets.x + (dx * scaleFactor));
                props.offset_y = Math.round(this.initialOffsets.y + (dy * scaleFactor));
            } else if (this.interactionMode.startsWith("scaling_")) {
                const angleInRadians = (props.rotation || 0) * Math.PI / 180;
                const cos = Math.cos(-angleInRadians);
                const sin = Math.sin(-angleInRadians);
                const local_dx = dx * cos - dy * sin;
                let newWidth;
                
                if (this.interactionMode === 'scaling_br' || this.interactionMode === 'scaling_tr') {
                    newWidth = this.initialBounds.w + local_dx;
                } else if (this.interactionMode === 'scaling_bl' || this.interactionMode === 'scaling_tl') {
                    newWidth = this.initialBounds.w - local_dx;
                }
                
                if (newWidth < 10) { newWidth = 10; }
                
                const newScale = this.initialScale * (newWidth / this.initialBounds.w);
                props.scale = newScale;
 } else if (this.interactionMode === "rotating") {
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    const centerX = this.movingLayerBounds.x + this.movingLayerBounds.w / 2;
    const centerY = this.movingLayerBounds.y + this.movingLayerBounds.h / 2;
    const currentMouseAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
    const angleDifference = currentMouseAngle - this.dragStartAngle;
    const props = this.layer_properties[this.movingLayer];
    props.rotation = this.initialRotation + (angleDifference * 180 / Math.PI);
    const rotationWidget = this.widgets.find(w => w.name === `rotation_${this.movingLayer}`);
    if(rotationWidget) rotationWidget.value = props.rotation;
    
    this.redrawPreviewCanvas();
}
            const scaleWidget = this.widgets.find(w => w.name === `scale_${this.movingLayer}`);
            if(scaleWidget) scaleWidget.value = props.scale;
            const offsetXWidget = this.widgets.find(w => w.name === `offset_x_${this.movingLayer}`);
            if(offsetXWidget) offsetXWidget.value = props.offset_x;
            const offsetYWidget = this.widgets.find(w => w.name === `offset_y_${this.movingLayer}`);
            if(offsetYWidget) offsetYWidget.value = props.offset_y;
            const rotationWidget = this.widgets.find(w => w.name === `rotation_${this.movingLayer}`);
            if(rotationWidget) rotationWidget.value = props.rotation;
            
            this.graph.setDirtyCanvas(true, true);
            this.redrawPreviewCanvas();
        };
      nodeType.prototype.onCanvasMouseUp = function(e) {
      if (this.isTextDragging) {
        this.updatePropertiesJSON();
        this.textActionMode = 'none';
        this.activeTextObject = null;
        this.isTextDragging = false;
        this.redrawPreviewCanvas();
    }
            if (this.interactionMode !== "none") {
                this.isDragging = false;
                this.interactionMode = "none";
                this.updatePropertiesJSON();
            }
        };
        nodeType.prototype.onCanvasMouseLeave = function(e) {
            if (this.previewCanvas) {
                this.previewCanvas.style.cursor = "default";
            }
            if (this.interactionMode !== "none") {
                this.isDragging = false;
                this.interactionMode = "none";
                this.updatePropertiesJSON();
            }
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
                anchor.inputEl.style.display = "none";
                container.appendChild(canvas);
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
                    } else if (isInMoveIcon && props.resize_mode === 'crop' && (!this.toolbar || !this.toolbar.activeTool)) {
                        if (this.movingLayer === layerName) {
                            this.movingLayer = null;
                        } else {
                            this.movingLayer = layerName;
                        }
                        this.refreshUI();
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
            ctx.strokeStyle = isMoving 
                ? "#F44"
                : (props.resize_mode !== 'crop' || (this.toolbar && this.toolbar.activeTool) ? disabledColor : LiteGraph.WIDGET_TEXT_COLOR);
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
                } else if (["scale", "offset_x", "offset_y", "rotation"].some(p => w.name.startsWith(p))) {
                    isHidden = isLayerCollapsed || !showTransformForCrop;
                }
                
                w.hidden = isHidden;
                if (!w.originalComputeSize) w.originalComputeSize = w.computeSize;
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
        if (this.toolbar) {
          if (this.toolbar.activeTool === 'mask') {
            // Si le mode masque est actif, on dit au MaskManager de se mettre à jour.
            // Il va automatiquement trouver le nouveau calque déplié.
            this.toolbar.maskManager.show();
        } else {
            // Sinon, on s'assure que ses outils sont bien cachés.
            this.toolbar.maskManager.hide();
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
            rotation: 0.0,
            brightness: 0.0, contrast: 0.0, color_r: 1.0, color_g: 1.0, color_b: 1.0, saturation: 1.0, 
            invert_mask: false, color_section_collapsed: true, layer_collapsed: true,
			internal_mask_filename: null,
            internal_mask_details: null,
        };
    }
    const props = this.layer_properties[layer_name];
    const allWidgets = [];
    const topSpacer = { name: `top_spacer_for_${layer_name}`, type: "CUSTOM_SPACER", draw: () => {}, computeSize: () => [0, 10] };
    this.widgets.push(topSpacer);
    allWidgets.push(topSpacer);
    const redrawCallback = (prop, v) => { 
        props[prop] = v; 
        this.updatePropertiesJSON(); 
        this.redrawPreviewCanvas(); 
        this.graph.setDirtyCanvas(true, true);
    };
    
    allWidgets.push(this.addWidget("combo", `blend_mode_${layer_name}`, props.blend_mode, (v) => { props.blend_mode = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {values: BLEND_MODES}));
    allWidgets.push(this.addWidget("number", `opacity_${layer_name}`, props.opacity, (v) => { props.opacity = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {min: 0.0, max: 1.0, step: 0.1, precision: 2}));
    const colorToggle = this.addWidget("toggle", `toggle_color_${layer_name}`, !props.color_section_collapsed, (v) => {
        props.color_section_collapsed = !v; this.refreshUI(); this.updatePropertiesJSON();
    }, { on: "▼ Color Adjust", off: "▶ Color Adjust" });
    allWidgets.push(colorToggle);
    
    allWidgets.push(this.addWidget("number", `brightness_${layer_name}`, props.brightness, (v) => redrawCallback('brightness', v), {min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `contrast_${layer_name}`, props.contrast, (v) => redrawCallback('contrast', v), {min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `saturation_${layer_name}`, props.saturation, (v) => redrawCallback('saturation', v), {min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `color_r_${layer_name}`, props.color_r, (v) => redrawCallback('color_r', v), {min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `color_g_${layer_name}`, props.color_g, (v) => redrawCallback('color_g', v), {min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `color_b_${layer_name}`, props.color_b, (v) => redrawCallback('color_b', v), {min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("toggle", `invert_mask_${layer_name}`, !!props.invert_mask, (v) => { 
        props.invert_mask = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas();
    }));
    const resizeModeWidget = this.addWidget("combo", `resize_mode_${layer_name}`, props.resize_mode, (v) => {
        props.resize_mode = v; if (v !== 'crop' && this.movingLayer === layer_name) { this.movingLayer = null; }
        this.refreshUI();        
        this.updatePropertiesJSON(); this.redrawPreviewCanvas();
    }, { values: RESIZE_MODES });
    allWidgets.push(resizeModeWidget);
    allWidgets.push(this.addWidget("number", `scale_${layer_name}`, props.scale, (v) => redrawCallback('scale', v), {min: 0.01, max: 10.0, step: 0.1, precision: 2 }));
    allWidgets.push(this.addWidget("number", `offset_x_${layer_name}`, props.offset_x, (v) => redrawCallback('offset_x', v), {min: -8192, max: 8192, step: 1 }));
    allWidgets.push(this.addWidget("number", `offset_y_${layer_name}`, props.offset_y, (v) => redrawCallback('offset_y', v), {min: -8192, max: 8192, step: 1 }));
    allWidgets.push(this.addWidget("number", `rotation_${layer_name}`, props.rotation, (v) => redrawCallback('rotation', v), {min: -360.0, max: 360.0, step: 1, precision: 1 }));
    const bottomSpacer = { name: `bottom_spacer_for_${layer_name}`, type: "CUSTOM_SPACER", draw: () => {}, computeSize: () => [0, 10] };
    this.widgets.push(bottomSpacer);
    allWidgets.push(bottomSpacer);
    for (const w of allWidgets) { 
        if (!w.originalComputeSize) w.originalComputeSize = w.computeSize;
    }
};
        
        nodeType.prototype.updateLayerWidgets = function() {
            this.widgets = this.widgets.filter(w => w.name.includes("_anchor") || w.name === "_properties_json");
            const connectedInputs = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null);
            connectedInputs.sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
            
            const existingWidgets = new Set();
            for(const w of this.widgets) {
                if (w.name.startsWith('blend_mode_')) existingWidgets.add(w.name.replace('blend_mode_', ''));
            }
            for (const input of connectedInputs) {
                if (!existingWidgets.has(input.name)) {
                   this.addLayerWidgets(input.name);
                }
            }
        };
nodeType.prototype.handleDisconnectedInputs = function() {
    const connected_layer_names = new Set(this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).map(i => i.name));
    const inputs_to_remove = [];
    const props_to_remove = [];

    // On trouve les entrées et propriétés à supprimer
    for (const key in this.layer_properties) {
        if (!connected_layer_names.has(key)) {
            props_to_remove.push(key);
            const layer_input = this.inputs.find(i => i.name === key);
            if(layer_input) inputs_to_remove.push(layer_input);
            const mask_input = this.inputs.find(i => i.name === key.replace("layer_", "mask_"));
            if(mask_input) inputs_to_remove.push(mask_input);
        }
    }

    // On supprime les propriétés
    props_to_remove.forEach(key => delete this.layer_properties[key]);

    // On supprime les entrées en partant de la fin pour ne pas perturber les index
    inputs_to_remove.sort((a,b) => this.inputs.indexOf(b) - this.inputs.indexOf(a)).forEach(i => this.removeInput(this.inputs.indexOf(i)));
    
    // On ré-indexe les entrées et les propriétés restantes
    const new_props = {};
    const remaining_layers = this.inputs.filter(i => i.name.startsWith("layer_"));
    const remaining_masks = this.inputs.filter(i => i.name.startsWith("mask_"));
    
    remaining_layers.sort((a,b)=> parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1])).forEach((input, i) => {
        const old_name = input.name;
        const new_name = `layer_${i + 1}`;
        if(this.layer_properties[old_name]) {
            new_props[new_name] = this.layer_properties[old_name];
        }
        const old_mask_name = old_name.replace("layer_", "mask_");
        const mask_input = remaining_masks.find(m => m.name === old_mask_name);
        if(mask_input) {
            mask_input.name = new_name.replace("layer_", "mask_");
        }
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
                this.addInput(`layer_${newIndex}`, "IMAGE");
                this.addInput(`mask_${newIndex}`, "MASK");
            }
        };
        
nodeType.prototype.updatePropertiesJSON = function() {
    // 1. Mise à jour du widget de données principal
    const mainDataWidget = this.widgets.find(w => w.name === "_layer_system_data" || w.name === "_properties_json");
    if (mainDataWidget) {
        const full_properties = {
            layers: this.layer_properties,
            texts: this.toolbar ? this.toolbar.getTexts() : [],
            preview_width: this.previewCanvas ? this.previewCanvas.width : 512,
            preview_height: this.previewCanvas ? this.previewCanvas.height : 512,
            toolbar_width: this.toolbar ? this.toolbar.width : 0
        };
        mainDataWidget.value = JSON.stringify(full_properties);
    }
    // 2. Neutralisation des widgets d'ancrage pour éviter les doublons
    this.widgets.forEach(widget => {
        if (widget.name.includes("_anchor")) {
            widget.value = null;
        }
    });
};
    },
}); 