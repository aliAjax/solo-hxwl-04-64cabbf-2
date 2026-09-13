import { useMemo, useState } from "react";
import {
  ROLE_LABEL,
  STAGES,
  USERS,
} from "../domain";
import type { Stage, Treatment } from "../domain";
import { useStore } from "../store";
import { ErrorBox, Field, Modal, StageBadge, Stepper } from "./ui";
import { ScheduleModal } from "./ScheduleModal";

const WEEKDAY = "日一二三四五六";

function fmtDateTime(iso: string): string {
  return `${iso.replace("T", " ")}（周${WEEKDAY[new Date(iso).getDay()]}）`;
}

type ClinicalForm = Pick<
  Treatment,
  "diagnosis" | "canals" | "workingLength" | "masterFile" | "medication" | "fillMaterial"
>;

export function CourseDetailModal({
  treatmentId,
  onClose,
}: {
  treatmentId: string;
  onClose: () => void;
}) {
  const { db, user, run, dispatch } = useStore();
  const [scheduling, setScheduling] = useState(false);
  const [clinicalErrors, setClinicalErrors] = useState<string[]>([]);
  const [stageErrors, setStageErrors] = useState<string[]>([]);
  const [materialErrors, setMaterialErrors] = useState<string[]>([]);
  const [phoneErrors, setPhoneErrors] = useState<string[]>([]);
  const [matName, setMatName] = useState("");
  const [matQty, setMatQty] = useState("");

  const treatment = db.treatments.find((t) => t.id === treatmentId);
  const patient = db.patients.find((p) => p.id === treatment?.patientId);
  const [form, setForm] = useState<ClinicalForm | null>(() =>
    treatment
      ? {
          diagnosis: treatment.diagnosis,
          canals: treatment.canals,
          workingLength: treatment.workingLength,
          masterFile: treatment.masterFile,
          medication: treatment.medication,
          fillMaterial: treatment.fillMaterial,
        }
      : null,
  );
  const [phoneDraft, setPhoneDraft] = useState(patient?.phone ?? "");

  const derived = useMemo(() => {
    if (!treatment) return null;
    const doctor = USERS.find((u) => u.id === treatment.doctorId);
    const next =
      (treatment.nextAppointmentId &&
        db.appointments.find((a) => a.id === treatment.nextAppointmentId && a.status === "scheduled")) ||
      null;
    const history = db.appointments
      .filter((a) => a.treatmentId === treatment.id)
      .sort((a, b) => (a.start < b.start ? 1 : -1));
    const materials = db.materials
      .filter((m) => m.treatmentId === treatment.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const logs = db.logs
      .filter((l) => l.treatmentId === treatment.id)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    return { doctor, next, history, materials, logs };
  }, [db, treatment]);

  if (!treatment || !derived || !form) {
    return (
      <Modal title="疗程不可用" onClose={onClose}>
        <p>该疗程可能已被删除。</p>
        <div className="modal-actions">
          <button className="primary-action" onClick={onClose}>关闭</button>
        </div>
      </Modal>
    );
  }

  const { doctor, next, history, materials, logs } = derived;
  const set = (k: keyof ClinicalForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const isDoctor = user.role === "doctor";
  const isOwner = isDoctor && treatment.doctorId === user.id;
  const canSchedule = user.role === "frontdesk" || isOwner;
  const canMaterial = user.role === "assistant" || isOwner;
  const stageIdx = STAGES.findIndex((s) => s.id === treatment.stage);
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
  const overdue = next != null && new Date(next.start).getTime() < Date.now();

  function saveClinical() {
    const res = run({ type: "updateClinical", id: treatment!.id, patch: form! });
    setClinicalErrors(res.ok ? [] : res.errors);
  }

  function advance(to: Stage) {
    const res = run({ type: "advance", id: treatment!.id, to });
    setStageErrors(res.ok ? [] : res.errors);
  }

  function registerMaterial() {
    const res = run({ type: "registerMaterial", id: treatment!.id, name: matName, quantity: matQty });
    if (res.ok) {
      setMaterialErrors([]);
      setMatName("");
      setMatQty("");
    } else {
      setMaterialErrors(res.errors);
    }
  }

  function savePhone() {
    if (!patient) return;
    const res = run({ type: "updatePhone", patientId: patient.id, phone: phoneDraft });
    setPhoneErrors(res.ok ? [] : res.errors);
  }

  function cancelAppt() {
    if (next && window.confirm(`确认取消 ${next.start.replace("T", " ")} 的复诊？`)) {
      dispatch({ type: "cancelAppointment", appointmentId: next.id });
    }
  }

  return (
    <Modal
      wide
      title={
        <>
          #{treatment.tooth} 根管疗程 <StageBadge stage={treatment.stage} />
        </>
      }
      subtitle={
        patient ? (
          <>
            患者 {patient.name} · 负责医生 {doctor?.name} · 当前身份：{user.name}（{ROLE_LABEL[user.role]}）
          </>
        ) : null
      }
      onClose={onClose}
    >
      <div className="detail-grid">
        <div className="detail-main">
          <Stepper stage={treatment.stage} />

          <section className="detail-card">
            <h3>阶段推进</h3>
            <p className="muted-text">
              阶段只能顺序前进，不能回退或跳级；进入下一阶段前需补齐必填临床数据。
            </p>
            {treatment.stage === "done" ? (
              <p className="locked-note">🔒 疗程已充填完成，阶段锁定。</p>
            ) : (
              <div className="stage-actions">
                {nextStage ? (
                  <button className="primary-action" disabled={!isOwner} onClick={() => advance(nextStage.id)}>
                    推进到「{nextStage.label}」
                  </button>
                ) : null}
                {treatment.stage === "medicate" ? (
                  <button className="ghost-btn" disabled={!isOwner} onClick={() => advance("medicate")}>
                    登记复诊换药（阶段不变）
                  </button>
                ) : null}
                {!isOwner ? (
                  <p className="perm-note">
                    {isDoctor
                      ? `该疗程由 ${doctor?.name} 负责，你只能改派医生，不能修改临床信息或阶段。`
                      : `当前角色（${ROLE_LABEL[user.role]}）不能推进阶段，仅负责医生可以。`}
                  </p>
                ) : null}
              </div>
            )}
            <ErrorBox errors={stageErrors} />
          </section>

          <section className="detail-card">
            <h3>临床信息</h3>
            <div className="form-grid">
              <Field label="诊断" required>
                <input
                  className="ctrl"
                  value={form.diagnosis}
                  disabled={!isOwner}
                  onChange={(e) => set("diagnosis", e.target.value)}
                />
              </Field>
              <Field label="根管情况">
                <input
                  className="ctrl"
                  value={form.canals}
                  disabled={!isOwner}
                  onChange={(e) => set("canals", e.target.value)}
                  placeholder="如 MB/DB/P 三根管"
                />
              </Field>
              <Field label="工作长度" hint="进入测长后必填；多根管如 MB 19.5mm / DB 20mm">
                <input
                  className="ctrl"
                  value={form.workingLength}
                  disabled={!isOwner}
                  onChange={(e) => set("workingLength", e.target.value)}
                  placeholder="如 MB 19.5mm / DB 20.0mm"
                />
              </Field>
              <Field label="主尖锉" hint="进入封药前必填">
                <input
                  className="ctrl"
                  value={form.masterFile}
                  disabled={!isOwner}
                  onChange={(e) => set("masterFile", e.target.value)}
                  placeholder="如 #30"
                />
              </Field>
              <Field label="封药药物" hint="进入充填前必填">
                <input
                  className="ctrl"
                  value={form.medication}
                  disabled={!isOwner}
                  onChange={(e) => set("medication", e.target.value)}
                  placeholder="如 氢氧化钙糊剂"
                />
              </Field>
              <Field label="充填材料 / 方式" hint="完成前必填">
                <input
                  className="ctrl"
                  value={form.fillMaterial}
                  disabled={!isOwner}
                  onChange={(e) => set("fillMaterial", e.target.value)}
                  placeholder="如 牙胶尖 + AH-Plus，冷侧压"
                />
              </Field>
            </div>
            {!isOwner && !isDoctor ? (
              <p className="perm-note">临床信息与诊断仅负责医生可修改，助理不能改诊断。</p>
            ) : null}
            <ErrorBox errors={clinicalErrors} />
            <div className="modal-actions">
              <button className="primary-action" disabled={!isOwner} onClick={saveClinical}>
                保存临床信息
              </button>
            </div>
          </section>

          <section className="detail-card">
            <h3>复诊安排</h3>
            {next ? (
              <div className={`appt-card${overdue ? " overdue" : ""}`}>
                <div>
                  <strong>{fmtDateTime(next.start)}</strong>
                  <span>
                    {next.durationMin} 分钟 · {next.purpose} · {doctor?.name}
                  </span>
                  {overdue ? <em className="overdue-tag">已逾复诊时间</em> : null}
                </div>
                <div className="row-actions">
                  <button disabled={!canSchedule} onClick={() => setScheduling(true)}>
                    改期
                  </button>
                  <button className="danger-btn" disabled={!canSchedule} onClick={cancelAppt}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted-text">
                {treatment.stage === "done" ? "疗程已完成，无待赴约复诊。" : "暂无待赴约复诊。"}
              </p>
            )}
            {treatment.stage !== "done" ? (
              <div className="modal-actions inline">
                <button className="primary-action" disabled={!canSchedule} onClick={() => setScheduling(true)}>
                  {next ? "重新排期" : "安排下次复诊"}
                </button>
                {!canSchedule ? (
                  <p className="perm-note">
                    {isDoctor ? "仅负责医生或前台可排期。" : "助理不能排期，请联系前台或负责医生。"}
                  </p>
                ) : null}
              </div>
            ) : null}
            {history.length ? (
              <details className="history-list">
                <summary>全部预约记录（{history.length}）</summary>
                <ul>
                  {history.map((a) => (
                    <li key={a.id}>
                      {a.start.replace("T", " ")} · {a.purpose} ·{" "}
                      <span className={a.status === "cancelled" ? "cancelled-text" : ""}>
                        {a.status === "cancelled" ? "已取消" : "待赴约"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="detail-card">
            <h3>材料登记</h3>
            {materials.length ? (
              <ul className="material-list">
                {materials.map((m) => {
                  const reg = USERS.find((u) => u.id === m.registrarId);
                  return (
                    <li key={m.id}>
                      <span>{m.name}</span>
                      <strong>{m.quantity}</strong>
                      <small>{reg?.name ?? m.registrarId} 登记</small>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted-text">暂无材料记录。</p>
            )}
            <div className="form-grid material-form">
              <Field label="材料名称" required>
                <input
                  className="ctrl"
                  value={matName}
                  disabled={!canMaterial}
                  onChange={(e) => setMatName(e.target.value)}
                  placeholder="如 K 锉 #25"
                />
              </Field>
              <Field label="用量" required>
                <input
                  className="ctrl"
                  value={matQty}
                  disabled={!canMaterial}
                  onChange={(e) => setMatQty(e.target.value)}
                  placeholder="如 1 板 / 20 ml"
                />
              </Field>
            </div>
            <ErrorBox errors={materialErrors} />
            <div className="modal-actions inline">
              <button className="primary-action" disabled={!canMaterial} onClick={registerMaterial}>
                登记材料
              </button>
              {!canMaterial ? <p className="perm-note">前台不能登记材料。</p> : null}
            </div>
          </section>
        </div>

        <aside className="detail-side">
          <section className="detail-card">
            <h3>患者与联系方式</h3>
            <p className="patient-line">
              {patient?.name} <small>{patient?.phone || "未留联系方式"}</small>
            </p>
            <Field label="修改联系方式" required>
              <input
                className="ctrl"
                value={phoneDraft}
                disabled={user.role !== "frontdesk"}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="手机号"
              />
            </Field>
            <ErrorBox errors={phoneErrors} />
            <button
              className="ghost-btn full-width"
              disabled={user.role !== "frontdesk"}
              onClick={savePhone}
            >
              保存联系方式
            </button>
            {user.role !== "frontdesk" ? (
              <p className="perm-note">仅前台可修改联系方式。</p>
            ) : null}
          </section>

          <section className="detail-card">
            <h3>负责医生</h3>
            <p className="muted-text">
              {doctor?.name}（{doctor?.title}）
            </p>
            <Field label="改派医生" hint="待赴约复诊将同步改派">
              <select
                className="ctrl"
                value={treatment.doctorId}
                disabled={!isDoctor}
                onChange={(e) => dispatch({ type: "transfer", id: treatment.id, doctorId: e.target.value })}
              >
                {USERS.filter((u) => u.role === "doctor").map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            {!isDoctor ? <p className="perm-note">仅医生可调整负责医生。</p> : null}
          </section>

          <section className="detail-card">
            <h3>本疗程操作记录</h3>
            <ul className="mini-log">
              {logs.slice(0, 12).map((l) => (
                <li key={l.id}>
                  <time>{new Date(l.at).toLocaleString("zh-CN", { hour12: false })}</time>
                  <span className="log-action">{l.action}</span>
                  <p>{l.detail}</p>
                  <small>
                    {l.actorName} · {ROLE_LABEL[l.role]}
                  </small>
                </li>
              ))}
              {!logs.length ? <li className="muted-text">暂无记录</li> : null}
            </ul>
          </section>
        </aside>
      </div>

      {scheduling ? (
        <ScheduleModal
          treatmentId={treatment.id}
          appointment={next ?? undefined}
          onClose={() => setScheduling(false)}
        />
      ) : null}
    </Modal>
  );
}
