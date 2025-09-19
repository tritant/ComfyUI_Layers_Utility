import { app, ComfyApp } from "../../scripts/app.js";

function standardizeMaskFromEditor(editorImage) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = editorImage.naturalWidth;
    canvas.height = editorImage.naturalHeight;
    ctx.drawImage(editorImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        const value = (alpha > 128) ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

export class MaskManager {
    constructor(node) {
        this.node = node;
        this.contextualToolbar = null;
        this.activeLayer = null;
        this.returned_image = null;
        this.createContextualToolbar();
    }

    async _uploadFile(file, isFinalMask = false) {
        const formData = new FormData();
        const type = isFinalMask ? "input" : "temp";
        formData.append("image", file);
        formData.append("overwrite", "true");
        formData.append("type", type);
        const response = await fetch("/upload/image", { method: "POST", body: formData });
        if (response.status !== 200) throw new Error(`Upload failed: ${response.status}`);
        return await response.json();
    }

async getSourceImageForActiveLayer() {
    if (!this.activeLayer) {
        throw new Error("Aucun calque actif n'est sélectionné.");
    }

    const layerProps = this.node.layer_properties[this.activeLayer.name];
    if (!layerProps || !layerProps.source_filename) {
        throw new Error("Impossible de trouver le fichier source pour le calque actif.");
    }
    const filename = layerProps.source_filename;
    const details = layerProps.source_details;

    const imageUrl = new URL("/view", window.location.origin);
    imageUrl.searchParams.set("filename", filename);
    imageUrl.searchParams.set("type", details.type || "input");
    imageUrl.searchParams.set("subfolder", details.subfolder || "");
    imageUrl.searchParams.set("t", Date.now());

    try {
        const img = new Image();
        img.src = imageUrl.href;
        img.crossOrigin = "anonymous";
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });
        return img;
    } catch (error) {
        console.error(`[Layer System] Échec du chargement de l'image source : ${imageUrl.href}`, error);
        throw new Error(`Impossible de charger l'image source : ${filename}`);
    }
}
    
hasActiveMask() {
    if (!this.activeLayer) {
        return false;
    }
    const layerProps = this.node.layer_properties[this.activeLayer.name];
    return layerProps && layerProps.internal_mask_filename;
}

    async handleCreateMask() {
        this.activeLayer = this.node.getActiveLayer();
        if (!this.activeLayer) return alert("Erreur : No active layer.");
        try {
            const sourceImage = await this.getSourceImageForActiveLayer();
            if (!sourceImage) throw new Error("Source image not found.");

            const tempNode = LiteGraph.createNode("LoadImage");
            ComfyApp.copyToClipspace({ imgs: [sourceImage] });
            ComfyApp.clipspace_return_node = tempNode;
            
            const original_onClipspaceEditorClosed = ComfyApp.onClipspaceEditorClosed;
            ComfyApp.onClipspaceEditorClosed = () => {
                if (tempNode.imgs && tempNode.imgs[0]) this.returned_image = tempNode.imgs[0];
                ComfyApp.onClipspaceEditorClosed = original_onClipspaceEditorClosed;
                setTimeout(() => this.handleMaskEditorClose(this.activeLayer), 100);
            };
			this.hide(); 
            ComfyApp.open_maskeditor();
        } catch (error) {
            console.error("[Layer System] Error creating mask :", error);
        }
    }

async handleEditMask() {
    this.activeLayer = this.node.getActiveLayer();
    if (!this.activeLayer) return alert("Erreur : No active layer.");
    
    const layerProps = this.node.layer_properties[this.activeLayer.name];
    if (!layerProps || !layerProps.internal_mask_details) {
        return alert("This layer does not have an editable internal mask.");
    }

    try {
        const sourceImage = await this.getSourceImageForActiveLayer();

        if (!sourceImage || !sourceImage.complete || sourceImage.naturalWidth === 0) {
            console.warn("[Layer System] The source image was not ready. Waiting for loading...");
            if (sourceImage && sourceImage.src) {
                await new Promise((resolve, reject) => {
                    if (sourceImage.complete) { resolve(); } 
                    else { sourceImage.onload = resolve; sourceImage.onerror = reject; }
                });
            } else {
                throw new Error("Source image found but invalid.");
            }
        }
        
        const maskDetails = layerProps.internal_mask_details;
        const maskUrl = new URL("/view", window.location.origin);
        maskUrl.searchParams.set("filename", maskDetails.name);
        maskUrl.searchParams.set("type", maskDetails.type);
        maskUrl.searchParams.set("subfolder", maskDetails.subfolder);
        
		const lastUpdate = layerProps.mask_last_update || Date.now();
        maskUrl.searchParams.set("t", lastUpdate);
		
        const rawMaskImage = new Image();
        rawMaskImage.crossOrigin = "anonymous";
        rawMaskImage.src = maskUrl.href;
        const maskLoadingPromise = new Promise((r, rj) => { rawMaskImage.onload = r; rawMaskImage.onerror = rj; });

        const tempNode = LiteGraph.createNode("LoadImage");
        ComfyApp.copyToClipspace({ imgs: [sourceImage] });
        ComfyApp.clipspace_return_node = tempNode;
        
        const original_onClipspaceEditorClosed = ComfyApp.onClipspaceEditorClosed;
        ComfyApp.onClipspaceEditorClosed = () => {
            if (tempNode.imgs && tempNode.imgs[0]) { this.returned_image = tempNode.imgs[0]; }
            ComfyApp.onClipspaceEditorClosed = original_onClipspaceEditorClosed;
            setTimeout(() => this.handleMaskEditorClose(this.activeLayer), 100);
        };
        
        this.hide();
        ComfyApp.open_maskeditor();
        
        await maskLoadingPromise;

        let attempts = 0;
        const maxAttempts = 50;
        const checkEditor = () => {
            attempts++;
            const editorCanvas = document.getElementById('maskCanvas');

            if (editorCanvas && editorCanvas.width > 0 && editorCanvas.style.display !== 'none') {
                setTimeout(() => {
                    let whiteOnBlackMask;
                    if (maskDetails.name.includes("_rbg_") || maskDetails.name.includes("_render_")) {
                        const invertedCanvas = document.createElement('canvas');
                        const ctx = invertedCanvas.getContext('2d');
                        invertedCanvas.width = rawMaskImage.naturalWidth;
                        invertedCanvas.height = rawMaskImage.naturalHeight;
                        ctx.filter = 'invert(1)';
                        ctx.drawImage(rawMaskImage, 0, 0);
                        whiteOnBlackMask = invertedCanvas;
                    } else {
                        whiteOnBlackMask = standardizeMaskFromEditor(rawMaskImage);
                    }
                    
                    const finalMaskForEditor = document.createElement('canvas');
                    const finalCtx = finalMaskForEditor.getContext('2d', { willReadFrequently: true });
                    finalMaskForEditor.width = whiteOnBlackMask.width;
                    finalMaskForEditor.height = whiteOnBlackMask.height;
                    finalCtx.drawImage(whiteOnBlackMask, 0, 0);
                    
                    const imageData = finalCtx.getImageData(0, 0, finalMaskForEditor.width, finalMaskForEditor.height);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const luminance = data[i];
                        if (luminance > 128) {
                            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
                        } else {
                            data[i + 3] = 0;
                        }
                    }
                    finalCtx.putImageData(imageData, 0, 0);

                    const editorCtx = editorCanvas.getContext('2d');
                    if (editorCtx) {
                        editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
                        editorCtx.drawImage(finalMaskForEditor, 0, 0, editorCanvas.width, editorCanvas.height);
                    }
                }, 450);

            } else if (attempts < maxAttempts) {
                setTimeout(checkEditor, 300);
            } else {
                console.error("[Layer System] Timeout: The mask editor did not initialize.");
            }
        };
        setTimeout(checkEditor, 300);

    } catch (error) {
        console.error("[Layer System] Error re-editing mask :", error);
    }
}
    async handleMaskEditorClose(activeLayer) {
        if (!activeLayer) activeLayer = this.node.getActiveLayer();
        if (!activeLayer) return;
        const returned_image = this.returned_image;
        if (!returned_image) return;
        this.returned_image = null;

        try {
            if (!returned_image.complete || returned_image.naturalWidth === 0) {
                await new Promise((r, rj) => { returned_image.onload = r; returned_image.onerror = rj; });
            }

            const rawCanvas = document.createElement('canvas');
            rawCanvas.width = returned_image.naturalWidth;
            rawCanvas.height = returned_image.naturalHeight;
            rawCanvas.getContext('2d').drawImage(returned_image, 0, 0);
            const blobToUpload = await new Promise(resolve => rawCanvas.toBlob(resolve, 'image/png'));
            const file = new File([blobToUpload], `internal_mask_${activeLayer.index}.png`, { type: "image/png" });
            const finalMaskResponse = await this._uploadFile(file, true);
            
            const layerProps = this.node.layer_properties[activeLayer.name];
            layerProps.internal_mask_filename = finalMaskResponse.name;
            layerProps.internal_mask_details = finalMaskResponse;
			layerProps.mask_last_update = Date.now();
            this.node.updatePropertiesJSON();
            
            const standardizedCanvas = standardizeMaskFromEditor(returned_image);
            this.updatePreview(standardizedCanvas.toDataURL());

            const maskName = `mask_${activeLayer.index}`;
            if (this.node.loaded_preview_images) {
                const previewMaskImage = new Image();
                previewMaskImage.src = standardizedCanvas.toDataURL();
                await new Promise((r, rj) => { previewMaskImage.onload = r; previewMaskImage.onerror = rj; });
                this.node.loaded_preview_images[maskName] = previewMaskImage;
            }
        } catch (e) {
            console.error("[Layer System] Critical error while processing mask.", e);
         }
        
		this.show();
        this.node.redrawPreviewCanvas();
        this.node.setDirtyCanvas(true, true);
    }
    
    handleDeleteMask() {
        this.activeLayer = this.node.getActiveLayer();
        if (!this.activeLayer) return;
        const layerProps = this.node.layer_properties[this.activeLayer.name];
        if (layerProps && layerProps.internal_mask_filename) {
            delete layerProps.internal_mask_filename;
            delete layerProps.internal_mask_details;
        }
        const maskName = `mask_${this.activeLayer.index}`;
        if (this.node.loaded_preview_images && this.node.loaded_preview_images[maskName]) {
            delete this.node.loaded_preview_images[maskName];
        }
        this.node.redrawPreviewCanvas();
        this.updatePreview(null);
        this.updateToolbarState();
        this.node.graph.setDirtyCanvas(true, true);
        this.node.updatePropertiesJSON();
    }
    
createContextualToolbar() {
    if (this.contextualToolbar) this.contextualToolbar.remove();
    const toolbar = document.createElement("div");
    toolbar.id = 'mask-contextual-toolbar';
    Object.assign(toolbar.style, {
        position: 'fixed', display: 'none', zIndex: '10001',
        backgroundColor: 'rgba(30, 30, 30, 0.8)', border: '1px solid #555',
        borderRadius: '8px', padding: '5px', display: 'flex',
        alignItems: 'center', gap: '10px',
    });

    const buttonContainer = document.createElement("div");
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '5px';

    const creationContainer = document.createElement("div");
    creationContainer.className = 'creation-tools';
    creationContainer.style.display = 'flex';
    
    const editionContainer = document.createElement("div");
    editionContainer.className = 'edition-tools';
    editionContainer.style.display = 'flex';

    const drawMaskButton = document.createElement("button");
    drawMaskButton.innerText = "Draw Mask";
    drawMaskButton.onclick = () => this.handleCreateMask();

    const reeditMaskButton = document.createElement("button");
    reeditMaskButton.innerText = "Edit mask";
    reeditMaskButton.onclick = () => this.handleEditMask();

    const deleteMaskButton = document.createElement("button");
    deleteMaskButton.innerText = "Delete mask";
    deleteMaskButton.onclick = () => this.handleDeleteMask();

    const removeBgButton = document.createElement("button");
    removeBgButton.innerText = "Remove BG";
    removeBgButton.onclick = () => {
        if (this.node.toolbar.removeBgManager) {
            this.node.toolbar.removeBgManager.button = removeBgButton;
            this.node.toolbar.removeBgManager.performRemoveBg();
        }
    };

    creationContainer.append(drawMaskButton);
    editionContainer.append(reeditMaskButton, deleteMaskButton);

    buttonContainer.append(creationContainer, editionContainer);

    buttonContainer.append(removeBgButton);

    [drawMaskButton, reeditMaskButton, deleteMaskButton, removeBgButton].forEach(btn => {
        Object.assign(btn.style, {
            backgroundColor: '#444', color: 'white', border: '1px solid #666',
            padding: '8px 12px', margin: '2px', cursor: 'pointer', borderRadius: '4px'
        });
        btn.onmouseover = () => btn.style.backgroundColor = '#555';
        btn.onmouseout = () => btn.style.backgroundColor = '#444';
    });
    
    const previewContainer = document.createElement("div");
    Object.assign(previewContainer.style, {
        width: '64px', height: '64px', border: '1px solid #555',
        backgroundColor: '#222', flexShrink: '0', padding: '2px'
    });
    const previewImage = document.createElement("img");
    previewImage.id = "ls-mask-preview-image";
    Object.assign(previewImage.style, {
        width: '100%', height: '100%', objectFit: 'contain', display: 'none'
    });
    previewContainer.append(previewImage);
    toolbar.append(buttonContainer, previewContainer);
    document.body.appendChild(toolbar);
    this.contextualToolbar = toolbar;
}

    updatePreview(imageUrl) {
        const previewEl = document.getElementById("ls-mask-preview-image");
        if (previewEl) {
            previewEl.src = imageUrl || "";
            previewEl.style.display = imageUrl ? "block" : "none";
        }
    }

    show() {
        this.activeLayer = this.node.getActiveLayer();
        if (!this.activeLayer) { this.hide(); return; }
        this.updateToolbarState();
        const layerProps = this.node.layer_properties[this.activeLayer.name];
        if (layerProps && layerProps.internal_mask_details) {
            const details = layerProps.internal_mask_details;
            const url = new URL("/view", window.location.origin);
            url.searchParams.append("filename", details.name);
            url.searchParams.append("type", details.type);
            url.searchParams.append("subfolder", details.subfolder);
			
			const lastUpdate = layerProps.mask_last_update || Date.now();
            url.searchParams.append("t", lastUpdate);
			
            this.updatePreview(url.href);
        } else {
            this.updatePreview(null);
        }
        this.contextualToolbar.style.display = 'flex';
        requestAnimationFrame(() => this.positionToolbar());
    }

    hide() {
        if (this.contextualToolbar) {
            this.contextualToolbar.style.display = 'none';
        }
    }

    updateToolbarState() {
        const hasMask = this.hasActiveMask();
        this.contextualToolbar.querySelector('.creation-tools').style.display = hasMask ? 'none' : 'flex';
        this.contextualToolbar.querySelector('.edition-tools').style.display = hasMask ? 'flex' : 'none';
    }
    
    positionToolbar() {
        if (!this.node.previewCanvas) return;
        const canvasRect = this.node.previewCanvas.getBoundingClientRect();
        const toolbarRect = this.contextualToolbar.getBoundingClientRect();
        const left = canvasRect.left + (canvasRect.width / 2) - (toolbarRect.width / 2);
        const top = canvasRect.bottom - (toolbarRect.height || 50) - 20;
        this.contextualToolbar.style.left = `${left}px`;
        this.contextualToolbar.style.top = `${top}px`;
    }
}