export class BrushManager {
    constructor(node) {
        this.node = node;
        this.isDrawing = false;
        this.lastPoint = { x: 0, y: 0 };
        this.settings = { size: 10, color: '#FFFFFF', mode: 'brush' };
        
        this.finalDrawingCanvas = document.createElement('canvas');
        this.finalDrawingCtx = this.finalDrawingCanvas.getContext('2d');

        this.liveDrawingOverlay = null;
        this.liveDrawingCtx = null;

        this.boundHandleMouseEvent = this.handleMouseEvent.bind(this);
        this.createSettingsToolbar();
    }

    createSettingsToolbar() {
        this.toolbar = document.createElement("div");
        Object.assign(this.toolbar.style, {
            position: 'fixed', display: 'none', zIndex: '10002', 
            backgroundColor: 'rgba(40, 40, 40, 0.9)', border: '1px solid #555',
            borderRadius: '8px', padding: '10px', alignItems: 'center',
            gap: '8px', color: 'white'
        });
        this.toolbar.innerHTML = `
            <label>Size:</label>
            <input type="range" min="1" max="200" value="${this.settings.size}" data-setting="size" style="width: 80px;">
            <span style="min-width: 25px;" data-value="size">${this.settings.size}</span>
            <label style="margin-left: 10px;">Color:</label>
            <input type="color" value="${this.settings.color}" data-setting="color">
            <button data-mode="brush" title="Brush" style="border: 2px solid #00F;">🖌️</button>
            <button data-mode="eraser" title="Eraser">Eraser</button>
            <button data-action="apply" style="margin-left: 15px; background-color: #4CAF50; color: white; border: none; padding: 5px 10px; cursor: pointer;">Apply</button>
            <button data-action="cancel" style="margin-left: 5px; background-color: #f44336; color: white; border: none; padding: 5px 10px; cursor: pointer;">Cancel</button>
        `;
        document.body.appendChild(this.toolbar);

        this.toolbar.addEventListener('input', (e) => {
            if (e.target.dataset.setting === 'size') {
                this.settings.size = parseInt(e.target.value, 10);
                this.toolbar.querySelector('span[data-value="size"]').textContent = this.settings.size;
            }
            if (e.target.dataset.setting === 'color') {
                this.settings.color = e.target.value;
            }
        });
        this.toolbar.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;
            if (target.dataset.mode) {
                this.settings.mode = target.dataset.mode;
                this.toolbar.querySelectorAll('[data-mode]').forEach(b => b.style.border = 'none');
                target.style.border = `2px solid ${this.settings.mode === 'brush' ? '#00F' : '#F00'}`;
            }
            if (target.dataset.action === 'apply') this.finalizeDrawing();
            if (target.dataset.action === 'cancel') this.hide();
        });
    }

    show() {
        this.activeLayer = this.node.getActiveLayer();
        if (!this.activeLayer) {
            alert("Please select a layer to draw on.");
            if (this.node.toolbar.activeTool === 'brush') this.node.toolbar.activeTool = null;
            this.node.refreshUI();
            return;
        }

        const layerImage = this.node.loaded_preview_images[this.activeLayer.name];
        if (!layerImage || !layerImage.naturalWidth) return;

        this.finalDrawingCanvas.width = layerImage.naturalWidth;
        this.finalDrawingCanvas.height = layerImage.naturalHeight;
        this.finalDrawingCtx.clearRect(0, 0, this.finalDrawingCanvas.width, this.finalDrawingCanvas.height);
        
        const preview = this.node.previewCanvas;
        const container = preview.parentElement;
        if (!container) return;

        this.liveDrawingOverlay = document.createElement('canvas');
        
        Object.assign(this.liveDrawingOverlay.style, {
            position: 'absolute', top: '0', left: '0',
            zIndex: '10001', pointerEvents: 'auto',
            width: '100%', height: '100%'
        });

        this.liveDrawingOverlay.width = preview.width;
        this.liveDrawingOverlay.height = preview.height;
        this.liveDrawingCtx = this.liveDrawingOverlay.getContext('2d');

        container.appendChild(this.liveDrawingOverlay);
        
        this.liveDrawingOverlay.addEventListener('mousedown', this.boundHandleMouseEvent);
        this.liveDrawingOverlay.addEventListener('mousemove', this.boundHandleMouseEvent);
        this.liveDrawingOverlay.addEventListener('mouseup', this.boundHandleMouseEvent);
        this.liveDrawingOverlay.addEventListener('mouseleave', this.boundHandleMouseEvent);
        
        this.toolbar.style.display = 'flex';
        this.positionToolbar();
    }

    hide() {
        if (this.liveDrawingOverlay) {
            this.liveDrawingOverlay.remove(); 
            this.liveDrawingOverlay = null;
            this.liveDrawingCtx = null;
        }
        this.toolbar.style.display = 'none';
        if (this.node.toolbar.activeTool === 'brush') {
            this.node.toolbar.activeTool = null;
            this.node.refreshUI();
        }
    }

    handleMouseEvent(e) {
		
         // --- DÉBUT DE LA CORRECTION DU BLOCAGE DE LA TOOLBAR ---
        // On calcule où le clic a eu lieu par rapport au canvas principal qui est SOUS l'overlay
        const mainCanvasRect = this.node.previewCanvas.getBoundingClientRect();
        const zoom = app.canvas.ds.scale || 1;
        const clickX_on_main_canvas = (e.clientX - mainCanvasRect.left) / zoom;
        const clickY_on_main_canvas = (e.clientY - mainCanvasRect.top) / zoom;

        // Si c'est un clic gauche (mousedown) ET qu'il est sur la zone de la barre d'outils...
        if (e.type === 'mousedown' && this.node.toolbar.isClickOnToolbar(clickX_on_main_canvas, clickY_on_main_canvas)) {
            // ... on passe la main au gestionnaire de la barre d'outils.
            this.node.toolbar.handleClick(e, clickX_on_main_canvas, clickY_on_main_canvas);
            return; // On arrête tout, on ne dessine pas.
        }
        // --- FIN DE LA CORRECTION DU BLOCAGE ---
		
        const activeLayer = this.node.getActiveLayer();
        if (!activeLayer) return;
        const props = this.node.layer_properties[activeLayer.name];
        const layerImage = this.node.loaded_preview_images[activeLayer.name];
        const preview = this.node.previewCanvas;
        const toolbar = this.node.toolbar;
        const baseImage = this.node.basePreviewImage;
        if (!props || !layerImage || !preview || !toolbar || !baseImage) return;

        const previewCanvasScale = (preview.width - toolbar.width) / baseImage.naturalWidth;
        const imageAreaCenterX = toolbar.width + (preview.width - toolbar.width) / 2;
        const imageAreaCenterY = preview.height / 2;
        const transformedWidth = layerImage.naturalWidth * props.scale * previewCanvasScale;
        const transformedHeight = layerImage.naturalHeight * props.scale * previewCanvasScale;
        const centerX = imageAreaCenterX + (props.offset_x * previewCanvasScale);
        const centerY = imageAreaCenterY + (props.offset_y * previewCanvasScale);
        const clickX = e.offsetX;
        const clickY = e.offsetY;
        const dx = clickX - centerX;
        const dy = clickY - centerY;
        const angleRad = - (props.rotation || 0) * Math.PI / 180;
        const unrotatedDx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
        const unrotatedDy = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
        const localX = unrotatedDx + transformedWidth / 2;
        const localY = unrotatedDy + transformedHeight / 2;
        const originalX = localX / (transformedWidth / layerImage.naturalWidth);
        const originalY = localY / (transformedHeight / layerImage.naturalHeight);
        const coords = { x: originalX, y: originalY };
        
        switch (e.type) {
            case 'mousedown':
                this.isDrawing = true;
                this.lastPoint = coords;
                break;
            case 'mousemove':
                if (this.isDrawing) {
                    this.draw(coords);
                    this.lastPoint = coords;
                }
                break;
            case 'mouseup':
            case 'mouseleave':
                this.isDrawing = false;
                break;
        }
    }

    draw(coords) {
        this.finalDrawingCtx.beginPath();
        this.finalDrawingCtx.moveTo(this.lastPoint.x, this.lastPoint.y);
        this.finalDrawingCtx.lineTo(coords.x, coords.y);
        this.finalDrawingCtx.lineCap = 'round';
        this.finalDrawingCtx.lineJoin = 'round';
        this.finalDrawingCtx.lineWidth = this.settings.size;
        if (this.settings.mode === 'eraser') {
            this.finalDrawingCtx.globalCompositeOperation = 'destination-out';
        } else {
            this.finalDrawingCtx.globalCompositeOperation = 'source-over';
            this.finalDrawingCtx.strokeStyle = this.settings.color;
        }
        this.finalDrawingCtx.stroke();
        this.updatePreviewOverlay();
    }

    updatePreviewOverlay() {
        if (!this.liveDrawingCtx) return;
        
        this.liveDrawingCtx.clearRect(0, 0, this.liveDrawingOverlay.width, this.liveDrawingOverlay.height);
        
        const props = this.node.layer_properties[this.activeLayer.name];
        const layerImage = this.node.loaded_preview_images[this.activeLayer.name];
        const preview = this.node.previewCanvas;
        const toolbar = this.node.toolbar;
        const baseImage = this.node.basePreviewImage;
        if (!props || !layerImage || !preview || !toolbar || !baseImage) return;

        const previewCanvasScale = (preview.width - toolbar.width) / baseImage.naturalWidth;
        const imageAreaCenterX = toolbar.width + (preview.width - toolbar.width) / 2;
        const imageAreaCenterY = preview.height / 2;
        const transformedWidth = layerImage.naturalWidth * props.scale * previewCanvasScale;
        const transformedHeight = layerImage.naturalHeight * props.scale * previewCanvasScale;
        const centerX = imageAreaCenterX + (props.offset_x * previewCanvasScale);
        const centerY = imageAreaCenterY + (props.offset_y * previewCanvasScale);
        const angleRad = (props.rotation || 0) * Math.PI / 180;

        this.liveDrawingCtx.save();
        this.liveDrawingCtx.translate(centerX, centerY);
        this.liveDrawingCtx.rotate(angleRad);
        this.liveDrawingCtx.drawImage(this.finalDrawingCanvas, -transformedWidth / 2, -transformedHeight / 2, transformedWidth, transformedHeight);
        this.liveDrawingCtx.restore();
    }
    
    async finalizeDrawing() {
        const applyButton = this.toolbar.querySelector('[data-action="apply"]');
        applyButton.textContent = "Applying...";
        applyButton.disabled = true;
        try {
            const props = this.node.layer_properties[this.activeLayer.name];
            const originalImage = this.node.loaded_preview_images[this.activeLayer.name];
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = originalImage.naturalWidth;
            finalCanvas.height = originalImage.naturalHeight;
            const finalCtx = finalCanvas.getContext('2d');
            finalCtx.drawImage(originalImage, 0, 0);
            
            // On utilise bien la toile interne du manager, qui est maintenant nommée correctement
            finalCtx.drawImage(this.finalDrawingCanvas, 0, 0);
            
            const blob = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], props.source_filename, { type: 'image/png' });
            const formData = new FormData();
            formData.append('image', file);
            formData.append('overwrite', 'true');
            formData.append('type', 'input');
            await fetch('/upload/image', { method: 'POST', body: formData });

            const newPreviewImage = new Image();
            newPreviewImage.src = finalCanvas.toDataURL();
            await new Promise(resolve => newPreviewImage.onload = resolve);
            this.node.loaded_preview_images[this.activeLayer.name] = newPreviewImage;
            this.node.redrawPreviewCanvas();

        } catch(e) {
            console.error("Failed to apply drawing:", e);
        } finally {
            applyButton.textContent = "Apply";
            applyButton.disabled = false;
            this.hide();
        }
    }
    
    positionToolbar() {
        if (!this.node.previewCanvas) return;
        const canvasRect = this.node.previewCanvas.getBoundingClientRect();
        this.toolbar.style.left = `${canvasRect.left}px`;
        this.toolbar.style.top = `${canvasRect.top - this.toolbar.offsetHeight - 5}px`;
    }
}