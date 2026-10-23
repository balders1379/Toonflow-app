import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const nodeSchema = z.object({
  nodeId: z.string().min(1).max(128),
  classType: z.string().max(200),
  title: z.string().max(500),
  inputs: z.array(z.object({
    name: z.string().min(1).max(200),
    valueType: z.enum(["string", "number", "boolean"]),
    value: z.union([z.string().max(100000), z.number(), z.boolean()]),
  })).max(1000),
});

export default Router().post("/", validateFields({
  fileName: u.mediaProvider.mediaProviderFileSchema,
  workflowId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  apiKey: z.string().max(8192).optional(),
  site: z.enum(["intl", "cn"]).optional(),
}), async (req, res) => {
  // ACT: 与其余媒体供应商接口保持一致，只读取已安装供应商并回传节点元数据，不开放控制连接。
  const fileName = String(req.body.fileName);
  const workflowId = String(req.body.workflowId).trim();
  const provider = await u.mediaProvider.getMediaProvider(fileName.slice(0, -3));
  const providedKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  const storedSite = u.conf.get(`settings.mediaProviderConfigs.${provider.id}.site`);
  const apiKey = providedKey || u.mediaProvider.getMediaProviderApiKey(provider.id);
  const site = req.body.site === "cn" || req.body.site === "intl" ? req.body.site : storedSite === "cn" ? "cn" : "intl";
  const signal = AbortSignal.timeout(60000);
  const runtime = await u.mediaProvider.loadMediaProviderSource(provider.source, { apiKey, site }, signal);
  if (typeof runtime.getWorkflowNodes !== "function") {
    throw Object.assign(new Error("当前供应商不支持同步工作流节点"), { status: 400 });
  }
  let nodes: unknown;
  try {
    nodes = await runtime.getWorkflowNodes(workflowId);
  } catch (error) {
    if (signal.aborted) throw Object.assign(new Error("同步工作流节点超时，请重试"), { status: 504 });
    throw error;
  }
  const result = z.array(nodeSchema).max(10000).safeParse(nodes);
  if (!result.success) throw Object.assign(new Error("工作流节点数据格式无效"), { status: 502 });
  res.set("Cache-Control", "no-store").json(success({ nodes: result.data }));
});
