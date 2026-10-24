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
        <el-form-item v-if="draft.type === 'image'" label="图片生成模式">
          <div class="imageModes">
            <el-checkbox-group v-model="draft.imageModes">
              <el-checkbox v-for="item in imageModeOptions" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox>
            </el-checkbox-group>
            <el-text v-for="warning in imageModeWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
          </div>
        </el-form-item>
        <el-form-item v-if="draft.type === 'video'" label="视频生成模式">
          <div class="videoModes">
            <el-checkbox-group v-model="draft.videoModes">
              <el-checkbox v-for="item in videoModeOptions" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox>
            </el-checkbox-group>
            <el-text class="fieldHint" type="info" size="small">
              勾选工作流支持的生成方式，视频节点会据此显示模式选项。首帧/尾帧参考使用「参考图」区域的第一行，首尾帧参考按行顺序使用前两行；它们分别对应视频节点里的「尾帧可选」「首帧可选」「首尾帧必填」。混合参考最多使用 9 张图片、3 个视频和 3 个音频。
            </el-text>
            <el-text v-for="warning in videoModeWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
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
            <el-text class="fieldHint" type="info" size="small">配置后图片卡片会直接显示这些分辨率。</el-text>
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
        title="模型类型已更改。输出节点将按新类型保存；不属于新类型的参数会原样保留在旧版参数中。" />

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
            <el-text class="fieldHint" type="info" size="small">绑定 ResolutionSelector 节点的 aspect_ratio 参数（与视频模型相同）；该节点的比例选项会作为图片卡片的比例选项，生成时写入所选比例。同步节点时若工作流中存在该节点会自动绑定。</el-text>
            <el-text v-if="derivedImageRatios.length" class="fieldHint" type="info" size="small">图片卡片比例选项：{{ derivedImageRatios.join('、') }}</el-text>
            <el-text v-for="warning in ratioWarnings" :key="warning" class="fieldHint" type="warning" size="small">{{ warning }}</el-text>
          </template>
          <template v-if="draft.type === 'video' && group.source === 'ratio'">
            <el-text class="fieldHint" type="info" size="small">绑定分辨率选择节点（如 ResolutionSelector）的比例字段，字段选项会作为视频卡片的比例选项。</el-text>
            <el-text v-if="derivedVideoRatios.length" class="fieldHint" type="info" size="small">
              视频卡片比例选项：{{ derivedVideoRatios.join('、') }}
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
  | "ratio"
  | "fixed"
  | "original";
type ParamSource = Exclude<InputSource, "fixed" | "original">;
type NodeTypeScope = ParamSource | "default" | "output";
type ValueType = "string" | "number" | "boolean";
type BindingField = { fieldName: string; source: InputSource; value?: string | number | boolean; disabled?: boolean; inputSource?: ParamSource };
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
type ImageModeValue = "text" | "singleImage";
type VideoModeValue = "text" | "singleImage" | "endFrameOptional" | "startFrameOptional" | "startEndRequired" | "multiReference";

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
const imageModeOptions: { value: ImageModeValue; label: string }[] = [
  { value: "text", label: "文生图" },
  { value: "singleImage", label: "参考生图" },
];
// ACT: 复用视频节点已有的模式值；混合参考用固定上限，运行时由节点按参考素材数量匹配。
const videoModeOptions: { value: VideoModeValue; label: string }[] = [
  { value: "text", label: "文生视频" },
  { value: "singleImage", label: "单图参考" },
  { value: "endFrameOptional", label: "首帧参考" },
  { value: "startFrameOptional", label: "尾帧参考" },
  { value: "startEndRequired", label: "首尾帧参考" },
  { value: "multiReference", label: "混合参考" },
];
const mixedReferenceMode = ["imageReference:9", "videoReference:3", "audioReference:3"];
// ACT: 编译与展示顺序固定；组内顺序仍由用户上下移动决定。
const inputSourceOrder: ParamSource[] = ["prompt", "image", "video", "audio", "duration", "size", "ratio"];
const sourceLabels: Record<InputSource, string> = {
  prompt: "参考词",
  image: "参考图",
  video: "参考视频",
  audio: "参考音频",
  duration: "时长（秒）",
  size: "分辨率",
  ratio: "比例",
  fixed: "固定值",
  original: "原始数据",
};
const presetDefs: Record<MediaType, ParamDef[]> = {
  // ACT: 与视频模型一致——「分辨率」分组绑定 ResolutionSelector.aspect_ratio，比例选项由该绑定推导。
  image: [
    { source: "prompt", label: "参考词" },
    { source: "image", label: "参考图" },
    { source: "ratio", label: "分辨率" },
  ],
  video: [
    { source: "prompt", label: "参考词" },
    { source: "image", label: "参考图" },
    { source: "video", label: "参考视频" },
    { source: "audio", label: "参考音频" },
    { source: "duration", label: "时长（秒）" },
    { source: "ratio", label: "分辨率" },
  ],
  audio: [
    { source: "prompt", label: "参考词/文本" },
    { source: "audio", label: "参考音频" },
  ],
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
const allSources: InputSource[] = [...inputSourceOrder, "fixed", "original"];

function emptyRows(): Record<ParamSource, InputRow[]> {
  return Object.fromEntries(inputSourceOrder.map(source => [source, [] as InputRow[]])) as Record<ParamSource, InputRow[]>;
}

function emptyNodeTypeFilters(): Record<NodeTypeScope, string> {
  return { prompt: "", image: "", video: "", audio: "", duration: "", size: "", ratio: "", default: "", output: "" };
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
    imageModes: [] as ImageModeValue[],
    videoModes: [] as VideoModeValue[],
    extraModes: [] as (string | string[])[],
  };
}

let rowSeq = 0;
function rowKey() {
  return `row-${++rowSeq}`;
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
    if ((field.source === "fixed" || field.source === "original") && inputSourceOrder.some(source => source === field.inputSource)) result.inputSource = field.inputSource as ParamSource;
    return result;
  };
  // ACT: 兼容旧版每条绑定只有一个字段的结构。
  const fields = Array.isArray(item.fields) ? item.fields.map(toField).filter((field): field is BindingField => Boolean(field)) : [toField(item)].filter((field): field is BindingField => Boolean(field));
  return fields.length ? { role: "input", nodeId, fields } : undefined;
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
    let mixedModeSeen = false;
    for (const item of Array.isArray(mode) ? mode : []) {
      if (Array.isArray(item)) {
        if (!item.every(entry => typeof entry === "string")) continue;
        if (mediaType !== "video" || mixedModeSeen) next.extraModes.push(item as string[]);
        else {
          mixedModeSeen = true;
          next.videoModes.push("multiReference");
        }
        continue;
      }
      if (typeof item !== "string") continue;
      if (mediaType === "image") {
        const option = imageModeOptions.find(entry => entry.value === item);
        if (option && !next.imageModes.includes(option.value)) next.imageModes.push(option.value);
        else if (!option) next.extraModes.push(item);
      } else if (mediaType === "video") {
        const option = videoModeOptions.find(entry => entry.value === item);
        if (option && !next.videoModes.includes(option.value)) next.videoModes.push(option.value);
        else if (!option) next.extraModes.push(item);
      } else next.extraModes.push(item);
    }
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
            next.rowsBySource[field.inputSource].push({ key: rowKey(), nodeId: binding.nodeId, fieldName: field.fieldName, mode: "original" });
          } else {
            const fields = originalFields.get(binding.nodeId) ?? [];
            if (!fields.includes(field.fieldName)) fields.push(field.fieldName);
            originalFields.set(binding.nodeId, fields);
          }
          continue;
        }
        if (field.source === "fixed" && field.inputSource) {
          next.rowsBySource[field.inputSource].push({
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
        next.rowsBySource[field.source].push({
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
    normalizeImageRatioRows();
    ensureImageRatioBinding();
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
const videoModeWarnings = computed(() => {
  if (draft.value.type !== "video") return [];
  const selected = new Set(draft.value.videoModes);
  const imageCount = enabledRows("image");
  const has = (source: ParamSource) => enabledRows(source) > 0;
  const warnings: string[] = [];
  if (selected.has("singleImage") && imageCount < 1) warnings.push("已勾选「单图参考」，但没有启用中的参考图节点，生成时图片不会传入。");
  if (selected.has("endFrameOptional") && imageCount < 1) warnings.push("已勾选「首帧参考」，但没有启用中的参考图节点。");
  if (selected.has("startFrameOptional") && imageCount < 1) warnings.push("已勾选「尾帧参考」，但没有启用中的参考图节点。");
  if (selected.has("startEndRequired") && imageCount < 2) warnings.push("已勾选「首尾帧参考」，需要至少两个启用中的参考图节点，并按行顺序使用第一张和第二张。");
  if (selected.has("multiReference") && !has("image") && !has("video") && !has("audio")) warnings.push("已勾选「混合参考」，但没有启用中的参考图、参考视频或参考音频节点。");
  return warnings;
});

const imageModeWarnings = computed(() => draft.value.type === "image" && draft.value.imageModes.includes("singleImage") && !enabledRows("image")
  ? ["已勾选「参考生图」，但没有启用中的参考图节点，生成时图片不会传入。"] : []);

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

function ratioOptionsOfField(nodeId: string, fieldName: string) {
  const classType = nodeOptions.value.find(node => node.nodeId === nodeId)?.classType ?? "";
  return knownFieldOptions[`${classType}.${fieldName}`] ?? [];
}

// ACT: 分辨率绑定的选项会成为视频卡片的比例选项；None 行不参与推导。
const derivedVideoRatios = computed(() => {
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
const derivedImageRatios = computed(() => derivedVideoRatios.value);

// ACT: 旧配置可能把其它字段绑定到图片比例；同步后降级为固定值，避免保存时被判定为不支持前端设置。
function normalizeImageRatioRows() {
  if (draft.value.type !== "image") return;
  for (const row of draft.value.rowsBySource.ratio) {
    if (row.mode !== "frontend" || canUseFrontend("ratio", row)) continue;
    // ACT: 字段不在同步结果中时保留原配置，避免丢失已有绑定。
    const input = fieldsOf(row.nodeId).find(item => item.name === row.fieldName);
    if (!input) continue;
    row.mode = "fixed";
    row.fixedValue = input.value;
  }
}

// ACT: 图片模型与视频模型一致——aspect_ratio 的前端绑定统一放在「分辨率」分组，生成时写入卡片所选比例。
function isImageRatioRow(row: InputRow) {
  if (row.fieldName !== "aspect_ratio") return false;
  const classType = nodeOptions.value.find(node => node.nodeId === row.nodeId)?.classType ?? "";
  return !classType || classType === "ResolutionSelector";
}

function isResolutionSelectorNode(nodeId: string) {
  return nodeOptions.value.find(node => node.nodeId === nodeId)?.classType === "ResolutionSelector";
}

// ACT: 早期版本把 aspect_ratio 绑在「分辨率」（size）分组，生成时会把分辨率文字写进比例字段；这里迁回比例来源。
function migrateImageRatioRows() {
  if (draft.value.type !== "image") return;
  if (!draft.value.rowsBySource.ratio.some(row => row.mode === "frontend")) {
    for (const source of inputSourceOrder) {
      if (source === "ratio") continue;
      const rows = draft.value.rowsBySource[source];
      const index = rows.findIndex(row => row.mode === "frontend" && isImageRatioRow(row));
      if (index < 0) continue;
      const [row] = rows.splice(index, 1);
      if (row) draft.value.rowsBySource.ratio.push(row);
      break;
    }
  }
  // ACT: ResolutionSelector 的其余参数（megapixels、multiple 等）与视频模型一样放在同一分组，避免落入「旧版参数」。
  const sizeRows = draft.value.rowsBySource.size;
  for (const row of sizeRows.filter(item => isResolutionSelectorNode(item.nodeId))) {
    sizeRows.splice(sizeRows.indexOf(row), 1);
    draft.value.rowsBySource.ratio.push(row);
  }
}

// ACT: 同一字段只能绑定一次；「分辨率」分组接管 aspect_ratio 后，清除其它分组里的同名绑定。
function dropImageRatioDuplicates() {
  if (draft.value.type !== "image") return;
  const pairs = new Set(draft.value.rowsBySource.ratio.map(row => pairKey(row.nodeId, row.fieldName)));
  for (const source of inputSourceOrder) {
    if (source === "ratio") continue;
    draft.value.rowsBySource[source] = draft.value.rowsBySource[source]
      .filter(row => !pairs.has(pairKey(row.nodeId, row.fieldName)) || !isImageRatioRow(row));
  }
}

// ACT: 图片模型只要工作流里放入了 ResolutionSelector，就自动绑定 aspect_ratio，卡片比例选项与生成时的写入都依赖这条绑定。
function ensureImageRatioBinding() {
  if (draft.value.type !== "image") return;
  const hasFrontendRatio = () => draft.value.rowsBySource.ratio.some(row => row.mode === "frontend");
  if (!hasFrontendRatio()) migrateImageRatioRows();
  if (!hasFrontendRatio()) {
    // 该分组里可能已有 aspect_ratio 的固定值行，直接改为前端设置。
    const existing = draft.value.rowsBySource.ratio.find(row => isImageRatioRow(row) && ratioOptionsOfField(row.nodeId, row.fieldName).length);
    if (existing) {
      existing.mode = "frontend";
      existing.fixedValue = workflowValue(existing.nodeId, existing.fieldName) ?? existing.fixedValue;
    } else {
      const pair = firstAvailablePair("ratio");
      if (!pair || pair.field.valueType !== "string" || !ratioOptionsOfField(pair.node.nodeId, pair.field.name).length) return;
      draft.value.rowsBySource.ratio.push({ key: rowKey(), nodeId: pair.node.nodeId, fieldName: pair.field.name, mode: "frontend", fixedValue: pair.field.value });
    }
  }
  dropImageRatioDuplicates();
}

const ratioWarnings = computed(() => {
  const rows = draft.value.rowsBySource.ratio.filter(row => row.mode === "frontend");
  if (!rows.length) return [];
  const optionSets = rows.map(row => ratioOptionsOfField(row.nodeId, row.fieldName)).filter(options => options.length);
  const warnings: string[] = [];
  if (!optionSets.length) {
    warnings.push("所选字段没有内置选项，卡片将保持默认比例。");
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
    for (const field of node.inputs) {
      if (draft.value.type === "image" && source === "ratio" && (node.classType !== "ResolutionSelector" || field.name !== "aspect_ratio")) continue;
      if (!used.has(pairKey(node.nodeId, field.name))) candidates.push({ node, field });
    }
  }
  if (source === "ratio") {
    const configured = candidates.find(item => knownFieldOptions[`${item.node.classType}.${item.field.name}`]);
    if (configured) return configured;
  }
  return candidates.find(item => item.field.valueType === preferredType(source)) ?? candidates[0];
}

function fieldChoices(source: ParamSource, row: InputRow): FieldChoice[] {
  const inputs = fieldsOf(row.nodeId);
  const used = usedPairs(row);
  const groupFields = new Set(draft.value.rowsBySource[source].filter(item => item.nodeId === row.nodeId).map(item => item.fieldName));
  const choices: FieldChoice[] = inputs
    .filter(input => draft.value.type !== "image" || source !== "ratio" || input.name === "aspect_ratio")
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
  if (draft.value.type !== "image" || source !== "ratio") return nodeOptions.value;
  return nodeOptions.value.filter(node => node.classType === "ResolutionSelector" || node.nodeId === selectedNodeId);
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
  if (draft.value.type === "image" && source === "ratio") {
    const node = nodeOptions.value.find(item => item.nodeId === row.nodeId);
    return node?.classType === "ResolutionSelector" && row.fieldName === "aspect_ratio" && input?.valueType === "string";
  }
  return !input || input.valueType === (source === "duration" ? "number" : "string");
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
    const selectable = draft.value.type === "image" && source === "ratio" ? inputs.filter(input => input.name === "aspect_ratio") : inputs;
    const next = selectable.find(input => input.valueType === preferredType(source) && !used.has(pairKey(row.nodeId, input.name)))
      ?? selectable.find(input => !used.has(pairKey(row.nodeId, input.name)));
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
    migrateImageRatioRows();
    dropImageRatioDuplicates();

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
        const field: BindingField = row.mode === "frontend" ? { fieldName, source }
          : row.mode === "original" ? { fieldName, source: "original", inputSource: source }
            : { fieldName, source: "fixed", inputSource: source, value: fixedValueForRow(row, source) };
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
    if (draft.value.type === "image") {
      const modes: (string | string[])[] = imageModeOptions.filter(option => draft.value.imageModes.includes(option.value)).map(option => option.value);
      modes.push(...draft.value.extraModes);
      if (modes.length) value.mode = modes;
      const sizes = [...new Set(draft.value.imageSizes.map(item => item.trim()).filter(Boolean))];
      const ratios = derivedImageRatios.value;
      if (sizes.some(item => item.length > 64)) throw new Error("图片分辨率选项不能超过 64 个字符");
      if (draft.value.rowsBySource.size.some(row => row.mode === "frontend") && !sizes.length) throw new Error("请填写图片分辨率选项");
      if (draft.value.rowsBySource.ratio.some(row => row.mode === "frontend") && !ratios.length) throw new Error("请在「分辨率」分组绑定 ResolutionSelector 的 aspect_ratio 参数");
      // ACT: 顶部填写的分辨率直接展示在图片卡片上，不要求同时绑定分辨率字段；留空表示卡片不显示分辨率选项。
      value.imageSizes = sizes;
      // ACT: 比例只能来自 ResolutionSelector.aspect_ratio 绑定；没有绑定时不写入空数组，避免卡片隐藏比例。
      if (draft.value.rowsBySource.ratio.some(row => row.mode === "frontend")) value.imageRatios = ratios;
      else Reflect.deleteProperty(value, "imageRatios");
    }
    if (draft.value.type === "video") {
      const modes: (string | string[])[] = [];
      for (const option of videoModeOptions) {
        if (!draft.value.videoModes.includes(option.value)) continue;
        modes.push(option.value === "multiReference" ? [...mixedReferenceMode] : option.value);
      }
      modes.push(...draft.value.extraModes);
      if (modes.length) value.mode = modes;
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
      const ratios = derivedVideoRatios.value;
      value.videoRatios = ratios;
    } else {
      Reflect.deleteProperty(value, "videoRatios");
    }
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

  .imageModes, .videoModes {
    width: 100%;

    .el-checkbox-group {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
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
