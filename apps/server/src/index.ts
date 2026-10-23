import { resolve } from "node:path";
import { createApp } from "./app";
import { getLanUrls, isLanAccessEnabled } from "./lib/localAccess";
import config from "../../../electrobun.config";

const startTime = Date.now();
const realPort = Number(process.env.TOONFLOW_SERVER_PORT || 3000);
if (!Number.isInteger(realPort) || realPort < 1 || realPort > 65535) throw new Error("TOONFLOW_SERVER_PORT 必须是 1–65535 之间的整数");
// 源码位于 apps/server/src，生产构建位于 build/server，均从文件位置定位根目录。
const fromSource = import.meta.path.endsWith(".ts");
const appDirectory = resolve(import.meta.dirname, fromSource ? "../../.." : "../..");
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(appDirectory, "data");
const app = await createApp({
  webRoot: resolve(appDirectory, "build/web"),
  appVersion: config.app.version,
  dataDirectory,
  toolsRoot: resolve(appDirectory, "build/tools"),
  nodesRoot: resolve(appDirectory, "build/nodes"),
  extRoot: resolve(appDirectory, "build/ext"),
  // ACT: 暂不安装内置团队，随团队打包一同恢复。
  // agentsRoot: resolve(appDirectory, "build/agents"),
  providersRoot: resolve(appDirectory, fromSource ? "packages/providers/src" : "build/providers"),
  skillsRoot: resolve(appDirectory, fromSource ? "packages/skills" : "build/skills"),
});
const { initializeMcpRuntime } = await import("./utils/mcp/runtime");
const { startMobileLinkRuntime } = await import("./utils/mobileLink");
app.listen(realPort, async (error?: Error) => {
  if (error) throw error;
  await initializeMcpRuntime(app, `http://127.0.0.1:${realPort}`, resolve(appDirectory, fromSource ? "packages/mcp/src/stdio.ts" : "build/mcp/stdio.js"));
  await startMobileLinkRuntime(app).catch(error => console.error("设备互联启动失败：", error));
  console.log(`[服务启动成功]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
  if (isLanAccessEnabled()) {
    console.warn("[局域网访问] 已开启 TOONFLOW_ALLOW_LAN=1：任何能访问下列地址的设备都可控制本服务，且没有登录鉴权");
    const urls = getLanUrls(realPort);
    if (urls.length) for (const url of urls) console.log(`[局域网地址]: ${url}`);
    else console.warn("[局域网访问] 未检测到本机私网地址；使用域名、反向代理或 Docker 时请设置 TOONFLOW_LAN_HOSTS=<主机名或 IP>");
  }
});
