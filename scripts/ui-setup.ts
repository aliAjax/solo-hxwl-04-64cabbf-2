// 在 React 之前建立 jsdom 全局环境（本模块必须最先被 import）
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost:5104/",
  pretendToBeVisual: true,
});

const { window } = dom;

// Node 21+ 的 globalThis 自带只读 getter（如 navigator），ESM 严格模式下直接
// 赋值会抛 "Cannot assign to read only property"。统一用 configurable 描述符注入。
function install(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  } catch {
    // 个别环境禁止重定义时回退到（非严格）赋值；失败不影响 jsdom 内部运行
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLAnchorElement",
  "HTMLInputElement", "HTMLSelectElement", "MouseEvent", "KeyboardEvent",
  "InputEvent", "Event", "CustomEvent", "getComputedStyle", "localStorage",
] as const) {
  install(key, (window as unknown as Record<string, unknown>)[key]);
}

window.confirm = () => true;
window.HTMLAnchorElement.prototype.click = function click() {
  // jsdom 下拦截 blob 下载导航
};
window.URL.createObjectURL = () => "blob:mock";
window.URL.revokeObjectURL = () => {};

// @ts-expect-error React act 环境标记
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { window };
