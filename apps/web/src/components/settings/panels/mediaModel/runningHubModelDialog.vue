<template>
  <el-dialog
    v-model="visible"
    :title="model ? '编辑 RunningHub 模型' : '添加 RunningHub 模型'"
    width="min(760px, calc(100vw - 32px))"
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
        <el-form-item label="ComfyUI 工作流 ID" required>
          <div class="workflowRow">
            <el-input v-model="draft.workflowId" clearable aria-label="ComfyUI 工作流 ID" placeholder="填写 RunningHub 工作流 ID" />
            <el-button :icon="IconRefresh" :loading="syncing" :disabled="!draft.workflowId.trim()" @click="syncNodes">同步节点</el-button>
            <el-button :icon="IconPlus" :disabled="!nodes.length" @click="openBinding()">添加</el-button>
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
      <div class="bindingSection">
        <div class="bindingHeader">
          <h4>节点绑定</h4>
          <el-text type="info" size="small">{{ nodes.length ? `已同步 ${nodes.length} 个节点` : '请先同步工作流节点' }}</el-text>
        </div>
        <div v-if="bindingEditorVisible" class="bindingEditor">
          <el-form labelPosition="top" @submit.prevent>
            <el-form-item label="节点" required>
              <div class="nodeRow">
                <el-select v-model="bindingDraft.nodeId" aria-label="节点" @change="selectNode">
                  <el-option v-for="node in nodeChoices" :key="node.nodeId" :value="node.nodeId" :label="`#${node.nodeId} · ${node.title}`">
                    <span>#{{ node.nodeId }} · {{ node.title }}</span>
                    <el-text v-if="node.classType && node.classType !== node.title" type="info" size="small">{{ node.classType }}</el-text>
                  </el-option>
                </el-select>
                <el-select v-model="bindingDraft.role" class="roleSelect" aria-label="用途">
                  <el-option value="input" label="输入" />
                  <el-option value="output" label="输出" />
                </el-select>
              </div>
            </el-form-item>
            <template v-if="bindingDraft.role === 'input'">
              <el-form-item label="参数" required>
                <div class="fieldEditor">
                  <div v-for="field in bindingDraft.fields" :key="field.fieldName" class="fieldRow">
                    <span class="fieldName">{{ field.fieldName }}</span>
                    <el-text class="fieldType" type="info" size="small">（{{ valueTypeLabels[field.valueType] }}）</el-text>
                    <el-select v-model="field.source" class="sourceSelect" aria-label="绑定来源">
                      <el-option v-for="item in sourceOptions" :key="item.value" :value="item.value" :label="item.label" />
                    </el-select>
                    <template v-if="field.source === 'fixed'">
                      <el-input v-if="field.valueType === 'string'" v-model="field.fixedText" class="fixedValue" placeholder="固定值" aria-label="固定值" />
                      <el-input-number v-else-if="field.valueType === 'number'" v-model="field.fixedNumber" class="fixedValue" controlsPosition="right" aria-label="固定值" />
                      <el-switch v-else v-model="field.fixedBoolean" aria-label="固定值" />
                    </template>
                  </div>
                  <el-text v-if="!bindingDraft.fields.length" type="info" size="small">该节点没有可覆盖的参数，请先在供应商配置中同步节点。</el-text>
                </div>
              </el-form-item>
            </template>
            <el-form-item v-else label="输出媒体类型" required>
              <el-select v-model="bindingDraft.mediaType" aria-label="输出媒体类型">
                <el-option v-for="item in mediaTypes" :key="item.value" :value="item.value" :label="item.label" />
              </el-select>
            </el-form-item>
          </el-form>
          <el-alert v-if="bindingError" :title="bindingError" type="error" :closable="false" showIcon />
          <div class="bindingEditorActions">
            <el-button size="small" @click="bindingEditorVisible = false">取消</el-button>
            <el-button size="small" type="primary" @click="confirmBinding">{{ bindingIndex === undefined ? '添加' : '保存' }}</el-button>
          </div>
        </div>
        <div v-if="draft.bindings.length" class="bindingList">
          <div v-for="(binding, index) in draft.bindings" :key="index" class="bindingRow">
            <div class="bindingInfo">
              <span class="bindingTitle">{{ nodeLabel(binding.nodeId) }}</span>
              <span class="bindingDetail">{{ bindingSummary(binding) }}</span>
            </div>
            <div class="bindingActions">
              <el-button text size="small" :icon="IconArrowUp" :disabled="index === 0" aria-label="上移" @click="moveBinding(index, -1)" />
              <el-button text size="small" :icon="IconArrowDown" :disabled="index === draft.bindings.length - 1" aria-label="下移" @click="moveBinding(index, 1)" />
              <el-button text size="small" :icon="IconEdit" aria-label="编辑节点绑定" @click="openBinding(index)" />
              <el-button text size="small" type="danger" :icon="IconTrash" aria-label="删除节点绑定" @click="draft.bindings.splice(index, 1)" />
            </div>
          </div>
        </div>
        <el-text v-else type="info" size="small">暂无节点绑定</el-text>
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
import { IconArrowDown, IconArrowRight, IconArrowUp, IconEdit, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-vue";
import type { MediaProviderModel } from "./types";

type MediaType = "image" | "video" | "audio";
type InputSource =
  | "prompt"
  | "image"
  | "firstFrame"
  | "lastFrame"
  | "video"
  | "audio"
  | "ratio"
  | "duration"
  | "resolution"
  | "fixed";
type BindingField = { fieldName: string; source: InputSource; value?: string | number | boolean };
type InputBinding = { role: "input"; nodeId: string; fields: BindingField[] };
type OutputBinding = { role: "output"; nodeId: string; mediaType: MediaType };
type Binding = InputBinding | OutputBinding;
type WorkflowNode = {
  nodeId: string;
  classType: string;
  title: string;
  inputs: { name: string; valueType: "string" | "number" | "boolean"; value?: string | number | boolean }[];
};

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
const allSourceOptions: { value: InputSource; label: string }[] = [
  { value: "prompt", label: "提示词" },
  { value: "image", label: "参考图" },
  { value: "firstFrame", label: "首帧" },
  { value: "lastFrame", label: "尾帧" },
  { value: "video", label: "参考视频" },
  { value: "audio", label: "参考音频" },
  { value: "ratio", label: "画面比例" },
  { value: "duration", label: "时长（秒）" },
  { value: "resolution", label: "分辨率" },
  { value: "fixed", label: "固定值" },
];
const videoOnlySources: InputSource[] = ["duration", "resolution"];
const valueTypeLabels: Record<"string" | "number" | "boolean", string> = { string: "文本", number: "数字", boolean: "布尔" };

const draft = ref(createDraft());
const sourceOptions = computed(() => allSourceOptions.filter(item => draft.value.type === "video" || !videoOnlySources.includes(item.value)));
const nodes = ref<WorkflowNode[]>([]);
const syncing = ref(false);
const syncError = ref("");
const formError = ref("");
const bindingEditorVisible = ref(false);
const bindingIndex = ref<number>();
const bindingError = ref("");
const bindingDraft = ref(createBindingDraft());
const idTouched = ref(false);
let originalExtra: Record<string, unknown> = {};

function createDraft() {
  return {
    id: "",
    label: "",
    type: "image" as MediaType,
    workflowId: "",
    bindings: [] as Binding[],
    durationResolutionMap: [] as { duration: string[]; resolution: string[] }[],
  };
}

type FieldDraft = {
  fieldName: string;
  source: InputSource;
  valueType: "string" | "number" | "boolean";
  fixedText: string;
  fixedNumber: number;
  fixedBoolean: boolean;
};

function createFieldDraft(fieldName = "", valueType: FieldDraft["valueType"] = "string", value?: string | number | boolean): FieldDraft {
  const draft: FieldDraft = {
    fieldName,
    source: "fixed",
    valueType,
    fixedText: "",
    fixedNumber: 0,
    fixedBoolean: false,
  };
  if (typeof value === "number" && Number.isFinite(value)) {
    draft.fixedNumber = value;
    draft.fixedText = String(value);
  } else if (typeof value === "boolean") {
    draft.fixedBoolean = value;
    draft.fixedText = String(value);
  } else if (typeof value === "string") {
    draft.fixedText = value;
  }
  return draft;
}

function fieldsForNode(node?: WorkflowNode): FieldDraft[] {
  return (node?.inputs ?? []).map(input => createFieldDraft(input.name, input.valueType, input.value));
}

function createBindingDraft(): {
  nodeId: string;
  role: "input" | "output";
  fields: FieldDraft[];
  mediaType: MediaType;
} {
  return {
    nodeId: "",
    role: "input",
    fields: [],
    mediaType: draft.value.type,
  };
}

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
    if (!allSourceOptions.some(source => source.value === field.source)) return undefined;
    const result: BindingField = { fieldName: field.fieldName.trim(), source: field.source as InputSource };
    if (typeof field.value === "string" || typeof field.value === "number" || typeof field.value === "boolean") result.value = field.value;
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
  bindingEditorVisible.value = false;
  bindingError.value = "";
  bindingIndex.value = undefined;
  if (props.model) {
    const source = JSON.parse(JSON.stringify(props.model)) as Record<string, unknown>;
    const { id, label, type, workflowId, bindings, durationResolutionMap, ...extra } = source;
    originalExtra = extra;
    draft.value = {
      id: typeof id === "string" ? id : "",
      label: typeof label === "string" ? label : "",
      type: type === "video" || type === "audio" ? type : "image",
      workflowId: typeof workflowId === "string" ? workflowId : "",
      bindings: Array.isArray(bindings) ? bindings.map(normalizeBinding).filter((item): item is Binding => Boolean(item)) : [],
      durationResolutionMap: Array.isArray(durationResolutionMap) ? durationResolutionMap.map(row => ({
        duration: Array.isArray(row?.duration) ? row.duration.map(String) : [],
        resolution: Array.isArray(row?.resolution) ? row.resolution.map(String) : [],
      })) : [],
    };
    idTouched.value = true;
  } else {
    originalExtra = {};
    draft.value = createDraft();
    idTouched.value = false;
    updateAutoId();
  }
  bindingDraft.value = createBindingDraft();
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
  for (const binding of draft.value.bindings) {
    if (known.has(binding.nodeId)) continue;
    known.add(binding.nodeId);
    options.push({ nodeId: binding.nodeId, classType: "", title: "已保存节点", inputs: [] });
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

function nodeLabel(nodeId: string) {
  const node = nodeOptions.value.find(item => item.nodeId === nodeId);
  return node ? `#${nodeId} · ${node.title}` : `#${nodeId}`;
}

function bindingSummary(binding: Binding) {
  if (binding.role === "output") return `输出 · ${mediaTypes.find(item => item.value === binding.mediaType)?.label ?? binding.mediaType}`;
  return "输入 · " + binding.fields.map(field => {
    const source = allSourceOptions.find(item => item.value === field.source)?.label ?? field.source;
    const value = field.source === "fixed" && field.value !== undefined ? ` = ${String(field.value)}` : "";
    return `${field.fieldName} → ${source}${value}`;
  }).join("；");
}

// ACT: 输入绑定按节点整体配置，同一节点只允许一条绑定；编辑该条时保留自身节点可选。
const nodeChoices = computed(() => {
  if (bindingDraft.value.role !== "input") return nodeOptions.value;
  const used = new Set(draft.value.bindings.flatMap((binding, index) => binding.role === "input" && index !== bindingIndex.value ? [binding.nodeId] : []));
  return nodeOptions.value.filter(node => !used.has(node.nodeId));
});

function selectNode(nodeId: string) {
  const node = nodeOptions.value.find(item => item.nodeId === nodeId);
  if (!node) return;
  // 选中节点后自动列出全部可覆盖参数，默认使用工作流当前值作为固定值。
  bindingDraft.value.fields = fieldsForNode(node);
}

watch(() => bindingDraft.value.role, role => {
  if (role !== "input" || bindingDraft.value.fields.length) return;
  const node = nodeOptions.value.find(item => item.nodeId === bindingDraft.value.nodeId);
  bindingDraft.value.fields = fieldsForNode(node);
});

function toFieldDraft(field: BindingField, input?: WorkflowNode["inputs"][number]): FieldDraft {
  const next = createFieldDraft(field.fieldName, input?.valueType ?? (typeof field.value === "number" ? "number" : typeof field.value === "boolean" ? "boolean" : "string"), input?.value);
  next.source = field.source;
  const value = field.value;
  if (typeof value === "number") {
    next.fixedNumber = value;
    next.fixedText = String(value);
  } else if (typeof value === "boolean") {
    next.fixedBoolean = value;
    next.fixedText = String(value);
  } else if (typeof value === "string") {
    next.fixedText = value;
  }
  return next;
}

/** 把已保存的字段合并到节点当前的全部参数上，未保存过的参数沿用工作流值。 */
function bindingFields(nodeId: string, saved: BindingField[]): FieldDraft[] {
  const node = nodeOptions.value.find(item => item.nodeId === nodeId);
  const savedByName = new Map(saved.map(field => [field.fieldName, field]));
  if (!node || !node.inputs.length) return saved.map(field => toFieldDraft(field));
  return node.inputs.map(input => {
    const field = savedByName.get(input.name);
    return field ? toFieldDraft(field, input) : createFieldDraft(input.name, input.valueType, input.value);
  });
}

function openBinding(index?: number) {
  bindingError.value = "";
  bindingIndex.value = index;
  if (index === undefined) {
    const next = createBindingDraft();
    const firstNode = nodeChoices.value[0];
    if (firstNode) {
      next.nodeId = firstNode.nodeId;
      next.fields = fieldsForNode(firstNode);
    }
    bindingDraft.value = next;
  } else {
    const binding = draft.value.bindings[index];
    const next = createBindingDraft();
    if (!binding) return;
    next.nodeId = binding.nodeId;
    next.role = binding.role;
    if (binding.role === "input") next.fields = bindingFields(binding.nodeId, binding.fields);
    else next.mediaType = binding.mediaType;
    bindingDraft.value = next;
  }
  bindingEditorVisible.value = true;
}

function fieldValue(field: FieldDraft) {
  if (field.valueType === "number") {
    if (!Number.isFinite(field.fixedNumber)) throw new Error(`参数 ${field.fieldName} 的固定值必须是有效数字`);
    return field.fixedNumber;
  }
  if (field.valueType === "boolean") return field.fixedBoolean;
  if (!field.fixedText.trim()) throw new Error(`请填写参数 ${field.fieldName} 的固定值`);
  return field.fixedText;
}

function confirmBinding() {
  bindingError.value = "";
  try {
    const nodeId = bindingDraft.value.nodeId.trim();
    if (!nodeId) throw new Error("请选择节点");
    const others = draft.value.bindings.filter((_, index) => index !== bindingIndex.value);
    let binding: Binding;
    if (bindingDraft.value.role === "input") {
      if (!bindingDraft.value.fields.length) throw new Error("该节点没有可覆盖的参数");
      const fields = bindingDraft.value.fields.map(field => {
        const value: BindingField = { fieldName: field.fieldName, source: field.source };
        if (field.source === "fixed") value.value = fieldValue(field);
        return value;
      });
      binding = { role: "input", nodeId, fields };
    } else {
      if (others.some(item => item.role === "output" && item.nodeId === nodeId)) throw new Error("该输出节点已经绑定");
      binding = { role: "output", nodeId, mediaType: bindingDraft.value.mediaType };
    }
    if (bindingIndex.value === undefined) draft.value.bindings.push(binding);
    else draft.value.bindings.splice(bindingIndex.value, 1, binding);
    bindingEditorVisible.value = false;
  } catch (error) {
    bindingError.value = error instanceof Error ? error.message : "节点绑定无效";
  }
}

function moveBinding(index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= draft.value.bindings.length) return;
  const [binding] = draft.value.bindings.splice(index, 1);
  if (binding) draft.value.bindings.splice(target, 0, binding);
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
    if (!draft.value.bindings.length) throw new Error("请至少添加一个节点绑定");
    const outputs = draft.value.bindings.filter((binding): binding is OutputBinding => binding.role === "output");
    if (!outputs.length) throw new Error("请至少添加一个输出节点绑定");
    if (!outputs.some(binding => binding.mediaType === draft.value.type)) throw new Error("请添加与模型类型一致的输出节点");
    const value: MediaProviderModel = {
      ...originalExtra,
      id,
      label,
      type: draft.value.type,
      workflowId,
      bindings: draft.value.bindings.map(binding => binding.role === "input"
        ? { role: "input", nodeId: binding.nodeId, fields: binding.fields.map(field => ({ ...field })) }
        : { ...binding }),
    };
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
  max-height: min(68dvh, calc(100dvh - 210px));
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

  .nodeRow {
    display: flex;
    width: 100%;
    gap: 8px;

    .el-select { flex: 1 1 0; min-width: 0; }
    .roleSelect { flex: 0 0 96px; }
  }

  .fieldEditor {
    width: 100%;

    .fieldRow {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      margin-bottom: 8px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      .fieldName {
        flex: 0 1 auto;
        min-width: 0;
        font-size: 13px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }

      .fieldType { flex-shrink: 0; }
      .sourceSelect { flex: 0 0 120px; }
      .fixedValue { flex: 1 1 0; min-width: 0; }
    }
  }

  .bindingSection {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);

    .bindingHeader {
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

    .bindingEditor {
      margin-bottom: 12px;
      padding: 12px;
      background: var(--el-fill-color-lighter);
      border-radius: var(--el-border-radius-base);

      .bindingEditorActions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
      }
    }

    .bindingList {
      display: flex;
      flex-direction: column;
      gap: 6px;

      .bindingRow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 10px;
        border: 1px solid var(--el-border-color-lighter);
        border-radius: var(--el-border-radius-base);

        .bindingInfo {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;

          .bindingTitle {
            font-size: 13px;
            font-weight: 600;
            overflow-wrap: anywhere;
          }

          .bindingDetail {
            color: var(--el-text-color-secondary);
            font-size: 12px;
            overflow-wrap: anywhere;
          }
        }

        .bindingActions {
          display: flex;
          flex-shrink: 0;
        }
      }
    }
  }
}

.formError { margin-top: 12px; }
</style>
