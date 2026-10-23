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
            <el-button text size="small" :icon="IconPlus" :disabled="!hasAvailableField" @click="addRow(group.source)">添加节点</el-button>
          </div>
          <div v-if="draft.rowsBySource[group.source].length" class="paramRows">
            <div
              v-for="(row, index) in draft.rowsBySource[group.source]"
              :key="row.key"
              class="paramRow"
              :class="{ rowDisabled: row.disabled }">
              <el-select v-model="row.nodeId" class="nodeSelect" filterable aria-label="节点" @change="onNodeChange(group.source, row)">
                <el-option v-for="node in nodeOptions" :key="node.nodeId" :value="node.nodeId" :label="`#${node.nodeId} · ${node.title}`">
                  <span>#{{ node.nodeId }} · {{ node.title }}</span>
                  <el-text v-if="node.classType && node.classType !== node.title" type="info" size="small">{{ node.classType }}</el-text>
                </el-option>
              </el-select>
              <template v-if="fieldsOf(row.nodeId).length">
                <el-select v-model="row.fieldName" class="fieldSelect" filterable aria-label="字段">
                  <el-option v-for="choice in fieldChoices(row)" :key="choice.name" :value="choice.name" :label="fieldLabel(choice)">
                    <span>{{ fieldLabel(choice) }}</span>
                  </el-option>
                </el-select>
              </template>
              <el-input v-else v-model="row.fieldName" class="fieldSelect" placeholder="输入工作流中的参数名" aria-label="参数名" />
              <el-switch v-model="row.disabled" active-text="None" inactive-text="使用" :aria-label="`${group.label}第 ${index + 1} 行是否使用`" />
              <div class="rowActions">
                <el-button text size="small" :icon="IconArrowUp" :disabled="index === 0" aria-label="上移" @click="moveRow(group.source, index, -1)" />
                <el-button text size="small" :icon="IconArrowDown" :disabled="index === draft.rowsBySource[group.source].length - 1" aria-label="下移" @click="moveRow(group.source, index, 1)" />
                <el-button text size="small" type="danger" :icon="IconTrash" aria-label="删除节点" @click="removeRow(group.source, index)" />
              </div>
              <div class="rowMeta">
                <el-text v-if="row.disabled" type="warning" size="small">生成时写入 None，不占用参考素材</el-text>
                <el-text v-else-if="fieldDefault(row)" type="info" size="small">{{ fieldDefault(row) }}</el-text>
                <el-text v-if="fieldMissing(row)" type="warning" size="small">参数未在同步结果中</el-text>
                <el-text v-if="!fieldsOf(row.nodeId).length" type="info" size="small">该节点未同步，无法校验参数</el-text>
              </div>
            </div>
          </div>
          <el-text v-else class="emptyGroup" type="info" size="small">未绑定节点</el-text>
          <template v-if="group.source === 'ratio'">
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
          <el-button text size="small" :icon="IconPlus" :disabled="!canAddDefaultNode" @click="addDefaultNode">添加节点</el-button>
        </div>
        <div v-if="draft.defaultNodes.length" class="defaultNodes">
          <div v-for="(node, index) in draft.defaultNodes" :key="node.key" class="defaultNode">
            <div class="defaultNodeHeader">
              <el-select v-model="node.nodeId" filterable aria-label="默认参数节点" @change="onDefaultNodeChange(node)">
                <el-option v-for="item in defaultNodeChoices(node)" :key="item.nodeId" :value="item.nodeId" :label="`#${item.nodeId} · ${item.title}`">
                  <span>#{{ item.nodeId }} · {{ item.title }}</span>
                  <el-text v-if="item.classType && item.classType !== item.title" type="info" size="small">{{ item.classType }}</el-text>
                </el-option>
              </el-select>
              <el-button text size="small" type="danger" :icon="IconTrash" :aria-label="`删除默认参数节点 ${index + 1}`" @click="removeDefaultNode(index)" />
            </div>
            <div v-if="defaultFields(node).length" class="defaultFields">
              <div v-for="field in defaultFields(node)" :key="field.name" class="defaultField" :class="{ fieldDisabled: field.used }">
                <span class="defaultFieldName" :title="field.name">{{ field.name }}</span>
                <el-switch
                  v-if="field.valueType === 'boolean'"
                  :model-value="node.values[field.name] as boolean"
                  :disabled="field.used"
                  :aria-label="`${field.name} 默认值`"
                  @update:model-value="value => setDefaultValue(node, field.name, value)" />
                <el-input-number
                  v-else-if="field.valueType === 'number'"
                  :model-value="node.values[field.name] as number"
                  :disabled="field.used"
                  controlsPosition="right"
                  size="small"
                  :aria-label="`${field.name} 默认值`"
                  @update:model-value="value => setDefaultValue(node, field.name, value)" />
                <el-select
                  v-else-if="defaultFieldOptions(node, field)"
                  :model-value="node.values[field.name] as string"
                  :disabled="field.used"
                  size="small"
                  :aria-label="`${field.name} 默认值`"
                  @update:model-value="value => setDefaultValue(node, field.name, value)">
                  <el-option v-for="option in (defaultFieldOptions(node, field) ?? [])" :key="option" :value="option" :label="option" />
                </el-select>
                <el-input
                  v-else
                  :model-value="node.values[field.name] as string"
                  :disabled="field.used"
                  size="small"
                  :aria-label="`${field.name} 默认值`"
                  @update:model-value="value => setDefaultValue(node, field.name, value)" />
                <el-text v-if="field.used" type="warning" size="small">已由输入参数控制</el-text>
              </div>
            </div>
            <el-text v-else class="fieldHint" type="info" size="small">该节点没有可设置的参数，或尚未同步节点信息。</el-text>
          </div>
        </div>
        <el-text v-else class="emptyGroup" type="info" size="small">未指定默认参数</el-text>
        <el-text class="fieldHint" type="info" size="small">这些数值会写入指定节点并覆盖工作流默认值；已被输入参数控制的字段不会写入。</el-text>
      </div>

      <div class="paramSection">
        <div class="sectionHeader">
          <h4>{{ outputLabel }}</h4>
          <el-button text size="small" :icon="IconPlus" :disabled="!canAddOutput" @click="addOutputRow">添加输出节点</el-button>
        </div>
        <div v-if="draft.outputRows.length" class="paramRows">
          <div v-for="(row, index) in draft.outputRows" :key="row.key" class="paramRow outputRow">
            <el-select v-model="row.nodeId" class="nodeSelect" filterable aria-label="输出节点">
              <el-option v-for="node in outputNodeChoices(row)" :key="node.nodeId" :value="node.nodeId" :label="`#${node.nodeId} · ${node.title}`">
                <span>#{{ node.nodeId }} · {{ node.title }}</span>
                <el-text v-if="node.classType && node.classType !== node.title" type="info" size="small">{{ node.classType }}</el-text>
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
            <el-text v-if="row.disabled" type="warning" size="small">写入 None</el-text>
          </div>
        </div>
        <el-text class="fieldHint" type="info" size="small">这些参数不属于当前模型类型的预设分组，会原样保存；切回对应类型后可继续编辑。</el-text>
      </div>

      <el-alert v-if="syncError" :title="syncError" type="error" :closable="false" showIcon />
      <el-alert v-if="formError" class="formError" :title="formError" type="error" :closable="false" showIcon />
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="confirmModel">确定</el-button>
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
  | "ratio"
  | "fixed";
type ParamSource = Exclude<InputSource, "fixed">;
type ValueType = "string" | "number" | "boolean";
type BindingField = { fieldName: string; source: InputSource; value?: string | number | boolean; disabled?: boolean };
type InputBinding = { role: "input"; nodeId: string; fields: BindingField[] };
type OutputBinding = { role: "output"; nodeId: string; mediaType: MediaType };
type Binding = InputBinding | OutputBinding;
type WorkflowNode = {
  nodeId: string;
  classType: string;
  title: string;
  inputs: { name: string; valueType: ValueType; value?: string | number | boolean }[];
};
type InputRow = { key: string; nodeId: string; fieldName: string; disabled: boolean };
type OutputRow = { key: string; nodeId: string };
type DefaultValue = string | number | boolean;
type DefaultNode = { key: string; nodeId: string; values: Record<string, DefaultValue> };
type DefaultField = { name: string; valueType: ValueType; used: boolean };
type ParamDef = { source: ParamSource; label: string };
type FieldChoice = { name: string; valueType: ValueType; status: "ok" | "missing" | "duplicate" };
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
const inputSourceOrder: ParamSource[] = ["prompt", "image", "video", "audio", "duration", "ratio"];
const sourceLabels: Record<InputSource, string> = {
  prompt: "参考词",
  image: "参考图",
  video: "参考视频",
  audio: "参考音频",
  duration: "时长（秒）",
  ratio: "分辨率",
  fixed: "固定值",
};
const presetDefs: Record<MediaType, ParamDef[]> = {
  image: [
    { source: "prompt", label: "参考词" },
    { source: "image", label: "参考图" },
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
const allSources: InputSource[] = [...inputSourceOrder, "fixed"];

function emptyRows(): Record<ParamSource, InputRow[]> {
  return Object.fromEntries(inputSourceOrder.map(source => [source, [] as InputRow[]])) as Record<ParamSource, InputRow[]>;
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
    return result;
  };
  // ACT: 兼容旧版每条绑定只有一个字段的结构。
  const fields = Array.isArray(item.fields) ? item.fields.map(toField).filter((field): field is BindingField => Boolean(field)) : [toField(item)].filter((field): field is BindingField => Boolean(field));
  return fields.length ? { role: "input", nodeId, fields } : undefined;
}

function applyModel() {
  nodes.value = [];
  syncing.value = false;
  syncError.value = "";
  formError.value = "";
  if (props.model) {
    const source = JSON.parse(JSON.stringify(props.model)) as Record<string, unknown>;
    // ACT: mode 单独解析后再写回，避免类型切换时残留其它媒体类型的模式。
    const { id, label, type, workflowId, bindings, durationResolutionMap, mode, ...extra } = source;
    originalExtra = extra;
    const mediaType: MediaType = type === "video" || type === "audio" ? type : "image";
    const next = createDraft();
    next.id = typeof id === "string" ? id : "";
    next.label = typeof label === "string" ? label : "";
    next.type = mediaType;
    next.workflowId = typeof workflowId === "string" ? workflowId : "";
    next.durationResolutionMap = Array.isArray(durationResolutionMap) ? durationResolutionMap.map(row => ({
      duration: Array.isArray(row?.duration) ? row.duration.map(String) : [],
      resolution: Array.isArray(row?.resolution) ? row.resolution.map(String) : [],
    })) : [];
    let mixedModeSeen = false;
    for (const item of Array.isArray(mode) ? mode : []) {
      if (Array.isArray(item)) {
        if (!item.every(entry => typeof entry === "string")) continue;
        if (mixedModeSeen) next.extraModes.push(item as string[]);
        else {
          mixedModeSeen = true;
          next.videoModes.push("multiReference");
        }
        continue;
      }
      if (typeof item !== "string") continue;
      const option = videoModeOptions.find(entry => entry.value === item);
      if (option) {
        if (!next.videoModes.includes(option.value)) next.videoModes.push(option.value);
      } else next.extraModes.push(item);
    }
    const parsed = Array.isArray(bindings) ? bindings.map(normalizeBinding).filter((item): item is Binding => Boolean(item)) : [];
    const fixedValues = new Map<string, Record<string, DefaultValue>>();
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
          disabled: field.disabled === true,
        });
      }
    }
    savedDefaultValues = fixedValues;
    next.defaultNodes = [...fixedValues.entries()].map(([nodeId, values]) => ({ key: rowKey(), nodeId, values: { ...values } }));
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
    mergeDefaultNodeValues();
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
  return draft.value.rowsBySource[source].filter(row => !row.disabled).length;
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

function nodeLabel(nodeId: string) {
  const node = nodeOptions.value.find(item => item.nodeId === nodeId);
  return node ? `#${nodeId} · ${node.title}` : `#${nodeId}`;
}

function fieldsOf(nodeId: string) {
  return nodeOptions.value.find(node => node.nodeId === nodeId)?.inputs ?? [];
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
  return fields;
}

function defaultFieldOptions(node: DefaultNode, field: DefaultField) {
  const classType = nodeOptions.value.find(item => item.nodeId === node.nodeId)?.classType ?? "";
  const options = knownFieldOptions[`${classType}.${field.name}`];
  if (!options) return undefined;
  const current = node.values[field.name];
  return typeof current === "string" && !options.includes(current) ? [current, ...options] : options;
}

function ratioOptionsOfField(nodeId: string, fieldName: string) {
  const classType = nodeOptions.value.find(node => node.nodeId === nodeId)?.classType ?? "";
  return knownFieldOptions[`${classType}.${fieldName}`] ?? [];
}

// ACT: 分辨率绑定的选项会成为视频卡片的比例选项；None 行不参与推导。
const derivedVideoRatios = computed(() => {
  const result: string[] = [];
  for (const row of draft.value.rowsBySource.ratio) {
    if (row.disabled) continue;
    for (const option of ratioOptionsOfField(row.nodeId, row.fieldName)) {
      const value = option.trim();
      if (value && !result.includes(value)) result.push(value);
    }
  }
  return result;
});

const ratioWarnings = computed(() => {
  const rows = draft.value.rowsBySource.ratio.filter(row => !row.disabled);
  if (!rows.length) return [];
  const optionSets = rows.map(row => ratioOptionsOfField(row.nodeId, row.fieldName)).filter(options => options.length);
  const warnings: string[] = [];
  if (!optionSets.length) {
    warnings.push("所选字段没有内置选项，视频卡片将保持默认比例。");
    return warnings;
  }
  if (new Set(optionSets.map(options => JSON.stringify(options))).size > 1) warnings.push("多个分辨率节点的选项不一致，卡片会合并显示所有选项。");
  if (optionSets.length < rows.length) warnings.push("部分节点字段没有内置选项，无法同步到卡片。");
  return warnings;
});

function defaultNodeChoices(row?: DefaultNode) {
  return nodeOptions.value.filter(node => !draft.value.defaultNodes.some(item => item.key !== row?.key && item.nodeId === node.nodeId));
}

const canAddDefaultNode = computed(() => defaultNodeChoices().length > 0);

function addDefaultNode() {
  const node = defaultNodeChoices()[0];
  if (!node) return;
  draft.value.defaultNodes.push({ key: rowKey(), nodeId: node.nodeId, values: valuesForNode(node.nodeId) });
}

function onDefaultNodeChange(node: DefaultNode) {
  node.values = valuesForNode(node.nodeId);
}

function removeDefaultNode(index: number) {
  draft.value.defaultNodes.splice(index, 1);
}

function preferredType(source: ParamSource): ValueType {
  return source === "duration" ? "number" : "string";
}

function firstAvailablePair(source: ParamSource) {
  const used = usedPairs();
  const candidates: { node: WorkflowNode; field: WorkflowNode["inputs"][number] }[] = [];
  for (const node of nodeOptions.value) {
    for (const field of node.inputs) {
      if (!used.has(pairKey(node.nodeId, field.name))) candidates.push({ node, field });
    }
  }
  if (source === "ratio") {
    const configured = candidates.find(item => knownFieldOptions[`${item.node.classType}.${item.field.name}`]);
    if (configured) return configured;
  }
  return candidates.find(item => item.field.valueType === preferredType(source)) ?? candidates[0];
}

const hasAvailableField = computed(() => {
  const used = usedPairs();
  return nodeOptions.value.some(node => node.inputs.some(input => !used.has(pairKey(node.nodeId, input.name))));
});

function fieldChoices(row: InputRow): FieldChoice[] {
  const inputs = fieldsOf(row.nodeId);
  const used = usedPairs(row);
  const choices: FieldChoice[] = inputs
    .filter(input => !used.has(pairKey(row.nodeId, input.name)))
    .map(input => ({ name: input.name, valueType: input.valueType, status: "ok" }));
  const current = row.fieldName.trim();
  if (current && !choices.some(choice => choice.name === current)) {
    const input = inputs.find(item => item.name === current);
    choices.unshift({ name: current, valueType: input?.valueType ?? "string", status: input ? "duplicate" : "missing" });
  }
  return choices;
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

function shortText(value: string | number | boolean) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function fieldDefault(row: InputRow) {
  const input = fieldsOf(row.nodeId).find(item => item.name === row.fieldName);
  if (!input) return "";
  const type = valueTypeLabels[input.valueType];
  return input.value === undefined ? type : `${type} · 当前值：${shortText(input.value)}`;
}

function onNodeChange(source: ParamSource, row: InputRow) {
  const inputs = fieldsOf(row.nodeId);
  if (!inputs.length) return;
  const used = usedPairs(row);
  const current = inputs.find(input => input.name === row.fieldName);
  if (current && !used.has(pairKey(row.nodeId, current.name))) return;
  const next = inputs.find(input => input.valueType === preferredType(source) && !used.has(pairKey(row.nodeId, input.name)))
    ?? inputs.find(input => !used.has(pairKey(row.nodeId, input.name)));
  row.fieldName = next?.name ?? "";
}

function addRow(source: ParamSource) {
  const pair = firstAvailablePair(source);
  if (!pair) {
    formError.value = "没有可添加的节点参数；如需复用，请先删除其它分组中的对应行";
    return;
  }
  formError.value = "";
  draft.value.rowsBySource[source].push({ key: rowKey(), nodeId: pair.node.nodeId, fieldName: pair.field.name, disabled: false });
}

function removeRow(source: ParamSource, index: number) {
  draft.value.rowsBySource[source].splice(index, 1);
}

function moveRow(source: ParamSource, index: number, offset: number) {
  const rows = draft.value.rowsBySource[source];
  const target = index + offset;
  if (target < 0 || target >= rows.length) return;
  const [row] = rows.splice(index, 1);
  if (row) rows.splice(target, 0, row);
}

function outputNodeChoices(row?: OutputRow) {
  return nodeOptions.value.filter(node => !draft.value.outputRows.some(item => item.key !== row?.key && item.nodeId === node.nodeId));
}

const canAddOutput = computed(() => outputNodeChoices().length > 0);

function addOutputRow() {
  const node = outputNodeChoices()[0];
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
        const field: BindingField = { fieldName, source };
        if (row.disabled) field.disabled = true;
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
        const value = node.values[field.name];
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`默认参数「${nodeLabel(nodeId)} · ${field.name}」缺少有效数值`);
        const key = pairKey(nodeId, field.name);
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
      if (ratios.length) value.videoRatios = ratios;
      else if (!draft.value.rowsBySource.ratio.length) Reflect.deleteProperty(value, "videoRatios");
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

  .videoModes {
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
      border-top: 1px dashed var(--el-border-color-lighter);

      &:first-of-type {
        padding-top: 0;
        border-top: 0;
      }
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

    .paramRows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .paramRow {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      &.rowDisabled { background: var(--el-fill-color-lighter); }

      &.outputRow { grid-template-columns: minmax(0, 1fr) auto; }

      .nodeSelect, .fieldSelect { min-width: 0; }

      .rowMeta {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }

      .rowActions {
        display: flex;
        flex-shrink: 0;
      }
    }

    .emptyGroup { display: block; padding: 2px 0 4px; }

    .defaultNode {
      padding: 8px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      & + .defaultNode { margin-top: 8px; }

      .defaultNodeHeader {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        .el-select { flex: 1; min-width: 0; }
        .el-button { flex-shrink: 0; }
      }

      .defaultFields {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .defaultField {
        display: grid;
        grid-template-columns: minmax(110px, 0.9fr) minmax(0, 1.3fr) auto;
        align-items: center;
        gap: 8px;

        &.fieldDisabled { opacity: 0.75; }

        .defaultFieldName {
          overflow: hidden;
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
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

.formError { margin-top: 12px; }

@media (max-width: 720px) {
  .dialogContent .paramSection .paramRow {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

    .rowActions {
      grid-column: 1 / -1;
      justify-self: end;
    }
  }
}
</style>
