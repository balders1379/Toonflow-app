<template>
  <el-dialog
    v-model="visible"
    :title="model ? '编辑 RunningHub 模型' : '添加 RunningHub 模型'"
    width="min(880px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false">
    <div class="dialogContent">
      <el-form labelPosition="top" @submit.prevent>
        <el-form-item label="显示名称" required>
          <el-input v-model="draft.label" clearable aria-label="模型显示名称" />
        </el-form-item>
        <el-form-item label="模型 ID" required>
          <el-input v-model="draft.id" clearable aria-label="模型 ID" @input="idTouched = true" />
        </el-form-item>
        <el-form-item label="模型类型">
          <el-select v-model="draft.type" aria-label="模型类型">
            <el-option v-for="item in mediaTypes" :key="item.value" :value="item.value" :label="item.label" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="modeOptions[draft.type].length" :label="modeLabels[draft.type]">
          <div class="generationModes">
            <el-checkbox-group v-model="draft.modes">
              <el-checkbox v-for="item in modeOptions[draft.type]" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox>
            </el-checkbox-group>
            <el-text v-if="draft.type === 'video'" class="fieldHint" type="info" size="small">
              勾选工作流支持的生成方式，视频节点会据此显示模式选项。首帧/尾帧参考使用「参考图」区域的第一行，首尾帧参考按行顺序使用前两行；它们分别对应视频节点里的「尾帧可选」「首帧可选」「首尾帧必填」。混合参考的参考数量在下方按模型配置。
            </el-text>
            <div v-if="draft.type === 'video' && draft.modes.includes('multiReference')" class="mixedCounts">
              <label v-for="item in mixedReferenceOptions" :key="item.key">
                <span>{{ item.label }}</span>
                <el-input-number v-model="draft.mixedReferenceCounts[item.key]" :min="0" :max="256" :step="1" :precision="0" size="small" controlsPosition="right" :aria-label="`混合参考${item.label}数量`" />
              </label>
            </div>
            <el-text v-for="warning in modeWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
          </div>
        </el-form-item>
        <el-form-item label="ComfyUI 工作流 ID" required>
          <div class="workflowRow">
            <el-input v-model="draft.workflowId" clearable aria-label="ComfyUI 工作流 ID" placeholder="填写 RunningHub 工作流 ID" />
            <el-button :icon="IconRefresh" :loading="syncing" :disabled="!draft.workflowId.trim()" @click="syncNodes">同步节点</el-button>
          </div>
          <el-text class="fieldHint" type="info" size="small">节点只用于本次配置，不会保存到模型中。</el-text>
        </el-form-item>
        <el-form-item v-if="draft.type === 'image'" label="分辨率选项">
          <div class="imageResolutionOptions">
            <el-input-tag v-model="draft.imageSizes" placeholder="输入后按回车，例如 1K、2K" aria-label="图片分辨率选项" />
            <el-text class="fieldHint" type="info" size="small">配置后图片卡片会显示这些分辨率；所选值会换算成数值写入下方「分辨率」分组里绑定的 ResolutionSelector.megapixels。</el-text>
          </div>
        </el-form-item>
        <el-form-item v-if="draft.type === 'video'" label="时长与分辨率">
          <div class="mappingEditor">
            <div class="mappingHeader"><span>时长（秒）</span><span>分辨率</span></div>
            <div v-for="(row, index) in draft.durationResolutionMap" :key="index" class="mappingRow">
              <span class="rowIndex">{{ index + 1 }}</span>
              <el-input-tag v-model="row.duration" placeholder="输入后按回车" :aria-label="`第 ${index + 1} 组时长`" />
              <icon-arrow-right :size="16" aria-hidden="true" />
              <el-input-tag v-model="row.resolution" placeholder="输入后按回车" :aria-label="`第 ${index + 1} 组分辨率`" />
              <el-button
                text
                type="danger"
                :icon="IconTrash"
                :aria-label="`删除第 ${index + 1} 组时长与分辨率`"
                @click="draft.durationResolutionMap.splice(index, 1)" />
            </div>
            <el-button class="addMapping" :icon="IconPlus" @click="draft.durationResolutionMap.push({ duration: [], resolution: [] })">添加时长与分辨率</el-button>
            <el-text class="fieldHint" type="info" size="small">配置后视频卡片才会显示时长和分辨率选项；留空则保持工作流默认值。</el-text>
          </div>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="typeChanged"
        class="typeAlert"
        type="warning"
        :closable="false"
        showIcon
        title="模型类型已更改。输出节点将按新类型保存；不属于新类型的参数会原样保留在旧版参数中，模式和选项配置会按新类型重建。" />

      <el-alert
        v-if="draft.removedSources.length"
        class="typeAlert"
        type="warning"
        :closable="false"
        showIcon
        title="已移除当前界面不支持的旧绑定"
        :description="`${draft.removedSources.join('、')}。这些绑定不会保存；如需保留请直接修改供应商 TS。`" />

      <div class="paramSection">
        <div class="sectionHeader">
          <h4>输入参数</h4>
          <el-text type="info" size="small">{{ nodes.length ? `已同步 ${nodes.length} 个节点` : '请先同步工作流节点' }}</el-text>
        </div>
        <div v-for="group in presetGroups" :key="group.source" class="paramGroup">
          <div class="paramHeader">
            <span class="paramName">{{ group.label }}</span>
            <div class="addNodeControls">
              <el-select v-model="nodeTypeFilters[group.source]" class="nodeTypeSelect" :aria-label="`${group.label}节点类型`">
                <el-option value="" label="所有" />
                <el-option v-for="nodeType in nodeTypes" :key="nodeType" :value="nodeType" :label="nodeType" />
              </el-select>
              <el-button text size="small" :icon="IconPlus" :disabled="!firstAvailablePair(group.source, nodeTypeFilters[group.source])" @click="addRow(group.source)">添加节点</el-button>
            </div>
          </div>
          <div v-if="draft.rowsBySource[group.source].length" class="paramRows">
            <div v-for="nodeGroup in groupedRows(group.source)" :key="nodeGroup.key" class="paramNode">
              <div v-for="(row, rowIndex) in nodeGroup.rows" :key="row.key" class="paramRow">
                <el-select v-if="rowIndex === 0" v-model="row.nodeId" class="nodeSelect" aria-label="节点" @change="onNodeGroupChange(group.source, nodeGroup.rows)">
                  <el-option v-for="node in inputNodeChoices(group.source, row.nodeId)" :key="node.nodeId" :value="node.nodeId" :label="nodeOptionLabel(node)">
                    <span>#{{ node.nodeId }} · {{ node.title }}</span>
                    <el-text v-if="node.classType" type="info" size="small"> · {{ node.classType }}</el-text>
                  </el-option>
                </el-select>
                <span v-else class="nodeSpacer" aria-hidden="true" />
                <template v-if="fieldsOf(row.nodeId).length">
                  <el-select :model-value="row.fieldName" class="fieldSelect" aria-label="字段" @update:model-value="value => onFieldSelect(group.source, row, value)">
                    <el-option v-for="choice in fieldChoices(group.source, row)" :key="choice.name" :value="choice.name" :label="fieldLabel(choice)">
                      <span>{{ fieldLabel(choice) }}</span>
                    </el-option>
                  </el-select>
                </template>
                <el-input v-else v-model="row.fieldName" class="fieldSelect" placeholder="输入工作流中的参数名" aria-label="参数名" @change="onFieldChange(group.source, row)" />
                <el-select v-model="row.mode" class="modeSelect" :aria-label="`${row.fieldName} 数值来源`" @change="onModeChange(row)">
                  <el-option value="frontend" label="前端设置" :disabled="!canUseFrontend(group.source, row)" />
                  <el-option value="fixed" label="固定数值" />
                  <el-option value="original" label="原始数据" :disabled="workflowValue(row.nodeId, row.fieldName) === undefined" />
                </el-select>
                <div v-if="row.mode !== 'frontend'" class="fixedValue">
                  <el-switch v-if="fieldValueType(row) === 'boolean' && row.fixedValue !== 'None'" :model-value="(row.mode === 'original' ? workflowValue(row.nodeId, row.fieldName) : row.fixedValue) as boolean" :disabled="row.mode === 'original'" :aria-label="`${row.fieldName} 固定值`" @update:model-value="value => row.fixedValue = value" />
                  <el-input v-else :model-value="String(row.mode === 'original' ? workflowValue(row.nodeId, row.fieldName) ?? '' : row.fixedValue ?? '')" :disabled="row.mode === 'original'" :aria-label="`${row.fieldName} 固定值`" @update:model-value="value => setRowFixedValue(row, value)" />
                </div>
                <div v-if="rowIndex === 0" class="rowActions">
                  <el-button text size="small" type="danger" :icon="IconTrash" aria-label="删除节点" @click="removeNodeGroup(group.source, nodeGroup.rows)" />
                </div>
                <div v-if="fieldMissing(row) || !fieldsOf(row.nodeId).length" class="rowMeta">
                  <el-text v-if="fieldMissing(row)" type="warning" size="small">参数未在同步结果中</el-text>
                  <el-text v-if="!fieldsOf(row.nodeId).length" type="info" size="small">该节点未同步，无法校验参数</el-text>
                </div>
              </div>
            </div>
          </div>
          <el-text v-else class="emptyGroup" type="info" size="small">未绑定节点</el-text>
          <template v-if="draft.type === 'image' && group.source === 'ratio'">
            <el-text class="fieldHint" type="info" size="small">绑定 ResolutionSelector 节点的参数（与视频模型相同）：aspect_ratio 由卡片比例控制，megapixels 由分辨率选项换算（1K→1、2K→2），其余参数按固定值写入。同步节点时若工作流中存在该节点会自动绑定。</el-text>
            <el-text v-if="derivedRatios.length" class="fieldHint" type="info" size="small">图片卡片比例选项：{{ derivedRatios.join('、') }}</el-text>
            <el-text v-for="warning in ratioWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
          </template>
          <template v-if="draft.type === 'video' && group.source === 'ratio'">
            <el-text class="fieldHint" type="info" size="small">绑定分辨率选择节点（如 ResolutionSelector）的比例字段，字段选项会作为视频卡片的比例选项。</el-text>
            <el-text v-if="derivedRatios.length" class="fieldHint" type="info" size="small">
              视频卡片比例选项：{{ derivedRatios.join('、') }}
            </el-text>
            <el-text v-for="warning in ratioWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
          </template>
        </div>
      </div>

      <div class="paramSection">
        <div class="sectionHeader">
          <h4>默认参数</h4>
          <div class="addNodeControls">
            <el-select v-model="nodeTypeFilters.default" class="nodeTypeSelect" aria-label="默认参数节点类型">
              <el-option value="" label="所有" />
              <el-option v-for="nodeType in nodeTypes" :key="nodeType" :value="nodeType" :label="nodeType" />
            </el-select>
            <el-button text size="small" :icon="IconPlus" :disabled="!canAddDefaultNode" @click="addDefaultNode">添加节点</el-button>
          </div>
        </div>
        <div v-if="draft.defaultNodes.length" class="paramRows">
          <div v-for="(node, index) in draft.defaultNodes" :key="node.key" class="paramNode">
            <div v-for="(field, fieldIndex) in defaultFields(node).length ? defaultFields(node) : [null]" :key="field?.name ?? node.key" class="paramRow defaultParamRow">
              <el-select v-if="fieldIndex === 0" v-model="node.nodeId" class="nodeSelect" aria-label="默认参数节点" @change="onDefaultNodeChange(node)">
                <el-option v-for="item in defaultNodeChoices(node)" :key="item.nodeId" :value="item.nodeId" :label="nodeOptionLabel(item)">
                  <span>#{{ item.nodeId }} · {{ item.title }}</span>
                  <el-text v-if="item.classType" type="info" size="small"> · {{ item.classType }}</el-text>
                </el-option>
              </el-select>
              <span v-else class="nodeSpacer" aria-hidden="true" />
              <template v-if="field">
                <el-select :model-value="field.name" class="fieldSelect" :aria-label="`默认参数 ${field.name}`" @update:model-value="value => onDefaultFieldSelect(node, field.name, value)">
                  <el-option v-for="choice in defaultFields(node)" :key="choice.name" :value="choice.name" :label="`${choice.name}（${valueTypeLabels[choice.valueType]}）`" />
                </el-select>
                <el-select v-if="!field.used" :model-value="defaultFieldMode(node, field.name)" class="modeSelect" :aria-label="`${field.name} 数值来源`" @update:model-value="value => onDefaultModeChange(node, field.name, value)">
                  <el-option value="fixed" label="固定数值" />
                  <el-option value="original" label="原始数据" :disabled="workflowValue(node.nodeId, field.name) === undefined" />
                </el-select>
                <div v-if="!field.used" class="defaultValue">
                  <el-switch
                    v-if="field.valueType === 'boolean'"
                    :model-value="defaultFieldValue(node, field.name) as boolean"
                    :disabled="defaultFieldMode(node, field.name) === 'original'"
                    :aria-label="`${field.name} 默认值`"
                    @update:model-value="value => setDefaultValue(node, field.name, value)" />
                  <el-input
                    v-else
                    :model-value="String(defaultFieldValue(node, field.name) ?? '')"
                    :disabled="defaultFieldMode(node, field.name) === 'original'"
                    :aria-label="`${field.name} 默认值`"
                    @update:model-value="value => setDefaultValue(node, field.name, value)" />
                </div>
                <el-text v-if="field.used" class="defaultUsed" type="warning" size="small">已由输入参数控制</el-text>
              </template>
              <el-text v-else class="rowMeta" type="info" size="small">该节点没有可设置的参数，或尚未同步节点信息。</el-text>
              <div v-if="fieldIndex === 0" class="rowActions">
                <el-button text size="small" type="danger" :icon="IconTrash" :aria-label="`删除默认参数节点 ${index + 1}`" @click="removeDefaultNode(node)" />
              </div>
            </div>
          </div>
        </div>
        <el-text v-else class="emptyGroup" type="info" size="small">未指定默认参数</el-text>
        <el-text class="fieldHint" type="info" size="small">这些数值会写入指定节点并覆盖工作流默认值；已被输入参数控制的字段不会写入。</el-text>
      </div>

      <div class="paramSection">
        <div class="sectionHeader">
          <h4>{{ outputLabel }}</h4>
          <div class="addNodeControls">
            <el-select v-model="nodeTypeFilters.output" class="nodeTypeSelect" aria-label="输出节点类型">
              <el-option value="" label="所有" />
              <el-option v-for="nodeType in nodeTypes" :key="nodeType" :value="nodeType" :label="nodeType" />
            </el-select>
            <el-button text size="small" :icon="IconPlus" :disabled="!canAddOutput" @click="addOutputRow">添加输出节点</el-button>
          </div>
        </div>
        <div v-if="draft.outputRows.length" class="paramRows">
          <div v-for="(row, index) in draft.outputRows" :key="row.key" class="paramRow outputRow">
            <el-select v-model="row.nodeId" class="nodeSelect" aria-label="输出节点">
              <el-option v-for="node in outputNodeChoices(row)" :key="node.nodeId" :value="node.nodeId" :label="nodeOptionLabel(node)">
                <span>#{{ node.nodeId }} · {{ node.title }}</span>
                <el-text v-if="node.classType" type="info" size="small"> · {{ node.classType }}</el-text>
              </el-option>
            </el-select>
            <div class="rowActions">
              <el-button text size="small" :icon="IconArrowUp" :disabled="index === 0" aria-label="上移" @click="moveOutputRow(index, -1)" />
              <el-button text size="small" :icon="IconArrowDown" :disabled="index === draft.outputRows.length - 1" aria-label="下移" @click="moveOutputRow(index, 1)" />
              <el-button text size="small" type="danger" :icon="IconTrash" aria-label="删除输出节点" @click="removeOutputRow(index)" />
            </div>
          </div>
        </div>
        <el-text v-else class="emptyGroup" type="info" size="small">至少添加一个输出节点</el-text>
      </div>

      <div v-if="legacyGroups.length" class="paramSection legacySection">
        <div class="sectionHeader"><h4>旧版参数（只读）</h4></div>
        <div v-for="group in legacyGroups" :key="group.source" class="legacyGroup">
          <div class="paramHeader"><span class="paramName">{{ group.label }}</span></div>
          <div v-for="row in draft.rowsBySource[group.source]" :key="row.key" class="legacyRow">
            <span class="legacyNode">{{ nodeLabel(row.nodeId) }}</span>
            <span class="legacyField">{{ row.fieldName }}</span>
            <el-text v-if="row.mode === 'fixed'" type="info" size="small">固定值：{{ row.fixedValue }}</el-text>
          </div>
        </div>
        <el-text class="fieldHint" type="info" size="small">这些参数不属于当前模型类型的预设分组，会原样保存；切回对应类型后可继续编辑。</el-text>
      </div>

    </div>
    <template #footer>
      <div class="dialogFooter">
        <div v-if="syncError || formError" class="footerErrors" role="alert">
          <el-text v-if="syncError" type="danger" size="small">{{ syncError }}</el-text>
          <el-text v-if="formError" type="danger" size="small">{{ formError }}</el-text>
        </div>
        <div class="footerActions">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="confirmModel">确定</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, ref, watch } from "vue";
import { IconArrowDown, IconArrowRight, IconArrowUp, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-vue";
import type { MediaProviderModel } from "./types";

type MediaType = "image" | "video" | "audio";
type InputSource =
  | "prompt"
  | "image"
  | "video"
  | "audio"
  | "duration"
  | "size"
  | "megapixels"
  | "ratio"
  | "fixed"
  | "original";
// ACT: megapixels 不作为独立分组，行统一放在「分辨率」分组里，写入时再换算成 megapixels 来源。
type ParamSource = Exclude<InputSource, "fixed" | "original" | "megapixels">;
// ACT: megapixels 没有独立分组，但仍作为固定/前端绑定的来源保存在「分辨率」分组里。
type BindingSource = ParamSource | "megapixels";
type NodeTypeScope = ParamSource | "default" | "output";
type ValueType = "string" | "number" | "boolean";
type BindingField = { fieldName: string; source: InputSource; value?: string | number | boolean; disabled?: boolean; inputSource?: BindingSource };
type InputBinding = { role: "input"; nodeId: string; fields: BindingField[] };
type OutputBinding = { role: "output"; nodeId: string; mediaType: MediaType };
type Binding = InputBinding | OutputBinding;
type WorkflowNode = {
  nodeId: string;
  classType: string;
  title: string;
  inputs: { name: string; valueType: ValueType; value?: string | number | boolean }[];
};
type InputRow = { key: string; nodeId: string; fieldName: string; mode: "frontend" | "fixed" | "original"; fixedValue?: DefaultValue };
type OutputRow = { key: string; nodeId: string };
type DefaultValue = string | number | boolean;
type DefaultNode = { key: string; nodeId: string; values: Record<string, DefaultValue>; originalFields: string[]; fieldOrder?: string[] };
type DefaultField = { name: string; valueType: ValueType; used: boolean };
type ParamDef = { source: ParamSource; label: string };
type FieldChoice = { name: string; valueType: ValueType; status: "ok" | "missing" | "duplicate" };
type ModeEntry = string | string[];
type ModeOption = { value: string; label: string };
type MixedCounts = Record<"image" | "video" | "audio", number>;

const props = defineProps<{
  model?: MediaProviderModel;
  models: MediaProviderModel[];
  config: Record<string, unknown>;
  fileName: string;
}>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ confirmed: [model: MediaProviderModel] }>();

const mediaTypes: { value: MediaType; label: string }[] = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];
// ACT: 图片/视频共用同一套模式表，加载、校验、保存走同一组函数。
const modeOptions: Record<MediaType, ModeOption[]> = {
  image: [
    { value: "text", label: "文生图" },
    { value: "singleImage", label: "参考生图" },
  ],
  video: [
    { value: "text", label: "文生视频" },
    { value: "singleImage", label: "单图参考" },
    { value: "endFrameOptional", label: "首帧参考" },
    { value: "startFrameOptional", label: "尾帧参考" },
    { value: "startEndRequired", label: "首尾帧参考" },
    { value: "multiReference", label: "混合参考" },
  ],
  audio: [],
};
const modeLabels: Record<MediaType, string> = { image: "图片生成模式", video: "视频生成模式", audio: "生成模式" };
const mixedReferenceOptions = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "audio", label: "音频" },
] as const;
const defaultMixedCounts: MixedCounts = { image: 9, video: 3, audio: 3 };
// 编译与展示顺序固定；组内顺序仍由用户上下移动决定。
const inputSourceOrder: ParamSource[] = ["prompt", "image", "video", "audio", "duration", "size", "ratio"];
const sourceLabels: Record<InputSource, string> = {
  prompt: "参考词",
  image: "参考图",
  video: "参考视频",
  audio: "参考音频",
  duration: "时长（秒）",
  size: "分辨率",
  megapixels: "分辨率（megapixels）",
  ratio: "比例",
  fixed: "固定值",
  original: "原始数据",
};
const paramDefs = {
  prompt: { source: "prompt", label: "参考词" },
  image: { source: "image", label: "参考图" },
  video: { source: "video", label: "参考视频" },
  audio: { source: "audio", label: "参考音频" },
  duration: { source: "duration", label: "时长（秒）" },
  ratio: { source: "ratio", label: "分辨率" },
} satisfies Record<string, ParamDef>;
const presetDefs: Record<MediaType, ParamDef[]> = {
  // ACT: 与视频模型一致——「分辨率」分组承载 ResolutionSelector 的全部参数：aspect_ratio 前端选择比例，megapixels 由分辨率选项换算，其余按固定值。
  image: [paramDefs.prompt, paramDefs.image, paramDefs.ratio],
  video: [paramDefs.prompt, paramDefs.image, paramDefs.video, paramDefs.audio, paramDefs.duration, paramDefs.ratio],
  audio: [{ source: "prompt", label: "参考词/文本" }, paramDefs.audio],
};
// ACT: RunningHub 的工作流接口只返回当前值、不返回下拉选项，内置节点在此补充枚举。
const knownFieldOptions: Record<string, string[]> = {
  "ResolutionSelector.aspect_ratio": [
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
  ],
};
const outputLabels: Record<MediaType, string> = { image: "输出图片", video: "输出视频", audio: "输出音频" };
const valueTypeLabels: Record<ValueType, string> = { string: "文本", number: "数字", boolean: "布尔" };
// ACT: megapixels 不是独立分组，但仍是合法的绑定来源，需要保留在解析白名单里。
const allSources: InputSource[] = [...inputSourceOrder, "megapixels", "fixed", "original"];

// ACT: megapixels 绑定统一展示在「分辨率」分组里，读写时在分组与来源之间做一次映射。
function rowGroupForSource(source: BindingSource): ParamSource {
  return source === "megapixels" ? "ratio" : source;
}

function bindingSourceFor(source: ParamSource, fieldName: string): BindingSource {
  return draft.value.type === "image" && source === "ratio" && fieldName === "megapixels" ? "megapixels" : source;
}

function emptyRows(): Record<ParamSource, InputRow[]> {
  return Object.fromEntries(inputSourceOrder.map(source => [source, [] as InputRow[]])) as Record<ParamSource, InputRow[]>;
}

function emptyNodeTypeFilters(): Record<NodeTypeScope, string> {
  return Object.fromEntries([...inputSourceOrder, "default", "output"].map(source => [source, ""])) as Record<NodeTypeScope, string>;
}

function createDraft() {
  return {
    id: "",
    label: "",
    type: "image" as MediaType,
    workflowId: "",
    rowsBySource: emptyRows(),
    defaultNodes: [] as DefaultNode[],
    outputRows: [] as OutputRow[],
    legacyOutputs: [] as OutputBinding[],
    durationResolutionMap: [] as { duration: string[]; resolution: string[] }[],
    imageSizes: [] as string[],
    modes: [] as string[],
    mixedReferenceCounts: { ...defaultMixedCounts },
    extraModes: [] as ModeEntry[],
    removedSources: [] as string[],
  };
}

let rowSeq = 0;
function rowKey() {
  return `row-${++rowSeq}`;
}

function parseMixedCounts(entry: string[]): MixedCounts | undefined {
  const counts: MixedCounts = { image: 0, video: 0, audio: 0 };
  let found = false;
  for (const item of entry) {
    const match = /^(image|video|audio)Reference:(\d+)$/.exec(item);
    if (!match) return undefined;
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count < 1 || count > 256) return undefined;
    counts[match[1] as keyof MixedCounts] = count;
    found = true;
  }
  return found ? counts : undefined;
}

// ACT: 图片、视频、音频共用：已知模式进 selected，视频的混合参考数组解析成数量，其余原样保留。
function parseModes(type: MediaType, raw: unknown) {
  const known = new Set(modeOptions[type].map(option => option.value));
  const selected: string[] = [];
  const extra: ModeEntry[] = [];
  let mixed = { ...defaultMixedCounts };
  for (const item of Array.isArray(raw) ? raw : []) {
    if (Array.isArray(item)) {
      if (!item.every(entry => typeof entry === "string")) continue;
      const counts = type === "video" && !selected.includes("multiReference") ? parseMixedCounts(item) : undefined;
      if (counts) {
        mixed = counts;
        selected.push("multiReference");
      } else extra.push(item);
      continue;
    }
    if (typeof item !== "string") continue;
    if (!known.has(item)) extra.push(item);
    else if (!selected.includes(item)) selected.push(item);
  }
  return { selected, mixed, extra };
}

function serializeModes(type: MediaType, selected: string[], mixed: MixedCounts, extra: ModeEntry[]) {
  const result: ModeEntry[] = [];
  for (const option of modeOptions[type]) {
    if (!selected.includes(option.value)) continue;
    if (option.value === "multiReference" && type === "video") {
      const references = mixedReferenceOptions
        .filter(item => mixed[item.key] >= 1)
        .map(item => `${item.key}Reference:${Math.min(Math.floor(mixed[item.key]), 256)}`);
      if (references.length) result.push(references);
    } else result.push(option.value);
  }
  result.push(...extra);
  return result;
}

const draft = ref(createDraft());
const originalType = ref<MediaType | "">("");
const nodes = ref<WorkflowNode[]>([]);
const nodeTypeFilters = ref(emptyNodeTypeFilters());
const nodeTypes = computed(() => [...new Set(nodes.value.map(node => node.classType).filter(Boolean))]);
const syncing = ref(false);
const syncError = ref("");
const formError = ref("");
const idTouched = ref(false);
let originalExtra: Record<string, unknown> = {};
// ACT: 保存模型里已有的固定值，切换节点或重新同步时用来恢复默认参数。
let savedDefaultValues = new Map<string, Record<string, DefaultValue>>();

function normalizeBinding(value: unknown): Binding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.nodeId !== "string" || !item.nodeId.trim()) return undefined;
  const nodeId = item.nodeId.trim();
  if (item.role === "output") {
    if (item.mediaType !== "image" && item.mediaType !== "video" && item.mediaType !== "audio") return undefined;
    return { role: "output", nodeId, mediaType: item.mediaType };
  }
  if (item.role !== "input") return undefined;
  const toField = (value: unknown): BindingField | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const field = value as Record<string, unknown>;
    if (typeof field.fieldName !== "string" || !field.fieldName.trim()) return undefined;
    if (!allSources.some(source => source === field.source)) return undefined;
    const result: BindingField = { fieldName: field.fieldName.trim(), source: field.source as InputSource };
    if (typeof field.value === "string" || typeof field.value === "number" || typeof field.value === "boolean") result.value = field.value;
    if (field.disabled === true) result.disabled = true;
    const isStoredSource = field.inputSource === "megapixels" || inputSourceOrder.some(source => source === field.inputSource);
    if ((field.source === "fixed" || field.source === "original") && isStoredSource) result.inputSource = field.inputSource as BindingSource;
    return result;
  };
  // ACT: 兼容旧版每条绑定只有一个字段的结构。
  const fields = Array.isArray(item.fields) ? item.fields.map(toField).filter((field): field is BindingField => Boolean(field)) : [toField(item)].filter((field): field is BindingField => Boolean(field));
  return fields.length ? { role: "input", nodeId, fields } : undefined;
}

// ACT: firstFrame、lastFrame、resolution 等来源当前界面不支持编辑；按约定不保留，但要提示，不能静默丢弃。
function collectUnsupportedSources(bindings: unknown) {
  const supported = new Set<string>(allSources);
  const removed: string[] = [];
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    if (!binding || typeof binding !== "object") continue;
    const raw = binding as Record<string, unknown>;
    if (raw.role === "output") continue;
    const fields = Array.isArray(raw.fields) ? raw.fields : [raw];
    for (const item of fields) {
      if (!item || typeof item !== "object") continue;
      const field = item as Record<string, unknown>;
      const source = typeof field.source === "string" ? field.source : "";
      const fieldName = typeof field.fieldName === "string" ? field.fieldName : "";
      if (!source || supported.has(source) || !fieldName) continue;
      removed.push(`#${String(raw.nodeId ?? "")}.${fieldName}（${source}）`);
    }
  }
  return removed;
}

function applyModel() {
  nodes.value = [];
  nodeTypeFilters.value = emptyNodeTypeFilters();
  syncing.value = false;
  syncError.value = "";
  formError.value = "";
  if (props.model) {
    const source = JSON.parse(JSON.stringify(props.model)) as Record<string, unknown>;
    // ACT: mode 单独解析后再写回，避免类型切换时残留其它媒体类型的模式。
    const { id, label, type, workflowId, bindings, durationResolutionMap, imageSizes, mode, ...extra } = source;
    originalExtra = extra;
    const mediaType: MediaType = type === "video" || type === "audio" ? type : "image";
    const next = createDraft();
    next.id = typeof id === "string" ? id : "";
    next.label = typeof label === "string" ? label : "";
    next.type = mediaType;
    next.workflowId = typeof workflowId === "string" ? workflowId : "";
    next.imageSizes = Array.isArray(imageSizes) ? imageSizes.filter((item): item is string => typeof item === "string") : [];
    next.durationResolutionMap = Array.isArray(durationResolutionMap) ? durationResolutionMap.map(row => ({
      duration: Array.isArray(row?.duration) ? row.duration.map(String) : [],
      resolution: Array.isArray(row?.resolution) ? row.resolution.map(String) : [],
    })) : [];
    const parsedModes = parseModes(mediaType, mode);
    next.modes = parsedModes.selected;
    next.mixedReferenceCounts = parsedModes.mixed;
    next.extraModes = parsedModes.extra;
    next.removedSources = collectUnsupportedSources(bindings);
    const parsed = Array.isArray(bindings) ? bindings.map(normalizeBinding).filter((item): item is Binding => Boolean(item)) : [];
    const fixedValues = new Map<string, Record<string, DefaultValue>>();
    const originalFields = new Map<string, string[]>();
    for (const binding of parsed) {
      if (binding.role === "output") {
        if (binding.mediaType === mediaType) {
          if (!next.outputRows.some(row => row.nodeId === binding.nodeId)) next.outputRows.push({ key: rowKey(), nodeId: binding.nodeId });
        } else {
          next.legacyOutputs.push({ ...binding });
        }
        continue;
      }
      for (const field of binding.fields) {
        if (field.source === "original") {
          if (field.inputSource) {
            next.rowsBySource[rowGroupForSource(field.inputSource)].push({ key: rowKey(), nodeId: binding.nodeId, fieldName: field.fieldName, mode: "original" });
          } else {
            const fields = originalFields.get(binding.nodeId) ?? [];
            if (!fields.includes(field.fieldName)) fields.push(field.fieldName);
            originalFields.set(binding.nodeId, fields);
          }
          continue;
        }
        if (field.source === "fixed" && field.inputSource) {
          next.rowsBySource[rowGroupForSource(field.inputSource)].push({
            key: rowKey(), nodeId: binding.nodeId, fieldName: field.fieldName,
            mode: "fixed", fixedValue: field.disabled === true ? "None" : field.value,
          });
          continue;
        }
        if (field.source === "fixed") {
          const value = field.disabled === true ? "None" : field.value;
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            const values = fixedValues.get(binding.nodeId) ?? {};
            values[field.fieldName] = value;
            fixedValues.set(binding.nodeId, values);
          }
          continue;
        }
        next.rowsBySource[rowGroupForSource(field.source as BindingSource)].push({
          key: rowKey(),
          nodeId: binding.nodeId,
          fieldName: field.fieldName,
          mode: field.disabled === true ? "fixed" : "frontend",
          fixedValue: field.disabled === true ? "None" : undefined,
        });
      }
    }
    savedDefaultValues = fixedValues;
    next.defaultNodes = [...new Set([...fixedValues.keys(), ...originalFields.keys()])].map(nodeId => ({
      key: rowKey(), nodeId, values: { ...(fixedValues.get(nodeId) ?? {}) }, originalFields: originalFields.get(nodeId) ?? [],
    }));
    draft.value = next;
    originalType.value = mediaType;
    idTouched.value = true;
  } else {
    originalExtra = {};
    savedDefaultValues = new Map();
    draft.value = createDraft();
    originalType.value = "";
    idTouched.value = false;
    updateAutoId();
  }
}

function updateAutoId() {
  if (idTouched.value) return;
  const workflowId = draft.value.workflowId.trim();
  draft.value.id = workflowId ? `rh-${workflowId}-${draft.value.type}` : "";
}

function currentApiKey() {
  return typeof props.config.apiKey === "string" ? props.config.apiKey.trim() : "";
}

async function syncNodes() {
  const workflowId = draft.value.workflowId.trim();
  if (!workflowId) {
    syncError.value = "请填写 ComfyUI 工作流 ID";
    return;
  }
  const apiKey = currentApiKey();
  if (!apiKey) {
    syncError.value = "请先在上方供应商配置中填写 API Key";
    return;
  }
  syncing.value = true;
  syncError.value = "";
  try {
    const { data } = await axios.post<{ code: number; data?: { nodes: WorkflowNode[] }; message?: string }>(
      "/api/providers/media/workflow",
      {
        fileName: props.fileName,
        workflowId,
        apiKey,
        site: props.config.site === "cn" ? "cn" : "intl",
      },
      { timeout: 65000 },
    );
    if (data.code !== 200 || !data.data) throw new Error(data.message || "同步节点失败");
    nodes.value = Array.isArray(data.data.nodes) ? data.data.nodes : [];
    for (const scope of Object.keys(nodeTypeFilters.value) as NodeTypeScope[]) {
      if (!nodeTypes.value.includes(nodeTypeFilters.value[scope])) nodeTypeFilters.value[scope] = "";
    }
    mergeDefaultNodeValues();
    for (const source of inputSourceOrder) {
      for (const nodeId of new Set(draft.value.rowsBySource[source].map(row => row.nodeId))) addMissingNodeFields(source, nodeId);
    }
    ensureImageBindings();
    syncError.value = nodes.value.length ? "" : "工作流中没有可用节点";
  } catch (error) {
    syncError.value = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "同步节点失败，请重试";
  } finally {
    syncing.value = false;
  }
}

const nodeOptions = computed<WorkflowNode[]>(() => {
  const options = nodes.value.map(node => ({ ...node, inputs: [...node.inputs] }));
  const known = new Set(options.map(node => node.nodeId));
  const ids: string[] = [];
  const collect = (nodeId: string) => {
    if (nodeId && !ids.includes(nodeId)) ids.push(nodeId);
  };
  for (const rows of Object.values(draft.value.rowsBySource)) for (const row of rows) collect(row.nodeId);
  for (const row of draft.value.defaultNodes) collect(row.nodeId);
  for (const row of draft.value.outputRows) collect(row.nodeId);
  for (const item of draft.value.legacyOutputs) collect(item.nodeId);
  for (const nodeId of ids) {
    if (known.has(nodeId)) continue;
    known.add(nodeId);
    options.push({ nodeId, classType: "", title: "已保存节点", inputs: [] });
  }
  return options;
});

watch(
  visible,
  isVisible => {
    if (!isVisible) return;
    applyModel();
    if (draft.value.workflowId && currentApiKey()) void syncNodes();
  },
  { immediate: true },
);
watch([() => draft.value.workflowId, () => draft.value.type], updateAutoId);

const presetGroups = computed(() => presetDefs[draft.value.type]);
const presetSources = computed(() => new Set(presetGroups.value.map(item => item.source)));
const legacyGroups = computed(() => inputSourceOrder
  .filter(source => !presetSources.value.has(source) && draft.value.rowsBySource[source].length > 0)
  .map(source => ({ source, label: sourceLabels[source] })));
const outputLabel = computed(() => outputLabels[draft.value.type]);
const typeChanged = computed(() => Boolean(props.model) && originalType.value !== "" && draft.value.type !== originalType.value);

function enabledRows(source: ParamSource) {
  return draft.value.rowsBySource[source].filter(row => row.mode === "frontend").length;
}

// ACT: 仅提示缺失的输入节点，不阻止保存，便于先声明模式再补绑定。
const videoModeImageRequirements = [
  { mode: "singleImage", minImages: 1, message: "已勾选「单图参考」，但没有启用中的参考图节点，生成时图片不会传入。" },
  { mode: "endFrameOptional", minImages: 1, message: "已勾选「首帧参考」，但没有启用中的参考图节点。" },
  { mode: "startFrameOptional", minImages: 1, message: "已勾选「尾帧参考」，但没有启用中的参考图节点。" },
  { mode: "startEndRequired", minImages: 2, message: "已勾选「首尾帧参考」，需要至少两个启用中的参考图节点，并按行顺序使用第一张和第二张。" },
] as const;

function buildModeWarnings() {
  const selected = draft.value.modes;
  const warnings: string[] = [];
  if (draft.value.type === "image") {
    if (selected.includes("singleImage") && !enabledRows("image")) warnings.push("已勾选「参考生图」，但没有启用中的参考图节点，生成时图片不会传入。");
    return warnings;
  }
  if (draft.value.type !== "video") return warnings;
  for (const item of videoModeImageRequirements) {
    if (selected.includes(item.mode) && enabledRows("image") < item.minImages) warnings.push(item.message);
  }
  if (selected.includes("multiReference")) {
    if (!enabledRows("image") && !enabledRows("video") && !enabledRows("audio")) warnings.push("已勾选「混合参考」，但没有启用中的参考图、参考视频或参考音频节点。");
    if (!mixedReferenceOptions.some(item => draft.value.mixedReferenceCounts[item.key] >= 1)) warnings.push("混合参考的参考数量至少需要一项大于 0。");
  }
  return warnings;
}

const modeWarnings = computed(buildModeWarnings);

function nodeLabel(nodeId: string) {
  const node = nodeOptions.value.find(item => item.nodeId === nodeId);
  return node ? `#${nodeId} · ${node.title}` : `#${nodeId}`;
}

function nodeOptionLabel(node: WorkflowNode) {
  const label = `#${node.nodeId} · ${node.title}`;
  return node.classType ? `${label} · ${node.classType}` : label;
}

function fieldsOf(nodeId: string) {
  return nodeOptions.value.find(node => node.nodeId === nodeId)?.inputs ?? [];
}

function workflowValue(nodeId: string, fieldName: string) {
  return fieldsOf(nodeId).find(input => input.name === fieldName)?.value;
}

function pairKey(nodeId: string, fieldName: string) {
  return `${nodeId.trim()}\u0000${fieldName.trim()}`;
}

function usedPairs(exclude?: InputRow) {
  const used = new Set<string>();
  for (const rows of Object.values(draft.value.rowsBySource)) {
    for (const row of rows) {
      if (exclude && row.key === exclude.key) continue;
      if (row.nodeId && row.fieldName) used.add(pairKey(row.nodeId, row.fieldName));
    }
  }
  return used;
}

function valueTypeOf(value: DefaultValue): ValueType {
  return typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
}

function setDefaultValue(node: DefaultNode, name: string, value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") node.values[name] = value;
}

function valuesForNode(nodeId: string) {
  const values: Record<string, DefaultValue> = { ...(savedDefaultValues.get(nodeId) ?? {}) };
  for (const input of fieldsOf(nodeId)) {
    if (input.value !== undefined && !Object.hasOwn(values, input.name)) values[input.name] = input.value;
  }
  return values;
}

// ACT: 同步节点后为默认参数补全新增字段，已有数值保持不变。
function mergeDefaultNodeValues() {
  for (const node of draft.value.defaultNodes) {
    for (const [name, value] of Object.entries(valuesForNode(node.nodeId))) {
      if (!Object.hasOwn(node.values, name)) node.values[name] = value;
    }
  }
}

function defaultFields(node: DefaultNode): DefaultField[] {
  const used = usedPairs();
  const fields: DefaultField[] = fieldsOf(node.nodeId).map(input => ({
    name: input.name,
    valueType: input.valueType,
    used: used.has(pairKey(node.nodeId, input.name)),
  }));
  for (const [name, value] of Object.entries(node.values)) {
    if (fields.some(field => field.name === name)) continue;
    fields.push({ name, valueType: valueTypeOf(value), used: used.has(pairKey(node.nodeId, name)) });
  }
  for (const name of node.originalFields) {
    if (!fields.some(field => field.name === name)) fields.push({ name, valueType: "string", used: used.has(pairKey(node.nodeId, name)) });
  }
  if (node.fieldOrder) {
    const positions = new Map(node.fieldOrder.map((name, index) => [name, index]));
    fields.sort((first, second) => (positions.get(first.name) ?? fields.length) - (positions.get(second.name) ?? fields.length));
  }
  return fields;
}

function defaultFieldMode(node: DefaultNode, fieldName: string) {
  return node.originalFields.includes(fieldName) ? "original" : "fixed";
}

function defaultFieldValue(node: DefaultNode, fieldName: string) {
  return defaultFieldMode(node, fieldName) === "original" ? workflowValue(node.nodeId, fieldName) : node.values[fieldName];
}

function onDefaultModeChange(node: DefaultNode, fieldName: string, mode: "fixed" | "original") {
  node.originalFields = node.originalFields.filter(name => name !== fieldName);
  if (mode === "original") node.originalFields.push(fieldName);
  const value = workflowValue(node.nodeId, fieldName);
  if (value !== undefined) node.values[fieldName] = value;
}

// ACT: 图片的「分辨率」分组统一承载 ResolutionSelector 的全部参数：aspect_ratio 前端选比例，megapixels 由分辨率选项换算，其余只能固定值。
type FieldPolicy = { nodeClass: string; frontend?: Record<string, ValueType> };
const imageFieldPolicies: Partial<Record<ParamSource, FieldPolicy>> = {
  ratio: { nodeClass: "ResolutionSelector", frontend: { aspect_ratio: "string", megapixels: "number" } },
};
// ACT: 比例分组的绑定优先于其它分组，用于去重时保留正确来源。
const policySourceOrder: ParamSource[] = ["ratio", ...inputSourceOrder.filter(source => source !== "ratio")];

function policyFor(source: ParamSource) {
  return draft.value.type === "image" ? imageFieldPolicies[source] : undefined;
}

function nodeAllowedForSource(source: ParamSource, node: WorkflowNode, keepNodeId?: string) {
  const policy = policyFor(source);
  if (!policy) return true;
  // ACT: 未同步的已保存节点没有 classType，保留可选，避免同步失败时丢失已有绑定。
  return !node.classType || node.classType === policy.nodeClass || node.nodeId === keepNodeId;
}

function isResolutionSelectorNode(nodeId: string) {
  return nodeOptions.value.find(node => node.nodeId === nodeId)?.classType === "ResolutionSelector";
}

function ratioOptionsOfField(nodeId: string, fieldName: string) {
  const classType = nodeOptions.value.find(node => node.nodeId === nodeId)?.classType ?? "";
  return knownFieldOptions[`${classType}.${fieldName}`] ?? [];
}

// ACT: 比例绑定的选项会成为卡片的比例选项；None 行不参与推导。
const derivedRatios = computed(() => {
  const result: string[] = [];
  for (const row of draft.value.rowsBySource.ratio) {
    if (row.mode !== "frontend") continue;
    for (const option of ratioOptionsOfField(row.nodeId, row.fieldName)) {
      const value = option.trim();
      if (value && !result.includes(value)) result.push(value);
    }
  }
  return result;
});

// ACT: 早期版本把 ResolutionSelector 的参数放在「分辨率」（size）等分组；现在统一收进「分辨率」分组。
function policyTargetForRow(row: InputRow) {
  if (draft.value.type !== "image") return undefined;
  const classType = nodeOptions.value.find(node => node.nodeId === row.nodeId)?.classType ?? "";
  if (classType && classType !== "ResolutionSelector") return undefined;
  return classType === "ResolutionSelector" || row.fieldName === "aspect_ratio" || row.fieldName === "megapixels" ? "ratio" : undefined;
}

function migrateImageRows() {
  if (draft.value.type !== "image") return;
  for (const source of inputSourceOrder) {
    const rows = draft.value.rowsBySource[source];
    for (let index = rows.length - 1; index >= 0; index--) {
      const target = policyTargetForRow(rows[index]!);
      if (!target || target === source) continue;
      const [row] = rows.splice(index, 1);
      if (row) draft.value.rowsBySource[target].push(row);
    }
  }
}

// ACT: 同一字段只能绑定一次，保留比例/分辨率分组里的那一行。
function dropDuplicateRows() {
  if (draft.value.type !== "image") return;
  const seen = new Set<string>();
  for (const source of policySourceOrder) {
    draft.value.rowsBySource[source] = draft.value.rowsBySource[source].filter(row => {
      const key = pairKey(row.nodeId, row.fieldName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function promoteToFrontend(row: InputRow) {
  if (row.mode === "frontend") return;
  row.mode = "frontend";
  row.fixedValue = workflowValue(row.nodeId, row.fieldName) ?? row.fixedValue;
}

function ensureRow(source: ParamSource, match: (row: InputRow) => boolean) {
  const rows = draft.value.rowsBySource[source];
  const existing = rows.find(match);
  if (existing) {
    promoteToFrontend(existing);
    return;
  }
  const pair = firstAvailablePair(source);
  if (!pair) return;
  rows.push({ key: rowKey(), nodeId: pair.node.nodeId, fieldName: pair.field.name, mode: "frontend", fixedValue: pair.field.value });
}

// ACT: 按字段名找未占用的 ResolutionSelector 参数，用于自动补 megapixels 行。
function findFieldPair(source: ParamSource, fieldName: string) {
  const used = usedPairs();
  for (const node of nodeOptions.value) {
    if (!nodeAllowedForSource(source, node)) continue;
    const field = node.inputs.find(input => input.name === fieldName && !used.has(pairKey(node.nodeId, input.name)));
    if (field) return { node, field };
  }
  return undefined;
}

function ensureFieldRow(source: ParamSource, fieldName: string) {
  const rows = draft.value.rowsBySource[source];
  const existing = rows.find(row => row.fieldName === fieldName);
  if (existing) {
    promoteToFrontend(existing);
    return;
  }
  const pair = findFieldPair(source, fieldName);
  if (!pair) return;
  rows.push({ key: rowKey(), nodeId: pair.node.nodeId, fieldName: pair.field.name, mode: "frontend", fixedValue: pair.field.value });
}

// ACT: 图片模型只要工作流里放入了 ResolutionSelector，就在「分辨率」分组自动绑定 aspect_ratio；配置了分辨率时再补 megapixels。
function ensureImageBindings() {
  if (draft.value.type !== "image") return;
  migrateImageRows();
  if (!draft.value.rowsBySource.ratio.some(row => row.mode === "frontend" && row.fieldName === "aspect_ratio")) {
    ensureRow("ratio", row => ratioOptionsOfField(row.nodeId, row.fieldName).length > 0);
  }
  if (draft.value.imageSizes.length) ensureFieldRow("ratio", "megapixels");
  dropDuplicateRows();
}

const ratioWarnings = computed(() => {
  // ACT: megapixels 没有内置比例选项，不参与比例选项推导的告警。
  const rows = draft.value.rowsBySource.ratio.filter(row => row.mode === "frontend" && row.fieldName !== "megapixels");
  if (!rows.length) return [];
  const optionSets = rows.map(row => ratioOptionsOfField(row.nodeId, row.fieldName)).filter(options => options.length);
  const warnings: string[] = [];
  if (!optionSets.length) {
    warnings.push("所选字段没有内置选项，卡片将隐藏比例选项。");
    return warnings;
  }
  if (new Set(optionSets.map(options => JSON.stringify(options))).size > 1) warnings.push("多个分辨率节点的选项不一致，卡片会合并显示所有选项。");
  if (optionSets.length < rows.length) warnings.push("部分节点字段没有内置选项，无法同步到卡片。");
  return warnings;
});

function defaultNodeChoices(row?: DefaultNode, nodeType = "") {
  return nodeOptions.value.filter(node => (!nodeType || node.classType === nodeType)
    && !draft.value.defaultNodes.some(item => item.key !== row?.key && item.nodeId === node.nodeId));
}

const canAddDefaultNode = computed(() => defaultNodeChoices(undefined, nodeTypeFilters.value.default).length > 0);

function addDefaultNode() {
  const node = defaultNodeChoices(undefined, nodeTypeFilters.value.default)[0];
  if (!node) return;
  draft.value.defaultNodes.push({ key: rowKey(), nodeId: node.nodeId, values: valuesForNode(node.nodeId), originalFields: [] });
}

function onDefaultNodeChange(node: DefaultNode) {
  node.values = valuesForNode(node.nodeId);
  node.originalFields = [];
  node.fieldOrder = undefined;
}

function onDefaultFieldSelect(node: DefaultNode, fieldName: string, selectedName: string) {
  if (fieldName === selectedName) return;
  const order = defaultFields(node).map(field => field.name);
  const first = order.indexOf(fieldName);
  const second = order.indexOf(selectedName);
  if (first < 0 || second < 0) return;
  [order[first], order[second]] = [order[second]!, order[first]!];
  node.fieldOrder = order;
}

function removeDefaultNode(node: DefaultNode) {
  const index = draft.value.defaultNodes.findIndex(item => item.key === node.key);
  if (index >= 0) draft.value.defaultNodes.splice(index, 1);
}

function preferredType(source: ParamSource): ValueType {
  return source === "duration" ? "number" : "string";
}

function firstAvailablePair(source: ParamSource, nodeType = "") {
  const used = usedPairs();
  const candidates: { node: WorkflowNode; field: WorkflowNode["inputs"][number] }[] = [];
  for (const node of nodeOptions.value) {
    if (nodeType && node.classType !== nodeType) continue;
    if (!nodeAllowedForSource(source, node)) continue;
    for (const field of node.inputs) {
      if (!used.has(pairKey(node.nodeId, field.name))) candidates.push({ node, field });
    }
  }
  if (source === "ratio") {
    const configured = candidates.find(item => ratioOptionsOfField(item.node.nodeId, item.field.name).length > 0);
    if (configured) return configured;
  }
  return candidates.find(item => item.field.valueType === preferredType(source)) ?? candidates[0];
}

function fieldChoices(source: ParamSource, row: InputRow): FieldChoice[] {
  const inputs = fieldsOf(row.nodeId);
  const used = usedPairs(row);
  const groupFields = new Set(draft.value.rowsBySource[source].filter(item => item.nodeId === row.nodeId).map(item => item.fieldName));
  const choices: FieldChoice[] = inputs
    .filter(input => !used.has(pairKey(row.nodeId, input.name)) || groupFields.has(input.name))
    .map(input => ({ name: input.name, valueType: input.valueType, status: "ok" }));
  const current = row.fieldName.trim();
  if (current && !choices.some(choice => choice.name === current)) {
    const input = inputs.find(item => item.name === current);
    choices.unshift({ name: current, valueType: input?.valueType ?? "string", status: input ? "duplicate" : "missing" });
  }
  return choices;
}

function inputNodeChoices(source: ParamSource, selectedNodeId: string) {
  return nodeOptions.value.filter(node => nodeAllowedForSource(source, node, selectedNodeId));
}

function fieldLabel(choice: FieldChoice) {
  if (choice.status === "missing") return `${choice.name}（未在同步结果中）`;
  if (choice.status === "duplicate") return `${choice.name}（已被其他行使用）`;
  return `${choice.name}（${valueTypeLabels[choice.valueType]}）`;
}

function fieldMissing(row: InputRow) {
  const inputs = fieldsOf(row.nodeId);
  return Boolean(inputs.length && row.fieldName && !inputs.some(input => input.name === row.fieldName));
}

function fieldValueType(row: InputRow) {
  return fieldsOf(row.nodeId).find(item => item.name === row.fieldName)?.valueType ?? "string";
}

function canUseFrontend(source: ParamSource, row: InputRow) {
  const input = fieldsOf(row.nodeId).find(item => item.name === row.fieldName);
  const policy = policyFor(source);
  if (policy) {
    // ACT: 只有 aspect_ratio / megapixels 允许前端设置；未同步时按字段名判断，保证同步失败也能保存。
    const valueType = policy.frontend?.[row.fieldName];
    if (!valueType) return false;
    return !input || input.valueType === valueType;
  }
  return !input || input.valueType === preferredType(source);
}

function onFieldChange(source: ParamSource, row: InputRow) {
  if (row.mode === "frontend" && !canUseFrontend(source, row)) row.mode = "fixed";
  if (row.mode !== "frontend") row.fixedValue = workflowValue(row.nodeId, row.fieldName);
}

function onFieldSelect(source: ParamSource, row: InputRow, fieldName: string) {
  const previous = row.fieldName;
  if (fieldName === previous) return;
  const other = draft.value.rowsBySource[source].find(item => item.key !== row.key && item.nodeId === row.nodeId && item.fieldName === fieldName);
  if (!other) {
    row.fieldName = fieldName;
    onFieldChange(source, row);
    return;
  }
  const mode = row.mode;
  const fixedValue = row.fixedValue;
  row.fieldName = other.fieldName;
  row.mode = other.mode;
  row.fixedValue = other.fixedValue;
  other.fieldName = previous;
  other.mode = mode;
  other.fixedValue = fixedValue;
}

function onModeChange(row: InputRow) {
  if (row.mode === "original" || row.mode === "fixed" && row.fixedValue === undefined) row.fixedValue = workflowValue(row.nodeId, row.fieldName);
}

function setRowFixedValue(row: InputRow, value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") row.fixedValue = value;
}

function onNodeChange(source: ParamSource, row: InputRow) {
  const inputs = fieldsOf(row.nodeId);
  if (!inputs.length) {
    if (row.mode === "fixed") row.fixedValue = undefined;
    return;
  }
  const used = usedPairs(row);
  const current = inputs.find(input => input.name === row.fieldName);
  if (!current || used.has(pairKey(row.nodeId, current.name))) {
    const next = inputs.find(input => input.valueType === preferredType(source) && !used.has(pairKey(row.nodeId, input.name)))
      ?? inputs.find(input => !used.has(pairKey(row.nodeId, input.name)));
    row.fieldName = next?.name ?? "";
  }
  onFieldChange(source, row);
}

function onNodeGroupChange(source: ParamSource, rows: InputRow[]) {
  const first = rows[0];
  if (!first?.nodeId) return;
  const removed = new Set(rows.slice(1).map(row => row.key));
  draft.value.rowsBySource[source] = draft.value.rowsBySource[source].filter(row => !removed.has(row.key));
  onNodeChange(source, first);
  addMissingNodeFields(source, first.nodeId);
}

function addMissingNodeFields(source: ParamSource, nodeId: string) {
  const node = nodes.value.find(item => item.nodeId === nodeId);
  if (!node) return;
  const defaults = draft.value.defaultNodes.find(item => item.nodeId === nodeId);
  const saved = savedDefaultValues.get(nodeId);
  for (const input of node.inputs) {
    if (usedPairs().has(pairKey(nodeId, input.name))) continue;
    const value = defaults?.values[input.name] ?? saved?.[input.name] ?? input.value;
    const mode = defaults?.originalFields.includes(input.name) ? "original" : "fixed";
    draft.value.rowsBySource[source].push({ key: rowKey(), nodeId, fieldName: input.name, mode, fixedValue: value });
    if (defaults) delete defaults.values[input.name];
    if (defaults) defaults.originalFields = defaults.originalFields.filter(name => name !== input.name);
    if (saved) delete saved[input.name];
  }
  for (const row of Object.values(draft.value.rowsBySource).flat()) {
    if (row.nodeId !== nodeId) continue;
    if (defaults) delete defaults.values[row.fieldName];
    if (defaults) defaults.originalFields = defaults.originalFields.filter(name => name !== row.fieldName);
    if (saved) delete saved[row.fieldName];
  }
  if (defaults && !Object.keys(defaults.values).length && !defaults.originalFields.length) removeDefaultNode(defaults);
}

function groupedRows(source: ParamSource) {
  const groups = new Map<string, InputRow[]>();
  for (const row of draft.value.rowsBySource[source]) {
    const key = row.nodeId || row.key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups].map(([key, rows]) => ({ key, rows }));
}

function addRow(source: ParamSource) {
  const pair = firstAvailablePair(source, nodeTypeFilters.value[source]);
  if (!pair) {
    formError.value = "没有可添加的节点参数；如需复用，请先删除其它分组中的对应行";
    return;
  }
  formError.value = "";
  const mode = pair.field.valueType === preferredType(source) ? "frontend" : "fixed";
  draft.value.rowsBySource[source].push({ key: rowKey(), nodeId: pair.node.nodeId, fieldName: pair.field.name, mode, fixedValue: pair.field.value });
  addMissingNodeFields(source, pair.node.nodeId);
}

function removeNodeGroup(source: ParamSource, groupRows: InputRow[]) {
  const keys = new Set(groupRows.map(row => row.key));
  draft.value.rowsBySource[source] = draft.value.rowsBySource[source].filter(row => !keys.has(row.key));
}

function outputNodeChoices(row?: OutputRow, nodeType = "") {
  return nodeOptions.value.filter(node => (!nodeType || node.classType === nodeType)
    && !draft.value.outputRows.some(item => item.key !== row?.key && item.nodeId === node.nodeId));
}

const canAddOutput = computed(() => outputNodeChoices(undefined, nodeTypeFilters.value.output).length > 0);

function addOutputRow() {
  const node = outputNodeChoices(undefined, nodeTypeFilters.value.output)[0];
  if (!node) return;
  draft.value.outputRows.push({ key: rowKey(), nodeId: node.nodeId });
}

function removeOutputRow(index: number) {
  draft.value.outputRows.splice(index, 1);
}

function moveOutputRow(index: number, offset: number) {
  const rows = draft.value.outputRows;
  const target = index + offset;
  if (target < 0 || target >= rows.length) return;
  const [row] = rows.splice(index, 1);
  if (row) rows.splice(target, 0, row);
}

function labelForSource(source: InputSource) {
  return presetGroups.value.find(item => item.source === source)?.label ?? sourceLabels[source];
}

function validateSelectorValue(nodeId: string, fieldName: string, value: DefaultValue) {
  if (value === "None") return;
  if (nodeOptions.value.find(item => item.nodeId === nodeId)?.classType !== "ResolutionSelector") return;
  if (fieldName === "megapixels" && (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 16)) throw new Error("megapixels 须在 0.1–16 之间");
  if (fieldName === "multiple" && (typeof value !== "number" || !Number.isInteger(value) || value < 8 || value > 128 || value % 4 !== 0)) throw new Error("multiple 须为 8–128 之间的 4 的倍数");
}

function fixedValueForRow(row: InputRow, source: ParamSource): DefaultValue {
  const raw = row.fixedValue;
  if (raw === undefined) throw new Error(`参数「${labelForSource(source)} · ${row.fieldName}」缺少固定值`);
  const valueType = fieldValueType(row);
  if (valueType === "number" && typeof raw === "string" && !raw.trim()) throw new Error(`${row.fieldName} 须为有效数字`);
  const value = valueType === "number" && raw !== "None" ? Number(raw) : raw;
  if (valueType === "number" && raw !== "None" && !Number.isFinite(value)) throw new Error(`${row.fieldName} 须为有效数字`);
  if (valueType === "boolean" && raw !== "None" && typeof value !== "boolean") throw new Error(`${row.fieldName} 须为布尔值`);
  validateSelectorValue(row.nodeId, row.fieldName, value);
  return value;
}

const capabilityKeys = ["mode", "imageSizes", "imageRatios", "videoRatios", "durationResolutionMap"] as const;

// ACT: 能力字段先全部清空再按最终类型写回，避免切换类型后残留其它媒体类型的配置。
// 空数组表示卡片不显示对应选项（与视频模型一致），不再通过删除字段表达。
function applyCapabilities(value: MediaProviderModel) {
  for (const key of capabilityKeys) Reflect.deleteProperty(value, key);
  if (draft.value.type !== "video") Reflect.deleteProperty(value, "audio");
  const modes = serializeModes(draft.value.type, draft.value.modes, draft.value.mixedReferenceCounts, draft.value.extraModes);
  if (modes.length) value.mode = modes;
  if (draft.value.type === "image") {
    const sizes = [...new Set(draft.value.imageSizes.map(item => item.trim()).filter(Boolean))];
    const ratioRows = draft.value.rowsBySource.ratio;
    const mbRow = ratioRows.find(row => row.mode === "frontend" && row.fieldName === "megapixels");
    if (sizes.some(item => item.length > 64)) throw new Error("图片分辨率选项不能超过 64 个字符");
    if (mbRow && !sizes.length) throw new Error("megapixels 使用前端设置时，请先填写分辨率选项");
    if (sizes.some(item => !isValidMegapixels(item))) throw new Error("分辨率须能换算为 0.1–16 之间的 megapixels，请使用 1K、2K 或 1024x1024 这类写法");
    if (ratioRows.some(row => row.mode === "frontend" && row.fieldName === "aspect_ratio") && !derivedRatios.value.length) throw new Error("请在「分辨率」分组绑定 ResolutionSelector 的 aspect_ratio 参数");
    value.imageSizes = sizes;
    value.imageRatios = derivedRatios.value;
    return;
  }
  if (draft.value.type === "video") {
    const rows = draft.value.durationResolutionMap.filter(row => row.duration.length || row.resolution.length);
    if (rows.length) {
      value.durationResolutionMap = rows.map((row, index) => {
        const duration = row.duration.map(Number);
        const resolution = row.resolution.map(item => item.trim());
        if (!duration.length || duration.some(item => !Number.isFinite(item) || item <= 0)) throw new Error(`第 ${index + 1} 组时长必须是正数`);
        if (!resolution.length || resolution.some(item => !item)) throw new Error(`请填写第 ${index + 1} 组分辨率`);
        return { duration, resolution };
      });
    }
    value.videoRatios = derivedRatios.value;
  }
}

// ACT: 与适配器的 sizeToMegapixels 保持一致，仅用于保存前校验 ResolutionSelector 的 megapixels 范围。
function sizeMegapixels(value: string) {
  const k = /^(\d+(?:\.\d+)?)\s*k$/i.exec(value);
  if (k) return Number(k[1]);
  const px = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value);
  if (px) return Number((Number(px[1]) * Number(px[2]) / 1e6).toFixed(2));
  return undefined;
}

function isValidMegapixels(value: string) {
  if (!draft.value.rowsBySource.ratio.some(row => row.mode === "frontend" && row.fieldName === "megapixels")) return true;
  const megapixels = sizeMegapixels(value);
  return megapixels !== undefined && megapixels >= 0.1 && megapixels <= 16;
}

function confirmModel() {
  formError.value = "";
  try {
    if (!idTouched.value) updateAutoId();
    const label = draft.value.label.trim();
    const id = draft.value.id.trim();
    const workflowId = draft.value.workflowId.trim();
    if (!label || !id) throw new Error("请填写显示名称和模型 ID");
    if (!workflowId) throw new Error("请填写 ComfyUI 工作流 ID");
    if (!/^[A-Za-z0-9_-]+$/.test(workflowId)) throw new Error("工作流 ID 只能包含字母、数字、下划线和短横线");
    if (id.length > 200) throw new Error("模型 ID 不能超过 200 个字符");
    if (props.models.some(item => item !== props.model && String(item.id).trim() === id)) throw new Error(`模型 ID 已存在：${id}`);
    ensureImageBindings();

    const bindings: Binding[] = [];
    const seen = new Set<string>();
    for (const source of inputSourceOrder) {
      draft.value.rowsBySource[source].forEach((row, index) => {
        const nodeId = row.nodeId.trim();
        const fieldName = row.fieldName.trim();
        if (!nodeId) throw new Error(`参数「${labelForSource(source)}」第 ${index + 1} 行缺少节点`);
        if (!fieldName) throw new Error(`参数「${labelForSource(source)}」第 ${index + 1} 行缺少参数名`);
        const key = pairKey(nodeId, fieldName);
        if (seen.has(key)) throw new Error(`节点 #${nodeId} 的字段 ${fieldName} 被重复绑定`);
        seen.add(key);
        if (row.mode === "frontend" && !canUseFrontend(source, row)) throw new Error(`节点 #${nodeId} 的字段 ${fieldName} 不支持前端设置`);
        // ACT: megapixels 行展示在「分辨率」分组，但绑定来源仍是 megapixels。
        const fieldSource = bindingSourceFor(source, fieldName);
        const field: BindingField = row.mode === "frontend" ? { fieldName, source: fieldSource }
          : row.mode === "original" ? { fieldName, source: "original", inputSource: fieldSource }
            : { fieldName, source: "fixed", inputSource: fieldSource, value: fixedValueForRow(row, source) };
        bindings.push({ role: "input", nodeId, fields: [field] });
      });
    }
    // ACT: 默认参数按节点写入固定值；同一字段已由输入参数控制时以输入参数为准。
    const defaultNodeIds = new Set<string>();
    for (const node of draft.value.defaultNodes) {
      const nodeId = node.nodeId.trim();
      if (!nodeId) throw new Error("默认参数节点缺少节点 ID");
      if (defaultNodeIds.has(nodeId)) throw new Error(`默认参数节点重复：#${nodeId}`);
      defaultNodeIds.add(nodeId);
      for (const field of defaultFields(node)) {
        if (field.used) continue;
        const key = pairKey(nodeId, field.name);
        if (node.originalFields.includes(field.name)) {
          if (!seen.has(key)) {
            seen.add(key);
            bindings.push({ role: "input", nodeId, fields: [{ fieldName: field.name, source: "original" }] });
          }
          continue;
        }
        const raw = node.values[field.name];
        if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") throw new Error(`默认参数「${nodeLabel(nodeId)} · ${field.name}」缺少有效数值`);
        if (field.valueType === "number" && typeof raw === "string" && !raw.trim()) throw new Error(`${field.name} 须为有效数字`);
        const value = field.valueType === "number" && raw !== "None" ? Number(raw) : raw;
        if (field.valueType === "number" && raw !== "None" && !Number.isFinite(value)) throw new Error(`${field.name} 须为有效数字`);
        validateSelectorValue(nodeId, field.name, value);
        if (seen.has(key)) continue;
        seen.add(key);
        bindings.push({ role: "input", nodeId, fields: [{ fieldName: field.name, source: "fixed", value }] });
      }
    }

    if (!draft.value.outputRows.length) throw new Error("请至少添加一个输出节点");
    const outputSeen = new Set<string>();
    for (const row of draft.value.outputRows) {
      const nodeId = row.nodeId.trim();
      if (!nodeId) throw new Error("输出节点缺少节点 ID");
      if (outputSeen.has(nodeId)) throw new Error(`输出节点重复：#${nodeId}`);
      outputSeen.add(nodeId);
      bindings.push({ role: "output", nodeId, mediaType: draft.value.type });
    }
    for (const binding of draft.value.legacyOutputs) bindings.push({ ...binding });

    const value: MediaProviderModel = {
      ...originalExtra,
      id,
      label,
      type: draft.value.type,
      workflowId,
      bindings,
    };
    applyCapabilities(value);
    emit("confirmed", value);
    visible.value = false;
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "模型配置无效";
  }
}
</script>

<style lang="scss" scoped>
.dialogContent {
  max-height: min(72dvh, calc(100dvh - 210px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 8px;

  .el-select { width: 100%; }

  .workflowRow {
    display: flex;
    width: 100%;
    gap: 8px;

    .el-input { min-width: 0; }
    .el-button { flex-shrink: 0; }
  }

  .fieldHint {
    display: block;
    margin-top: 6px;
    line-height: 1.5;
  }

  .typeAlert { margin-bottom: 12px; }

  .imageResolutionOptions {
    width: 100%;

    .el-input-tag { width: 100%; }
  }

  .generationModes {
    width: 100%;

    .el-checkbox-group {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
    }

    .mixedCounts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin-top: 10px;

      label {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }

      .el-input-number { width: 96px; }
    }
  }

  .mappingEditor {
    width: 100%;

    .mappingHeader {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      padding: 0 44px 4px 26px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .mappingRow {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) 16px minmax(0, 1fr) 32px;
      align-items: start;
      gap: 8px;
      margin-bottom: 8px;

      .rowIndex, > svg { margin-top: 8px; color: var(--el-text-color-secondary); }
      .el-button { width: 32px; padding: 0; }
    }

    .addMapping { width: 100%; margin-top: 4px; }
  }

  .paramSection {
    width: 100%;
    margin-top: 12px;
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);

    .sectionHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;

      h4 {
        margin: 0;
        font-size: 14px;
      }
    }

    .paramGroup {
      padding-top: 10px;

      &:first-of-type { padding-top: 0; }
    }

    .paramHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }

    .paramName {
      font-size: 13px;
      font-weight: 600;
    }

    .addNodeControls {
      display: flex;
      align-items: center;
      gap: 8px;

      .nodeTypeSelect { width: 160px; }
      .el-button { flex-shrink: 0; }
    }

    .paramRows {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-x: auto;
    }

    .paramNode {
      min-width: 660px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);
    }

    .paramRow {
      display: grid;
      grid-template-columns: minmax(160px, 1.15fr) minmax(130px, 1fr) 116px minmax(150px, 0.9fr) 32px;
      align-items: center;
      gap: 8px;
      padding: 8px;

      &.outputRow {
        grid-template-columns: minmax(0, 1fr) auto;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--el-border-radius-base);

        .rowActions { grid-column: 2; }
      }

      .nodeSelect, .fieldSelect, .modeSelect { min-width: 0; }
      .nodeSpacer { grid-column: 1; }

      .rowMeta {
        grid-column: 2 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }

      .fixedValue {
        grid-column: 4;
        grid-row: 1;
        min-width: 0;
      }

      .rowActions {
        grid-column: 5;
        grid-row: 1;
        display: flex;
        flex-shrink: 0;

        .el-button { width: 32px; padding: 0; }
      }
    }

    .emptyGroup { display: block; padding: 2px 0 4px; }

    .defaultParamRow {
      .defaultUsed { grid-column: 3 / 5; }

      .defaultValue {
        grid-column: 4;
        grid-row: 1;
        min-width: 0;
      }

      .rowMeta { grid-column: 2 / 5; }
    }
  }

  .legacySection {
    .legacyGroup + .legacyGroup { margin-top: 8px; }

    .legacyRow {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
    }

    .legacyNode { font-weight: 600; }
    .legacyField { color: var(--el-text-color-secondary); }
  }
}

.dialogFooter {
  display: flex;
  align-items: center;
  gap: 12px;

  .footerErrors {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow-wrap: anywhere;

    .el-text { display: block; }
  }

  .footerActions {
    display: flex;
    gap: 12px;
    margin-left: auto;

    .el-button + .el-button { margin-left: 0; }
  }
}
</style>
