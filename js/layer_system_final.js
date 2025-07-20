import { app } from "/scripts/app.js";

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft_light", "hard_light", "difference", "color_dodge", "color_burn"];
const RESIZE_MODES = ["stretch", "fit", "cover", "crop"];

app.registerExtension({
    name: "LayerSystem.DynamicLayers",
    
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "LayerSystem") {
            return;
        }

        // --- Fonction utilitaire pour redimensionner la hauteur uniquement ---
        const resizeHeight = function() {
            if (!this.size) return;
            const newSize = this.computeSize();
            // Ne met à jour que la hauteur, en conservant la largeur actuelle
            this.size[1] = newSize[1]; 
            this.onResize?.(this.size);
            this.graph.setDirtyCanvas(true, true);
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

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            if (!this.layer_properties) { this.layer_properties = {}; }
            const p_widget = this.widgets.find(w => w.name === "_properties_json");
            if (p_widget) {
                p_widget.inputEl.style.display = "none";
                p_widget.computeSize = () => [0, -4];
            }
            setTimeout(() => this.refreshUI(), 0);
        };
        
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, is_connected, link_info, io_slot) {
            onConnectionsChange?.apply(this, arguments);
            if (side === 1) { 
                setTimeout(() => this.refreshUI(), 0);
            }
        };

        nodeType.prototype.refreshUI = function() {
            for (const input of this.inputs) {
                if (input.link !== null && (input.type === "*" || Array.isArray(input.type))) {
                    const link = this.graph.links[input.link];
                    if (link) {
                        const originNode = this.graph.getNodeById(link.origin_id);
                        if (originNode?.outputs[link.origin_slot]) {
                            input.type = originNode.outputs[link.origin_slot].type;
                        }
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
            const name_A = `layer_${layer_index}`;
            const name_B = `layer_${swap_index}`;
            const mask_name_A = name_A.replace("layer_", "mask_");
            const mask_name_B = name_B.replace("layer_", "mask_");

            const props_A = this.layer_properties[name_A];
            this.layer_properties[name_A] = this.layer_properties[name_B];
            this.layer_properties[name_B] = props_A;
            
            const input_A = this.inputs.find(i => i.name === name_A);
            const input_B = this.inputs.find(i => i.name === name_B);
            const mask_input_A = this.inputs.find(i => i.name === mask_name_A);
            const mask_input_B = this.inputs.find(i => i.name === mask_name_B);

            [input_A.link, input_B.link] = [input_B.link, input_A.link];
            [mask_input_A.link, mask_input_B.link] = [mask_input_B.link, mask_input_A.link];

            if (this.graph.links[input_A.link]) this.graph.links[input_A.link].target_slot = this.inputs.indexOf(input_A);
            if (this.graph.links[input_B.link]) this.graph.links[input_B.link].target_slot = this.inputs.indexOf(input_B);
            if (this.graph.links[mask_input_A.link]) this.graph.links[mask_input_A.link].target_slot = this.inputs.indexOf(mask_input_A);
            if (this.graph.links[mask_input_B.link]) this.graph.links[mask_input_B.link].target_slot = this.inputs.indexOf(mask_input_B);

            this.refreshUI();
            this.graph.setDirtyCanvas(true, true);
        };

        nodeType.prototype.addLayerWidgets = function(layer_name) {
            if (!this.layer_properties[layer_name]) {
                this.layer_properties[layer_name] = {
                    blend_mode: "normal", opacity: 1.0, enabled: true,
                    resize_mode: "fit", scale: 1.0, offset_x: 0, offset_y: 0,
                    brightness: 0.0, contrast: 0.0,
                    color_r: 1.0, color_g: 1.0, color_b: 1.0,
                    saturation: 1.0,
                    invert_mask: false,
                    color_section_collapsed: true,
                };
            }
            const props = this.layer_properties[layer_name];
            const layer_index = parseInt(layer_name.split("_")[1]);
            const total_layers = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).length;

            if (layer_index > 1) {
                const spacer = this.addWidget("text", `spacer_for_${layer_name}`, "", null, {});
                spacer.draw = () => {};
                spacer.computeSize = () => [0, 20];
            }
            
            this.addWidget("toggle", `enabled_${layer_name}`, props.enabled, (v) => { props.enabled = v; this.updatePropertiesJSON(); }, {label: `Layer ${layer_index} Enabled`});
            this.addWidget("combo", `blend_mode_${layer_name}`, props.blend_mode, (v) => { props.blend_mode = v; this.updatePropertiesJSON(); }, {values: BLEND_MODES});
            this.addWidget("number", `opacity_${layer_name}`, props.opacity, (v) => { props.opacity = v; this.updatePropertiesJSON(); }, {min: 0.0, max: 1.0, step: 0.1, precision: 2});
            
            const toggle_button = this.addWidget("toggle", `toggle_color_${layer_name}`, !props.color_section_collapsed, (v) => {
                props.color_section_collapsed = !v;
                updateColorWidgetsVisibility();
                this.updatePropertiesJSON();
            }, { on: "▼ Color Adjustments", off: "▶ Color Adjustments" });

            const color_widgets = [
                this.addWidget("number", `brightness_${layer_name}`, props.brightness, (v) => { props.brightness = v; this.updatePropertiesJSON(); }, { label: "Brightness", min: -1.0, max: 1.0, step: 0.1, precision: 2 }),
                this.addWidget("number", `contrast_${layer_name}`, props.contrast, (v) => { props.contrast = v; this.updatePropertiesJSON(); }, { label: "Contrast", min: -1.0, max: 1.0, step: 0.1, precision: 2 }),
                this.addWidget("number", `saturation_${layer_name}`, props.saturation, (v) => { props.saturation = v; this.updatePropertiesJSON(); }, { label: "Saturation", min: 0.0, max: 2.0, step: 0.1, precision: 2 }),
                this.addWidget("number", `color_r_${layer_name}`, props.color_r, (v) => { props.color_r = v; this.updatePropertiesJSON(); }, { label: "R", min: 0.0, max: 2.0, step: 0.1, precision: 2 }),
                this.addWidget("number", `color_g_${layer_name}`, props.color_g, (v) => { props.color_g = v; this.updatePropertiesJSON(); }, { label: "G", min: 0.0, max: 2.0, step: 0.1, precision: 2 }),
                this.addWidget("number", `color_b_${layer_name}`, props.color_b, (v) => { props.color_b = v; this.updatePropertiesJSON(); }, { label: "B", min: 0.0, max: 2.0, step: 0.1, precision: 2 })
            ];
            
            for (const w of color_widgets) {
                w.originalComputeSize = w.computeSize;
            }

            const updateColorWidgetsVisibility = () => {
                for (const w of color_widgets) {
                    w.hidden = props.color_section_collapsed;
                    w.computeSize = props.color_section_collapsed ? () => [0, -4] : w.originalComputeSize;
                }
                resizeHeight.call(this);
            };
            updateColorWidgetsVisibility();
            
            const mask_input_name = layer_name.replace("layer_", "mask_");
            const mask_input = this.inputs.find(i => i.name === mask_input_name);
            if (mask_input && mask_input.link !== null) {
                this.addWidget("toggle", `invert_mask_${layer_name}`, !!props.invert_mask, (v) => { props.invert_mask = v; this.updatePropertiesJSON(); }, { label: "Invert Mask" });
            }

            const resizeModeWidget = this.addWidget("combo", `resize_mode_${layer_name}`, props.resize_mode, () => {}, { values: RESIZE_MODES });
            const scaleWidget = this.addWidget("number", `scale_${layer_name}`, props.scale, (v) => { props.scale = v; this.updatePropertiesJSON(); }, { min: 0.01, max: 10.0, step: 0.1, precision: 2 });
            const offsetXWidget = this.addWidget("number", `offset_x_${layer_name}`, props.offset_x, (v) => { props.offset_x = v; this.updatePropertiesJSON(); }, { min: -8192, max: 8192, step: 10 });
            const offsetYWidget = this.addWidget("number", `offset_y_${layer_name}`, props.offset_y, (v) => { props.offset_y = v; this.updatePropertiesJSON(); }, { min: -8192, max: 8192, step: 10 });
            
            scaleWidget.originalComputeSize = scaleWidget.computeSize;
            offsetXWidget.originalComputeSize = offsetXWidget.computeSize;
            offsetYWidget.originalComputeSize = offsetYWidget.computeSize;
            
            const updateTransformVisibility = (resize_mode) => {
                const showTransformControls = (resize_mode === 'crop');
                [scaleWidget, offsetXWidget, offsetYWidget].forEach(w => {
                    w.hidden = !showTransformControls;
                    w.computeSize = showTransformControls ? w.originalComputeSize : () => [0, -4];
                });
                resizeHeight.call(this);
            };

            resizeModeWidget.callback = (v) => {
                props.resize_mode = v;
                updateTransformVisibility(v);
                this.updatePropertiesJSON();
            };
            updateTransformVisibility(props.resize_mode);

            const up_button = this.addWidget("button", "Up", null, () => { this.moveLayer(layer_index, "up"); });
            const down_button = this.addWidget("button", "Down", null, () => { this.moveLayer(layer_index, "down"); });
            if (layer_index === 1) up_button.disabled = true;
            if (layer_index === total_layers) down_button.disabled = true;
        };
        
        nodeType.prototype.updateLayerWidgets = function() {
            this.widgets = this.widgets.filter(w => w.name === "_properties_json");
            const connectedInputs = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null);
            connectedInputs.sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
            for (const input of connectedInputs) { this.addLayerWidgets(input.name); }
            resizeHeight.call(this);
        };

        nodeType.prototype.handleDisconnectedInputs = function() {
            const connected_layer_names = new Set(this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).map(i => i.name));
            
            const inputs_to_remove = [];
            const props_to_remove = [];
            for (const key in this.layer_properties) {
                if (!connected_layer_names.has(key)) {
                    props_to_remove.push(key);
                    const layer_input = this.inputs.find(i => i.name === key);
                    if(layer_input) inputs_to_remove.push(layer_input);
                    const mask_input = this.inputs.find(i => i.name === key.replace("layer_", "mask_"));
                    if(mask_input) inputs_to_remove.push(mask_input);
                }
            }
            props_to_remove.forEach(key => delete this.layer_properties[key]);
            inputs_to_remove.forEach(i => this.removeInput(this.inputs.indexOf(i)));
            
            const new_props = {};
            const remaining_layers = this.inputs.filter(i => i.name.startsWith("layer_"));
            const remaining_masks = this.inputs.filter(i => i.name.startsWith("mask_"));

            remaining_layers.sort((a,b)=>a.name.localeCompare(b.name)).forEach((input, i) => {
                const old_name = input.name;
                const new_name = `layer_${i + 1}`;
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
            const lastLayerInput = layerInputs[layerInputs.length - 1];

            if (!lastLayerInput || lastLayerInput.link !== null) {
                const newIndex = layerInputs.length + 1;
                this.addInput(`layer_${newIndex}`, ["IMAGE", "MASK", "*"]);
                this.addInput(`mask_${newIndex}`, "MASK");
            }
        };

        nodeType.prototype.updatePropertiesJSON = function() { const p = this.widgets.find(w => w.name === "_properties_json"); if (p) { p.value = JSON.stringify(this.layer_properties); } };
    },
});
