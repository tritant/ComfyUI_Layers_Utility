export class MagicWandManager {
    constructor(node) {
        this.node = node;
        this.contextualToolbar = null;
		this.activeMaskPreview = null;
        this.settings = {
            tolerance: 32,
            contiguous: true,
			fusionMode: 'add'
        };
		this.createContextualToolbar();
    }
	
async handleCanvasClick(e) {
    this.hideSelectionPreview();
    const activeLayer = this.node.getActiveLayer();
    if (!activeLayer) return;

    const layerName = activeLayer.name;
    const props = this.node.layer_properties[layerName];
    const layerImage = this.node.loaded_preview_images[layerName];
    const baseImage = this.node.basePreviewImage;
    const preview = this.node.previewCanvas;
    const toolbar = this.node.toolbar;

    if (!props || !layerImage || !baseImage || !preview || !toolbar) return;

    const previewCanvasScale = this.node.previewCanvasScale || 1.0;
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
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const unrotatedDx = dx * cosA - dy * sinA;
    const unrotatedDy = dx * sinA + dy * cosA;

    if (Math.abs(unrotatedDx) > transformedWidth / 2 || Math.abs(unrotatedDy) > transformedHeight / 2) {
        return;
    }

    const localX = unrotatedDx + transformedWidth / 2;
    const localY = unrotatedDy + transformedHeight / 2;

    const finalX = Math.round(localX * (layerImage.naturalWidth / transformedWidth));
    const finalY = Math.round(localY * (layerImage.naturalHeight / transformedHeight));

    const applyButton = this.contextualToolbar.querySelector("button");
    applyButton.innerText = "Processing...";
    applyButton.disabled = true;

    const dataToSend = {
        filename: props.source_filename,
        details: props.source_details,
        x: finalX,
        y: finalY,
        tolerance: this.settings.tolerance,
        contiguous: this.settings.contiguous,
    };

    try {
        const response = await fetch("/layersystem/magic_wand", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dataToSend),
        });
        const result = await response.json();
        
        if (result.success && result.mask_details) {
            const maskUrl = new URL("/view", window.location.origin);
            maskUrl.searchParams.set("filename", result.mask_details.name);
            maskUrl.searchParams.set("type", result.mask_details.type);
            maskUrl.searchParams.set("t", Date.now());

            const maskImage = new Image();
            maskImage.src = maskUrl.href;
            maskImage.onload = () => {
                this.activeMaskPreview = maskImage;
                this.showSelectionPreview(maskImage, props, layerImage);
            };
        }
    } catch (error) {
        console.error("Erreur lors de l'appel à la baguette magique:", error);
    } finally {
        applyButton.innerText = "Apply mask";
        applyButton.disabled = false;
    }
}

showSelectionPreview(maskImage, props, layerImage) {
    const overlay = this.node.overlayCanvas;
    const preview = this.node.previewCanvas;
    if (!overlay || !maskImage || !props || !layerImage) return;
    
    const ctx = overlay.getContext('2d');
    overlay.width = preview.width;
    overlay.height = preview.height;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCanvas.width = maskImage.naturalWidth;
    tempCanvas.height = maskImage.naturalHeight;
    tempCtx.drawImage(maskImage, 0, 0);
    const maskData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const highlightData = tempCtx.createImageData(tempCanvas.width, tempCanvas.height);

    for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 128) { 
            highlightData.data[i] = 255;     
            highlightData.data[i + 1] = 0;   
            highlightData.data[i + 2] = 0;   
            highlightData.data[i + 3] = 102; 
        }
    }
     tempCtx.putImageData(highlightData, 0, 0);

    const previewCanvasScale = this.node.previewCanvasScale || 1.0;
    const imageAreaCenterX = this.node.toolbar.width + (preview.width - this.node.toolbar.width) / 2;
    const imageAreaCenterY = preview.height / 2;

    const transformedWidth = layerImage.naturalWidth * props.scale * previewCanvasScale;
    const transformedHeight = layerImage.naturalHeight * props.scale * previewCanvasScale;
    const centerX = imageAreaCenterX + (props.offset_x * previewCanvasScale);
    const centerY = imageAreaCenterY + (props.offset_y * previewCanvasScale);
    const angleRad = (props.rotation || 0) * Math.PI / 180;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angleRad);
   
    ctx.drawImage(tempCanvas, -transformedWidth / 2, -transformedHeight / 2, transformedWidth, transformedHeight);
    
    ctx.restore();
}

hideSelectionPreview() {
    const overlay = this.node.overlayCanvas;
    if (overlay) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
}

    async _uploadFile(file, isTemp = true) {
        const formData = new FormData();
        const type = isTemp ? "temp" : "input";
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", type);
        const response = await fetch("/upload/image", { method: "POST", body: formData });
        if (response.status !== 200) throw new Error(`Upload failed: ${response.status}`);
        return await response.json();
    }

    createContextualToolbar() {
        if (this.contextualToolbar) this.contextualToolbar.remove();
        this.contextualToolbar = document.createElement("div");
        Object.assign(this.contextualToolbar.style, {
            position: 'fixed',
            display: 'none',
            top: '20px', 
            left: '20px', 
            zIndex: '10001',
            backgroundColor: 'rgba(40, 40, 40, 0.9)',
            border: '1px solid #555',
            borderRadius: '8px',
            padding: '10px',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            color: 'white',
        });

        const toleranceLabel = document.createElement("label");
        toleranceLabel.innerText = "Tolerance :";
        const toleranceInput = document.createElement("input");
        toleranceInput.type = "range";
        toleranceInput.min = "0";
        toleranceInput.max = "255";
        toleranceInput.value = this.settings.tolerance;
		toleranceInput.style.width = '80px'; 
        toleranceInput.oninput = (e) => {
            this.settings.tolerance = parseInt(e.target.value, 10);
            toleranceValue.innerText = this.settings.tolerance;
        };
        const toleranceValue = document.createElement("span");
        toleranceValue.innerText = this.settings.tolerance;
        toleranceValue.style.minWidth = "25px";

        const contiguousLabel = document.createElement("label");
        contiguousLabel.innerText = "Contigu :";
        const contiguousInput = document.createElement("input");
        contiguousInput.type = "checkbox";
        contiguousInput.checked = this.settings.contiguous;
        contiguousInput.onchange = (e) => {
            this.settings.contiguous = e.target.checked;
        };

    const modeLabel = document.createElement("label");
    modeLabel.innerText = "Mode :";
    Object.assign(modeLabel.style, { marginLeft: '10px' });
    
    const modeSelect = document.createElement("select");
    modeSelect.innerHTML = `
        <option value="add">➕ Add</option>
        <option value="subtract">➖ Subtract</option>
        <option value="intersect">✂️ Intersection</option>
    `;
    modeSelect.value = this.settings.fusionMode;
    modeSelect.style.backgroundColor = "#333";
    modeSelect.style.color = "white";
    modeSelect.onchange = (e) => {
        this.settings.fusionMode = e.target.value;
    };

        const applyButton = document.createElement("button");
        applyButton.innerText = "Apply mask";
    applyButton.onclick = async () => {
        if (!this.activeMaskPreview) {
            alert("Aucune sélection à appliquer.");
            return;
        }
        const activeLayer = this.node.getActiveLayer();
        if (!activeLayer) return;

        applyButton.innerText = "Processing...";
        applyButton.disabled = true;

        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.activeMaskPreview.naturalWidth;
            tempCanvas.height = this.activeMaskPreview.naturalHeight;
            tempCanvas.getContext('2d').drawImage(this.activeMaskPreview, 0, 0);
            const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
            const tempFile = new File([blob], `temp_selection_mask.png`, { type: "image/png" });
            const newMaskDetails = await this._uploadFile(tempFile, false);

            const props = this.node.layer_properties[activeLayer.name];
            const existingMaskFilename = props.internal_mask_filename || null;

            const response = await fetch("/layersystem/apply_mask", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    new_mask_details: newMaskDetails,
                    existing_mask_filename: existingMaskFilename,
					fusion_mode: this.settings.fusionMode,
					layer_index: activeLayer.index
                }),
            });
            const result = await response.json();

            if (result.success && result.render_mask_details && result.preview_mask_details && result.editor_mask_details) {
            
               props.internal_mask_filename = result.render_mask_details.name; 
               props.internal_mask_details = result.render_mask_details;
               props.internal_preview_mask_details = result.preview_mask_details;
               props.internal_editor_mask_details = result.editor_mask_details; 
               props.mask_last_update = Date.now();
               this.node.updatePropertiesJSON();

                const finalMaskUrl = new URL('/view', window.location.origin);
                finalMaskUrl.searchParams.set("filename", result.preview_mask_details.name);
                finalMaskUrl.searchParams.set("type", "input");
                finalMaskUrl.searchParams.set("t", Date.now());

                const finalMaskImage = new Image();
                finalMaskImage.src = finalMaskUrl.href;
                await new Promise(r => finalMaskImage.onload = r);
                
                this.node.loaded_preview_images[activeLayer.name.replace("layer_", "mask_")] = finalMaskImage;
                
                this.hide();
                this.node.toolbar.activeTool = 'mask';
                this.node.toolbar.maskManager.show();
                this.node.redrawPreviewCanvas();
            }
        } catch (error) {
            console.error("Erreur lors de l'application du masque:", error);
        } finally {
            applyButton.innerText = "Apply mask";
            applyButton.disabled = false;
        }
    };

        this.contextualToolbar.append(
        toleranceLabel, toleranceInput, toleranceValue,
        contiguousLabel, contiguousInput,
        modeLabel, modeSelect, 
        applyButton
        );
        document.body.appendChild(this.contextualToolbar);
    }

    show() {
        if (!this.contextualToolbar) return;
        this.contextualToolbar.style.display = 'flex';
        this.positionToolbar();
    }

 hide() {
    if (!this.contextualToolbar) return;
    this.contextualToolbar.style.display = 'none';
    this.hideSelectionPreview();
}

    positionToolbar() {
        if (!this.node.previewCanvas) return;
        const canvasRect = this.node.previewCanvas.getBoundingClientRect();
        const toolbarRect = this.contextualToolbar.getBoundingClientRect();
        const left = canvasRect.left + (canvasRect.width / 2) - (toolbarRect.width / 2);
        const top = canvasRect.top - toolbarRect.height - 2;
        this.contextualToolbar.style.left = `${left}px`;
        this.contextualToolbar.style.top = `${top}px`;
    }
}