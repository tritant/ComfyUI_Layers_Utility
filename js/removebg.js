export class RemoveBgManager {
    constructor(node, maskManager) {
        this.node = node;
        this.maskManager = maskManager;
        this.button = null; // Référence au bouton pour le feedback visuel
    }

async performRemoveBg() {
    const activeLayer = this.maskManager.getActiveLayer();
    if (!activeLayer) return;

    const layerName = activeLayer.name;
    const previewInfo = this.node.preview_data?.[layerName];
    const sourceFilename = previewInfo?.filename;

    if (!sourceFilename) {
        alert("Erreur : Impossible de trouver le nom du fichier source.");
        return;
    }

    if (this.button) {
        this.button.textContent = "Traitement...";
        this.button.disabled = true;
    }

    try {
        const response = await fetch("/layersystem/remove_bg", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: sourceFilename }),
        });

        if (!response.ok) throw new Error(`Erreur du serveur : ${await response.text()}`);

        const newMasks = await response.json();
        const previewMaskDetails = newMasks.preview_mask_details;
        const renderMaskDetails = newMasks.render_mask_details;

        // --- On distribue les masques à la bonne destination ---
        
        // 1. Pour le BACKEND : on stocke les détails du masque de RENDU (noir/blanc)
        const layerProps = this.node.layer_properties[layerName];
        layerProps.internal_mask_filename = renderMaskDetails.name;
        layerProps.internal_mask_details = renderMaskDetails;
        
        // On ne touche PAS au toggle, il reste à sa valeur manuelle.
        this.node.updatePropertiesJSON();

        // 2. Pour la PREVIEW LIVE : on charge le masque de PREVIEW (blanc/noir)
        const previewMaskUrl = new URL("/view", window.location.origin);
        previewMaskUrl.searchParams.set("filename", previewMaskDetails.name);
        previewMaskUrl.searchParams.set("type", previewMaskDetails.type);
        previewMaskUrl.searchParams.set("subfolder", previewMaskDetails.subfolder);
        
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
        console.error("[LayerSystem] Erreur lors du Remove BG:", error);
        alert(`Une erreur est survenue lors du Remove BG: ${error.message}`);
    } finally {
        if (this.button) {
            this.button.textContent = "Remove BG";
            this.button.disabled = false;
        }
    }
}
}