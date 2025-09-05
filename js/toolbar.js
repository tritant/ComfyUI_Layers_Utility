import { MaskManager } from './mask_manager.js';
import { RemoveBgManager } from './removebg.js';

const textIconPath = new Path2D("M5 4v2h5v12h4V6h5V4H5z");
const maskIconPath = new Path2D("M2 2 H22 V22 H2 Z M12 12 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0");
const FONT_LIST = [
    // Sans-serif
    "Arial",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Impact",
    "Lucida Sans Unicode",
    // Serif
    "Georgia",
    "Times New Roman",
    "Garamond",
    // Monospace
    "Courier New",
    "Lucida Console"
];
function ensureToolbarStyles() {
    const styleId = 'contextual-toolbar-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        #contextual-text-toolbar {
            /* MODIFIÉ : Fond blanc avec 85% d'opacité */
            background-color: rgba(255, 255, 255, 0.5) !important;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            /* MODIFIÉ : Bordure grise subtile */
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            box-shadow: 0 4px H12px rgba(0,0,0,0.2);
            padding: 2px;
            display: flex;
            gap: 4px;
        }
        #contextual-text-toolbar button {
            background-color: transparent;
            border: none;
            /* MODIFIÉ : Icônes sombres pour la lisibilité sur fond blanc */
            color: #333;
            font-size: 18px;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        #contextual-text-toolbar button:hover {
            /* MODIFIÉ : Effet de survol gris très clair */
            background-color: rgba(0, 0, 0, 0.05);
        }
    `;
    document.head.appendChild(style);
}
export class Toolbar {
    constructor(node) {
        this.node = node;
        this.width = 40;
        this.activeTool = null;
        this.textElements = [];
        this.activeTextarea = null;
        this.lastClickTime = 0;
        this.lastClickTarget = null;
        this.clickTimeout = null;
        this.tools = [
            { name: 'text', icon: textIconPath, y: 9 },
            { name: 'mask', icon: '🎭', y: 45 }
        ];
        this.toolBounds = {};
        this.selectedTextObject = null;
        this.textEditTool = 'move';
        this.contextualToolbar = null;
        this.isTextDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.initialTextPos = { x: 0, y: 0 };
        this.dragOffset = { x: 0, y: 0 };
        this.boundDragMove = this.handleDragMove.bind(this);
        this.boundDragEnd = this.handleDragEnd.bind(this);
        this.isResizing = false;
        this.resizeSensitivity = 0.5;
        this.colorPicker = null;
        
        this.maskManager = new MaskManager(this.node);
		this.removeBgManager = new RemoveBgManager(this.node, this.maskManager);
        
        this.setupColorPicker();
        this.createContextualToolbar();
    }
createContextualToolbar() {
    ensureToolbarStyles();
    if (this.contextualToolbar) this.contextualToolbar.remove();
    const toolbar = document.createElement("div");
    toolbar.id = 'contextual-text-toolbar';
    this.contextualToolbar = toolbar;
    Object.assign(toolbar.style, {
        position: 'fixed', display: 'none', zIndex: '10001',
    });
    
    const fontSelect = document.createElement("select");
    fontSelect.className = 'font-select';
    Object.assign(fontSelect.style, {
        backgroundColor: 'transparent',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        borderRadius: '4px',
        color: '#333',
        padding: '3px',
        margin: '0 2px'
    });
    FONT_LIST.forEach(fontName => {
        const option = document.createElement("option");
        option.value = fontName;
        option.textContent = fontName;
        option.style.fontFamily = fontName;
        fontSelect.appendChild(option);
    });
    fontSelect.addEventListener('change', () => {
        if (this.selectedTextObject) {
            this.selectedTextObject.fontFamily = fontSelect.value;
            this.node.redrawPreviewCanvas();
            this.node.updatePropertiesJSON();
        }
    });
    toolbar.appendChild(fontSelect);
    
    const icons = {
        'move': '↔️', 'edit': '✏️', 'resize': '🔍', 'color': '🎨', 'delete': '🗑️', 'close': '❌'
    };
    for (const action in icons) {
        const button = document.createElement("button");
        button.innerHTML = icons[action];
        
        button.addEventListener('click', () => {
            if (!this.selectedTextObject) return;
                this.isTextDragging = false;
                this.isResizing = false;
                this.node.previewCanvas.style.setProperty('cursor', 'default', 'important');
            Array.from(event.currentTarget.parentElement.children).forEach(btn => {
            btn.style.backgroundColor = 'transparent';
            });
            switch(action) {
                case 'resize':
                   this.isResizing = true;
                   this.node.previewCanvas.style.setProperty('cursor', 'ns-resize', 'important');
                   event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
                   break;
                case 'move':
                   this.isTextDragging = true;
                   this.node.previewCanvas.style.setProperty('cursor', 'move', 'important');
                   event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
                   break;
                case 'edit':
                    this.node.editTextElement(this.selectedTextObject);
                    event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
                    break;
                case 'delete':
                    const index = this.textElements.findIndex(el => el.id === this.selectedTextObject.id);
                    if (index > -1) {
                        this.textElements.splice(index, 1);
                        this.hideContextualToolbar();
                        this.node.updatePropertiesJSON();
                    }
                    break;
                case 'close':
                    this.hideContextualToolbar();
                    break;
                case 'color':
                    event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
                    if (this.selectedTextObject && this.colorPicker) {
                    this.colorPicker.value = this.selectedTextObject.color || '#FFFFFF';
                    this.colorPicker.click();
                    }
                    break;
            }
        });
        toolbar.appendChild(button);
    }
    document.body.appendChild(toolbar);
}
    getTexts() {
        return this.textElements;
    }
    draw(ctx) {
        const canvas = this.node.previewCanvas;
        if (!canvas) return;
        const x = 0;
        ctx.save();
        ctx.fillStyle = '#282828';
        ctx.fillRect(x, 0, this.width, canvas.height);
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, 0, this.width, canvas.height);
        ctx.restore();
        this.tools.forEach(tool => {
            const iconSize = 24;
            const iconX_start = (this.width - iconSize) / 2;
            const iconY_start = tool.y;
            
            this.toolBounds[tool.name] = { 
                x: iconX_start, 
                y: iconY_start, 
                size: iconSize 
            };
            ctx.save();
             if (tool.icon instanceof Path2D) {
                ctx.translate(iconX_start, iconY_start);
                ctx.scale(iconSize / 24, iconSize / 24);
                ctx.strokeStyle = (this.activeTool === tool.name) ? "#FFD700" : "#FFFFFF";
                ctx.lineWidth = 2;
                ctx.stroke(tool.icon);
            } else {
                ctx.font = `${iconSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                if (this.activeTool === tool.name) {
                    ctx.fillStyle = "rgba(255, 221, 255, 0.6)";
                    const padding = 2;
                    ctx.fillRect(iconX_start - padding, iconY_start - padding, iconSize + (padding*2), iconSize + (padding*2));
                }
                
                ctx.fillText(tool.icon, iconX_start + iconSize / 2, iconY_start + iconSize / 2);
            }
            
            ctx.restore();
        });
    }
    getConversionRatio() {
        if (!this.node.basePreviewImage || !this.node.previewCanvas || (this.node.previewCanvas.width - this.width) <= 0) {
            return 1.0;
        }
        const baseImageWidth = this.node.basePreviewImage.naturalWidth;
        const previewImageAreaWidth = this.node.previewCanvas.width - this.width;
        return baseImageWidth / previewImageAreaWidth;
    }
    drawTextElements(ctx) {
        if (!this.node.previewCanvas || !this.node.basePreviewImage) return;
        const ratio = this.getConversionRatio();
        if (ratio === 1.0 && this.textElements.length > 0) return;
        const inverseRatio = 1 / ratio;
        const previewImageAreaWidth = this.node.previewCanvas.width - this.width;
        const previewCenterX = previewImageAreaWidth / 2;
        const previewCenterY = this.node.previewCanvas.height / 2;
        ctx.save();
        this.textElements.forEach(textEl => {
            const preview_offset_x = textEl.offset_x * inverseRatio;
            const preview_offset_y = textEl.offset_y * inverseRatio;
            const preview_size = textEl.size * inverseRatio;
            const preview_x = this.width + previewCenterX + preview_offset_x;
            const preview_y = previewCenterY + preview_offset_y;
            ctx.fillStyle = textEl.color;
            ctx.font = `${preview_size}px ${textEl.fontFamily || 'Arial'}`;
            ctx.textBaseline = 'top';
            ctx.fillText(textEl.text, preview_x, preview_y);
        });
        ctx.restore();
    }
    handleClick(e, mouseX, mouseY) {
        const clickedTool = this.tools.find(tool => {
            const bounds = this.toolBounds[tool.name];
            if (!bounds) return false;
            return mouseX >= bounds.x && mouseX < (bounds.x + bounds.size) &&
                   mouseY >= bounds.y && mouseY < (bounds.y + bounds.size);
        });
        if (clickedTool) {
            const toolName = clickedTool.name;
            const isCurrentlyActive = this.activeTool === toolName;
            this.activeTool = null;
            this.hideContextualToolbar();
            this.maskManager.hide();
            if (!isCurrentlyActive) {
                this.activeTool = toolName;
            }
            if (this.activeTool === 'mask') {
                this.maskManager.show();
            }
            if (this.activeTool && this.node.movingLayer) {
                this.node.movingLayer = null;
            }
            
            this.node.refreshUI();
        }
    }
    handleCanvasClick(e) {
        if (this.activeTool !== 'text') {
            return;
        }
        
        if (this.selectedTextObject) {
            const clickedText = this.node.findTextElementAtPos(e.offsetX, e.offsetY);
            if (clickedText && clickedText.id === this.selectedTextObject.id) {
                this.handleDragStart(e);
            } else {
                this.hideContextualToolbar();
            }
            return;
        }
        
        const now = Date.now();
        const clickedTextForSelection = this.node.findTextElementAtPos(e.offsetX, e.offsetY);
        
        if (clickedTextForSelection && (now - this.lastClickTime < 300) && this.lastClickTarget === clickedTextForSelection.id) {
            if (this.clickTimeout) { clearTimeout(this.clickTimeout); this.clickTimeout = null; }
            this.showContextualToolbar(clickedTextForSelection, e);
            this.lastClickTime = 0;
            return;
        }
        this.lastClickTime = now;
        this.lastClickTarget = clickedTextForSelection ? clickedTextForSelection.id : null;
        if (!clickedTextForSelection) {
            this.clickTimeout = setTimeout(() => {
                if (this.activeTextarea) this.activeTextarea.remove();
                
                const textInput = document.createElement("div");
                this.activeTextarea = textInput;
                textInput.contentEditable = true;
                Object.assign(textInput.style, {
                    position: 'fixed', left: `${e.clientX}px`, top: `${e.clientY}px`,
                    border: '2px solid #FFD700', background: 'rgba(20,20,20,0.9)',
                    color: 'white', zIndex: '9999', fontFamily: 'Arial',
                    fontSize: '16px', padding: '5px', minWidth: '100px',
                    resize: 'both', overflow: 'auto', whiteSpace: 'pre-wrap'
                });
                document.body.appendChild(textInput);
                textInput.focus();
                document.execCommand('selectAll', false, null);
                const onFinish = () => {
                    if (textInput.innerText.trim() !== "") {
                        const ratio = this.getConversionRatio();
                        const previewImageAreaWidth = this.node.previewCanvas.width - this.width;
                        const previewCenterX = previewImageAreaWidth / 2;
                        const previewCenterY = this.node.previewCanvas.height / 2;
                        const click_x_in_preview_area = e.offsetX - this.width;
                        const click_y_in_preview_area = e.offsetY;
                        const newTextElement = {
                            id: `text_${Date.now()}`,
                            text: textInput.innerText,
                            offset_x: (click_x_in_preview_area - previewCenterX) * ratio,
                            offset_y: (click_y_in_preview_area - previewCenterY) * ratio,
                            size: 24 * ratio,
                            color: '#FFFFFF',
                            fontFamily: 'Arial',
                        };
                        this.textElements.push(newTextElement);
                        this.node.updatePropertiesJSON();
                        this.node.redrawPreviewCanvas();
                    }
                    if (textInput.parentElement) textInput.parentElement.removeChild(textInput);
                    this.activeTextarea = null;
                };
            
                textInput.addEventListener('blur', onFinish);
                textInput.addEventListener('keydown', (evt) => {
                    evt.stopPropagation();
                    if (evt.key === 'Enter' && !evt.shiftKey) {
                        evt.preventDefault();
                        onFinish();
                    }
                });
            }, 250);
        }
    }
    showContextualToolbar(textElement, event) {
        this.selectedTextObject = textElement;
        this.contextualToolbar.style.display = 'flex';
        this.node.redrawPreviewCanvas();
        this.setDefaultMode();
        
        const fontSelect = this.contextualToolbar.querySelector('.font-select');
        if (fontSelect && this.selectedTextObject.fontFamily) {
            fontSelect.value = this.selectedTextObject.fontFamily;
        }
        
        this.updateContextualToolbarPosition();
    }
    handleDragStart(e) {
        if (!this.selectedTextObject) return;
        
        this.initialTextData = {
            offset_x: this.selectedTextObject.offset_x,
            offset_y: this.selectedTextObject.offset_y,
            size: this.selectedTextObject.size
        };
        
        this.dragStart = { x: e.clientX, y: e.clientY };
        
        if (this.isResizing) {
            window.addEventListener('mousemove', this.boundDragMove, true);
            window.addEventListener('mouseup', this.boundDragEnd, true);
            return;
        }
        
        this.isTextDragging = true;
        window.addEventListener('mousemove', this.boundDragMove, true);
        window.addEventListener('mouseup', this.boundDragEnd, true);
    }
    updateContextualToolbarPosition() {
        if (!this.selectedTextObject || !this.node.previewCanvas || !this.node.getTextPreviewMetrics) return;
        const metrics = this.node.getTextPreviewMetrics(this.selectedTextObject);
        if (!metrics) return;
        const canvasRect = this.node.previewCanvas.getBoundingClientRect();
        
        let zoom = 1.0;
        const unscaledWidth = this.node.previewCanvas.width;
        if (unscaledWidth > 0 && canvasRect.width > 0) {
            zoom = canvasRect.width / unscaledWidth;
        }
        const anchorX = canvasRect.left + (metrics.x + metrics.width / 2) * zoom;
        const anchorY = canvasRect.top + metrics.y * zoom;
        const toolbarEl = this.contextualToolbar;
        if (!toolbarEl) return;
        
        toolbarEl.style.left = `${anchorX}px`;
        toolbarEl.style.top = `${anchorY}px`;
        
        const margin = 60;
        toolbarEl.style.transform = `translate(-50%, -100%) translateY(-${margin}px)`;
    }
    handleDragMove(e) {
        if (!this.selectedTextObject) return;
        
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        const ratio = this.getConversionRatio();
        if (this.isResizing) {
            const delta_size_final = -(dy * this.resizeSensitivity) * ratio;
            const newSize = this.initialTextData.size + delta_size_final;
            this.selectedTextObject.size = Math.max(5 * ratio, newSize);
        }
        else if (this.isTextDragging) {
            e.preventDefault();
            e.stopPropagation();
            const delta_x_final = dx * ratio;
            const delta_y_final = dy * ratio;
            this.selectedTextObject.offset_x = this.initialTextData.offset_x + delta_x_final;
            this.selectedTextObject.offset_y = this.initialTextData.offset_y + delta_y_final;
        }
        
        this.node.redrawPreviewCanvas();
    }
handleDragEnd(e) {
    window.removeEventListener('mousemove', this.boundDragMove, true);
    window.removeEventListener('mouseup', this.boundDragEnd, true);
    
    this.node.updatePropertiesJSON();
    this.node.redrawPreviewCanvas();
    if (this.isResizing) {
    } 
    else if (this.isTextDragging) { 
        this.isTextDragging = false; 
        this.updateContextualToolbarPosition();
    }
}
hideContextualToolbar() {
    this.selectedTextObject = null;
    this.contextualToolbar.style.display = 'none';
    this.isResizing = false;
    this.isTextDragging = false;
    
    if (this.node.previewCanvas) {
        this.node.previewCanvas.style.setProperty('cursor', 'default', 'important');
    }
    this.node.redrawPreviewCanvas();
}
    setupColorPicker() {
        const picker = document.createElement('input');
        picker.type = 'color';
        Object.assign(picker.style, {
            position: 'fixed',
            opacity: 0,
            pointerEvents: 'none',
            left: '-100px',
            top: '-100px'
        });
        picker.addEventListener('input', () => {
            if (this.selectedTextObject) {
                this.selectedTextObject.color = picker.value;
                this.node.redrawPreviewCanvas();
            }
        });
        picker.addEventListener('change', () => {
            if (this.selectedTextObject) {
                this.setDefaultMode();
                this.node.updatePropertiesJSON();
            }
        });
        document.body.appendChild(picker);
        this.colorPicker = picker;
    }
setDefaultMode() {
    this.isTextDragging = true;
    this.isResizing = false;
    this.node.previewCanvas.style.setProperty('cursor', 'move', 'important');
    if (!this.contextualToolbar) return;
    Array.from(this.contextualToolbar.children).forEach(button => {
        button.style.backgroundColor = 'transparent';
        if (button.innerHTML === '↔️') {
            button.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
        }
    });
}
    isClickOnToolbar(mouseX, mouseY) {
        const canvas = this.node.previewCanvas;
        return canvas && mouseX < this.width;
    }
} 