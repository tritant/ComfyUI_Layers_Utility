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

function createEditorImage(layerImage, rawMaskImage) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = layerImage.naturalWidth;
    canvas.height = layerImage.naturalHeight;

    // Étape 1: Dessiner l'image du masque brut pour l'utiliser comme source alpha.
    // L'éditeur s'attend à ce que le masque soit DÉJÀ appliqué au canal alpha de l'image.
    // Et ComfyUI interprète le noir comme transparent et le blanc comme opaque dans son éditeur.
    // Donc, nous voulons que les zones NOIRES du rawMaskImage deviennent transparentes (alpha = 0)
    // et les zones BLANCHES deviennent opaques (alpha = 255).

    // On dessine l'image du calque en premier
    ctx.drawImage(layerImage, 0, 0);

    // On change l'opération de composition.
    // 'destination-in' utilise le masque dessiné ensuite pour définir l'alpha du contenu existant.
    // Ce masque doit être BLANC sur FOND NOIR pour que le blanc devienne opaque et le noir transparent.
    // Or, notre rawMaskImage est NOIR sur BLANC. Nous devons donc l'inverser avant de l'utiliser.
    ctx.globalCompositeOperation = 'destination-in';
    
    // Créer un masque temporaire inversé: blanc sur noir à partir du rawMaskImage (noir sur blanc)
    const tempMaskCanvas = document.createElement('canvas');
    const tempMaskCtx = tempMaskCanvas.getContext('2d');
    tempMaskCanvas.width = rawMaskImage.naturalWidth;
    tempMaskCanvas.height = rawMaskImage.naturalHeight;
    tempMaskCtx.filter = 'invert(100%)'; // Inverse les couleurs
    tempMaskCtx.drawImage(rawMaskImage, 0, 0);
    tempMaskCtx.filter = 'none'; // Réinitialiser le filtre

    // Dessiner le masque temporaire INVERSÉ par-dessus pour effectuer la découpe
    // Maintenant, le blanc du masque temporaire rendra l'image visible, et le noir la rendra transparente.
    ctx.drawImage(tempMaskCanvas, 0, 0, canvas.width, canvas.height);

    // Réinitialiser l'opération de composition pour ne pas affecter les opérations futures
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
        if (!sourceImage) throw new Error("Image source introuvable.");

        // Étape 1: Recharger le masque BRUT (noir/blanc)
        const maskDetails = layerProps.internal_mask_details;
        const maskUrl = new URL("/view", window.location.origin);
        maskUrl.searchParams.set("filename", maskDetails.name);
        maskUrl.searchParams.set("type", maskDetails.type);
        maskUrl.searchParams.set("subfolder", maskDetails.subfolder);
        
        const rawMaskImage = new Image();
        rawMaskImage.crossOrigin = "anonymous";
        rawMaskImage.src = maskUrl.href;
        await new Promise((r, rj) => { rawMaskImage.onload = r; rawMaskImage.onerror = rj; });

        // Étape 2: Créer l'image pour l'éditeur en utilisant la nouvelle fonction
        const editorImageCanvas = createEditorImage(sourceImage, rawMaskImage);

        // Étape 3: Uploader cette image préparée pour obtenir une URL de serveur
        const blobToUpload = await new Promise(resolve => editorImageCanvas.toBlob(resolve, 'image/png'));
        const file = new File([blobToUpload], `temp_edit_${this.activeLayer.index}_${+new Date()}.png`, { type: 'image/png' });
        const uploadResponse = await this._uploadFile(file);
        
        const finalUrl = new URL("/view", window.location.origin);
        finalUrl.searchParams.set("filename", uploadResponse.name);
        finalUrl.searchParams.set("type", uploadResponse.type);
        finalUrl.searchParams.set("subfolder", uploadResponse.subfolder);

        const imageToSendToEditor = new Image();
        imageToSendToEditor.crossOrigin = "anonymous";
        imageToSendToEditor.src = finalUrl.href;
        await new Promise(r => { imageToSendToEditor.onload = r; });

        // Étape 4: Ouvrir l'éditeur avec la bonne image
        const tempNode = LiteGraph.createNode("LoadImage");
        ComfyApp.copyToClipspace({ imgs: [imageToSendToEditor] });
        ComfyApp.clipspace_return_node = tempNode;
        
        const original_onClipspaceEditorClosed = ComfyApp.onClipspaceEditorClosed;
        ComfyApp.onClipspaceEditorClosed = () => {
            if (tempNode.imgs && tempNode.imgs[0]) { this.returned_image = tempNode.imgs[0]; }
            ComfyApp.onClipspaceEditorClosed = original_onClipspaceEditorClosed;
            setTimeout(() => this.handleMaskEditorClose(this.activeLayer), 0);
        };
        ComfyApp.open_maskeditor();
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
            const file = new File([blobToUpload], `internal_mask_${activeLayer.index}_${+new Date()}.png`, { type: "image/png" });
            const finalMaskResponse = await this._uploadFile(file, true);
            
            const layerProps = this.node.layer_properties[activeLayer.name];
            layerProps.internal_mask_filename = finalMaskResponse.name;
            layerProps.internal_mask_details = finalMaskResponse;
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
        const creationContainer = document.createElement("div");
        creationContainer.className = 'creation-tools';
        creationContainer.style.display = 'flex';
        const editionContainer = document.createElement("div");
        editionContainer.className = 'edition-tools';
        editionContainer.style.display = 'flex';
        const drawMaskButton = document.createElement("button");
        drawMaskButton.innerText = "Dessiner Masque";
        drawMaskButton.onclick = () => this.handleCreateMask();
        creationContainer.append(drawMaskButton);
        const reeditMaskButton = document.createElement("button");
        reeditMaskButton.innerText = "Ré-éditer";
        reeditMaskButton.onclick = () => this.handleEditMask();
        const deleteMaskButton = document.createElement("button");
        deleteMaskButton.innerText = "Supprimer";
        deleteMaskButton.onclick = () => this.handleDeleteMask();
        editionContainer.append(reeditMaskButton, deleteMaskButton);
        [drawMaskButton, reeditMaskButton, deleteMaskButton].forEach(btn => {
            Object.assign(btn.style, {
                backgroundColor: '#444', color: 'white', border: '1px solid #666',
                padding: '8px 12px', margin: '2px', cursor: 'pointer', borderRadius: '4px'
            });
            btn.onmouseover = () => btn.style.backgroundColor = '#555';
            btn.onmouseout = () => btn.style.backgroundColor = '#444';
        });
        buttonContainer.append(creationContainer, editionContainer);
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