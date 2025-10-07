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
const MAX_LAYERS = 11;
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
const trashIconPath = new Path2D("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z");
const replaceIconPath = new Path2D("M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z");
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
                const url = previewInfo.url; 
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                 if (url) {
                    img.src = url + `?t=${Date.now()}`;
                    img.onload = () => resolve({ name, img });
                    img.onerror = (err) => reject(err);
                } else {
                    reject(new Error(`[Layer System] Missing preview URL for ${name}`));
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
                        this.refreshUI();
                    })
                    .catch(e => console.error("[Layer System] At least one preview image could not be loaded.", e));
            }
        };
        
        const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function(ctx) {
        onDrawBackground?.apply(this, arguments);
		if (this.toolbar && this.toolbar.activeTool === 'brush') {
            this.toolbar.brushManager.positionToolbar();
        }
		if (this.toolbar && this.toolbar.activeTool === 'mask_painter') {
            this.toolbar.maskPainterManager.positionToolbar();
        }
        if (this.toolbar) {
        if (this.toolbar.maskManager?.contextualToolbar?.style.display !== 'none') {
            this.toolbar.maskManager.positionToolbar();
        }
        if (this.toolbar.contextualToolbar?.style.display !== 'none') {
            this.toolbar.updateContextualToolbarPosition();
        }
		if (this.toolbar.magicWandManager?.contextualToolbar?.style.display !== 'none') {
            this.toolbar.magicWandManager.positionToolbar();
        }
		if (this.toolbar.selectionSubMenu?.style.display !== 'none') {
            this.toolbar.positionSelectionSubMenu();
        }
    }
};
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.base_image_properties = null;
            this.layer_properties = this.layer_properties || {};
			
	    const onRemoved_original = this.onRemoved;
        this.onRemoved = () => {
        onRemoved_original?.apply(this, arguments);
        if (this.toolbar?.contextualToolbar) {
            this.toolbar.contextualToolbar.remove();
        }
        if (this.toolbar?.maskManager?.contextualToolbar) {
            this.toolbar.maskManager.contextualToolbar.remove();
        }
		if (this.toolbar.selectionSubMenu) {
            this.toolbar.selectionSubMenu.remove();
        }
        if (this.toolbar.magicWandManager?.settingsToolbar) {
            this.toolbar.magicWandManager.settingsToolbar.remove();
        }
		if (this.toolbar?.brushManager?.toolbar) {
            this.toolbar.brushManager.toolbar.remove();
        }
		if (this.toolbar?.maskPainterManager?.toolbar) {
            this.toolbar.maskPainterManager.toolbar.remove();
        }
    };
			
const topSpacer = { 
    name: "global_top_spacer", 
    type: "CUSTOM_SPACER", 
    draw: () => {}, 
    computeSize: () => [0, 10] 
};
this.widgets.push(topSpacer);
            this.addWidget(
              "button",
              "Add Image",
               null,
               () => { this.handleInternalImageLoad(); }
            );
            
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
            this.size[0] = 800;
            
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
					
					const overlayCanvas = document.createElement("canvas");
                    overlayCanvas.id = "ls-overlay-canvas";
                    overlayCanvas.style.position = "absolute";
                    overlayCanvas.style.top = "0";
                    overlayCanvas.style.left = "0";
                    overlayCanvas.style.pointerEvents = "none";
                    container.appendChild(overlayCanvas);
                    this.overlayCanvas = overlayCanvas;
					
                    const anchorIndex = this.widgets.indexOf(anchorWidget);
                    if (anchorIndex > 0) {
                       this.widgets.splice(anchorIndex, 1);
                       this.widgets.unshift(anchorWidget);
                    }
                    this.redrawPreviewCanvas();
this.previewCanvas.addEventListener('mousedown', (e) => {
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;

    if (this.toolbar.isClickOnToolbar(mouseX, mouseY)) {
        this.toolbar.handleClick(e, mouseX, mouseY);
        return;
    }

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

    if (this.toolbar.activeTool === 'magic_wand' && this.toolbar.magicWandManager) {
        this.toolbar.magicWandManager.handleCanvasClick(e);
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
 if (this.loadedConfig) {
    this.loadStateFromConfig(this.loadedConfig);
} else {
    this.refreshUI();
}
            }, 0);
        };
        
nodeType.prototype.onResize = function(size) {
    if (this._resizing) return;
    this._resizing = true;
    if (!this.widgets || !this.size || !this.basePreviewImage || this.basePreviewImage.naturalWidth <= 0) {
        this._resizing = false;
        return;
    }
    
    const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
    if (anchorWidget) {
        const aspectRatio = this.basePreviewImage.naturalHeight / this.basePreviewImage.naturalWidth;
        const toolbarWidth = this.toolbar ? this.toolbar.width : 0;
        const contentWidth = size[0] - 20 - toolbarWidth;
        const requiredHeight = contentWidth * aspectRatio;
        anchorWidget.computeSize = () => [size[0], requiredHeight];
    }
    
    const newComputedSize = this.computeSize();
    this.size[1] = newComputedSize[1];
    if (anchorWidget?.computeSize) {
        delete anchorWidget.computeSize;
    }

    if (this.previewCanvas) {
        if (this.redraw_req) cancelAnimationFrame(this.redraw_req);
        this.redraw_req = requestAnimationFrame(() => {
            this.redrawPreviewCanvas();
            this.redraw_req = null;
        });
    }

    if (this.base_image_properties) {
        const baseHeaderAnchor = this.widgets.find(w => w.name === 'header_anchor_1');
        if (baseHeaderAnchor && baseHeaderAnchor.canvas) {
            this.drawHeaderCanvas(baseHeaderAnchor.canvas, 'base_image');
        }
    }

    const activeLayerKeys = Object.keys(this.layer_properties);
    for (const layerName of activeLayerKeys) {
        const layerIndex = parseInt(layerName.split('_')[1]);
        const headerAnchor = this.widgets.find(w => w.name === `header_anchor_${layerIndex + 1}`);
        if (headerAnchor && headerAnchor.canvas) {
            this.drawHeaderCanvas(headerAnchor.canvas, layerName);
        }
    }
    this._resizing = false;
};

nodeType.prototype.onConfigure = function(info) {
    const onConfigureOriginal = nodeType.prototype.__proto__.onConfigure;
    onConfigureOriginal?.apply(this, arguments);
    this.loadedConfig = info;
};

nodeType.prototype.loadStateFromConfig = function(info) {
    if (this.stateLoaded) return;
    if (info.widgets_values) {
        const jsonWidgetIndex = this.widgets.findIndex(w => w.name === "_properties_json");
        if (jsonWidgetIndex > -1 && info.widgets_values[jsonWidgetIndex]) {
            try {
                const props = JSON.parse(info.widgets_values[jsonWidgetIndex]);
                this.base_image_properties = props.base || null;
                this.layer_properties = props.layers || {};

                if (this.toolbar) {
                    this.toolbar.textElements = props.texts || [];
                } else {
                    this.loadedTextData = props.texts || [];
                }
                this.stateLoaded = true;

                setTimeout(() => {
                    this.refreshPreviewsOnly();
                }, 100);
                   this.refreshUI();
                
            } catch (e) {
                console.error("[Layer System] Error loading JSON state", e);
                this.refreshUI();
            }
        }
    } else {
        this.refreshUI();
    }
};
     
nodeType.prototype.refreshPreviewsOnly = async function() {
    const properties_widget = this.widgets.find(w => w.name === "_properties_json");
    if (!properties_widget) return;

    try {
        const response = await fetch("/layersystem/refresh_previews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ properties_json: properties_widget.value }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const ui_data = await response.json();
        
        if (ui_data.layer_previews) {
            this.onExecuted({ layer_previews: ui_data.layer_previews });
        }
    } catch (e) {
        console.error("[Layer System] Failed to refresh previews:", e);
    }
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
            
            const sortedLayerNames = Object.keys(this.layer_properties).sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));
            
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
        console.error("[Layer System] Unable to find text position for editing.");
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
	

    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
    if (this.toolbar.isClickOnToolbar(mouseX, mouseY)) {
        this.toolbar.handleClick(e, mouseX, mouseY);
        return;
    }
	

    if (this.toolbar.activeTool) {
        this.toolbar.handleCanvasClick(e);
        return;
    }
    if (!this.movingLayer) {
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
        if (this.toolbar?.activeTool === 'mask_painter' && this.toolbar?.maskPainterManager) {
            this.toolbar.maskPainterManager.switchLayer();
        }
            const layerName = e.currentTarget.dataset.layerName;
            if (!layerName) {
                return;
            }
    if (layerName === 'base_image') {
        const bounds = this.base_image_properties?.replace_icon_bounds;
        if (bounds && e.offsetX >= bounds.x && e.offsetX <= bounds.x + bounds.size &&
            e.offsetY >= bounds.y && e.offsetY <= bounds.y + bounds.size) {
            this.handleBaseImageReplace();
        }
        return;
    }
            const props = this.layer_properties[layerName];
            if (!props) return;
            
            const layer_index = parseInt(layerName.split("_")[1]);
            const x = e.offsetX;
            const y = e.offsetY;
            if (props.trash_icon_bounds) {
                const bounds = props.trash_icon_bounds;
                if (x >= bounds.x && x <= bounds.x + bounds.size && y >= bounds.y && y <= bounds.y + bounds.size) {
                    if (confirm(`Are you sure you want to delete Layer ${layer_index}?`)) {
                        this.deleteLayer(layerName);
                    }
                    return;
                }
            }
                    
                    const widgetWidth = this.size[0] - 20;
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
                        const total_layers = Object.keys(this.layer_properties).length;
                        if (layer_index < total_layers) { this.moveLayer(layer_index, "down"); }
                    } else if (isInMoveIcon && props.resize_mode === 'crop' && !(this.toolbar && (this.toolbar.activeTool || this.toolbar.selectionSubMenu?.style.display === 'flex'))) {
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
 
                        if (this.toolbar.activeTool === 'brush') {
                            this.toolbar.brushManager.show();
                        }
 
                        this.refreshUI();
                    }
                    this.updatePropertiesJSON();
                });
            }
        };
nodeType.prototype.drawHeaderCanvas = function(canvas, layerName) {
    if (!canvas) return;

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
    const isBaseLayer = layerName === 'base_image';
    let layerImage = null;
    if (this.loaded_preview_images) {
         const imageKey = isBaseLayer ? 'base_image' : layerName;
        layerImage = this.loaded_preview_images[imageKey];
    }

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
    const textY = topPadding + thumbSize / 2;
    const thumbY = topPadding;
    
    if (isBaseLayer) {
        canvas.dataset.layerName = 'base_image';
        ctx.fillStyle = '#FFFFFF'; 
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "14px Arial";
        ctx.fillText(`▶ Base Image`, 5, textY);
    const replaceIconSize = 36;
    const replaceIconX = thumbX - replaceIconSize - padding;
    const replaceIconY = topPadding + (thumbSize - replaceIconSize) / 2;
    if (this.base_image_properties) {
        this.base_image_properties.replace_icon_bounds = { x: replaceIconX, y: replaceIconY, size: replaceIconSize };
    }
    ctx.save();
    ctx.translate(replaceIconX, replaceIconY);
    ctx.scale(replaceIconSize / 24, replaceIconSize / 24);
    ctx.strokeStyle = "#CCCCCC";
    ctx.lineWidth = 2;
    ctx.stroke(replaceIconPath);
    ctx.restore();
        ctx.fillStyle = "#353535";
        ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);
        if (layerImage && layerImage.naturalWidth > 0) {
            const imgRatio = layerImage.naturalWidth / layerImage.naturalHeight;
            let destWidth, destHeight, destX, destY;
            if (imgRatio > 1) { destWidth = thumbSize; destHeight = thumbSize / imgRatio; }
            else { destHeight = thumbSize; destWidth = thumbSize * imgRatio; }
            destX = thumbX + (thumbSize - destWidth) / 2;
            destY = thumbY + (thumbSize - destHeight) / 2;
            ctx.drawImage(layerImage, 0, 0, layerImage.naturalWidth, layerImage.naturalHeight, destX, destY, destWidth, destHeight);
        }
                
        return; 
    }

    const props = this.layer_properties[layerName];
    if (!props) return;
canvas.dataset.layerName = layerName;
    const layer_index = parseInt(layerName.split("_")[1]);
    const total_layers = Object.keys(this.layer_properties).length;
    
    ctx.fillStyle = !props.layer_collapsed ? "#4CAF50" : LiteGraph.WIDGET_TEXT_COLOR;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "14px Arial";
    const triangle = props.layer_collapsed ? "▶" : "▼";
    const textMaxWidth = moveIconX - (padding * 3) - 24;
    ctx.fillText(`${triangle} Layer ${layer_index}`, 5, textY, textMaxWidth);
    const trashSize = 36;
    const trashX = moveIconX - trashSize - padding;
    const trashY = topPadding + (thumbSize - trashSize) / 2;
    props.trash_icon_bounds = { x: trashX, y: trashY, size: trashSize };
    ctx.save();
    ctx.translate(trashX, trashY);
    ctx.scale(trashSize / 24, trashSize / 24);
    ctx.strokeStyle = "#F44336";
    ctx.lineWidth = 2;
    ctx.stroke(trashIconPath);
    ctx.restore();
    
    const moveIconY = topPadding + (thumbSize - moveIconSize) / 2;
    const isMoving = this.movingLayer === layerName;
	const isMoveDisabled = props.resize_mode !== 'crop' || 
          (this.toolbar && (this.toolbar.activeTool || this.toolbar.selectionSubMenu?.style.display === 'flex'));
    ctx.save();
    ctx.translate(moveIconX, moveIconY);
    ctx.scale(moveIconSize / 24, moveIconSize / 24);
	
	ctx.strokeStyle = isMoving ? "#F44" : (isMoveDisabled ? "#555" : LiteGraph.WIDGET_TEXT_COLOR);
    ctx.lineWidth = 2;
    ctx.stroke(moveIconPath);
    ctx.restore();

    const isFirst = layer_index <= 1;
    const isLast = layer_index >= total_layers;
    const arrowUpY = topPadding + (thumbSize / 2 - arrowSize) + 4;
    const arrowDownY = topPadding + (thumbSize / 2) - 4;
    ctx.save();
    ctx.translate(arrowBlockX, arrowUpY);
    ctx.strokeStyle = isFirst ? "#555" : LiteGraph.WIDGET_TEXT_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke(arrowUpPath);
    ctx.restore();
    ctx.save();
    ctx.translate(arrowBlockX, arrowDownY);
    ctx.strokeStyle = isLast ? "#555" : LiteGraph.WIDGET_TEXT_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke(arrowDownPath);
    ctx.restore();

    const lockY = topPadding + (thumbSize - lockSize) / 2;
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
        destY = thumbY + (thumbSize - destHeight) / 2;
        ctx.drawImage(layerImage, 0, 0, layerImage.naturalWidth, layerImage.naturalHeight, destX, destY, destWidth, destHeight);
    }
    
    const eyeY = topPadding + (thumbSize - eyeSize) / 2;
    ctx.save();
    ctx.translate(eyeX, eyeY);
    ctx.scale(eyeSize / 24, eyeSize / 24);
    ctx.strokeStyle = props.enabled ? "#4CAF50" : "#F44";
    ctx.lineWidth = 1.5;
    ctx.stroke(eyeIconPath);
    if (!props.enabled) { ctx.stroke(eyeSlashPath); }
    ctx.restore();
    };
    
nodeType.prototype.handleBaseImageReplace = function() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';
    fileInput.onchange = async (e) => {
        if (!e.target.files.length) { 
            document.body.removeChild(fileInput); 
            return; 
        }
        const originalFile = e.target.files[0];
        try {
            const staticFilename = "layersystem_base.png";
            const newFile = new File([originalFile], staticFilename, { type: originalFile.type });
            const formData = new FormData();
            formData.append('image', newFile);
            formData.append('overwrite', 'true');
            formData.append('type', 'input');
            
            const response = await fetch('/upload/image', { method: 'POST', body: formData });
            const data = await response.json();
            
            this.base_image_properties = { filename: data.name, details: data };
            this.updatePropertiesJSON();
            app.queuePrompt();
        } catch (error) {
            console.error("[Layer System] Error replacing base image:", error);
        } finally {
            document.body.removeChild(fileInput);
        }
    };
    document.body.appendChild(fileInput);
    fileInput.click();
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
    this.updateLayerWidgets();
    const activeLayerKeys = Object.keys(this.layer_properties);
    const activeLayers = new Set(activeLayerKeys);
    
    const baseAnchor = this.widgets.find(w => w.name === `header_anchor_1`);
    if (baseAnchor) {
        if (this.base_image_properties) {
            baseAnchor.hidden = false;
            baseAnchor.computeSize = (width) => [width, 64];
            if (baseAnchor.canvas) {
                this.drawHeaderCanvas(baseAnchor.canvas, 'base_image');
            }
        } else {
            baseAnchor.hidden = true;
            baseAnchor.computeSize = () => [0, -4];
        }
    }

    for (let i = 2; i <= MAX_LAYERS; i++) {
        const layerName = `layer_${i - 1}`;
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

    if (!this.base_image_properties && activeLayerKeys.length === 1) {
        const layerName = activeLayerKeys[0];
        if (this.layer_properties[layerName]) {
            this.layer_properties[layerName].layer_collapsed = false;
            this.updateLayerVisibility(layerName);
        }
    }

    if (this.toolbar) {
        if (this.toolbar.activeTool === 'mask') {
            this.toolbar.maskManager.show();
        } else {
            this.toolbar.maskManager.hide();
        }
    }
    
    this.updatePropertiesJSON();
    resizeHeight.call(this);
};
        
nodeType.prototype.moveLayer = function(layer_index, direction) {
    let layers_array = Object.entries(this.layer_properties).map(([name, props]) => {
        const maskName = name.replace('layer_', 'mask_');
        return {
            name,
            props,
            preview_img: this.loaded_preview_images ? this.loaded_preview_images[name] : null,
            preview_data: this.preview_data ? this.preview_data[name] : null,
            mask_img: this.loaded_preview_images ? this.loaded_preview_images[maskName] : null,
            mask_data: this.preview_data ? this.preview_data[maskName] : null
        };
    });

    const fromIndex = layers_array.findIndex(l => l.name === `layer_${layer_index}`);
    if (fromIndex === -1) return;

    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    const element = layers_array.splice(fromIndex, 1)[0];
    layers_array.splice(toIndex, 0, element);
    this.layer_properties = {};
    const old_loaded_preview_images = this.loaded_preview_images || {};
    const old_preview_data = this.preview_data || {};
    this.loaded_preview_images = { base_image: old_loaded_preview_images['base_image'] };
    this.preview_data = { base_image: old_preview_data['base_image'] };
    layers_array.forEach((layer, index) => {
        const newLayerName = `layer_${index + 1}`;
        const newMaskName = `mask_${index + 1}`;
        this.layer_properties[newLayerName] = layer.props;
        if (layer.preview_img) this.loaded_preview_images[newLayerName] = layer.preview_img;
        if (layer.preview_data) this.preview_data[newLayerName] = layer.preview_data;
        if (layer.mask_img) this.loaded_preview_images[newMaskName] = layer.mask_img;
        if (layer.mask_data) this.preview_data[newMaskName] = layer.mask_data;
        if (this.movingLayer === layer.name) {
            this.movingLayer = newLayerName;
        }
    });
    this.updatePropertiesJSON();
    this.refreshUI();
    this.redrawPreviewCanvas();
};
nodeType.prototype.addLayerWidgets = function(layer_name) {
    if (!this.layer_properties[layer_name]) {
        this.layer_properties[layer_name] = {
            blend_mode: "normal", opacity: 1.0, enabled: true, resize_mode: "crop", scale: 1.0, offset_x: 0, offset_y: 0,
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
    this.widgets = this.widgets.filter(w => 
        w.name.includes("_anchor") || 
        w.name === "_properties_json" ||
        w.name === "Add Image" ||
        w.name === "global_top_spacer"
    );
    
    const activeLayerKeys = Object.keys(this.layer_properties);
    activeLayerKeys.sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));
    
    for (const layerName of activeLayerKeys) {
        this.addLayerWidgets(layerName);
    }
};

nodeType.prototype.getActiveLayer = function() {
    if (!this.layer_properties) return null;
    const openLayerName = Object.keys(this.layer_properties).find(name => this.layer_properties[name]?.layer_collapsed === false);
    if (openLayerName) {
        const layerIndex = parseInt(openLayerName.split("_")[1]);
        const displayIndex = this.layer_order ? this.layer_order.indexOf(openLayerName) + 1 : layerIndex;
        return { name: openLayerName, index: layerIndex, displayIndex: displayIndex };
    }
    return null;
};

nodeType.prototype.handleDisconnectedInputs = function() {
    const connected_layer_names = new Set(this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).map(i => i.name));
    const inputs_to_remove = [];
    const props_to_remove = [];
    for (const key in this.layer_properties) {
        if (!connected_layer_names.has(key)) {
            props_to_remove.push(key);
            const layer_input = this.inputs.find(i => i.name === key);
            if(layer_input) inputs_to_remove.push(layer_input);
            const mask_input = this.inputs.find(i => i.name === key.replace("layer_", "mask_"));
            if(mask_input) inputs_to_remove.push(mask_input);
        }
    }
    props_to_remove.forEach(key => delete this.layer_properties[key]);
    inputs_to_remove.sort((a,b) => this.inputs.indexOf(b) - this.inputs.indexOf(a)).forEach(i => this.removeInput(this.inputs.indexOf(i)));
    
    const final_props = {};
    const final_images = {};
    const final_data = {};
    for (const key in this.loaded_preview_images) {
        if (!key.startsWith("layer_") && !key.startsWith("mask_")) {
            final_images[key] = this.loaded_preview_images[key];
        }
    }
    if (this.preview_data) {
        for (const key in this.preview_data) {
            if (!key.startsWith("layer_") && !key.startsWith("mask_")) {
                final_data[key] = this.preview_data[key];
            }
        }
    }
    
    const remaining_layers = this.inputs.filter(i => i.name.startsWith("layer_"));
    remaining_layers.sort((a, b) => this.inputs.indexOf(a) - this.inputs.indexOf(b));
    remaining_layers.forEach((input, i) => {
        const old_name = input.name;
        const new_name = `layer_${i + 1}`;
        const old_mask_name = old_name.replace("layer_", "mask_");
        const new_mask_name = new_name.replace("layer_", "mask_");
        if (this.layer_properties[old_name]) {
            final_props[new_name] = this.layer_properties[old_name];
        }
        
        if (this.loaded_preview_images[old_name]) {
            final_images[new_name] = this.loaded_preview_images[old_name];
        }
        if (this.loaded_preview_images[old_mask_name]) {
            final_images[new_mask_name] = this.loaded_preview_images[old_mask_name];
        }
        if (this.preview_data && this.preview_data[old_name]) {
            final_data[new_name] = this.preview_data[old_name];
        }
        if (this.preview_data && this.preview_data[old_mask_name]) {
            final_data[new_mask_name] = this.preview_data[old_mask_name];
        }
        input.name = new_name;
        const mask_input = this.inputs.find(m => m.name === old_mask_name);
        if (mask_input) {
            mask_input.name = new_mask_name;
        }
    });
    this.layer_properties = final_props;
    this.loaded_preview_images = final_images;
    this.preview_data = final_data;
    
    const finalLayerNames = Object.keys(this.layer_properties);
    if (finalLayerNames.length > 0) {
        const isAnyLayerExpanded = finalLayerNames.some(name =>
            !this.layer_properties[name].layer_collapsed
        );
        if (!isAnyLayerExpanded) {
            this.layer_properties[finalLayerNames[0]].layer_collapsed = false;
        }
    }
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
 
nodeType.prototype.handleInternalImageLoad = function() {
    if (Object.keys(this.layer_properties).length >= MAX_LAYERS) {
        alert(`Maximum number of layers (${MAX_LAYERS}) reached.`);
        return;
    }
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';

    fileInput.onchange = async (e) => {
        if (!e.target.files.length) { 
            document.body.removeChild(fileInput); 
            return; 
        }
        const originalFile = e.target.files[0];

        try {
            const isBaseImage = !this.base_image_properties;
            const timestamp = Date.now();
            const staticFilename = isBaseImage ? "layersystem_base.png" : `layersystem_${timestamp}.png`;

            const localUrl = URL.createObjectURL(originalFile);
            const newImage = new Image();
            newImage.src = localUrl;
            await new Promise(resolve => newImage.onload = resolve);

            const newFile = new File([originalFile], staticFilename, { type: originalFile.type });
            const formData = new FormData();
            formData.append('image', newFile);
            formData.append('overwrite', 'true');
            formData.append('type', 'input');
            const response = await fetch('/upload/image', { method: 'POST', body: formData });
            const data = await response.json();

            if (isBaseImage) {
                this.base_image_properties = { filename: data.name, details: data };
                this.loaded_preview_images['base_image'] = newImage;
                this.basePreviewImage = newImage;
            } else {
                const existingIndices = new Set(Object.keys(this.layer_properties).map(k => parseInt(k.split('_')[1])));
                let newIndex = 1;
                while (existingIndices.has(newIndex)) { newIndex++; }
                const layerName = `layer_${newIndex}`;

                if (this.accordionMode) {
                    for (const key in this.layer_properties) {
                        this.layer_properties[key].layer_collapsed = true;
                    }
                }
                this.layer_properties[layerName] = {
                    source_filename: data.name,
                    source_details: data,
                    blend_mode: "normal", opacity: 1.0, enabled: true, resize_mode: "crop", scale: 1.0, offset_x: 0, offset_y: 0,
                    rotation: 0.0, brightness: 0.0, contrast: 0.0, color_r: 1.0, color_g: 1.0, color_b: 1.0, saturation: 1.0,
                    invert_mask: false, color_section_collapsed: true, layer_collapsed: false,
                };
                this.loaded_preview_images[layerName] = newImage;
            }
            
            this.updatePropertiesJSON();
            this.refreshUI();
            this.redrawPreviewCanvas();

        } catch (error) {
            console.error("Error uploading file:", error);
        } finally {
            document.body.removeChild(fileInput);
        }
    };
    document.body.appendChild(fileInput);
    fileInput.click();
};

nodeType.prototype.deleteLayer = function(layerNameToDelete) {
    if (this.movingLayer === layerNameToDelete) {
        this.movingLayer = null;
    }

    const layerToDeleteProps = this.layer_properties[layerNameToDelete];
    if (layerToDeleteProps && layerToDeleteProps.source_details) {
        const fileDetails = layerToDeleteProps.source_details;
        const deleteFileOnServer = async (details) => {
            try {
                if (!details || !details.name) return;
                await fetch("/layersystem/delete_file", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: details.name, subfolder: details.subfolder }),
                });
            } catch (e) { console.error("Failed to delete file:", e); }
        };
        deleteFileOnServer(fileDetails);
        if (layerToDeleteProps.internal_mask_details) deleteFileOnServer(layerToDeleteProps.internal_mask_details);
        if (layerToDeleteProps.internal_preview_mask_details) deleteFileOnServer(layerToDeleteProps.internal_preview_mask_details);
    }
    
    const layersToKeep = [];
    const sortedKeys = Object.keys(this.layer_properties).sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));
    
    for (const name of sortedKeys) {
        if (name !== layerNameToDelete) {
            const maskName = name.replace('layer_', 'mask_');
            layersToKeep.push({
                props: JSON.parse(JSON.stringify(this.layer_properties[name])),
                preview_img: this.loaded_preview_images[name],
                preview_data: this.preview_data[name] ? JSON.parse(JSON.stringify(this.preview_data[name])) : undefined,
                mask_img: this.loaded_preview_images[maskName],
                mask_data: this.preview_data[maskName] ? JSON.parse(JSON.stringify(this.preview_data[maskName])) : undefined,
            });
        }
    }

    const new_layer_properties = {};
    const new_loaded_preview_images = { base_image: this.loaded_preview_images.base_image };
    const new_preview_data = { base_image: this.preview_data.base_image };

    layersToKeep.forEach((layer, index) => {
        const newLayerName = `layer_${index + 1}`;
        const newMaskName = `mask_${index + 1}`;
        new_layer_properties[newLayerName] = layer.props;
        if (layer.preview_img) new_loaded_preview_images[newLayerName] = layer.preview_img;
        if (layer.preview_data) new_preview_data[newLayerName] = layer.preview_data;
        if (layer.mask_img) new_loaded_preview_images[newMaskName] = layer.mask_img;
        if (layer.mask_data) new_preview_data[newMaskName] = layer.mask_data;
    });
    
    this.layer_properties = new_layer_properties;
    this.loaded_preview_images = new_loaded_preview_images;
    this.preview_data = new_preview_data;

    this.updatePropertiesJSON();
    this.refreshUI();
    this.redrawPreviewCanvas();
};
 
 nodeType.prototype.logFullState = function(label) {
    console.log(`\n\n--- DEBUG STATE: ${label} ---`);
    console.log("PROPRIÉTÉS DES CALQUES:", JSON.parse(JSON.stringify(this.layer_properties)));
    console.log("DONNÉES DE PREVIEW:", this.preview_data);
    console.log("--- FIN DEBUG STATE ---\n\n");
};
 
nodeType.prototype.updatePropertiesJSON = function() {
    const mainDataWidget = this.widgets.find(w => w.name === "_layer_system_data" || w.name === "_properties_json");
    if (mainDataWidget) {
        const full_properties = {
            base: this.base_image_properties,
            layers: this.layer_properties,
            texts: this.toolbar ? this.toolbar.getTexts() : [],
            preview_width: this.previewCanvas ? this.previewCanvas.width : 512,
            preview_height: this.previewCanvas ? this.previewCanvas.height : 512,
            toolbar_width: this.toolbar ? this.toolbar.width : 0
        };
        mainDataWidget.value = JSON.stringify(full_properties);
    }
    this.widgets.forEach(widget => {
        if (widget.name.includes("_anchor")) {
            widget.value = null;
        }
    });
   };
  },
});  