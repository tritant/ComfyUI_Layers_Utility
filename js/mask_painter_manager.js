export class MaskPainterManager {
    constructor(node) {
        this.node = node;
        this.isDrawing = false;
        this.lastPoint = { x: 0, y: 0 };
        this.settings = {
            size: 30,
            hardness: 80, // Le retour de la dureté !
            mode: 'brush'
        };

        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        
        this.liveOverlay = null;
        this.liveCtx = null;

        this.boundHandleMouseEvent = this.handleMouseEvent.bind(this);
        this.createSettingsToolbar();
    }

    createSettingsToolbar() {
        if (this.toolbar) this.toolbar.remove();
        this.toolbar = document.createElement("div");
        Object.assign(this.toolbar.style, {
            position: 'fixed', display: 'none', zIndex: '10002',
            backgroundColor: 'rgba(40, 40, 40, 0.9)', border: '1px solid #555',
            borderRadius: '8px', padding: '8px', alignItems: 'center',
            gap: '8px', color: 'white', fontFamily: 'sans-serif'
        });

        this.toolbar.innerHTML = `
            <label>Size:</label>
            <input type="range" min="1" max="500" value="${this.settings.size}" data-setting="size" style="width: 80px;">
            <span style="min-width: 30px;" data-value="size">${this.settings.size}</span>
            <label style="margin-left: 10px;">Hardness:</label>
            <input type="range" min="0" max="100" value="${this.settings.hardness}" data-setting="hardness" style="width: 80px;">
            <span style="min-width: 30px;" data-value="hardness">${this.settings.hardness}%</span>
            <button data-mode="brush" title="Brush (Reveal)" style="font-size: 18px; border: 2px solid white; border-radius: 4px; background: black; color: white;">🖌️</button>
            <button data-mode="eraser" title="Eraser (Hide)" style="font-size: 18px; border: 1px solid gray; border-radius: 4px; background: white; color: black;">🧼</button>
            <button data-action="apply" style="margin-left: 15px; background-color: #4CAF50; color: white; border: none; padding: 5px 10px; cursor: pointer;">Apply Mask</button>
            <button data-action="cancel" style="margin-left: 5px; background-color: #f44336; color: white; border: none; padding: 5px 10px; cursor: pointer;">Cancel</button>
        `;
        document.body.appendChild(this.toolbar);

        this.toolbar.addEventListener('input', (e) => {
            const setting = e.target.dataset.setting;
            if (setting) {
                this.settings[setting] = parseInt(e.target.value, 10);
                const suffix = setting === 'hardness' ? '%' : '';
                this.toolbar.querySelector(`span[data-value="${setting}"]`).textContent = e.target.value + suffix;
            }
        });

        this.toolbar.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            if (target.dataset.mode) {
                this.settings.mode = target.dataset.mode;
                this.toolbar.querySelector('[data-mode="brush"]').style.border = `2px solid ${this.settings.mode === 'brush' ? 'white' : 'gray'}`;
                this.toolbar.querySelector('[data-mode="eraser"]').style.border = `2px solid ${this.settings.mode === 'eraser' ? 'white' : 'gray'}`;
            }
            if (target.dataset.action === 'apply') this.finalizeDrawing();
            if (target.dataset.action === 'cancel') this.hide();
        });
    }

async show() {
    this.activeLayer = this.node.getActiveLayer();
    if (!this.activeLayer) {
        alert("Please select a layer to paint a mask on.");
        return;
    }

    const layerImage = this.node.loaded_preview_images[this.activeLayer.name];
    if (!layerImage || !layerImage.naturalWidth) return;

    // On éteint le calque dans le rendu principal
    const props = this.node.layer_properties[this.activeLayer.name];
    props.enabled = false;
    this.node.refreshUI();

    const preview = this.node.previewCanvas;
    this.maskCanvas.width = layerImage.naturalWidth;
    this.maskCanvas.height = layerImage.naturalHeight;
    
    this.liveOverlay = document.createElement('canvas');
    Object.assign(this.liveOverlay.style, {
        position: 'absolute', top: '0', left: '0',
        zIndex: '10001', pointerEvents: 'auto', cursor: 'none'
    });
    this.liveOverlay.width = preview.width;
    this.liveOverlay.height = preview.height;
    this.liveCtx = this.liveOverlay.getContext('2d');
    preview.parentElement.appendChild(this.liveOverlay);

    this.liveOverlay.addEventListener('mousedown', this.boundHandleMouseEvent);
    this.liveOverlay.addEventListener('mousemove', this.boundHandleMouseEvent);
    this.liveOverlay.addEventListener('mouseup', this.boundHandleMouseEvent);
    this.liveOverlay.addEventListener('mouseleave', this.boundHandleMouseEvent);

    this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    
    if (props.internal_mask_details) {
        const details = props.internal_mask_details;
        const url = new URL("/view", window.location.origin);
        url.searchParams.set("filename", details.name);
        url.searchParams.set("type", details.type);
        url.searchParams.set("t", Date.now());
        const existingMask = new Image();
        existingMask.crossOrigin = "anonymous";
        existingMask.src = url.href;
        await new Promise(resolve => { existingMask.onload = resolve; existingMask.onerror = resolve; });

        const tempCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        tempCtx.canvas.width = this.maskCanvas.width;
        tempCtx.canvas.height = this.maskCanvas.height;
        tempCtx.drawImage(existingMask, 0, 0, tempCtx.canvas.width, tempCtx.canvas.height);
        const imageData = tempCtx.getImageData(0, 0, tempCtx.canvas.width, tempCtx.canvas.height);
        const data = imageData.data;

        let hasAlpha = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                hasAlpha = true;
                break;
            }
        }

        if (hasAlpha) {
            // CAS 1 : Masque de l'éditeur (RGBA). Ton test prouve qu'il faut inverser sa transparence.
            for (let i = 0; i < data.length; i += 4) {
                data[i + 3] = 255 - data[i + 3]; // On inverse le canal alpha existant
                data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; // Et on normalise le RGB
            }
        } else {
            // CAS 2 : Masque de notre outil (RGB Noir/Blanc). Cette logique est correcte et n'inverse pas.
            for (let i = 0; i < data.length; i += 4) {
                data[i + 3] = 255 - data[i]; // alpha = 255 - luminance
                data[i] = data[i+1] = data[i+2] = 255;
            }
        }
        this.maskCtx.putImageData(imageData, 0, 0);

    } else {
        // Un nouveau masque est entièrement opaque (calque visible).
        this.maskCtx.fillStyle = 'white';
        this.maskCtx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    }
    
    this.updateLivePreview();
    this.toolbar.style.display = 'flex';
    this.positionToolbar();
}

    drawStamp(point) {
        const ctx = this.maskCtx;
        const radius = this.settings.size / 2;
        const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
        // La dureté (0-100) contrôle où le dégradé devient transparent
        const hardnessStop = Math.max(0, Math.min(1, this.settings.hardness / 100));
    
        // Pinceau (Révéler) -> Peint de l'opaque avec 'source-over'
        if (this.settings.mode === 'brush') {
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(hardnessStop, 'white');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = gradient;
        
        // Gomme (Cacher) -> Efface vers le transparent avec 'destination-out'
        } else {
            gradient.addColorStop(0, 'black'); // La couleur n'importe pas
            gradient.addColorStop(hardnessStop, 'black');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = gradient;
        }
        
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.globalCompositeOperation = 'source-over';
    }

    hide() {
        if (this.activeLayer) {
            const props = this.node.layer_properties[this.activeLayer.name];
            if (props) {
                props.enabled = true; // On rallume le calque
				this.node.updatePropertiesJSON();
            }
        }
        this.toolbar.style.display = 'none';
        if (this.liveOverlay) {
            this.liveOverlay.remove();
            this.liveOverlay = null;
            this.liveCtx = null;
        }
        if (this.node.toolbar.activeTool === 'mask_painter') {
            this.node.toolbar.activeTool = null;

        }
        this.node.refreshUI();
    }

async finalizeDrawing() {
    const applyButton = this.toolbar.querySelector('[data-action="apply"]');
    applyButton.textContent = "Applying...";
    applyButton.disabled = true;

    try {
        const blob = await new Promise(resolve => this.maskCanvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], `temp_alpha_mask_${this.activeLayer.index}.png`, { type: "image/png" });
        const formData = new FormData();
        formData.append("image", file);
        formData.append("overwrite", "true");
        
        // --- CORRECTION ---
        // On sauvegarde le fichier temporaire dans 'input' au lieu de 'temp'
        formData.append("type", "input");
        // --- FIN CORRECTION ---

        let response = await fetch("/upload/image", { method: "POST", body: formData });
        const tempAlphaMaskDetails = await response.json();

        response = await fetch("/layersystem/finalize_painter_mask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                alpha_mask_details: tempAlphaMaskDetails,
                layer_index: this.activeLayer.index
            }),
        });
        
        if (!response.ok) {
            throw new Error(`Server error: ${await response.text()}`);
        }
        const finalMasks = await response.json();
        
        const props = this.node.layer_properties[this.activeLayer.name];
        props.internal_mask_filename = finalMasks.render_mask_details.name;
        props.internal_mask_details = finalMasks.render_mask_details;
        props.internal_preview_mask_details = finalMasks.preview_mask_details;
        props.mask_last_update = Date.now();
        this.node.updatePropertiesJSON();

        const newMaskImage = new Image();
        const previewUrl = new URL("/view", window.location.origin);
        previewUrl.searchParams.set("filename", finalMasks.preview_mask_details.name);
        previewUrl.searchParams.set("type", "input");
        previewUrl.searchParams.set("t", props.mask_last_update);
        newMaskImage.src = previewUrl.href;

        await new Promise(resolve => newMaskImage.onload = resolve);
        this.node.loaded_preview_images[this.activeLayer.name.replace('layer_', 'mask_')] = newMaskImage;

    } catch (e) {
        console.error("Failed to apply mask drawing:", e);
    } finally {
        applyButton.textContent = "Apply Mask";
        applyButton.disabled = false;
        this.hide();
    }
}
    
    getOriginalCoords(e) {
        const props = this.node.layer_properties[this.activeLayer.name];
        const layerImage = this.node.loaded_preview_images[this.activeLayer.name];
        const preview = this.node.previewCanvas;
        const toolbar = this.node.toolbar;
        const baseImage = this.node.basePreviewImage;
        const previewCanvasScale = (preview.width - toolbar.width) / baseImage.naturalWidth;
        const imageAreaCenterX = toolbar.width + (preview.width - toolbar.width) / 2;
        const imageAreaCenterY = preview.height / 2;
        const transformedWidth = layerImage.naturalWidth * props.scale * previewCanvasScale;
        const transformedHeight = layerImage.naturalHeight * props.scale * previewCanvasScale;
        const centerX = imageAreaCenterX + (props.offset_x * previewCanvasScale);
        const centerY = imageAreaCenterY + (props.offset_y * previewCanvasScale);
        const dx = e.offsetX - centerX;
        const dy = e.offsetY - centerY;
        const angleRad = -(props.rotation || 0) * Math.PI / 180;
        const unrotatedDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
        const unrotatedDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
        const localX = unrotatedDx + transformedWidth / 2;
        const localY = unrotatedDy + transformedHeight / 2;
        return {
            x: localX / (transformedWidth / layerImage.naturalWidth),
            y: localY / (transformedHeight / layerImage.naturalHeight)
        };
    }

    handleMouseEvent(e) {
        if (!this.activeLayer) return;

    // --- DÉBUT DE LA CORRECTION ---
    // On calcule la position du clic par rapport au canvas principal en dessous
    const mainCanvasRect = this.node.previewCanvas.getBoundingClientRect();
    const zoom = app.canvas.ds.scale || 1;
    const clickX_on_main_canvas = (e.clientX - mainCanvasRect.left) / zoom;
    const clickY_on_main_canvas = (e.clientY - mainCanvasRect.top) / zoom;

    // Si c'est un clic sur la barre d'outils principale, on lui passe l'événement et on s'arrête.
    if (e.type === 'mousedown' && this.node.toolbar.isClickOnToolbar(clickX_on_main_canvas, clickY_on_main_canvas)) {
        this.node.toolbar.handleClick(e, clickX_on_main_canvas, clickY_on_main_canvas);
        return;
    }
    // --- FIN DE LA CORRECTION ---
		
        if (e.type === 'mousedown') {
            this.isDrawing = true;
            const coords = this.getOriginalCoords(e);
            this.lastPoint = coords;
            this.drawStamp(coords);
        } else if (e.type === 'mousemove') {
            if (this.isDrawing) {
                const coords = this.getOriginalCoords(e);
                this.drawStroke(this.lastPoint, coords);
                this.lastPoint = coords;
            }
        } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
            this.isDrawing = false;
        }
        this.updateLivePreview(e);
    }
    
    drawStroke(from, to) {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const step = this.settings.size / 4;
        for (let i = 0; i < dist; i += step) {
            const x = from.x + (Math.cos(angle) * i);
            const y = from.y + (Math.sin(angle) * i);
            this.drawStamp({ x, y });
        }
        this.drawStamp(to);
    }
    
    updateLivePreview(mouseEvent = null) {
        if (!this.liveCtx) return;
        this.liveCtx.clearRect(0, 0, this.liveOverlay.width, this.liveOverlay.height);

        // On ne dessine plus le fond, il est déjà visible en dessous !

        const tempLayerCanvas = document.createElement('canvas');
        tempLayerCanvas.width = this.maskCanvas.width;
        tempLayerCanvas.height = this.maskCanvas.height;
        const tempLayerCtx = tempLayerCanvas.getContext('2d');
        
        const layerImage = this.node.loaded_preview_images[this.activeLayer.name];
        tempLayerCtx.drawImage(layerImage, 0, 0);
        tempLayerCtx.globalCompositeOperation = 'destination-in';
        tempLayerCtx.drawImage(this.maskCanvas, 0, 0);

        const props = this.node.layer_properties[this.activeLayer.name];
        const preview = this.node.previewCanvas;
        const toolbar = this.node.toolbar;
        const baseImage = this.node.basePreviewImage;
        const previewCanvasScale = (preview.width - toolbar.width) / baseImage.naturalWidth;
        const imageAreaCenterX = toolbar.width + (preview.width - toolbar.width) / 2;
        const imageAreaCenterY = preview.height / 2;
        const transformedWidth = layerImage.naturalWidth * props.scale * previewCanvasScale;
        const transformedHeight = layerImage.naturalHeight * props.scale * previewCanvasScale;
        const centerX = imageAreaCenterX + (props.offset_x * previewCanvasScale);
        const centerY = imageAreaCenterY + (props.offset_y * previewCanvasScale);
        const angleRad = (props.rotation || 0) * Math.PI / 180;

        this.liveCtx.save();
        this.liveCtx.translate(centerX, centerY);
        this.liveCtx.rotate(angleRad);
        this.liveCtx.drawImage(tempLayerCanvas, -transformedWidth / 2, -transformedHeight / 2, transformedWidth, transformedHeight);
        this.liveCtx.restore();
        
        if (mouseEvent) {
            const previewSize = (this.settings.size / this.maskCanvas.width) * transformedWidth;
            this.liveCtx.beginPath();
            this.liveCtx.arc(mouseEvent.offsetX, mouseEvent.offsetY, previewSize / 2, 0, 2 * Math.PI);
            this.liveCtx.strokeStyle = 'white';
            this.liveCtx.lineWidth = 1;
            this.liveCtx.setLineDash([2, 2]);
            this.liveCtx.stroke();
            this.liveCtx.setLineDash([]);
        }
    }
    
    positionToolbar() {
        if (!this.node.previewCanvas) return;
        const canvasRect = this.node.previewCanvas.getBoundingClientRect();
        this.toolbar.style.left = `${canvasRect.left}px`;
        this.toolbar.style.top = `${canvasRect.top - this.toolbar.offsetHeight - 5}px`;
    }
}