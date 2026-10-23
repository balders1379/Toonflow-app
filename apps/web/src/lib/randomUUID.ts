// ACT: 局域网 HTTP 页面不是安全上下文，浏览器不提供 crypto.randomUUID；按 UUID v4 用 getRandomValues 补齐。
const cryptoObject = globalThis.crypto;
if (cryptoObject && typeof cryptoObject.randomUUID !== "function") {
  Object.defineProperty(cryptoObject, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => {
      const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}
