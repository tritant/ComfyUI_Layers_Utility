export class RemoveBgManager {
    constructor(node, maskManager) {
        this.node = node;
        this.maskManager = maskManager;
        this.button = null;
    }

async performRemoveBg() {
    const activeLayer = this.maskManager.getActiveLayer();
    if (!activeLayer) return;
    const layerIndex = activeLayer.index;
    const layerName = activeLayer.name;
    const previewInfo = this.node.preview_data?.[layerName];
    const sourceFilename = previewInfo?.filename;

    if (!sourceFilename) {
        alert("Erreur : Unable to find source file name.");
        return;
    }

    if (this.button) {
        this.button.textContent = "processing...";
        this.button.disabled = true;
    }

    try {
        const response = await fetch("/layersystem/remove_bg", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: sourceFilename, layer_index_str: String(layerIndex)}),
        });

        if (!response.ok) throw new Error(`Server error : ${await response.text()}`);

        const newMasks = await response.json();
        const previewMaskDetails = newMasks.preview_mask_details;
        const renderMaskDetails = newMasks.render_mask_details;
        const layerProps = this.node.layer_properties[layerName];
        layerProps.internal_mask_filename = renderMaskDetails.name;
        layerProps.internal_mask_details = renderMaskDetails;
        layerProps.internal_preview_mask_details = previewMaskDetails;
		layerProps.mask_last_update = Date.now();
        this.node.updatePropertiesJSON();

        const previewMaskUrl = new URL("/view", window.location.origin);
        previewMaskUrl.searchParams.set("filename", previewMaskDetails.name);
        previewMaskUrl.searchParams.set("type", previewMaskDetails.type);
        previewMaskUrl.searchParams.set("subfolder", previewMaskDetails.subfolder);
        
		previewMaskUrl.searchParams.set("t", layerProps.mask_last_update);
		
        const newMaskImage = new Image();
        newMaskImage.crossOrigin = "anonymous";
        newMaskImage.src = previewMaskUrl.href;
        await new Promise((r, rj) => { newMaskImage.onload = r; newMaskImage.onerror = rj; });
        
        const maskName = `mask_${activeLayer.index}`;
        if (this.node.loaded_preview_images) {
            this.node.loaded_preview_images[maskName] = newMaskImage;
        }

        this.maskManager.show();
        this.node.redrawPreviewCanvas();

    } catch (error) {
        console.error("[LayerSystem] Error while removing BG:", error);
    } finally {
        if (this.button) {
            this.button.textContent = "Remove BG";
            this.button.disabled = false;
        }
    }
}
}