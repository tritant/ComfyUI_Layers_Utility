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
        // Opaque -> Blanc (255), Transparent -> Noir (0)
        const value = (alpha > 128) ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function convertMaskToEditorFormat(cleanMask) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = cleanMask.naturalWidth;
    canvas.height = cleanMask.naturalHeight;
    ctx.drawImage(cleanMask, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const luminance = data[i];
        
        if (luminance < 110) { 
            data[i] = 0;     // Rouge
            data[i + 1] = 0; // Vert
            data[i + 2] = 0; // Bleu
            data[i + 3] = 0; // Opaque
        } 
        else {
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function createEditorImage(layerImage, maskForProcessing) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = layerImage.naturalWidth;
    canvas.height = layerImage.naturalHeight;

    ctx.drawImage(layerImage, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    
    // Créer un masque temporaire inversé (blanc sur noir)
    const tempInvertedMask = document.createElement('canvas');
    const tempCtx = tempInvertedMask.getContext('2d');

    // ▼▼▼ LA CORRECTION EST ICI ▼▼▼
    // On récupère la largeur et la hauteur, que la source soit une Image ou un Canvas
    const maskWidth = maskForProcessing.naturalWidth || maskForProcessing.width;
    const maskHeight = maskForProcessing.naturalHeight || maskForProcessing.height;
    
    tempInvertedMask.width = maskWidth;
    tempInvertedMask.height = maskHeight;
    // ▲▲▲ FIN DE LA CORRECTION ▲▲▲

    tempCtx.filter = 'invert(1)';
    tempCtx.drawImage(maskForProcessing, 0, 0);

    // On applique ce masque inversé pour créer le canal alpha
    ctx.drawImage(tempInvertedMask, 0, 0);
    
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
}

function applyMask(layerImage, maskImage) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = layerImage.naturalWidth;
    canvas.height = layerImage.naturalHeight;
    ctx.drawImage(layerImage, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
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
        if (response.status !== 200) throw new Error(`Échec de l'upload: ${response.status}`);
        return await response.json();
    }

    async getSourceImageForActiveLayer() {
        if (!this.activeLayer) return null;
        const inputName = `layer_${this.activeLayer.index}`;
        const inputSlot = this.node.inputs.find(i => i.name === inputName);
        if (!inputSlot || inputSlot.link === null) return null;
        const link = app.graph.links[inputSlot.link];
        let currentNode = app.graph.getNodeById(link.origin_id);
        for (let i = 0; i < 10; i++) {
            if (!currentNode) return null;
            if (currentNode.type === "LoadImage") {
                return currentNode.imgs && currentNode.imgs.length > 0 ? currentNode.imgs[0] : null;
            }
            const parentInput = currentNode.inputs.find(inp => inp.type === "IMAGE");
            if (!parentInput || !parentInput.link) return null;
            const parentLink = app.graph.links[parentInput.link];
            currentNode = app.graph.getNodeById(parentLink.origin_id);
        }
        return null;
    }
    
    getActiveLayer() {
        if (!this.node.layer_properties) return null;
        const openLayerName = Object.keys(this.node.layer_properties).find(name => this.node.layer_properties[name]?.layer_collapsed === false);
        if (openLayerName) {
            const layerIndex = parseInt(openLayerName.split("_")[1]);
            return { name: openLayerName, index: layerIndex };
        }
        return null;
    }

    hasActiveMask() {
        if (!this.activeLayer) return false;
        const layerProps = this.node.layer_properties[this.activeLayer.name];
        if (layerProps && layerProps.internal_mask_filename) return true;
        const maskInputName = `mask_${this.activeLayer.index}`;
        const maskInputSlot = this.node.findInputSlot(maskInputName);
        return maskInputSlot !== -1 && this.node.inputs[maskInputSlot].link !== null;
    }

    async handleCreateMask() {
        this.activeLayer = this.getActiveLayer();
        if (!this.activeLayer) return alert("Erreur : Aucun calque actif.");
        try {
            const sourceImage = await this.getSourceImageForActiveLayer();
            if (!sourceImage) throw new Error("Image source introuvable.");

            const tempNode = LiteGraph.createNode("LoadImage");
            ComfyApp.copyToClipspace({ imgs: [sourceImage] });
            ComfyApp.clipspace_return_node = tempNode;
            
            const original_onClipspaceEditorClosed = ComfyApp.onClipspaceEditorClosed;
            ComfyApp.onClipspaceEditorClosed = () => {
                if (tempNode.imgs && tempNode.imgs[0]) this.returned_image = tempNode.imgs[0];
                ComfyApp.onClipspaceEditorClosed = original_onClipspaceEditorClosed;
                setTimeout(() => this.handleMaskEditorClose(this.activeLayer), 0);
            };
			this.hide(); 
            ComfyApp.open_maskeditor();
        } catch (error) {
            console.error("Erreur lors de la création du masque :", error);
            alert(`Erreur : ${error.message}`);
        }
    }

async handleEditMask() {
    this.activeLayer = this.getActiveLayer();
    if (!this.activeLayer) return alert("Erreur : Aucun calque actif.");
    
    const layerProps = this.node.layer_properties[this.activeLayer.name];
    if (!layerProps || !layerProps.internal_mask_details) {
        return alert("Ce calque n'a pas de masque interne éditable.");
    }

    try {
        const sourceImage = await this.getSourceImageForActiveLayer();

        if (!sourceImage || !sourceImage.complete || sourceImage.naturalWidth === 0) {
            console.warn("[Layer System] L'image source n'était pas prête. Attente du chargement...");
            if (sourceImage && sourceImage.src) {
                await new Promise((resolve, reject) => {
                    if (sourceImage.complete) { resolve(); } 
                    else { sourceImage.onload = resolve; sourceImage.onerror = reject; }
                });
            } else {
                throw new Error("Image source trouvée mais invalide.");
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
            setTimeout(() => this.handleMaskEditorClose(this.activeLayer), 0);
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
                
                // ▼▼▼ LA CORRECTION DE TIMING EST ICI ▼▼▼
                // L'éditeur est visible, mais on attend un court instant pour le laisser finir son propre dessin.
                setTimeout(() => {
                    console.log("[Layer System] Éditeur stabilisé. Application du masque.");
                    
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
                    if (editorCtx) { // Sécurité supplémentaire
                        editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
                        editorCtx.drawImage(finalMaskForEditor, 0, 0, editorCanvas.width, editorCanvas.height);
                    }
                }, 350); // On attend 250ms, un délai généralement suffisant
                // ▲▲▲ FIN DE LA CORRECTION ▲▲▲

            } else if (attempts < maxAttempts) {
                setTimeout(checkEditor, 100);
            } else {
                console.error("[LayerSystem] Timeout: L'éditeur de masque ne s'est pas initialisé.");
            }
        };
        setTimeout(checkEditor, 100);

    } catch (error) {
        console.error("Erreur lors de la ré-édition du masque :", error);
        alert(`Erreur : ${error.message}`);
    }
}
    async handleMaskEditorClose(activeLayer) {
        if (!activeLayer) activeLayer = this.getActiveLayer();
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
            console.error("[LayerSystem] Erreur critique lors du traitement du masque.", e);
            alert("Une erreur est survenue.");
        }
        
        //this.updateToolbarState();
		this.show();
        this.node.redrawPreviewCanvas();
        this.node.setDirtyCanvas(true, true);
    }
    
    handleDeleteMask() {
        this.activeLayer = this.getActiveLayer();
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

    // --- Conteneurs pour les boutons qui apparaissent/disparaissent ---
    const creationContainer = document.createElement("div");
    creationContainer.className = 'creation-tools';
    creationContainer.style.display = 'flex';
    
    const editionContainer = document.createElement("div");
    editionContainer.className = 'edition-tools';
    editionContainer.style.display = 'flex';

    // --- Création de TOUS les boutons ---
    const drawMaskButton = document.createElement("button");
    drawMaskButton.innerText = "Dessiner Masque";
    drawMaskButton.onclick = () => this.handleCreateMask();

    const reeditMaskButton = document.createElement("button");
    reeditMaskButton.innerText = "Ré-éditer";
    reeditMaskButton.onclick = () => this.handleEditMask();

    const deleteMaskButton = document.createElement("button");
    deleteMaskButton.innerText = "Supprimer";
    deleteMaskButton.onclick = () => this.handleDeleteMask();

    // ▼▼▼ LE BOUTON REMOVE BG EST CRÉÉ ICI ▼▼▼
    const removeBgButton = document.createElement("button");
    removeBgButton.innerText = "Remove BG";
    removeBgButton.onclick = () => {
        if (this.node.toolbar.removeBgManager) {
            this.node.toolbar.removeBgManager.button = removeBgButton;
            this.node.toolbar.removeBgManager.performRemoveBg();
        }
    };

    // --- Assemblage Logique ---
    // On place les boutons dans leurs conteneurs respectifs
    creationContainer.append(drawMaskButton);
    editionContainer.append(reeditMaskButton, deleteMaskButton);

    // On ajoute les conteneurs au container principal
    buttonContainer.append(creationContainer, editionContainer);

    // ▼▼▼ MODIFICATION CLÉ ▼▼▼
    // On ajoute le bouton "Remove BG" à part. Il ne sera donc pas affecté
    // par la logique qui cache/affiche creationContainer et editionContainer.
    buttonContainer.append(removeBgButton);
    // ▲▲▲ FIN DE LA MODIFICATION ▲▲▲

    // On applique le style à tous les boutons en une seule fois
    [drawMaskButton, reeditMaskButton, deleteMaskButton, removeBgButton].forEach(btn => {
        Object.assign(btn.style, {
            backgroundColor: '#444', color: 'white', border: '1px solid #666',
            padding: '8px 12px', margin: '2px', cursor: 'pointer', borderRadius: '4px'
        });
        btn.onmouseover = () => btn.style.backgroundColor = '#555';
        btn.onmouseout = () => btn.style.backgroundColor = '#444';
    });
    
    // --- Reste de la fonction (Preview, etc.) ---
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
        this.activeLayer = this.getActiveLayer();
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