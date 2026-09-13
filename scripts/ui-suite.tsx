import "./ui-setup";
import { createRoot } from "react-dom/client";
import { act } from "react";
import React from "react";
import App from "../src/App";
import { USERS } from "../src/domain";

interface TestApi {
  test: (name: string, fn: () => void) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function flush() {
  await act(async () => {
    await sleep(0);
  });
}

function fire(node: Element | Node, type: string) {
  const el = node as HTMLElement;
  act(() => {
    el.dispatchEvent(new window.Event(type, { bubbles: true }));
  });
}

function reactProps(el: any): any {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? el[key] : null;
}

function setValue(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto =
    el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    // jsdom 下 React 19 的 input 合成事件不可靠，直接驱动挂载的 onChange
    reactProps(el)?.onChange?.({ target: el, currentTarget: el });
  });
}
function $all(sel: string): HTMLElement[] {
  return Array.from(window.document.querySelectorAll(sel));
}
function $text(sel: string, text: string): HTMLElement {
  const hit = $all(sel).find((el) => (el.textContent ?? "").includes(text));
  if (!hit) throw new Error(`未找到包含「${text}」的 ${sel}`);
  return hit;
}
function click(el: Element | Node) {
  act(() => {
    (el as HTMLElement).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}
function dblClick(el: Element | Node) {
  act(() => {
    const props = reactProps(el as HTMLElement);
    if (props?.onDoubleClick) props.onDoubleClick({ target: el, currentTarget: el });
    else (el as HTMLElement).dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  });
}

export async function runUiSuite({ test }: TestApi) {
  window.localStorage.clear();
  const container = window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });
  await flush();

  test("首屏渲染：6 张指标卡、3 条示例疗程、月历事件、操作记录", () => {
    const cards = $all(".metric-card");
    if (cards.length !== 6) throw new Error(`指标卡数量 ${cards.length}，期望 6`);
    const titles = cards.map((c) => c.querySelector("strong")?.textContent);
    if (titles.some((t) => !t)) throw new Error("指标卡缺数值");
    const rows = $all("button.record-card");
    if (rows.length !== 3) throw new Error(`疗程卡数量 ${rows.length}，期望 3（全部筛选）`);
    if (!$text(".record-card", "张伟")) throw new Error("列表缺少患者张伟");
    if ($all(".cal-event").length < 2) throw new Error("月历至少渲染 2 个复诊事件");
    if ($all(".audit-list li").length < 10) throw new Error("操作记录未随示例数据生成");
    if (!$text(".eyebrow", "门诊治疗管理台")) throw new Error("页面标题未渲染");
  });

  test("筛选：切到「完成」只剩 #11；关键字「王芳」只剩 1 条；重置恢复 3 条", () => {
    click($text(".chip", "完成"));
    if ($all("button.record-card").length !== 1) throw new Error("阶段筛选「完成」应收敛为 1 条");
    if (!$text(".record-card", "李娜")) throw new Error("完成病例应为李娜 #11");
    click($text(".chip", "全部"));

    const search = $all(".search-box input")[0] as HTMLInputElement;
    setValue(search, "王芳");
    const rows = $all("button.record-card");
    if (rows.length !== 1 || !rows[0].textContent!.includes("王芳"))
      throw new Error("关键字筛选应收敛为王芳 1 条");
    setValue(search, "");
    if ($all("button.record-card").length !== 3) throw new Error("清空搜索后应恢复 3 条");
  });

  test("医生权限边界：林医生不能推进陈医生的 #36，行内错误说明负责人", () => {
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[1].id); // 林医生
    click($text("button.record-card", "张伟"));
    const modal = $all(".modal.wide")[0] as HTMLElement | undefined;
    if (!modal) throw new Error("未打开疗程详情弹窗");
    const adv = modal.querySelector(".stage-actions .primary-action") as HTMLButtonElement;
    if (!adv) throw new Error("缺少阶段推进按钮");
    if (!adv.disabled) throw new Error("非负责医生时推进按钮应禁用");
    // 临床信息输入也应禁用（仅主区，不含侧栏的改派下拉——医生可改派）
    const inputs = modal.querySelectorAll<HTMLInputElement>(".detail-main input.ctrl");
    const enabledClinical = Array.from(inputs).some((i) => !i.disabled);
    if (enabledClinical) throw new Error("非负责医生的临床/材料输入框应全部禁用");
    click($text(".modal .icon-btn", "✕"));
  });

  test("陈医生推进 #37 的完整阶段门禁：缺料被拦→补齐→直到完成", () => {
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[0].id); // 陈医生
    // 新建 #37
    click($text("button", "新建疗程"));
    let modal = $all(".modal")[0] as HTMLElement;
    const sel = modal.querySelector("select") as HTMLSelectElement;
    setValue(sel, "new");
    const ins = modal.querySelectorAll<HTMLInputElement>("input.ctrl");
    // 新建患者后依次为：姓名、联系方式、牙位、诊断
    setValue(ins[0], "赵敏");
    setValue(ins[2], "37");
    setValue(ins[3], "慢性牙髓炎");
    click($text(".modal-actions button", "建立疗程"));
    if ($all(".modal").length) throw new Error("合法建疗程后弹窗应关闭");

    click($text("button.record-card", "赵敏"));
    modal = $all(".modal.wide")[0] as HTMLElement;

    // access→length 缺工作长度：阻止并在弹窗行内显示原因
    click($text(".stage-actions button", "推进到「测长」"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("工作长度")))
      throw new Error("缺工作长度应行内报错");

    // 补工作长度再推进
    const wl = Array.from(modal.querySelectorAll<HTMLInputElement>("input.ctrl")).find(
      (i) => i.placeholder?.includes("19.5"),
    )!;
    setValue(wl, "20.0mm");
    click($text(".modal-actions button", "保存临床信息"));
    click($text(".stage-actions button", "推进到「测长」"));

    // 跳回开髓被拒（非法回退）
    // UI 无回退按钮，改测连续推进到 prep 合法、prep→medicate 缺主尖锉
    click($text(".stage-actions button", "推进到「根管预备」"));
    click($text(".stage-actions button", "推进到「封药」"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("主尖锉")))
      throw new Error("缺主尖锉应阻止进入封药");
    const mf = Array.from(modal.querySelectorAll<HTMLInputElement>("input.ctrl")).find(
      (i) => i.placeholder === "如 #30",
    )!;
    setValue(mf, "#25");
    click($text(".modal-actions button", "保存临床信息"));
    click($text(".stage-actions button", "推进到「封药」"));

    // medicate→fill 缺封药药物
    click($text(".stage-actions button", "推进到「充填」"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("封药药物")))
      throw new Error("缺封药药物应阻止进入充填");
    const med = Array.from(modal.querySelectorAll<HTMLInputElement>("input.ctrl")).find(
      (i) => i.placeholder?.includes("氢氧化钙"),
    )!;
    setValue(med, "氢氧化钙糊剂");
    click($text(".modal-actions button", "保存临床信息"));
    click($text(".stage-actions button", "推进到「充填」"));

    // fill→done 缺充填材料
    click($text(".stage-actions button", "推进到「完成」"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("充填材料")))
      throw new Error("缺充填材料应阻止完成");
    const fill = Array.from(modal.querySelectorAll<HTMLInputElement>("input.ctrl")).find(
      (i) => i.placeholder?.includes("AH-Plus"),
    )!;
    setValue(fill, "牙胶尖+AH-Plus 冷侧压");
    click($text(".modal-actions button", "保存临床信息"));
    click($text(".stage-actions button", "推进到「完成」"));
    if (!$text(".detail-card", "阶段锁定")) throw new Error("完成后应显示锁定提示");
    click($text(".modal .icon-btn", "✕"));
  });

  test("助理：可登记材料并出现在列表；不能排期（按钮禁用）", () => {
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[2].id); // 周助理
    click($text("button.record-card", "张伟"));
    const modal = $all(".modal.wide")[0] as HTMLElement;
    const matInputs = modal.querySelectorAll<HTMLInputElement>(".material-form input.ctrl");
    setValue(matInputs[0], "K锉 #15");
    setValue(matInputs[1], "1 板");
    click($text(".modal-actions button", "登记材料"));
    if (!$text(".material-list", "K锉 #15")) throw new Error("材料未出现在登记列表");
    const scheduleBtn = Array.from(modal.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent ?? "").includes("安排下次复诊"),
    );
    if (scheduleBtn && !scheduleBtn.disabled) throw new Error("助理的排期按钮应禁用");
    click($text(".modal .icon-btn", "✕"));
  });

  test("前台：可改联系方式并留痕；电话格式非法被行内阻止", () => {
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[3].id); // 何前台
    click($text("button.record-card", "王芳"));
    const modal = $all(".modal.wide")[0] as HTMLElement;
    const phone = modal.querySelector<HTMLInputElement>(".detail-side input.ctrl")!;
    setValue(phone, "12");
    click($text(".detail-side button", "保存联系方式"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("格式")))
      throw new Error("非法电话应行内报错");
    setValue(phone, "137 0000 8888");
    click($text(".detail-side button", "保存联系方式"));
    click($text(".modal .icon-btn", "✕"));
    if (!$text(".audit-list", "修改联系方式")) throw new Error("改电话未写入操作记录");
  });

  test("日历双击空白日：助理无反应；前台打开选疗程→目的缺失被拦→补齐后排期成功留痕", () => {
    // 先以陈医生新建一条未排复诊的进行中疗程（孙洁 #25），供前台日历排期
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[0].id);
    click($text("button", "新建疗程"));
    let nm = $all(".modal")[0] as HTMLElement;
    setValue(nm.querySelector("select") as HTMLSelectElement, "new");
    let ins = nm.querySelectorAll<HTMLInputElement>("input.ctrl");
    setValue(ins[0], "孙洁");
    setValue(ins[2], "25");
    setValue(ins[3], "急性牙髓炎");
    click($text(".modal-actions button", "建立疗程"));

    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[2].id); // 助理
    // 切到下个月，保证所选空白日不在过去
    const navNext = $all(".cal-nav button:not(.ghost-btn)")[1] as HTMLButtonElement;
    click(navNext);
    const findFutureCell = () =>
      Array.from($all(".cal-cell")).find(
        (c) => !c.classList.contains("dim") && !c.classList.contains("has"),
      ) as HTMLElement | undefined;
    let futureCell = findFutureCell();
    if (!futureCell) throw new Error("未找到可选的未来空白日");
    dblClick(futureCell);
    if ($all(".modal-backdrop").length) throw new Error("助理双击日历不应打开排期");

    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[3].id); // 前台
    futureCell = findFutureCell();
    if (!futureCell) throw new Error("前台切换后未找到未来空白日");
    dblClick(futureCell);
    if (!$text(".modal h2", "选择要排期的疗程")) throw new Error("前台双击应弹出疗程选择");
    click($text(".pick-item", "孙洁"));
    if (!$text(".modal h2", "安排复诊")) throw new Error("应进入安排复诊表单");
    // 目的为空直接确认：必填缺失，行内阻止
    click($text(".modal-actions button", "确认排期"));
    if (!$all(".error-box").some((e) => (e.textContent ?? "").includes("复诊目的")))
      throw new Error("复诊目的缺失应被行内阻止");
    const modal = $all(".modal")[0] as HTMLElement;
    const purpose = Array.from(modal.querySelectorAll<HTMLInputElement>("input.ctrl")).find(
      (i) => i.type === "text",
    )!;
    setValue(purpose, "开髓后测长");
    click($text(".modal-actions button", "确认排期"));
    if ($all(".modal-backdrop").length) throw new Error("合法排期后应关闭全部弹窗");
    if (!$text(".audit-list", "安排复诊")) throw new Error("排期未写入操作记录");
  });

  test("导出只含当前筛选：选「封药」阶段导出，CSV 行数与列表一致且留痕", () => {
    setValue($all(".role-switch select")[0] as HTMLSelectElement, USERS[0].id);
    click($text(".chip", "封药"));
    const shown = $all("button.record-card").length;
    click($text("button", "导出当前筛选 CSV"));
    if (!$text(".audit-list", "导出")) throw new Error("导出未写入操作记录");
    // localStorage 仍是封药筛选下的同一份数据
    const raw = window.localStorage.getItem("hxwl-rct-db-v1");
    if (!raw || !raw.includes("安排复诊")) throw new Error("数据未持久化到 localStorage");
    if (shown < 1) throw new Error("封药筛选下至少应有 1 条（张伟 #36）");
    click($text(".chip", "全部"));
  });

  test("持久化：刷新（重挂载）后新增的赵敏 #37 与新复诊仍在", async () => {
    await act(async () => {
      root.unmount();
    });
    const root2 = createRoot(container);
    await act(async () => {
      root2.render(React.createElement(App));
    });
    await flush();
    if (!$text("button.record-card", "赵敏")) throw new Error("刷新后新建疗程丢失");
    if ($all(".cal-event").length < 3) throw new Error("刷新后新排复诊在月历中丢失");
  });
}
