/**
 * RunningHub ComfyUI 工作流适配器
 *
 * 依据（RunningHub OpenAPI 文档）：
 * - 鉴权：请求头 Authorization: Bearer <API Key>，请求体同时携带 apiKey
 * - 节点：POST /api/openapi/getJsonApiFormat
 * - 任务：POST /task/openapi/create → /task/openapi/status → /task/openapi/outputs
 * - 素材：POST /task/openapi/upload，返回的 fileName 作为 nodeInfoList 的 fieldValue
 *
 * 模型配置（在界面中生成）额外保存 workflowId 与 bindings：
 * bindings 中的输入绑定按顺序把生成请求里的参考词、参考素材、时长或分辨率比例写入工作流节点；
 * 模型可用 videoRatios 声明比例选项，视频卡片会据此展示并原样提交；
 * 默认参数节点以 fixed 绑定写入固定值，覆盖工作流中对应的字段；
 * 标记 disabled 的行会向对应字段写入 None，用于禁用工作流里多余的输入且不占用参考素材；
 * 视频模型还通过 mode 声明支持的生成方式，供视频节点选择并按首帧/尾帧映射参考图；
 * 输出绑定声明结果节点和媒体类型，用于筛选 RunningHub 返回的文件。
 */

type MediaType = "image" | "video" | "audio";

type MediaInput =
  | { type: "url"; url: string; mimeType?: string; name?: string }
  | { type: "base64"; data: string; mimeType: string; name?: string }
  | { type: "binary"; data: Uint8Array; mimeType: string; name?: string };

type MediaAsset = MediaInput & { mediaType: MediaType };

type ImageRequest = {
  model: string;
  prompt: string;
  images?: MediaInput[];
  mask?: MediaInput;
  n?: number;
  ratio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
};

type VideoRequest = {
  model: string;
  prompt?: string;
  mode?: string | string[];
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  duration?: number;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
};

type AudioRequest = {
  model: string;
  text?: string;
  prompt?: string;
  audios?: MediaInput[];
  images?: MediaInput[];
  voice?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  format?: string;
  sampleRate?: number;
};

type WorkflowRequest = {
  model: string;
  prompt?: string;
  text?: string;
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  ratio?: string;
  duration?: number;
  resolution?: string;
};

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
  | "fixed"
  | "original";

type BindingField = {
  fieldName: string;
  source: InputSource;
  value?: string | number | boolean;
  /** ACT: 界面将节点行设为 None 时写入 "None"，显式禁用工作流默认输入。 */
  disabled?: boolean;
};

type InputBinding = {
  role: "input";
  nodeId: string;
  fields: BindingField[];
  /** 旧版结构：单字段绑定，仍兼容已保存的模型。 */
  fieldName?: string;
  source?: InputSource;
  value?: string | number | boolean;
};

type OutputBinding = {
  role: "output";
  nodeId: string;
  mediaType: MediaType;
};

type Binding = InputBinding | OutputBinding;

type RunningHubModel = {
  id: string;
  label: string;
  type: string;
  workflowId?: unknown;
  bindings?: unknown;
};

type WorkflowNode = {
  nodeId: string;
  classType: string;
  title: string;
  inputs: { name: string; valueType: "string" | "number" | "boolean"; value: string | number | boolean }[];
};

type Context = {
  config: { apiKey?: unknown; site?: unknown };
  signal?: AbortSignal;
  models?: RunningHubModel[];
  tool: { fetch: typeof fetch };
};

const rules = [
  {
    type: "input",
    field: "apiKey",
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
  {
    type: "select",
    field: "site",
    title: "站点",
    value: "intl",
    options: [
      { label: "国际站（runninghub.ai）", value: "intl" },
      { label: "国内站（runninghub.cn）", value: "cn" },
    ],
  },
];

const siteBases: Record<string, string> = {
  intl: "https://www.runninghub.ai",
  cn: "https://www.runninghub.cn",
};

const uploadLimit = 30 * 1024 * 1024;
const pollInterval = 4000;
const totalTimeout = 30 * 60 * 1000;
const requestTimeout = 120 * 1000;

const mediaExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/avi": "avi",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
};

const mimeByFileType: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/avi",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function connection(context: Context) {
  const apiKey = normalizeKey(context.config.apiKey);
  if (!apiKey) throw new Error("请先在供应商配置中填写 RunningHub API Key");
  return { apiKey, base: siteBases[String(context.config.site ?? "")] ?? siteBases.intl! };
}

/** 合并超时与宿主取消信号，避免依赖 AbortSignal.any。 */
function createSignal(context: Context, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const external = context.signal;
  if (!external) return timeoutSignal;
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (timeoutSignal.aborted || external.aborted) {
    abort();
    return controller.signal;
  }
  const onTimeout = () => abort();
  const onExternal = () => abort();
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  external.addEventListener("abort", onExternal, { once: true });
  controller.signal.addEventListener(
    "abort",
    () => {
      timeoutSignal.removeEventListener("abort", onTimeout);
      external.removeEventListener("abort", onExternal);
    },
    { once: true },
  );
  return controller.signal;
}

function delay(signal: AbortSignal, ms: number): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorDetail(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const parsed = record(JSON.parse(raw));
    const message = typeof parsed.msg === "string" ? parsed.msg : typeof parsed.message === "string" ? parsed.message : "";
    return message ? "：" + message : "";
  } catch {
    return "";
  }
}

async function postJson(
  context: Context,
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await context.tool.fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error("RunningHub 请求失败（HTTP " + response.status + "）" + errorDetail(raw));
  }
  const payload = await response.json().catch(() => undefined);
  if (!payload || typeof payload !== "object") throw new Error("RunningHub 返回的内容不是有效 JSON");
  return payload as Record<string, unknown>;
}

function ensureCode(payload: Record<string, unknown>, action: string): void {
  const code = Number(payload.code);
  if (Number.isFinite(code) && code !== 0) {
    const message = typeof payload.msg === "string" ? payload.msg.trim() : "";
    throw new Error(action + "失败" + (message ? "：" + message : "（错误码 " + code + "）"));
  }
}

function readableValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const data = record(value);
  for (const key of ["message", "msg", "error", "failedReason", "failReason", "detail", "reason"]) {
    const detail = readableValue(data[key]);
    if (detail) return detail;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function promptTipsError(value: unknown): string {
  if (!value) return "";
  let tips = value;
  if (typeof tips === "string") {
    try {
      tips = JSON.parse(tips);
    } catch {
      return "";
    }
  }
  const data = record(tips);
  const error = readableValue(data.error);
  const nodeErrors = data.node_errors;
  const hasNodeErrors = !!nodeErrors && typeof nodeErrors === "object" && Object.keys(record(nodeErrors)).length > 0;
  if (data.result !== false && !error && !hasNodeErrors) return "";
  const detail = error || (hasNodeErrors ? readableValue(nodeErrors) : "");
  return (detail || "工作流节点校验未通过").slice(0, 1000);
}

function splitBase64(data: string): { mimeType: string; payload: string } {
  const matched = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(data.trim());
  if (matched) return { mimeType: matched[1]!.toLowerCase(), payload: matched[2]! };
  return { mimeType: "", payload: data.trim() };
}

function guessMimeByUrl(url: string, fallback: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const matched = /\.([a-zA-Z0-9]+)$/.exec(pathname);
  const ext = matched ? matched[1]!.toLowerCase() : "";
  return mimeByFileType[ext] ?? fallback;
}

async function mediaBytes(context: Context, input: MediaInput, signal: AbortSignal): Promise<{ data: Uint8Array; mimeType: string }> {
  if (input.type === "binary") {
    if (!(input.data instanceof Uint8Array)) throw new Error("参考素材格式无效");
    return { data: input.data, mimeType: input.mimeType || "application/octet-stream" };
  }
  if (input.type === "base64") {
    const split = splitBase64(input.data);
    const data = Buffer.from(split.payload, "base64");
    return { data: new Uint8Array(data), mimeType: input.mimeType || split.mimeType || "application/octet-stream" };
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("参考素材地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("参考素材只支持 HTTP(S) 地址");
  const response = await context.tool.fetch(url, { signal });
  if (!response.ok) throw new Error("读取参考素材失败（HTTP " + response.status + "）");
  if (Number(response.headers.get("content-length")) > uploadLimit) throw new Error("参考素材不能超过 30 MB");
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type");
  const mimeType = input.mimeType || (contentType ? contentType.split(";")[0]!.trim() : "") || guessMimeByUrl(input.url, "application/octet-stream");
  return { data: new Uint8Array(buffer), mimeType };
}

/** 极简 multipart/form-data 构造，避免依赖 VM 中不存在的 FormData。 */
class MultipartBody {
  readonly boundary: string;
  private chunks: Uint8Array[] = [];
  private finished = false;

  constructor(boundary: string) {
    this.boundary = boundary;
  }

  appendField(name: string, value: string): void {
    this.pushText("--" + this.boundary + "\r\n");
    this.pushText('Content-Disposition: form-data; name="' + name + '"\r\n\r\n');
    this.pushText(value + "\r\n");
  }

  appendFile(name: string, filename: string, mimeType: string, data: Uint8Array): void {
    this.pushText("--" + this.boundary + "\r\n");
    this.pushText('Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n');
    this.pushText("Content-Type: " + mimeType + "\r\n\r\n");
    this.chunks.push(data);
    this.pushText("\r\n");
  }

  finish(): Uint8Array<ArrayBuffer> {
    if (!this.finished) {
      this.pushText("--" + this.boundary + "--\r\n");
      this.finished = true;
    }
    let total = 0;
    for (const chunk of this.chunks) total += chunk.length;
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  private pushText(text: string): void {
    this.chunks.push(new TextEncoder().encode(text));
  }
}

async function uploadMedia(context: Context, apiKey: string, base: string, input: MediaInput, signal: AbortSignal): Promise<string> {
  const source = await mediaBytes(context, input, signal);
  if (!source.data.byteLength) throw new Error("参考素材为空，无法上传到 RunningHub");
  if (source.data.byteLength > uploadLimit) throw new Error("参考素材不能超过 30 MB");
  const mimeType = source.mimeType || "application/octet-stream";
  const extension = mediaExtensions[mimeType] ?? "bin";
  const body = new MultipartBody("----runninghub" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10));
  body.appendField("apiKey", apiKey);
  body.appendField("fileType", "input");
  body.appendFile("file", "input." + extension, mimeType, source.data);
  const response = await context.tool.fetch(base + "/task/openapi/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "multipart/form-data; boundary=" + body.boundary,
    },
    body: body.finish(),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error("上传参考素材失败（HTTP " + response.status + "）" + errorDetail(raw));
  }
  const payload = await response.json().catch(() => undefined);
  const result = record(payload);
  ensureCode(result, "上传参考素材");
  const fileName = record(result.data).fileName;
  if (typeof fileName !== "string" || !fileName.trim()) throw new Error("RunningHub 未返回上传文件名");
  return fileName;
}

async function failureReason(context: Context, apiKey: string, base: string, taskId: string, signal: AbortSignal): Promise<string> {
  try {
    const payload = await postJson(context, apiKey, base + "/task/openapi/outputs", { apiKey, taskId }, createSignal(context, requestTimeout));
    return readableValue(record(payload.data).failedReason) || readableValue(payload.msg);
  } catch (error) {
    if (signal.aborted) throw error;
    return "";
  }
}

async function waitForTask(context: Context, apiKey: string, base: string, taskId: string, signal: AbortSignal, deadline: number): Promise<void> {
  while (true) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("等待 RunningHub 生成结果超时，可以稍后重新发起");
    const payload = await postJson(context, apiKey, base + "/task/openapi/status", { apiKey, taskId }, createSignal(context, requestTimeout));
    ensureCode(payload, "查询任务状态");
    const raw = payload.data;
    const status = (typeof raw === "string" ? raw : String(record(raw).status ?? "")).toUpperCase();
    if (status === "SUCCESS") return;
    if (status === "FAILED" || status === "ERROR" || status === "CANCEL") {
      const reason = await failureReason(context, apiKey, base, taskId, signal);
      throw new Error("RunningHub 任务失败" + (reason ? "：" + reason : "，请检查工作流和节点参数"));
    }
    await delay(signal, pollInterval);
  }
}

async function fetchOutputs(context: Context, apiKey: string, base: string, taskId: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    signal.throwIfAborted();
    const payload = await postJson(context, apiKey, base + "/task/openapi/outputs", { apiKey, taskId }, createSignal(context, requestTimeout));
    const code = Number(payload.code);
    if (code === 0) {
      if (!Array.isArray(payload.data)) throw new Error("RunningHub 未返回任务结果");
      return payload.data.map(record);
    }
    if (code === 803 || code === 804) {
      await delay(signal, pollInterval);
      continue;
    }
    const reason = readableValue(record(payload.data).failedReason) || readableValue(payload.msg);
    throw new Error("读取 RunningHub 任务结果失败" + (reason ? "：" + reason : "（错误码 " + code + "）"));
  }
  throw new Error("读取 RunningHub 任务结果超时，请稍后重试");
}

function normalizeWorkflowNodes(raw: unknown): WorkflowNode[] {
  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      throw new Error("工作流节点数据格式无效");
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("工作流节点数据格式无效");
  const nodes: WorkflowNode[] = [];
  for (const [nodeId, value] of Object.entries(source as Record<string, unknown>)) {
    const node = record(value);
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    const meta = record(node._meta);
    const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : classType;
    const inputs: WorkflowNode["inputs"] = [];
    for (const [name, fieldValue] of Object.entries(record(node.inputs))) {
      const valueType = typeof fieldValue;
      if (valueType === "string" || valueType === "number" || valueType === "boolean") {
        inputs.push({ name, valueType, value: fieldValue as string | number | boolean });
      }
    }
    nodes.push({ nodeId, classType, title: title || nodeId, inputs });
  }
  return nodes.sort((left, right) => {
    const leftNumber = Number(left.nodeId);
    const rightNumber = Number(right.nodeId);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return left.nodeId.localeCompare(right.nodeId);
  });
}

function isOutputBinding(binding: Binding): binding is OutputBinding {
  return binding.role === "output" && (binding.mediaType === "image" || binding.mediaType === "video" || binding.mediaType === "audio");
}

function isInputBinding(binding: Binding): binding is InputBinding {
  return binding.role === "input";
}

// ACT: 兼容旧版单字段绑定；新结构下同一节点的多个参数保存在 fields 中。
function bindingFields(binding: InputBinding): BindingField[] {
  return Array.isArray(binding.fields) && binding.fields.length
    ? binding.fields
    : [{ fieldName: binding.fieldName ?? "", source: binding.source ?? "fixed", value: binding.value }];
}

function guessMimeByFileType(fileType: unknown, mediaType: MediaType): string {
  if (typeof fileType === "string") {
    const key = fileType.trim().toLowerCase().replace(/^\./, "");
    const mime = mimeByFileType[key];
    if (mime) return mime;
  }
  if (mediaType === "image") return "image/png";
  if (mediaType === "video") return "video/mp4";
  return "audio/mpeg";
}

async function runWorkflow(context: Context, request: ImageRequest | VideoRequest | AudioRequest, mediaType: MediaType): Promise<MediaAsset[]> {
  const { apiKey, base } = connection(context);
  const modelId = typeof request.model === "string" ? request.model.trim() : "";
  if (!modelId) throw new Error("未指定 RunningHub 模型");
  const models = Array.isArray(context.models) ? context.models : [];
  const model = models.find(item => item && item.id === modelId);
  if (!model) throw new Error("未找到 RunningHub 模型配置，请重新选择模型");
  if (model.type !== mediaType) throw new Error("RunningHub 模型类型与当前生成方式不一致");
  const workflowId = typeof model.workflowId === "string" ? model.workflowId.trim() : "";
  if (!workflowId) throw new Error("该 RunningHub 模型未绑定工作流 ID");
  const bindings = Array.isArray(model.bindings) ? (model.bindings as Binding[]) : [];
  if (!bindings.length) throw new Error("该 RunningHub 模型未配置节点绑定");

  const signal = createSignal(context, totalTimeout);
  const deadline = Date.now() + totalTimeout;
  const input = request as WorkflowRequest;
  const images = Array.isArray(input.images) ? input.images : [];
  const videos = Array.isArray(input.videos) ? input.videos : [];
  const audios = Array.isArray(input.audios) ? input.audios : [];
  // ACT: 首帧/尾帧参考模式统一复用「参考图」绑定，按图片顺序依次消费首帧、尾帧。
  const pictures = [...images];
  if (input.firstFrame) pictures.push(input.firstFrame);
  if (input.lastFrame) pictures.push(input.lastFrame);
  let imageIndex = 0;
  let pictureIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;
  const nextImage = () => (imageIndex < images.length ? images[imageIndex++] : undefined);
  const nextPicture = () => (pictureIndex < pictures.length ? pictures[pictureIndex++] : undefined);
  // ACT: 同一素材被参考图与旧版首/尾帧绑定共用时只上传一次。
  const uploadedMedia = new WeakMap<MediaInput, string>();
  const nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string | number | boolean }[] = [];
  const seen = new Set<string>();

  for (const binding of bindings) {
    if (!binding || !isInputBinding(binding)) continue;
    const nodeId = typeof binding.nodeId === "string" ? binding.nodeId.trim() : "";
    if (!nodeId) throw new Error("RunningHub 输入绑定缺少节点 ID");
    const fields = bindingFields(binding);
    for (const field of fields) {
      const fieldName = typeof field.fieldName === "string" ? field.fieldName.trim() : "";
      if (!fieldName) throw new Error("RunningHub 输入绑定缺少字段名");
      if (field.source === "original") {
        const key = nodeId + "|" + fieldName;
        if (seen.has(key)) throw new Error("RunningHub 节点字段被重复绑定：" + nodeId + "." + fieldName);
        seen.add(key);
        continue;
      }
      // ACT: None 行只写入 "None" 禁用该输入，不消费参考素材，也不产生上传。
      if (field.disabled === true) {
        const key = nodeId + "|" + fieldName;
        if (seen.has(key)) throw new Error("RunningHub 节点字段被重复绑定：" + nodeId + "." + fieldName);
        seen.add(key);
        nodeInfoList.push({ nodeId, fieldName, fieldValue: "None" });
        continue;
      }
      let fieldValue: string | number | boolean | undefined;
      let mediaInput: MediaInput | undefined;
      switch (field.source) {
        case "prompt":
          fieldValue = mediaType === "audio" ? input.text ?? input.prompt : input.prompt;
          break;
        case "image":
          mediaInput = nextPicture();
          break;
        case "firstFrame":
          mediaInput = input.firstFrame ?? nextImage();
          break;
        case "lastFrame":
          mediaInput = input.lastFrame ?? nextImage();
          break;
        case "video":
          mediaInput = videoIndex < videos.length ? videos[videoIndex++] : undefined;
          break;
        case "audio":
          mediaInput = audioIndex < audios.length ? audios[audioIndex++] : undefined;
          break;
        case "ratio":
          fieldValue = input.ratio;
          break;
        case "duration":
          fieldValue = input.duration;
          break;
        case "resolution":
          fieldValue = input.resolution;
          break;
        case "fixed":
          if (typeof field.value === "string" || typeof field.value === "number" || typeof field.value === "boolean") {
            fieldValue = field.value;
          } else {
            throw new Error("RunningHub 固定值绑定缺少有效值");
          }
          break;
        default:
          throw new Error("RunningHub 输入绑定包含未知来源：" + String(field.source));
      }
      if (mediaInput) {
        const cached = uploadedMedia.get(mediaInput);
        fieldValue = cached ?? await uploadMedia(context, apiKey, base, mediaInput, signal);
        if (!cached) uploadedMedia.set(mediaInput, fieldValue);
      }
      // ACT: 前端设置未传值时写入 None，避免沿用工作流默认输入；固定空字符串仍原样提交。
      if (field.source !== "fixed" && (fieldValue == null || fieldValue === "")) fieldValue = "None";
      if (fieldValue === undefined) continue;
      const key = nodeId + "|" + fieldName;
      if (seen.has(key)) throw new Error("RunningHub 节点字段被重复绑定：" + nodeId + "." + fieldName);
      seen.add(key);
      nodeInfoList.push({ nodeId, fieldName, fieldValue });
    }
  }

  const outputBindings = bindings.filter((binding): binding is OutputBinding => !!binding && isOutputBinding(binding) && binding.mediaType === mediaType);
  if (!outputBindings.length) {
    const label = mediaType === "image" ? "图片" : mediaType === "video" ? "视频" : "音频";
    throw new Error("该 RunningHub 模型未配置" + label + "输出节点");
  }

  const created = await postJson(
    context,
    apiKey,
    base + "/task/openapi/create",
    { apiKey, workflowId, nodeInfoList },
    createSignal(context, requestTimeout),
  );
  ensureCode(created, "提交 RunningHub 任务");
  const createdData = record(created.data);
  const tips = promptTipsError(createdData.promptTips);
  if (tips) throw new Error("工作流校验未通过：" + tips);
  const taskId = typeof createdData.taskId === "string" || typeof createdData.taskId === "number" ? String(createdData.taskId).trim() : "";
  if (!taskId) throw new Error("RunningHub 未返回任务 ID");

  await waitForTask(context, apiKey, base, taskId, signal, deadline);

  const outputNodeIds = new Set(outputBindings.map(binding => String(binding.nodeId).trim()).filter(Boolean));
  const files = await fetchOutputs(context, apiKey, base, taskId, signal);
  const usable = files.filter(file => typeof file.fileUrl === "string" && /^https?:\/\//i.test(file.fileUrl));
  const matched = usable.filter(file => outputNodeIds.has(String(file.nodeId ?? "").trim()));
  // ACT: 少数 RunningHub 响应不带 nodeId，此时只在所有结果都缺失时退化为返回全部可用文件。
  const selected = matched.length ? matched : usable.length && usable.every(file => !file.nodeId) ? usable : [];
  if (!selected.length) throw new Error("工作流没有返回已绑定输出节点的结果，请检查输出节点绑定");

  const urls = new Set<string>();
  const assets: MediaAsset[] = [];
  for (const file of selected) {
    const url = String(file.fileUrl);
    if (urls.has(url)) continue;
    urls.add(url);
    assets.push({ type: "url", url, mimeType: guessMimeByFileType(file.fileType, mediaType), mediaType });
  }
  return assets;
}

export default {
  id: "runningHub",
  label: "RunningHub",
  icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAENUlEQVRYCcVXXWgcVRT+dmZ3ZmfThG7apEgxVVsSpUJBa6kgSJWATz6IVCKKID5IrT9ERZHiQ1oVixVqEKT4IhgKQlBBqFAQQRQqNrWhUJSS1qrFtDF/u+3+zcz6nZmd2bmb2XQCqT3w7b337Ln3fHPOuffOAKps4XA/cY2orzKucr0RYjOxRFLUvEnMEavtuHW9Wfp4nVDkDY5aDW/0+NWAwe3sLN4EAgv02Zfmz3NEJ6GIpgOaFqgkQ60Sr3MdF64rwbuudNHiaVmlRGRbzfe+q2HwURO1ugUNgqyHVNi3kGro/P99G8c2MDttY/LkJXz5xQmcOX2hdenoeFoIxNJ9Z0zD7ictVNABndCQi2BN2NdDfVOXwRpkGNQC99LI20cxemg86jTaL4RBjmql7zhAja1N1MhRhctxKxzqfJTZu4oyzFwG73+wB4OP7JAl46TelkCctegkERZj4iPNVpDxYFAfFYck09Q9/+LjUbXSlyJMJJIrl1H5anwaxYUZ5t/woDVaXcvi7m2bsH37QCOnfpFWGY1t9wwg392FuVnZbKokJiDT7FodB1+bwqU/K+oqjVHWyuDr71/Czh1bmTq/tFy2a/OdWN+TjyWQOAX+8wCm1X5KuVTD5MRfDLpqk07ryJpGLGnVMtbEV8ZulRj7pHbB1MQEgggEE1erTUwgqUMtFVAN2uVnrphAreq2XXFt3sK9OzexALldGkUoxrbtoFyOL9zEu0Dcpo0URo70o1TMsMxMbkOz0fIE0CwM3HUr7uzf6B1IwZNptJifW8TMlXnhskQSE5CZcjntGlzHKm8eu81juoPHTpZP7yp7wOAhdXrid8yRRJysiIAsUPEcOHTiQ6dLLYTqXCdVu27jk9G2d4FCNo7gEp0E3wih86gNgq2ayhFcXLiG4Vc+wvFvT6h/RkYrikCdhfDrxCIqpTLdFr3ruHdDHgPMe3T/S9h//OEs9j57BFPn/om4W9pNTECes1qtY3joLP44J68Qvmzs68SxX55Cb08uJOEwPZv7b0GtKnfp8hIfv5g5wRM235J8o78vFvDp4VNMS/MmlFuwb0MP3to/FLOSqkpMQJ2mjj77+BR+m5pR6qGEKp4Yegj3P7BVNW4ZJSaw3Lm2MF/B6Hs/KQTqjIKVMbDvwDOQy6idJCYQpKDdQuOfT+LnkxeZimZZlRmFhx+8D4/t3tVumpfRZkVFzAwTfMsRyGtoynvzs7IaUm0oV8o2Phz5zotCB0/IHA8lgUlKBw6+gJ7e7sjqYbcodA8R+0JVo3NsrI7zk1XWc4HuZdsV4NhpzF6WN8V4Of4Nt96eMazvznNH6JyX8WDqOXSv68KVy/JRpMiojG4jbsaHiVwOfYQn8q0maf4/Mey7bv4KCYnRjSbxL32E34Wtu+sO/imnx8tEB3G94qdJIhE/ReIwcZQ4T3jyH+6C1C5Co275AAAAAElFTkSuQmCC",
  version: "1.1.4",
  readme:
    "RunningHub\n\n使用 ComfyUI 工作流生成图片、视频和音频。国际站与国内站的账号、API Key 可能不通用，请按 Key 来源选择站点。\n\n添加供应商后模型列表为空，请在「编辑模型」中点击「手动添加」：先填写 ComfyUI 工作流 ID 并同步节点，再按参考词、参考图、参考视频/音频、时长、分辨率等参数分组，为每个参数添加一个或多个工作流节点。不需要的节点行设为 None，运行时会向该字段写入 None，禁用工作流默认输入且不占用参考素材。在输入参数和输出节点之间可添加默认参数节点，为节点的每个参数指定固定值，生成时覆盖工作流默认值。最后在输出分组中添加输出节点。\n\n视频模型可勾选支持的生成模式（文生视频、单图参考、首帧参考、尾帧参考、首尾帧参考、混合参考），生成节点会据此显示模式选项；首帧/尾帧参考使用参考图第一行，首尾帧参考按行顺序使用前两行，混合参考最多使用 9 张图片、3 个视频和 3 个音频。「分辨率」分组绑定分辨率选择节点（如 ResolutionSelector 的 aspect_ratio）后，该字段的选项会成为视频卡片的比例选项，生成时原样写入工作流。\n\n参考素材会在每次生成时自动上传到 RunningHub，单文件不超过 30 MB。",
  rules,
  models: [],
  async generateImage(this: Context, request: ImageRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    return runWorkflow(this, request, "image");
  },
  async generateVideo(this: Context, request: VideoRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    return runWorkflow(this, request, "video");
  },
  async generateAudio(this: Context, request: AudioRequest): Promise<MediaAsset[]> {
    this.signal?.throwIfAborted();
    return runWorkflow(this, request, "audio");
  },
  async getWorkflowNodes(this: Context, workflowId: string): Promise<WorkflowNode[]> {
    const { apiKey, base } = connection(this);
    const id = typeof workflowId === "string" ? workflowId.trim() : "";
    if (!id) throw new Error("请填写 ComfyUI 工作流 ID");
    const payload = await postJson(
      this,
      apiKey,
      base + "/api/openapi/getJsonApiFormat",
      { apiKey, workflowId: id },
      createSignal(this, 60000),
    );
    ensureCode(payload, "获取工作流节点");
    const prompt = record(payload.data).prompt;
    if (!prompt) throw new Error("RunningHub 未返回工作流节点数据");
    return normalizeWorkflowNodes(prompt);
  },
};
