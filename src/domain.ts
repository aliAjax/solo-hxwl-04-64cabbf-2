// 牙科根管治疗管理台 —— 领域模型、校验规则与状态变更（纯函数，无 DOM 依赖）

export type Role = "doctor" | "assistant" | "frontdesk";

export interface User {
  id: string;
  name: string;
  role: Role;
  title: string;
}

export const USERS: User[] = [
  { id: "u-chen", name: "陈医生", role: "doctor", title: "牙体牙髓主治" },
  { id: "u-lin", name: "林医生", role: "doctor", title: "牙体牙髓医生" },
  { id: "u-zhou", name: "周助理", role: "assistant", title: "门诊助理" },
  { id: "u-he", name: "何前台", role: "frontdesk", title: "前台复诊协调员" },
];

export const ROLE_LABEL: Record<Role, string> = {
  doctor: "医生",
  assistant: "助理",
  frontdesk: "前台",
};

// ---- 疗程阶段：开髓 → 测长 → 根管预备 → 封药 → 充填 → 完成 ----
export type Stage = "access" | "length" | "prep" | "medicate" | "fill" | "done";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "access", label: "开髓" },
  { id: "length", label: "测长" },
  { id: "prep", label: "根管预备" },
  { id: "medicate", label: "封药" },
  { id: "fill", label: "充填" },
  { id: "done", label: "完成" },
];

export const STAGE_LABEL: Record<Stage, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.label]),
) as Record<Stage, string>;

export interface Patient {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface Treatment {
  id: string;
  patientId: string;
  tooth: string; // 规范化后的 FDI 牙位，如 "36"
  diagnosis: string; // 诊断
  stage: Stage;
  doctorId: string; // 负责医生
  canals: string; // 根管情况备注
  workingLength: string; // 工作长度，如 "MB 19.5mm / DB 20mm"
  masterFile: string; // 主尖锉，如 "#30"
  medication: string; // 封药药物，如 "氢氧化钙"
  fillMaterial: string; // 充填材料/方式
  nextAppointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  treatmentId: string;
  patientId: string;
  doctorId: string;
  start: string; // ISO，本地时区 YYYY-MM-DDTHH:mm
  durationMin: number;
  purpose: string;
  status: "scheduled" | "cancelled";
  createdAt: string;
}

export interface MaterialUse {
  id: string;
  treatmentId: string;
  name: string;
  quantity: string;
  registrarId: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  role: Role;
  action: string;
  detail: string;
  treatmentId?: string;
}

export interface DB {
  patients: Patient[];
  treatments: Treatment[];
  appointments: Appointment[];
  materials: MaterialUse[];
  logs: AuditLog[];
}

export function emptyDB(): DB {
  return { patients: [], treatments: [], appointments: [], materials: [], logs: [] };
}

export function isEmpty(db: DB): boolean {
  return db.patients.length === 0 && db.treatments.length === 0;
}

// ---- 工具 ----
let seq = 0;
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  seq += 1;
  return `id-${Date.now().toString(36)}-${seq}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 牙位规范化：接受 "#36"/"36"，仅允许 FDI 11–48（末位 1–8）。 */
export function normalizeTooth(raw: string): { ok: true; tooth: string } | { ok: false; reason: string } {
  const tooth = raw.trim().replace(/^#/, "").trim();
  if (!/^(1[1-8]|2[1-8]|3[1-8]|4[1-8])$/.test(tooth)) {
    return { ok: false, reason: "牙位需为 FDI 两位编号（11–48，末位 1–8），如 36；可带 # 前缀" };
  }
  return { ok: true, tooth };
}

const PHONE_RE = /^[0-9+\-\s]{7,20}$/;

// ---- 动作定义 ----
export type Action =
  | {
      type: "createCourse";
      patientId?: string;
      newPatient?: { name: string; phone?: string };
      tooth: string;
      diagnosis: string;
      canals?: string;
      doctorId: string;
    }
  | { type: "updateClinical"; id: string; patch: Partial<Pick<Treatment, "diagnosis" | "canals" | "workingLength" | "masterFile" | "medication" | "fillMaterial">> }
  | { type: "advance"; id: string; to: Stage }
  | { type: "transfer"; id: string; doctorId: string }
  | { type: "registerMaterial"; id: string; name: string; quantity: string }
  | { type: "schedule"; treatmentId: string; start: string; durationMin: number; purpose: string }
  | { type: "reschedule"; appointmentId: string; start: string; durationMin: number; purpose: string }
  | { type: "cancelAppointment"; appointmentId: string }
  | { type: "updatePhone"; patientId: string; phone: string }
  | { type: "exportData"; scope: string; count: number }
  | { type: "restoreSamples" }
  | { type: "clearAll" };

export interface ActCtx {
  user: User;
  at: string;
  uid: () => string;
}

export type ActResult =
  | { ok: true; db: DB; message: string }
  | { ok: false; errors: string[] };

function makeLog(ctx: ActCtx, action: string, detail: string, treatmentId?: string): AuditLog {
  return {
    id: ctx.uid(),
    at: ctx.at,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    role: ctx.user.role,
    action,
    detail,
    treatmentId,
  };
}

const fail = (errors: string[]): ActResult => ({ ok: false, errors });

function doctorName(db: DB, id: string): string {
  void db;
  return USERS.find((u) => u.id === id)?.name ?? id;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 检查同一医生 / 同一患者的预约时间冲突。 */
export function findConflicts(
  db: DB,
  spec: { start: string; durationMin: number; doctorId: string; patientId: string; ignoreId?: string },
): { doctor?: Appointment; patient?: Appointment } {
  const s = new Date(spec.start).getTime();
  if (Number.isNaN(s)) return {};
  const e = s + spec.durationMin * 60000;
  const out: { doctor?: Appointment; patient?: Appointment } = {};
  for (const a of db.appointments) {
    if (a.status !== "scheduled" || a.id === spec.ignoreId) continue;
    const as = new Date(a.start).getTime();
    if (!overlaps(s, e, as, as + a.durationMin * 60000)) continue;
    if (a.doctorId === spec.doctorId && !out.doctor) out.doctor = a;
    if (a.patientId === spec.patientId && !out.patient) out.patient = a;
  }
  return out;
}

const ADVANCE_REQUIRES: Partial<Record<Stage, { field: keyof Treatment; label: string }[]>> = {
  length: [{ field: "workingLength", label: "工作长度" }],
  medicate: [{ field: "masterFile", label: "主尖锉" }],
  fill: [{ field: "medication", label: "封药药物" }],
  done: [{ field: "fillMaterial", label: "充填材料" }],
};

function validateAdvance(t: Treatment, to: Stage): string[] {
  const errors: string[] = [];
  const fromIdx = STAGES.findIndex((s) => s.id === t.stage);
  const toIdx = STAGES.findIndex((s) => s.id === to);
  if (t.stage === "done") {
    errors.push(`疗程已充填完成，阶段已锁定，不能再变更（当前：${STAGE_LABEL.done}）`);
    return errors;
  }
  const sameStep = to === t.stage;
  if (sameStep && to !== "medicate") {
    errors.push(`非法阶段跳转：已处于「${STAGE_LABEL[t.stage]}」，重复进入该阶段没有意义`);
    return errors;
  }
  if (!sameStep && toIdx !== fromIdx + 1) {
    errors.push(
      toIdx <= fromIdx
        ? `非法阶段跳转：不能从「${STAGE_LABEL[t.stage]}」回退到「${STAGE_LABEL[to]}」，阶段只能顺序推进`
        : `非法阶段跳转：不能从「${STAGE_LABEL[t.stage]}」跳到「${STAGE_LABEL[to]}」，需先完成「${STAGES[fromIdx + 1].label}」`,
    );
    return errors;
  }
  for (const req of ADVANCE_REQUIRES[to] ?? []) {
    if (!String(t[req.field] ?? "").trim()) {
      errors.push(`必填缺失：进入「${STAGE_LABEL[to]}」前必须填写${req.label}`);
    }
  }
  return errors;
}

function validateSlot(start: string, durationMin: number, purpose: string, at: string): string[] {
  const errors: string[] = [];
  if (!start) errors.push("必填缺失：请选择复诊时间");
  if (!Number.isFinite(durationMin) || durationMin < 10 || durationMin > 480)
    errors.push("复诊时长需在 10–480 分钟之间");
  if (!purpose.trim()) errors.push("必填缺失：请填写复诊目的");
  if (start && new Date(start).getTime() < new Date(at).getTime() - 60000)
    errors.push("复诊时间不能早于当前时间");
  return errors;
}

function conflictErrors(db: DB, spec: Parameters<typeof findConflicts>[1]): string[] {
  const c = findConflicts(db, spec);
  const errors: string[] = [];
  if (c.doctor)
    errors.push(
      `时间冲突：${doctorName(db, c.doctor.doctorId)}在 ${c.doctor.start.replace("T", " ")} 已有复诊安排（${c.doctor.purpose}）`,
    );
  if (c.patient) {
    const p = db.patients.find((x) => x.id === c.patient!.patientId);
    errors.push(
      `时间冲突：患者${p?.name ?? ""}在 ${c.patient.start.replace("T", " ")} 已有另一场预约（${c.patient.purpose}）`,
    );
  }
  return errors;
}

export function applyAction(db: DB, action: Action, ctx: ActCtx): ActResult {
  const { user } = ctx;
  const isDoctor = user.role === "doctor";

  switch (action.type) {
    case "exportData": {
      return {
        ok: true,
        db: {
          ...db,
          logs: [
            ...db.logs,
            makeLog(ctx, "导出", `导出当前筛选结果：${action.count} 条疗程（${action.scope}）`),
          ],
        },
        message: `已导出 ${action.count} 条疗程`,
      };
    }

    case "restoreSamples": {
      const seeded = buildSeed(ctx.at, ctx.uid, ctx.user);
      return { ok: true, db: seeded, message: "已恢复示例数据" };
    }

    case "clearAll": {
      return { ok: true, db: emptyDB(), message: "已清空全部本地数据" };
    }

    case "createCourse": {
      if (!isDoctor)
        return fail([`无权操作：仅医生可建立疗程（当前角色：${ROLE_LABEL[user.role]}）`]);
      const errors: string[] = [];
      let patient =
        action.patientId != null ? db.patients.find((p) => p.id === action.patientId) : undefined;
      const np = action.newPatient;
      if (!patient) {
        if (!np || !np.name.trim()) errors.push("必填缺失：请填写患者姓名");
        if (np?.phone?.trim() && !PHONE_RE.test(np.phone.trim()))
          errors.push("联系方式格式不正确：需为 7–20 位数字（可含空格、+、-）");
      }
      const toothRes = normalizeTooth(action.tooth);
      if (!toothRes.ok) errors.push(toothRes.reason);
      const tooth = toothRes.ok ? toothRes.tooth : "";
      if (!action.diagnosis.trim()) errors.push("必填缺失：请填写诊断");
      const doctor = USERS.find((u) => u.id === action.doctorId && u.role === "doctor");
      if (!doctor) errors.push("必填缺失：请分配负责医生");
      if (patient && toothRes.ok) {
        const dup = db.treatments.find(
          (t) => t.patientId === patient!.id && t.tooth === tooth,
        );
        if (dup)
          errors.push(
            `重复牙位：患者「${patient.name}」的 #${tooth} 已存在疗程（当前阶段：${STAGE_LABEL[dup.stage]}），同一牙位不能重复建疗程`,
          );
      } else if (!patient && np?.name.trim() && toothRes.ok) {
        const sameName = db.patients.find((p) => p.name === np.name.trim());
        if (sameName) {
          const dup = db.treatments.find(
            (t) => t.patientId === sameName.id && t.tooth === tooth,
          );
          if (dup)
            errors.push(
              `重复牙位：患者「${sameName.name}」的 #${tooth} 已存在疗程（当前阶段：${STAGE_LABEL[dup.stage]}），同一牙位不能重复建疗程`,
            );
        }
      }
      if (errors.length) return fail(errors);

      const logs: AuditLog[] = [];
      let patients = db.patients;
      let patientId: string;
      if (patient) {
        patientId = patient.id;
      } else {
        patientId = ctx.uid();
        patient = {
          id: patientId,
          name: np!.name.trim(),
          phone: np!.phone?.trim() ?? "",
          createdAt: ctx.at,
        };
        patients = [...patients, patient];
        logs.push(makeLog(ctx, "建档", `新建患者档案：${patient.name}${patient.phone ? `，联系方式 ${patient.phone}` : ""}`));
      }
      const id = ctx.uid();
      const treatment: Treatment = {
        id,
        patientId,
        tooth,
        diagnosis: action.diagnosis.trim(),
        stage: "access",
        doctorId: action.doctorId,
        canals: action.canals?.trim() ?? "",
        workingLength: "",
        masterFile: "",
        medication: "",
        fillMaterial: "",
        nextAppointmentId: null,
        createdAt: ctx.at,
        updatedAt: ctx.at,
      };
      logs.push(
        makeLog(
          ctx,
          "新建疗程",
          `患者 ${patient.name}，#${tooth}，诊断「${treatment.diagnosis}」，分配 ${doctor!.name}，阶段：开髓`,
          id,
        ),
      );
      return {
        ok: true,
        db: { ...db, patients, treatments: [...db.treatments, treatment], logs: [...db.logs, ...logs] },
        message: `已为 ${patient.name} 建立 #${tooth} 疗程并分配 ${doctor!.name}`,
      };
    }

    case "updateClinical": {
      const t = db.treatments.find((x) => x.id === action.id);
      if (!t) return fail(["疗程不存在或已被删除"]);
      if (user.role !== "doctor")
        return fail([`无权操作：临床信息仅负责医生可修改（当前角色：${ROLE_LABEL[user.role]}），助理可登记材料`]);
      if (t.doctorId !== user.id)
        return fail([
          `无权操作：#${t.tooth} 疗程由${doctorName(db, t.doctorId)}负责，医生只能修改自己负责的疗程`,
        ]);
      const allowed: (keyof typeof action.patch)[] = [
        "diagnosis",
        "canals",
        "workingLength",
        "masterFile",
        "medication",
        "fillMaterial",
      ];
      const patch: Record<string, string> = {};
      for (const k of allowed) if (action.patch[k] !== undefined) patch[k] = action.patch[k]!.trim();
      if (patch.diagnosis !== undefined && !patch.diagnosis) return fail(["必填缺失：诊断不能为空"]);
      const labels: Record<string, string> = {
        diagnosis: "诊断",
        canals: "根管情况",
        workingLength: "工作长度",
        masterFile: "主尖锉",
        medication: "封药药物",
        fillMaterial: "充填材料",
      };
      const changed = Object.entries(patch)
        .filter(([k, v]) => v !== (t as unknown as Record<string, string>)[k])
        .map(([k, v]) => `${labels[k]}：${v || "（清空）"}`);
      if (!changed.length) return { ok: true, db, message: "没有改动" };
      const updated: Treatment = { ...t, ...patch, updatedAt: ctx.at };
      return {
        ok: true,
        db: {
          ...db,
          treatments: db.treatments.map((x) => (x.id === t.id ? updated : x)),
          logs: [
            ...db.logs,
            makeLog(ctx, "修改临床信息", `#${t.tooth} ${changed.join("；")}`, t.id),
          ],
        },
        message: `#${t.tooth} 临床信息已保存`,
      };
    }

    case "advance": {
      const t = db.treatments.find((x) => x.id === action.id);
      if (!t) return fail(["疗程不存在或已被删除"]);
      if (user.role !== "doctor")
        return fail([`无权操作：仅医生可推进阶段（当前角色：${ROLE_LABEL[user.role]}）`]);
      if (t.doctorId !== user.id)
        return fail([`无权操作：#${t.tooth} 由${doctorName(db, t.doctorId)}负责，你不能推进其阶段`]);
      const errors = validateAdvance(t, action.to);
      if (errors.length) return fail(errors);
      const updated: Treatment = { ...t, stage: action.to, updatedAt: ctx.at };
      const sameMed = action.to === "medicate" && t.stage === "medicate";
      return {
        ok: true,
        db: {
          ...db,
          treatments: db.treatments.map((x) => (x.id === t.id ? updated : x)),
          logs: [
            ...db.logs,
            makeLog(
              ctx,
              sameMed ? "复诊换药" : "阶段推进",
              `#${t.tooth}：${STAGE_LABEL[t.stage]} → ${STAGE_LABEL[action.to]}`,
              t.id,
            ),
          ],
        },
        message: sameMed
          ? `#${t.tooth} 已登记复诊换药（仍为封药阶段）`
          : `#${t.tooth} 已进入「${STAGE_LABEL[action.to]}」阶段`,
      };
    }

    case "transfer": {
      const t = db.treatments.find((x) => x.id === action.id);
      if (!t) return fail(["疗程不存在或已被删除"]);
      if (!isDoctor) return fail([`无权操作：仅医生可调整负责医生（当前角色：${ROLE_LABEL[user.role]}）`]);
      const target = USERS.find((u) => u.id === action.doctorId && u.role === "doctor");
      if (!target) return fail(["请选择有效的负责医生"]);
      if (target.id === t.doctorId) return { ok: true, db, message: "负责医生未变化" };
      return {
        ok: true,
        db: {
          ...db,
          treatments: db.treatments.map((x) =>
            x.id === t.id ? { ...x, doctorId: target.id, updatedAt: ctx.at } : x,
          ),
          appointments: db.appointments.map((a) =>
            a.treatmentId === t.id && a.status === "scheduled" ? { ...a, doctorId: target.id } : a,
          ),
          logs: [
            ...db.logs,
            makeLog(
              ctx,
              "分配医生",
              `#${t.tooth}：${doctorName(db, t.doctorId)} → ${target.name}（待赴约复诊同步改派）`,
              t.id,
            ),
          ],
        },
        message: `#${t.tooth} 已改派给 ${target.name}`,
      };
    }

    case "registerMaterial": {
      const t = db.treatments.find((x) => x.id === action.id);
      if (!t) return fail(["疗程不存在或已被删除"]);
      if (user.role === "frontdesk")
        return fail(["无权操作：前台仅负责排期与联系方式，不能登记材料"]);
      if (user.role === "doctor" && t.doctorId !== user.id)
        return fail([`无权操作：#${t.tooth} 由${doctorName(db, t.doctorId)}负责`]);
      const errors: string[] = [];
      if (!action.name.trim()) errors.push("必填缺失：请填写材料名称");
      if (!action.quantity.trim()) errors.push("必填缺失：请填写用量");
      if (errors.length) return fail(errors);
      const rec: MaterialUse = {
        id: ctx.uid(),
        treatmentId: t.id,
        name: action.name.trim(),
        quantity: action.quantity.trim(),
        registrarId: user.id,
        createdAt: ctx.at,
      };
      return {
        ok: true,
        db: {
          ...db,
          materials: [...db.materials, rec],
          logs: [
            ...db.logs,
            makeLog(
              ctx,
              "材料登记",
              `#${t.tooth}：${rec.name} × ${rec.quantity}`,
              t.id,
            ),
          ],
        },
        message: `已登记材料：${rec.name} × ${rec.quantity}`,
      };
    }

    case "schedule":
    case "reschedule": {
      const isNew = action.type === "schedule";
      const t = isNew
        ? db.treatments.find((x) => x.id === action.treatmentId)
        : undefined;
      const old = !isNew ? db.appointments.find((a) => a.id === action.appointmentId) : undefined;
      const course = isNew ? t : db.treatments.find((x) => x.id === old?.treatmentId);
      if (!course) return fail(["疗程或预约不存在"]);
      if (old && old.status !== "scheduled") return fail(["该预约已取消，不能改期，请新建复诊"]);
      if (user.role === "assistant")
        return fail([`无权操作：助理不能排期（当前角色：助理），仅前台与负责医生可安排复诊`]);
      if (user.role === "doctor" && course.doctorId !== user.id)
        return fail([`无权操作：#${course.tooth} 由${doctorName(db, course.doctorId)}负责，你不能为其排期`]);
      const errors = validateSlot(action.start, action.durationMin, action.purpose, ctx.at);
      if (course.stage === "done") errors.push("疗程已充填完成，不能再安排复诊");
      const patientId = course.patientId;
      const conflicts = conflictErrors(db, {
        start: action.start,
        durationMin: action.durationMin,
        doctorId: course.doctorId,
        patientId,
        ignoreId: old?.id,
      });
      if (conflicts.length) return fail(conflicts);
      if (isNew && course.nextAppointmentId) {
        const exist = db.appointments.find((a) => a.id === course.nextAppointmentId);
        if (exist?.status === "scheduled")
          errors.push("该疗程已有待赴约复诊，请先取消或改期，避免重复预约");
      }
      if (errors.length) return fail(errors);

      if (isNew) {
        const appt: Appointment = {
          id: ctx.uid(),
          treatmentId: course.id,
          patientId,
          doctorId: course.doctorId,
          start: action.start,
          durationMin: action.durationMin,
          purpose: action.purpose.trim(),
          status: "scheduled",
          createdAt: ctx.at,
        };
        const patient = db.patients.find((p) => p.id === patientId);
        return {
          ok: true,
          db: {
            ...db,
            appointments: [...db.appointments, appt],
            treatments: db.treatments.map((x) =>
              x.id === course.id ? { ...x, nextAppointmentId: appt.id, updatedAt: ctx.at } : x,
            ),
            logs: [
              ...db.logs,
              makeLog(
                ctx,
                "安排复诊",
                `#${course.tooth}（${patient?.name ?? ""}）${appt.start.replace("T", " ")}，${appt.durationMin} 分钟，目的：${appt.purpose}，医生：${doctorName(db, course.doctorId)}`,
                course.id,
              ),
            ],
          },
          message: `已为 #${course.tooth} 安排 ${appt.start.replace("T", " ")} 复诊`,
        };
      }

      const updated: Appointment = {
        ...old!,
        start: action.start,
        durationMin: action.durationMin,
        purpose: action.purpose.trim(),
      };
      return {
        ok: true,
        db: {
          ...db,
          appointments: db.appointments.map((a) => (a.id === old!.id ? updated : a)),
          logs: [
            ...db.logs,
            makeLog(
              ctx,
              "改期",
              `#${course.tooth} 复诊改为 ${updated.start.replace("T", " ")}，${updated.durationMin} 分钟，目的：${updated.purpose}`,
              course.id,
            ),
          ],
        },
        message: `复诊已改期至 ${updated.start.replace("T", " ")}`,
      };
    }

    case "cancelAppointment": {
      const a = db.appointments.find((x) => x.id === action.appointmentId);
      if (!a) return fail(["预约不存在"]);
      if (a.status !== "scheduled") return fail(["该预约已取消"]);
      const course = db.treatments.find((t) => t.id === a.treatmentId);
      if (user.role === "assistant") return fail(["无权操作：助理不能取消复诊"]);
      if (user.role === "doctor" && (!course || course.doctorId !== user.id))
        return fail(["无权操作：你不是该疗程的负责医生"]);
      return {
        ok: true,
        db: {
          ...db,
          appointments: db.appointments.map((x) => (x.id === a.id ? { ...x, status: "cancelled" } : x)),
          treatments: db.treatments.map((t) =>
            t.nextAppointmentId === a.id ? { ...t, nextAppointmentId: null, updatedAt: ctx.at } : t,
          ),
          logs: [
            ...db.logs,
            makeLog(ctx, "取消复诊", `#${course?.tooth ?? ""} ${a.start.replace("T", " ")}（${a.purpose}）`, course?.id),
          ],
        },
        message: "复诊已取消",
      };
    }

    case "updatePhone": {
      const p = db.patients.find((x) => x.id === action.patientId);
      if (!p) return fail(["患者不存在"]);
      if (user.role !== "frontdesk")
        return fail([`无权操作：联系方式仅前台可修改（当前角色：${ROLE_LABEL[user.role]}）`]);
      const phone = action.phone.trim();
      if (!phone) return fail(["必填缺失：联系方式不能为空"]);
      if (!PHONE_RE.test(phone)) return fail(["联系方式格式不正确：需为 7–20 位数字（可含空格、+、-）"]);
      if (phone === p.phone) return { ok: true, db, message: "联系方式未变化" };
      return {
        ok: true,
        db: {
          ...db,
          patients: db.patients.map((x) => (x.id === p.id ? { ...x, phone } : x)),
          logs: [...db.logs, makeLog(ctx, "修改联系方式", `${p.name}：${p.phone || "（空）"} → ${phone}`)],
        },
        message: `${p.name} 的联系方式已更新`,
      };
    }
  }
}

// ---- 查询与指标 ----
export interface CourseView {
  treatment: Treatment;
  patient: Patient;
  doctor: User;
  next: Appointment | null;
}

export function courseViews(db: DB): CourseView[] {
  return db.treatments.map((treatment) => {
    const patient = db.patients.find((p) => p.id === treatment.patientId);
    const next =
      (treatment.nextAppointmentId &&
        db.appointments.find(
          (a) => a.id === treatment.nextAppointmentId && a.status === "scheduled",
        )) ||
      null;
    return {
      treatment,
      patient: patient ?? { id: treatment.patientId, name: "（已删除患者）", phone: "", createdAt: "" },
      doctor: USERS.find((u) => u.id === treatment.doctorId) ?? USERS[0],
      next,
    };
  });
}

export interface Filters {
  stage: Stage | "all";
  doctorId: string;
  query: string;
  overdueOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = { stage: "all", doctorId: "all", query: "", overdueOnly: false };

export function filterCourses(db: DB, f: Filters, now: string = nowIso()): CourseView[] {
  const q = f.query.trim().toLowerCase();
  const nowMs = new Date(now).getTime();
  return courseViews(db)
    .filter((v) => (f.stage === "all" ? true : v.treatment.stage === f.stage))
    .filter((v) => (f.doctorId === "all" ? true : v.treatment.doctorId === f.doctorId))
    .filter((v) => {
      if (!q) return true;
      return [v.patient.name, v.treatment.tooth, v.treatment.diagnosis, v.doctor.name, v.treatment.canals]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .filter((v) => {
      if (!f.overdueOnly) return true;
      return v.next != null && new Date(v.next.start).getTime() < nowMs;
    })
    .sort((a, b) => {
      const an = a.next ? new Date(a.next.start).getTime() : Number.POSITIVE_INFINITY;
      const bn = b.next ? new Date(b.next.start).getTime() : Number.POSITIVE_INFINITY;
      if (an !== bn) return an - bn;
      return a.patient.name.localeCompare(b.patient.name, "zh");
    });
}

export interface Metrics {
  waiting: number;
  overdue: number;
  filled: number;
  avgWorkingLength: string;
  medicated: number;
  active: number;
}

export function computeMetrics(db: DB, now: string = nowIso()): Metrics {
  const nowMs = new Date(now).getTime();
  const active = db.treatments.filter((t) => t.stage !== "done");
  let waiting = 0;
  let overdue = 0;
  for (const t of active) {
    const a = db.appointments.find(
      (x) => x.id === t.nextAppointmentId && x.status === "scheduled",
    );
    if (a) {
      waiting += 1;
      if (new Date(a.start).getTime() < nowMs) overdue += 1;
    }
  }
  const lengths: number[] = [];
  for (const t of db.treatments) {
    const ms = [...t.workingLength.matchAll(/(\d+(?:\.\d+)?)\s*mm/gi)].map((m) => parseFloat(m[1]));
    if (ms.length) lengths.push(ms.reduce((s, n) => s + n, 0) / ms.length);
  }
  const avg = lengths.length ? lengths.reduce((s, n) => s + n, 0) / lengths.length : NaN;
  return {
    waiting,
    overdue,
    filled: db.treatments.filter((t) => t.stage === "done").length,
    avgWorkingLength: Number.isNaN(avg) ? "—" : `${avg.toFixed(1)} mm`,
    medicated: db.treatments.filter((t) => t.stage === "medicate").length,
    active: active.length,
  };
}

// ---- 导出（仅当前筛选结果） ----
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCSV(db: DB, views: CourseView[]): string {
  const header = [
    "患者", "联系方式", "牙位", "诊断", "阶段", "负责医生",
    "工作长度", "主尖锉", "封药药物", "充填材料", "下次复诊", "复诊时长(分钟)", "复诊目的",
  ];
  const lines = views.map((v) =>
    [
      v.patient.name,
      v.patient.phone,
      `#${v.treatment.tooth}`,
      v.treatment.diagnosis,
      STAGE_LABEL[v.treatment.stage],
      v.doctor.name,
      v.treatment.workingLength,
      v.treatment.masterFile,
      v.treatment.medication,
      v.treatment.fillMaterial,
      v.next ? v.next.start.replace("T", " ") : "",
      v.next ? String(v.next.durationMin) : "",
      v.next ? v.next.purpose : "",
    ].map(csvCell).join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}

// ---- 示例数据 ----
function atOffset(base: Date, days: number, hh: number, mm: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 0, 0);
  // 转成本地 datetime-local 形态
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}`;
}

export function buildSeed(at: string, genId: () => string = uid, actor?: User): DB {
  const db = emptyDB();
  const id = genId;
  const base = new Date(at);
  const log = (action: string, detail: string, treatmentId?: string) =>
    db.logs.push({
      id: id(),
      at,
      actorId: actor?.id ?? "u-chen",
      actorName: actor?.name ?? "陈医生",
      role: actor?.role ?? "doctor",
      action,
      detail,
      treatmentId,
    });

  const p1: Patient = { id: id(), name: "张伟", phone: "138 0000 1036", createdAt: at };
  const p2: Patient = { id: id(), name: "李娜", phone: "139 0000 2011", createdAt: at };
  const p3: Patient = { id: id(), name: "王芳", phone: "137 0000 3046", createdAt: at };
  db.patients.push(p1, p2, p3);

  const t1: Treatment = {
    id: id(), patientId: p1.id, tooth: "36", diagnosis: "慢性根尖周炎",
    stage: "medicate", doctorId: "u-chen", canals: "MB / DB / P 三根管",
    workingLength: "MB 19.5mm / DB 20.0mm / P 21.0mm", masterFile: "#30",
    medication: "氢氧化钙糊剂", fillMaterial: "", nextAppointmentId: null,
    createdAt: at, updatedAt: at,
  };
  const t2: Treatment = {
    id: id(), patientId: p2.id, tooth: "11", diagnosis: "外伤后变色",
    stage: "done", doctorId: "u-lin", canals: "单根管",
    workingLength: "22.0mm", masterFile: "#40", medication: "氢氧化钙糊剂",
    fillMaterial: "牙胶尖 + AH-Plus，冷侧压充填", nextAppointmentId: null,
    createdAt: at, updatedAt: at,
  };
  const t3: Treatment = {
    id: id(), patientId: p3.id, tooth: "46", diagnosis: "急性牙髓炎",
    stage: "length", doctorId: "u-chen", canals: "近中双根管，远中单根管",
    workingLength: "近颊 18.5mm / 近舌 18.5mm / 远中 19.0mm", masterFile: "",
    medication: "", fillMaterial: "", nextAppointmentId: null,
    createdAt: at, updatedAt: at,
  };
  db.treatments.push(t1, t2, t3);

  const a1: Appointment = {
    id: id(), treatmentId: t1.id, patientId: p1.id, doctorId: "u-chen",
    start: atOffset(base, 3, 9, 30), durationMin: 40, purpose: "复诊换药 / 根管预备",
    status: "scheduled", createdAt: at,
  };
  const a2: Appointment = {
    id: id(), treatmentId: t3.id, patientId: p3.id, doctorId: "u-chen",
    start: atOffset(base, 1, 14, 0), durationMin: 30, purpose: "复测长度并预备",
    status: "scheduled", createdAt: at,
  };
  db.appointments.push(a1, a2);
  t1.nextAppointmentId = a1.id;
  t3.nextAppointmentId = a2.id;

  db.materials.push(
    { id: id(), treatmentId: t1.id, name: "K 锉 #25", quantity: "1 板", registrarId: "u-zhou", createdAt: at },
    { id: id(), treatmentId: t1.id, name: "次氯酸钠冲洗液 2.5%", quantity: "20 ml", registrarId: "u-zhou", createdAt: at },
    { id: id(), treatmentId: t2.id, name: "牙胶尖 #40", quantity: "1 盒", registrarId: "u-zhou", createdAt: at },
  );

  log("新建疗程", `患者 张伟，#36，诊断「慢性根尖周炎」，分配 陈医生，阶段：开髓`, t1.id);
  log("阶段推进", `#36：开髓 → 测长`, t1.id);
  log("阶段推进", `#36：测长 → 根管预备`, t1.id);
  log("阶段推进", `#36：根管预备 → 封药`, t1.id);
  log("安排复诊", `#36（张伟）${a1.start.replace("T", " ")}，40 分钟，目的：复诊换药 / 根管预备`, t1.id);
  log("材料登记", `#36：K 锉 #25 × 1 板`, t1.id);
  log("新建疗程", `患者 李娜，#11，诊断「外伤后变色」，分配 林医生，阶段：开髓`, t2.id);
  log("阶段推进", `#11：封药 → 充填`, t2.id);
  log("阶段推进", `#11：充填 → 完成`, t2.id);
  log("新建疗程", `患者 王芳，#46，诊断「急性牙髓炎」，分配 陈医生，阶段：开髓`, t3.id);
  log("阶段推进", `#46：开髓 → 测长`, t3.id);
  log("安排复诊", `#46（王芳）${a2.start.replace("T", " ")}，30 分钟，目的：复测长度并预备`, t3.id);
  return db;
}

// ---- 本地持久化 ----
const STORAGE_KEY = "hxwl-rct-db-v1";

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = buildSeed(new Date().toISOString());
      saveDB(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as DB;
    return { ...emptyDB(), ...parsed };
  } catch {
    const seeded = buildSeed(new Date().toISOString());
    saveDB(seeded);
    return seeded;
  }
}

export function saveDB(db: DB): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // 存储不可用时仅保留内存态
  }
}
