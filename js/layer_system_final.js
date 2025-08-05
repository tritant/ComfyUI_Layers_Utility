import { app } from "/scripts/app.js";

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft_light", "hard_light", "difference", "color_dodge", "color_burn"];
const RESIZE_MODES = ["stretch", "fit", "cover", "crop"];

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
            setTimeout(() => {
                const p_widget = this.widgets.find(w => w.name === "_properties_json");
                if(p_widget) {
                    p_widget.hidden = true;
                    p_widget.computeSize = () => [0, -4];
                }
                const anchorWidget = this.widgets.find(w => w.name === "_preview_anchor");
                if (anchorWidget && anchorWidget.inputEl) {
                    const canvas = document.createElement("canvas");
                    const container = anchorWidget.inputEl.parentElement;
                    container.style.padding = "0px";
                    container.style.margin = "0px";
                    container.replaceChild(canvas, anchorWidget.inputEl);
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
                this.refreshUI();
            }, 0);
        };
        
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function(size) {
            onResize?.apply(this, arguments);
            if (this.previewCanvas) {
                if (this.redraw_req) cancelAnimationFrame(this.redraw_req);
                this.redraw_req = requestAnimationFrame(() => {
                    this.redrawPreviewCanvas();
                    this.redraw_req = null;
                });
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
            let destWidth;
            if (imgRatio > canvasRatio) {
                destWidth = canvas.width;
            } else {
                destWidth = canvas.height * imgRatio;
            }
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

                    let final_sx = 0, final_sy = 0, final_sw = layerImage.naturalWidth, final_sh = layerImage.naturalHeight;
                    let final_dx = destX, final_dy = destY, final_dw = destWidth, final_dh = destHeight;
                    if (props.resize_mode === 'crop') {
                        final_dx = destX + (props.offset_x * this.previewCanvasScale);
                        final_dy = destY + (props.offset_y * this.previewCanvasScale);
                        final_dw = final_sw * props.scale * this.previewCanvasScale;
                        final_dh = final_sh * props.scale * this.previewCanvasScale;
                    } else { 
                        const layerRatio = layerImage.naturalWidth / layerImage.naturalHeight;
                        const destContainerRatio = destWidth / destHeight;
                        switch(props.resize_mode) {
                            case 'fit':
                                if (layerRatio > destContainerRatio) { final_dh = final_dw / layerRatio; final_dy += (destHeight - final_dh) / 2; } 
                                else { final_dw = final_dh * layerRatio; final_dx += (destWidth - final_dw) / 2; }
                                break;
                            case 'cover':
                                if (layerRatio > destContainerRatio) { final_sw = final_sh * destContainerRatio; final_sx = (layerImage.naturalWidth - final_sw) / 2; } 
                                else { final_sh = final_sw / destContainerRatio; final_sy = (layerImage.naturalHeight - final_sh) / 2; }
                                break;
                            case 'stretch': default: break;
                        }
                    }

                    if (props.invert_mask) {
                        // LOGIQUE FINALE - Selon votre idée : un pochoir noir.
                        
                        // 1. Créer une toile temporaire pour le pochoir noir
                        const stencilCanvas = document.createElement('canvas');
                        stencilCanvas.width = canvas.width;
                        stencilCanvas.height = canvas.height;
                        const stencilCtx = stencilCanvas.getContext('2d');

                        // 2. Remplir cette toile en noir
                        stencilCtx.fillStyle = 'black';
                        stencilCtx.fillRect(0, 0, stencilCanvas.width, stencilCanvas.height);

                        // 3. Faire un trou dans le noir en utilisant la forme du calque
                        stencilCtx.globalCompositeOperation = 'destination-out';
                        stencilCtx.drawImage(layerImage, final_sx, final_sy, final_sw, final_sh, final_dx, final_dy, final_dw, final_dh);

                        // 4. Dessiner ce pochoir par-dessus le canvas principal
                        // On respecte l'opacité générale du calque, mais pas le mode de fusion.
                        ctx.globalAlpha = props.opacity;
                        ctx.globalCompositeOperation = 'source-over'; // 'normal'
                        ctx.drawImage(stencilCanvas, 0, 0);

                    } else {
                        // Comportement normal
                        ctx.globalAlpha = props.opacity;
                        ctx.globalCompositeOperation = props.blend_mode === 'normal' ? 'source-over' : props.blend_mode;
                        ctx.drawImage(imageToDraw, final_sx, final_sy, final_sw, final_sh, final_dx, final_dy, final_dw, final_dh);
                    }

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

        nodeType.prototype.refreshUI = function() {
            for (const input of this.inputs) {
                if (input.link !== null && (input.type === "*" || Array.isArray(input.type))) {
                    const link = this.graph.links[input.link];
                    if (link) {
                        const originNode = this.graph.getNodeById(link.origin_id);
                        if (originNode?.outputs[link.origin_slot]) { input.type = originNode.outputs[link.origin_slot].type; }
                    }
                }
            }
            this.handleDisconnectedInputs();
            this.updateLayerWidgets();
            this.ensureWildcardInputs();
            this.updatePropertiesJSON();
            resizeHeight.call(this);
        };
        
        nodeType.prototype.moveLayer = function(layer_index, direction) {
            const swap_index = direction === "up" ? layer_index - 1 : layer_index + 1;
            const name_A = `layer_${layer_index}`, name_B = `layer_${swap_index}`;
            const mask_name_A = name_A.replace("layer_", "mask_"), mask_name_B = name_B.replace("layer_", "mask_");
            const input_A = this.inputs.find(i => i.name === name_A), input_B = this.inputs.find(i => i.name === name_B);
            const mask_input_A = this.inputs.find(i => i.name === mask_name_A), mask_input_B = this.inputs.find(i => i.name === mask_name_B);
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
            this.refreshUI();
            this.redrawPreviewCanvas();
        };

        nodeType.prototype.addLayerWidgets = function(layer_name) {
            if (!this.layer_properties[layer_name]) {
                this.layer_properties[layer_name] = {
                    blend_mode: "normal", opacity: 1.0, enabled: true, resize_mode: "fit", scale: 1.0, offset_x: 0, offset_y: 0,
                    brightness: 0.0, contrast: 0.0, color_r: 1.0, color_g: 1.0, color_b: 1.0, saturation: 1.0, 
                    invert_mask: false, color_section_collapsed: true, layer_collapsed: false,
                };
            }
            const props = this.layer_properties[layer_name];
            const layer_index = parseInt(layer_name.split("_")[1]);
            const total_layers = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).length;
            if (layer_index > 1) {
                const spacer = this.addWidget("text", `spacer_for_${layer_name}`, "", null, {});
                spacer.draw = () => {}; spacer.computeSize = () => [0, 20];
            }
            const layerToggle = this.addWidget("toggle", `toggle_layer_${layer_name}`, !props.layer_collapsed, (v) => {
                props.layer_collapsed = !v; updateVisibility(); this.updatePropertiesJSON();
            }, { on: `▼ Layer ${layer_index} Settings`, off: `▶ Layer ${layer_index} Settings` });
            const collapsibleWidgets = [], colorWidgets = [], transformWidgets = [];
            collapsibleWidgets.push(this.addWidget("toggle", `enabled_${layer_name}`, props.enabled, (v) => { props.enabled = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {label: `Enabled`}));
            collapsibleWidgets.push(this.addWidget("combo", `blend_mode_${layer_name}`, props.blend_mode, (v) => { props.blend_mode = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {values: BLEND_MODES}));
            collapsibleWidgets.push(this.addWidget("number", `opacity_${layer_name}`, props.opacity, (v) => { props.opacity = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); }, {min: 0.0, max: 1.0, step: 0.1, precision: 2}));
            const colorToggle = this.addWidget("toggle", `toggle_color_${layer_name}`, !props.color_section_collapsed, (v) => {
                props.color_section_collapsed = !v; updateVisibility(); this.updatePropertiesJSON();
            }, { on: "▼ Color Adjust", off: "▶ Color Adjust" });
            collapsibleWidgets.push(colorToggle);
            const redrawCallback = (prop, v) => { props[prop] = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas(); };
            colorWidgets.push(this.addWidget("number", `brightness_${layer_name}`, props.brightness, (v) => redrawCallback('brightness', v), { label: "Brightness", min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
            colorWidgets.push(this.addWidget("number", `contrast_${layer_name}`, props.contrast, (v) => redrawCallback('contrast', v), { label: "Contrast", min: -1.0, max: 1.0, step: 0.1, precision: 2 }));
            colorWidgets.push(this.addWidget("number", `saturation_${layer_name}`, props.saturation, (v) => redrawCallback('saturation', v), { label: "Saturation", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            colorWidgets.push(this.addWidget("number", `color_r_${layer_name}`, props.color_r, (v) => redrawCallback('color_r', v), { label: "R", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            colorWidgets.push(this.addWidget("number", `color_g_${layer_name}`, props.color_g, (v) => redrawCallback('color_g', v), { label: "G", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            colorWidgets.push(this.addWidget("number", `color_b_${layer_name}`, props.color_b, (v) => redrawCallback('color_b', v), { label: "B", min: 0.0, max: 2.0, step: 0.1, precision: 2 }));
            collapsibleWidgets.push(...colorWidgets);
            
            collapsibleWidgets.push(this.addWidget("toggle", `invert_mask_${layer_name}`, !!props.invert_mask, (v) => { 
                props.invert_mask = v; this.updatePropertiesJSON(); this.redrawPreviewCanvas();
            }, { label: "Invert Mask" }));
            
            const resizeModeWidget = this.addWidget("combo", `resize_mode_${layer_name}`, props.resize_mode, (v) => {
                props.resize_mode = v; if (v !== 'crop' && this.movingLayer === layer_name) { this.movingLayer = null; }
                updateVisibility(); this.updatePropertiesJSON(); this.redrawPreviewCanvas();
            }, { values: RESIZE_MODES });
            collapsibleWidgets.push(resizeModeWidget);
            transformWidgets.push(this.addWidget("number", `scale_${layer_name}`, props.scale, (v) => redrawCallback('scale', v), { min: 0.01, max: 10.0, step: 0.1, precision: 2 }));
            transformWidgets.push(this.addWidget("number", `offset_x_${layer_name}`, props.offset_x, (v) => redrawCallback('offset_x', v), { min: -8192, max: 8192, step: 1 }));
            transformWidgets.push(this.addWidget("number", `offset_y_${layer_name}`, props.offset_y, (v) => redrawCallback('offset_y', v), { min: -8192, max: 8192, step: 1 }));
            collapsibleWidgets.push(...transformWidgets);
            
            const up_button = this.addWidget("button", "Up", null, () => { this.moveLayer(layer_index, "up"); });
            const down_button = this.addWidget("button", "Down", null, () => { this.moveLayer(layer_index, "down"); });
            const move_button = this.addWidget("button", "Move Calque", `move_btn_${layer_name}`, () => {
                if (this.movingLayer === layer_name) { this.movingLayer = null; move_button.name = "Move Calque"; } 
                else { if (this.movingLayer) { const old_button = this.widgets.find(w => w.name === `move_btn_${this.movingLayer}`); if (old_button) old_button.name = "Move Calque"; }
                    this.movingLayer = layer_name; move_button.name = "STOP";
                }
                this.redrawPreviewCanvas();
            });
            if (this.movingLayer === layer_name) { move_button.name = "STOP"; }
            for (const w of [...collapsibleWidgets, up_button, down_button, move_button]) { w.originalComputeSize = w.computeSize; }
            if (layer_index <= 1) up_button.disabled = true;
            if (layer_index >= total_layers) down_button.disabled = true;
            const updateVisibility = () => {
                const isLayerCollapsed = props.layer_collapsed, isColorCollapsed = props.color_section_collapsed, showTransformForCrop = props.resize_mode === 'crop';
                for(const w of collapsibleWidgets) {
                    let isHidden = isLayerCollapsed;
                    if (colorWidgets.includes(w)) { isHidden = isLayerCollapsed || isColorCollapsed; }
                    if (w === colorToggle) { isHidden = isLayerCollapsed; }
                    if (w.name.startsWith("scale_") || w.name.startsWith("offset_")) { isHidden = isLayerCollapsed || !showTransformForCrop; }
                    w.hidden = isHidden; w.computeSize = isHidden ? () => [0, -4] : w.originalComputeSize;
                }
                const showMoveButton = showTransformForCrop && !isLayerCollapsed;
                move_button.hidden = !showMoveButton; move_button.computeSize = !showMoveButton ? () => [0, -4] : move_button.originalComputeSize;
                resizeHeight.call(this);
            };
            updateVisibility();
        };
        
        nodeType.prototype.updateLayerWidgets = function() {
            this.widgets = this.widgets.filter(w => w.name === "_properties_json" || w.name === "_preview_anchor");
            const connectedInputs = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null);
            connectedInputs.sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
            for (const input of connectedInputs) { this.addLayerWidgets(input.name); }
            resizeHeight.call(this);
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
            const lastLayerInput = layerInputs.sort((a,b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1])).pop();
            if (!lastLayerInput || lastLayerInput.link !== null) {
                const newIndex = lastLayerInput ? parseInt(lastLayerInput.name.split("_")[1]) + 1 : 1;
                this.addInput(`layer_${newIndex}`, ["IMAGE", "MASK", "*"]);
                this.addInput(`mask_${newIndex}`, "MASK");
            }
        };
        nodeType.prototype.updatePropertiesJSON = function() { const p = this.widgets.find(w => w.name === "_properties_json"); if (p) { p.value = JSON.stringify(this.layer_properties); } };
    },
});