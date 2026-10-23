import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { Request } from "express";

// ACT: 局域网访问是显式信任选项，默认关闭；开启后按本机页面同等权限处理，服务本身没有登录鉴权。
const cacheDuration = 10_000;
let cache: { at: number; hosts: Set<string> } = { at: 0, hosts: new Set() };

export function isLanAccessEnabled() {
  return process.env.TOONFLOW_ALLOW_LAN === "1";
}

export function normalizeHost(hostname: string | undefined) {
  let value = hostname?.trim().toLowerCase() ?? "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end !== -1) value = value.slice(1, end);
  }
  // 浏览器地址栏中的 IPv6 区域标识会写成 %25。
  return value.replaceAll("%25", "%");
}

function isPrivateAddress(address: string) {
  const value = address.split("%")[0] ?? "";
  if (isIP(value) === 4) return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(value);
  // ULA 与链路本地地址。
  if (isIP(value) === 6) return /^(f[cd]|fe[89ab])/i.test(value);
  return false;
}

function lanHosts() {
  const now = Date.now();
  if (now - cache.at > cacheDuration) {
    const detected = Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
      .filter(entry => !entry.internal && isPrivateAddress(entry.address))
      .map(entry => normalizeHost(entry.address));
    const configured = (process.env.TOONFLOW_LAN_HOSTS ?? "").split(",").map(value => normalizeHost(value)).filter(Boolean);
    // ACT: 自动探测只接受私网 IP 字面量，避免把公网网卡或任意域名纳入信任；域名需显式配置。
    cache = { at: now, hosts: new Set([...detected, ...configured]) };
  }
  return cache.hosts;
}

export function isTrustedLanHostname(hostname: string | undefined) {
  return isLanAccessEnabled() && lanHosts().has(normalizeHost(hostname));
}

export function isTrustedLanHost(req: Request) {
  return isTrustedLanHostname(req.hostname);
}

export function isTrustProxyEnabled() {
  return process.env.TOONFLOW_TRUST_PROXY === "1";
}

function requestSourceHostname(req: Request) {
  const source = req.get("origin") ?? req.get("referer");
  if (!source) return undefined;
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

export function isSameOriginRequest(req: Request) {
  const source = req.get("origin") ?? req.get("referer");
  if (!source) return false;
  try {
    const url = new URL(source);
    // ACT: 反向代理可能在本机之前终止 TLS，因此只对齐 Host，不依赖 X-Forwarded-Proto。
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === req.get("host");
  } catch {
    return false;
  }
}

// ACT: 反向代理改写 Host 时，改用页面来源域名判断；来源仍必须在允许列表内，防止 DNS rebinding 与跨站请求。
export function isTrustedProxyRequest(req: Request) {
  return isTrustProxyEnabled() && isTrustedLanHostname(requestSourceHostname(req));
}

// ACT: 只对浏览器页面放行：Host 必须是本机地址且 Origin/Referer 同源，防止 DNS rebinding 与跨站请求。
export function isTrustedLanRequest(req: Request) {
  return (isTrustedLanHost(req) && isSameOriginRequest(req)) || isTrustedProxyRequest(req);
}

export function getLanUrls(port: number) {
  return [...lanHosts()].flatMap(host => {
    const address = host.split("%")[0] ?? host;
    // 链路本地 IPv6 带区域标识，无法直接在其他设备上访问，不展示。
    if (isIP(address) === 6 && /^fe[89ab]/i.test(address)) return [];
    return [isIP(address) === 6 ? `http://[${host.replaceAll("%", "%25")}]:${port}` : `http://${host}:${port}`];
  });
}
