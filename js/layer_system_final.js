import { app } from "/scripts/app.js";

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft_light", "hard_light"];
const RESIZE_MODES = ["stretch", "fit", "cover", "crop"];

app.registerExtension({
    name: "LayerSystem.DynamicLayers",
    
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "LayerSystem") {
            return;
        }

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

            const temp_link = input_A.link;
            input_A.link = input_B.link;
            input_B.link = temp_link;

            const temp_mask_link = mask_input_A.link;
            mask_input_A.link = mask_input_B.link;
            mask_input_B.link = temp_mask_link;

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
                };
            }
            const props = this.layer_properties[layer_name];
            const layer_index = parseInt(layer_name.split("_")[1]);
            const total_layers = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null).length;

            if (layer_index > 1) {
                const spacer = this.addWidget("text", `spacer_for_${layer_name}`, "", null, {});
                spacer.draw = () => {};
                spacer.computeSize = () => [0, 20];
                spacer.onMouseDown = spacer.onClick = spacer.mouse = () => {};
            }
            
            this.addWidget("toggle", `enabled_${layer_name}`, props.enabled, (v) => { props.enabled = v; this.updatePropertiesJSON(); }, {label: `Layer ${layer_index} Enabled`});
            this.addWidget("combo", `blend_mode_${layer_name}`, props.blend_mode, (v) => { props.blend_mode = v; this.updatePropertiesJSON(); }, {values: BLEND_MODES});
            this.addWidget("number", `opacity_${layer_name}`, props.opacity, (v) => { props.opacity = v; this.updatePropertiesJSON(); }, {min: 0.0, max: 1.0, step: 0.1, precision: 2});
            
            const resizeModeWidget = this.addWidget("combo", `resize_mode_${layer_name}`, props.resize_mode, () => {}, { values: RESIZE_MODES });
            const scaleWidget = this.addWidget("number", `scale_${layer_name}`, props.scale, (v) => { props.scale = v; this.updatePropertiesJSON(); }, { min: 0.0, max: 10.0, step: 0.1, precision: 2 });
            const offsetXWidget = this.addWidget("number", `offset_x_${layer_name}`, props.offset_x, (v) => { props.offset_x = v; this.updatePropertiesJSON(); }, { min: -8192, max: 8192, step: 10 });
            const offsetYWidget = this.addWidget("number", `offset_y_${layer_name}`, props.offset_y, (v) => { props.offset_y = v; this.updatePropertiesJSON(); }, { min: -8192, max: 8192, step: 10 });
            
            // --- MODIFICATION UNIQUE : DÉPLACEMENT DES BOUTONS ---
            // Le bloc de code pour les boutons Up/Down est maintenant ici, à la fin.
            const up_button = this.addWidget("button", "Up", null, () => { this.moveLayer(layer_index, "up"); });
            const down_button = this.addWidget("button", "Down", null, () => { this.moveLayer(layer_index, "down"); });
            if (layer_index === 1) up_button.disabled = true;
            if (layer_index === total_layers) down_button.disabled = true;

            scaleWidget.originalComputeSize = scaleWidget.computeSize;
            offsetXWidget.originalComputeSize = offsetXWidget.computeSize;
            offsetYWidget.originalComputeSize = offsetYWidget.computeSize;
            const updateVisibility = (resize_mode) => {
                const show = (resize_mode === 'crop');
                [scaleWidget, offsetXWidget, offsetYWidget].forEach(w => {
                    w.hidden = !show;
                    w.computeSize = show ? w.originalComputeSize : () => [0, -4];
                });
                this.onResize?.(this.size);
            };
            resizeModeWidget.callback = (v) => {
                props.resize_mode = v;
                updateVisibility(v);
                this.updatePropertiesJSON();
            };
            updateVisibility(props.resize_mode);
        };
        
        nodeType.prototype.updateLayerWidgets = function() {
            this.widgets = this.widgets.filter(w => w.name === "_properties_json");
            const connectedInputs = this.inputs.filter(i => i.name.startsWith("layer_") && i.link !== null);
            connectedInputs.sort((a, b) => parseInt(a.name.split("_")[1]) - parseInt(b.name.split("_")[1]));
            for (const input of connectedInputs) { this.addLayerWidgets(input.name); }
            this.onResize?.(this.size);
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