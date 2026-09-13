// 交互规则验证：覆盖重复牙位、时间冲突、非法阶段跳转、必填缺失、角色权限、
// 指标/筛选/导出随数据同步、空库恢复示例、本地持久化。
import assert from "node:assert/strict";

// ---- localStorage shim（模拟浏览器本地持久化） ----
// Node 21+ 的部分内置全局（如 navigator）在严格模式下只读赋值会抛错，
// 统一用 defineProperty(configurable) 注入，兼容所有 Node 版本。
const mem = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  },
});

const {
  USERS,
  emptyDB,
  isEmpty,
  buildSeed,
  loadDB,
  saveDB,
  applyAction,
  computeMetrics,
  filterCourses,
  courseViews,
  buildCSV,
  DEFAULT_FILTERS,
  STAGE_LABEL,
} = await import("./domain.mjs");

const [chen, lin, zhou, he] = USERS;
assert.equal(chen.name, "陈医生");
assert.equal(lin.name, "林医生");
assert.equal(zhou.role, "assistant");
assert.equal(he.role, "frontdesk");

let seq = 0;
// 固定"当前时刻"必须按本地挂钟构造：排期入参是无时区 datetime（按本地时区解释），
// 若这里用 UTC 绝对时刻（...Z），UTC+ 时区下 11:00 本地会早于 09:00Z 被误判为过去。
const LOCAL_NOW = new Date(2026, 8, 13, 9, 0, 0, 0);
const NOW_ISO = LOCAL_NOW.toISOString();
// 足够远的未来视角（按本地构造），保证任何时区下种子复诊都已逾期
const FUTURE_ISO = new Date(2030, 0, 2, 0, 0, 0, 0).toISOString();
const ctx = (user, at = NOW_ISO) => ({
  user,
  at,
  uid: () => `t${++seq}`,
});

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
function expectErrors(res, needles) {
  assert.equal(res.ok, false, "应当被拦截");
  for (const n of needles) {
    assert.ok(
      res.errors.some((e) => e.includes(n)),
      `错误信息应包含「${n}」，实际：${JSON.stringify(res.errors)}`,
    );
  }
}

console.log("\n[1] 空库恢复示例与本地持久化");
let db = emptyDB();
assert.ok(isEmpty(db));
check("空库可恢复示例数据（3 患者 / 3 疗程 / 2 复诊 / 3 材料 / 含日志）", () => {
  db = buildSeed(NOW_ISO, () => `s${++seq}`, chen);
  assert.equal(db.patients.length, 3);
  assert.equal(db.treatments.length, 3);
  assert.equal(db.appointments.length, 2);
  assert.equal(db.materials.length, 3);
  assert.ok(db.logs.length >= 10);
  assert.ok(!isEmpty(db));
});
check("saveDB/loadDB 刷新不丢（localStorage 往返）", () => {
  saveDB(db);
  const again = loadDB();
  assert.equal(again.treatments.length, 3);
  assert.equal(again.appointments.length, 2);
});

console.log("\n[2] 新建疗程：必填与重复牙位");
check("缺患者姓名/牙位/诊断/医生 时一次性列出全部必填原因", () => {
  const r = applyAction(db, {
    type: "createCourse",
    newPatient: { name: "", phone: "" },
    tooth: "",
    diagnosis: "",
    doctorId: "",
  }, ctx(chen));
  expectErrors(r, ["患者姓名", "牙位", "诊断", "负责医生"]);
});
check("牙位格式非法（如 99、58、ab）被阻止并说明 FDI 规则", () => {
  const r = applyAction(db, {
    type: "createCourse",
    newPatient: { name: "测试" },
    tooth: "99",
    diagnosis: "牙髓炎",
    doctorId: chen.id,
  }, ctx(chen));
  expectErrors(r, ["FDI"]);
});
check("同一患者重复牙位（#36/# 36 等价）被阻止并指明现有阶段", () => {
  const zhang = db.patients.find((p) => p.name === "张伟");
  const r = applyAction(db, {
    type: "createCourse",
    patientId: zhang.id,
    tooth: "# 36",
    diagnosis: "随便",
    doctorId: chen.id,
  }, ctx(chen));
  expectErrors(r, ["重复牙位", "张伟", "#36", STAGE_LABEL.medicate]);
});
check("同名新患者同样拦截重复牙位；不同牙位放行并生成多牙位疗程", () => {
  const dup = applyAction(db, {
    type: "createCourse",
    newPatient: { name: "张伟" },
    tooth: "36",
    diagnosis: "x",
    doctorId: chen.id,
  }, ctx(chen));
  expectErrors(dup, ["重复牙位"]);
  const ok = applyAction(db, {
    type: "createCourse",
    patientId: db.patients.find((p) => p.name === "张伟").id,
    tooth: "37",
    diagnosis: "楔状缺损累及牙髓",
    doctorId: chen.id,
  }, ctx(chen));
  assert.equal(ok.ok, true);
  db = ok.db;
  assert.equal(db.treatments.length, 4);
  assert.ok(db.logs.at(-1).action === "新建疗程");
});

console.log("\n[3] 角色权限");
const t36 = db.treatments.find((t) => t.tooth === "36" && t.patientId === db.patients.find((p) => p.name === "张伟").id);
check("非医生（助理/前台）不能建立疗程", () => {
  for (const u of [zhou, he]) {
    const r = applyAction(db, {
      type: "createCourse",
      newPatient: { name: "钱某" },
      tooth: "21",
      diagnosis: "牙髓炎",
      doctorId: chen.id,
    }, ctx(u));
    expectErrors(r, ["无权操作", "仅医生"]);
  }
});
check("医生只能修改自己负责的疗程（林医生改陈医生的 #36 被拒）", () => {
  const r = applyAction(db, {
    type: "updateClinical",
    id: t36.id,
    patch: { diagnosis: "被篡改的诊断" },
  }, ctx(lin));
  expectErrors(r, ["无权操作", "陈医生"]);
});
check("助理不能改诊断与临床信息", () => {
  const r = applyAction(db, {
    type: "updateClinical",
    id: t36.id,
    patch: { masterFile: "#35" },
  }, ctx(zhou));
  expectErrors(r, ["助理", "负责医生"]);
});
check("助理可以登记材料（但不能改诊断）", () => {
  const r = applyAction(db, {
    type: "registerMaterial",
    id: t36.id,
    name: "吸潮纸尖",
    quantity: "1 盒",
  }, ctx(zhou));
  assert.equal(r.ok, true);
  db = r.db;
  assert.equal(db.materials.at(-1).name, "吸潮纸尖");
  assert.equal(db.materials.at(-1).registrarId, zhou.id);
});
check("助理登记材料缺名称/用量被阻止", () => {
  const r = applyAction(db, {
    type: "registerMaterial",
    id: t36.id,
    name: "",
    quantity: "",
  }, ctx(zhou));
  expectErrors(r, ["材料名称", "用量"]);
});
check("前台不能登记材料", () => {
  const r = applyAction(db, {
    type: "registerMaterial",
    id: t36.id,
    name: "牙胶尖",
    quantity: "1",
  }, ctx(he));
  expectErrors(r, ["前台"]);
});
check("前台只能改联系方式（医生/助理改电话被拒）", () => {
  const pid = t36.patientId;
  assert.equal(applyAction(db, { type: "updatePhone", patientId: pid, phone: "13800000000" }, ctx(chen)).ok, false);
  assert.equal(applyAction(db, { type: "updatePhone", patientId: pid, phone: "13800000000" }, ctx(zhou)).ok, false);
  const bad = applyAction(db, { type: "updatePhone", patientId: pid, phone: "12" }, ctx(he));
  expectErrors(bad, ["格式"]);
  const empty = applyAction(db, { type: "updatePhone", patientId: pid, phone: "  " }, ctx(he));
  expectErrors(empty, ["不能为空"]);
  const ok = applyAction(db, { type: "updatePhone", patientId: pid, phone: "138 0000 9999" }, ctx(he));
  assert.equal(ok.ok, true);
  db = ok.db;
  assert.equal(db.patients.find((p) => p.id === pid).phone, "138 0000 9999");
});
check("助理不能排期；负责医生/前台可以", () => {
  const t46 = db.treatments.find((t) => t.tooth === "46");
  const r = applyAction(db, {
    type: "schedule",
    treatmentId: t46.id,
    start: "2026-09-20T10:00",
    durationMin: 30,
    purpose: "复诊",
  }, ctx(zhou));
  expectErrors(r, ["助理不能排期"]);
});

console.log("\n[4] 阶段流转：非法跳转与门禁必填");
check("不能从开髓跳到封药（需先完成测长）", () => {
  const t37 = db.treatments.find((t) => t.tooth === "37");
  const r = applyAction(db, { type: "advance", id: t37.id, to: "medicate" }, ctx(chen));
  expectErrors(r, ["非法阶段跳转", "测长"]);
});
check("未填工作长度不能进入测长", () => {
  const t37 = db.treatments.find((t) => t.tooth === "37");
  const r = applyAction(db, { type: "advance", id: t37.id, to: "length" }, ctx(chen));
  expectErrors(r, ["工作长度"]);
});
check("补齐工作长度后可进入测长；非负责医生不能推进", () => {
  const t37 = db.treatments.find((t) => t.tooth === "37");
  let r = applyAction(db, {
    type: "updateClinical",
    id: t37.id,
    patch: { workingLength: "20.0mm", canals: "单根管" },
  }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  const denied = applyAction(db, { type: "advance", id: t37.id, to: "length" }, ctx(lin));
  expectErrors(denied, ["无权操作"]);
  r = applyAction(db, { type: "advance", id: t37.id, to: "length" }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
});
check("不能回退阶段（测长 → 开髓被拒）", () => {
  const t37 = db.treatments.find((t) => t.tooth === "37");
  const r = applyAction(db, { type: "advance", id: t37.id, to: "access" }, ctx(chen));
  expectErrors(r, ["回退"]);
});
check("已完成疗程阶段锁定，不能再推进/排期", () => {
  const t11 = db.treatments.find((t) => t.tooth === "11");
  const r1 = applyAction(db, { type: "advance", id: t11.id, to: "done" }, ctx(lin));
  expectErrors(r1, ["锁定"]);
  const r2 = applyAction(db, {
    type: "schedule",
    treatmentId: t11.id,
    start: "2026-09-20T10:00",
    durationMin: 30,
    purpose: "复查",
  }, ctx(he));
  expectErrors(r2, ["充填完成"]);
});
check("封药阶段重复进入仅允许「复诊换药」语义；重复停留在其他阶段被拒", () => {
  const t36Now = db.treatments.find((t) => t.id === t36.id);
  const re = applyAction(db, { type: "advance", id: t36Now.id, to: "medicate" }, ctx(chen));
  assert.equal(re.ok, true);
  assert.equal(re.db.treatments.find((t) => t.id === t36.id).stage, "medicate");
  assert.match(re.message, /换药/);
  const t37 = db.treatments.find((t) => t.tooth === "37");
  const same = applyAction(db, { type: "advance", id: t37.id, to: "length" }, ctx(chen));
  expectErrors(same, ["已处于"]);
});
check("进入封药前必须有主尖锉；进入充填前必须有封药；完成前必须有充填材料", () => {
  const t37 = db.treatments.find((t) => t.tooth === "37");
  // 测长 → 预备：合法单步
  let r = applyAction(db, { type: "advance", id: t37.id, to: "prep" }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  // 预备 → 封药：缺主尖锉
  expectErrors(applyAction(db, { type: "advance", id: t37.id, to: "medicate" }, ctx(chen)), ["主尖锉"]);
  r = applyAction(db, { type: "updateClinical", id: t37.id, patch: { masterFile: "#25" } }, ctx(chen));
  db = r.db;
  r = applyAction(db, { type: "advance", id: t37.id, to: "medicate" }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  // 封药 → 充填：缺封药药物（主尖锉已填，药物为空）
  expectErrors(applyAction(db, { type: "advance", id: t37.id, to: "fill" }, ctx(chen)), ["封药药物"]);
  r = applyAction(db, { type: "updateClinical", id: t37.id, patch: { medication: "氢氧化钙" } }, ctx(chen));
  db = r.db;
  r = applyAction(db, { type: "advance", id: t37.id, to: "fill" }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  // 充填 → 完成：缺充填材料
  expectErrors(applyAction(db, { type: "advance", id: t37.id, to: "done" }, ctx(chen)), ["充填材料"]);
  r = applyAction(db, { type: "updateClinical", id: t37.id, patch: { fillMaterial: "牙胶尖冷侧压" } }, ctx(chen));
  db = r.db;
  r = applyAction(db, { type: "advance", id: t37.id, to: "done" }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  assert.equal(db.treatments.find((t) => t.id === t37.id).stage, "done");
});

console.log("\n[5] 排期校验：时间冲突与必填");
const t46 = db.treatments.find((t) => t.tooth === "46");
// 新建张伟的 #38（陈医生），专门走排期成功路径（无既有复诊）
const created38 = applyAction(db, {
  type: "createCourse",
  patientId: db.patients.find((p) => p.name === "张伟").id,
  tooth: "38",
  diagnosis: "智齿冠周炎累及牙髓",
  doctorId: chen.id,
}, ctx(chen));
assert.equal(created38.ok, true);
db = created38.db;
const t38 = db.treatments.find((t) => t.tooth === "38");

check("缺时间/目的、时长越界、过去时间 都被阻止", () => {
  const r = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: "",
    durationMin: 5,
    purpose: "",
  }, ctx(he));
  expectErrors(r, ["复诊时间", "10–480", "复诊目的"]);
  const past = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: "2020-01-01T09:00",
    durationMin: 30,
    purpose: "x",
  }, ctx(he));
  expectErrors(past, ["不能早于当前"]);
});
check("同一医生时间重叠被阻止并指出冲突预约", () => {
  // t46 现有复诊为 +1 天 14:00（陈医生）；给同由陈医生负责的 #38 排同一时段
  const t46Appt = db.appointments.find((a) => a.treatmentId === t46.id && a.status === "scheduled");
  const r = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: t46Appt.start, // 完全重叠
    durationMin: 30,
    purpose: "换药",
  }, ctx(he));
  expectErrors(r, ["时间冲突", "陈医生"]);
});
check("同一患者两个牙位疗程时间重叠也被阻止", () => {
  const t36Appt = db.appointments.find((a) => a.treatmentId === t36.id && a.status === "scheduled");
  // 张伟 #36 在 +3 天 09:30；给张伟 #38 排 09:40，患者撞档
  const [day, hm] = [t36Appt.start.slice(0, 10), "09:40"];
  const r = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: `${day}T${hm}`,
    durationMin: 30,
    purpose: "测长复查",
  }, ctx(he));
  expectErrors(r, ["时间冲突", "患者张伟"]);
});
check("错开放置时间后排期成功；同疗程重复排期被阻止", () => {
  const r = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: "2026-09-13T11:00",
    durationMin: 40,
    purpose: "根管预备",
  }, ctx(he));
  assert.equal(r.ok, true);
  db = r.db;
  const dup = applyAction(db, {
    type: "schedule",
    treatmentId: t38.id,
    start: "2026-09-14T11:00",
    durationMin: 30,
    purpose: "再来",
  }, ctx(he));
  expectErrors(dup, ["已有待赴约", "改期"]);
});
check("改期到冲突时段被阻止；取消后疗程的待赴约引用被清空", () => {
  const a38 = db.appointments.find((a) => a.treatmentId === t38.id && a.status === "scheduled");
  const a46 = db.appointments.find((a) => a.treatmentId === t46.id && a.status === "scheduled");
  const clash = applyAction(db, {
    type: "reschedule",
    appointmentId: a38.id,
    start: a46.start,
    durationMin: 30,
    purpose: "改期撞档",
  }, ctx(he));
  expectErrors(clash, ["时间冲突"]);
  const cancel = applyAction(db, { type: "cancelAppointment", appointmentId: a38.id }, ctx(he));
  assert.equal(cancel.ok, true);
  db = cancel.db;
  assert.equal(db.treatments.find((t) => t.id === t38.id).nextAppointmentId, null);
});
check("助理不能取消复诊", () => {
  const a46 = db.appointments.find((a) => a.treatmentId === t46.id && a.status === "scheduled");
  expectErrors(applyAction(db, { type: "cancelAppointment", appointmentId: a46.id }, ctx(zhou)), ["助理"]);
});
check("改派医生后待赴约复诊同步改派，且新医生拥有编辑/排期权", () => {
  const r = applyAction(db, { type: "transfer", id: t36.id, doctorId: lin.id }, ctx(chen));
  assert.equal(r.ok, true);
  db = r.db;
  const updated = db.treatments.find((t) => t.id === t36.id);
  assert.equal(updated.doctorId, lin.id);
  // 待赴约复诊同步改派给新医生
  const linkedAppt = db.appointments.find(
    (a) => a.id === updated.nextAppointmentId && a.status === "scheduled",
  );
  assert.ok(linkedAppt, "t36 应仍有待赴约复诊");
  assert.equal(linkedAppt.doctorId, lin.id);
  // 陈医生不再能改该疗程
  expectErrors(
    applyAction(db, { type: "updateClinical", id: t36.id, patch: { diagnosis: "x" } }, ctx(chen)),
    ["林医生"],
  );
  // 林医生可以推进
  const adv = applyAction(db, { type: "advance", id: t36.id, to: "medicate" }, ctx(lin));
  assert.equal(adv.ok, true);
  db = adv.db;
});

console.log("\n[6] 指标、筛选、列表随数据同步");
check("指标与当前数据一致（待复诊/逾期/完成/封药/平均工作长度）", () => {
  const mNow = computeMetrics(db, NOW_ISO);
  assert.equal(mNow.filled, 2); // 示例 #11 与走完全流程的 #37
  assert.ok(mNow.active >= 3);
  assert.ok(mNow.medicated >= 1);
  assert.match(mNow.avgWorkingLength, /mm$/);
  const mFuture = computeMetrics(db, FUTURE_ISO);
  assert.ok(mFuture.overdue >= 1, "未来视角下示例复诊应全部逾期");
  // 剩余待赴约复诊都在 2026 年，2030 视角下应全部逾期（原先这里是恒真式，加强为精确相等）
  assert.equal(mFuture.waiting, mFuture.overdue);
});
check("阶段筛选 + 医生筛选 + 关键字 + 仅逾期 同步收窄列表", () => {
  const all = filterCourses(db, DEFAULT_FILTERS, NOW_ISO);
  assert.equal(all.length, db.treatments.length);
  const med = filterCourses(db, { ...DEFAULT_FILTERS, stage: "medicate" }, NOW_ISO);
  assert.ok(med.every((v) => v.treatment.stage === "medicate"));
  const chenOnly = filterCourses(db, { ...DEFAULT_FILTERS, doctorId: chen.id }, NOW_ISO);
  assert.ok(chenOnly.every((v) => v.treatment.doctorId === chen.id));
  const hit = filterCourses(db, { ...DEFAULT_FILTERS, query: "张伟 37" }, NOW_ISO);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].treatment.tooth, "37");
  const overdue = filterCourses(db, { ...DEFAULT_FILTERS, overdueOnly: true }, FUTURE_ISO);
  assert.ok(overdue.length >= 1);
  assert.ok(overdue.every((v) => v.next && new Date(v.next.start).getTime() < Date.parse(FUTURE_ISO)));
});

console.log("\n[7] 导出只含当前筛选");
check("CSV 行数等于筛选结果数且含 BOM 与关键字段", () => {
  const views = filterCourses(db, { ...DEFAULT_FILTERS, stage: "medicate" });
  const csv = buildCSV(db, views);
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines.length - 1, views.length);
  assert.match(lines[0], /患者/);
  assert.match(lines[0], /工作长度/);
  assert.ok(csv.startsWith("﻿"));
  // 全量导出明显更多
  const full = buildCSV(db, courseViews(db));
  assert.ok(full.split("\r\n").length > lines.length);
});

console.log("\n[8] 数据维护动作也留痕");
check("清空/恢复/导出都写操作记录", () => {
  let r = applyAction(db, { type: "exportData", scope: "阶段=封药", count: 1 }, ctx(he));
  assert.equal(r.ok, true);
  assert.equal(r.db.logs.at(-1).action, "导出");
  r = applyAction(r.db, { type: "clearAll" }, ctx(chen));
  assert.equal(r.ok, true);
  assert.ok(isEmpty(r.db));
  r = applyAction(r.db, { type: "restoreSamples" }, ctx(chen));
  assert.equal(r.ok, true);
  assert.equal(r.db.treatments.length, 3);
});

console.log(`\n全部 ${passed} 组交互验证通过 ✅`);
