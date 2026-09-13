// 在 React 之前建立 jsdom 全局环境（本模块必须最先被 import）
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost:5104/",
  pretendToBeVisual: true,
});

const { window } = dom;

for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLAnchorElement",
  "HTMLInputElement", "HTMLSelectElement", "MouseEvent", "KeyboardEvent",
  "Event", "CustomEvent", "getComputedStyle",
] as const) {
  // @ts-expect-error 注入浏览器全局
  globalThis[key] = window[key];
}

globalThis.localStorage = window.localStorage;
window.confirm = () => true;
window.HTMLAnchorElement.prototype.click = function click() {
  // jsdom 下拦截 blob 下载导航
};
window.URL.createObjectURL = () => "blob:mock";
window.URL.revokeObjectURL = () => {};

// @ts-expect-error React act 环境标记
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { window };
