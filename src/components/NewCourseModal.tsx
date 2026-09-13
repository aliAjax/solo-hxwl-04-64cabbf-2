import { useState } from "react";
import { USERS, ROLE_LABEL } from "../domain";
import type { Patient } from "../domain";
import { useStore } from "../store";
import { ErrorBox, Field, Modal } from "./ui";

export function NewCourseModal({
  patients,
  onClose,
}: {
  patients: Patient[];
  onClose: () => void;
}) {
  const { user, run } = useStore();
  const [patientId, setPatientId] = useState<string>(patients[0]?.id ?? "new");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tooth, setTooth] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [canals, setCanals] = useState("");
  const [doctorId, setDoctorId] = useState(
    user.role === "doctor" ? user.id : USERS.find((u) => u.role === "doctor")?.id ?? "",
  );
  const [errors, setErrors] = useState<string[]>([]);

  const doctors = USERS.filter((u) => u.role === "doctor");
  const isNew = patientId === "new";

  function submit() {
    const res = run({
      type: "createCourse",
      patientId: isNew ? undefined : patientId,
      newPatient: isNew ? { name, phone } : undefined,
      tooth,
      diagnosis,
      canals,
      doctorId,
    });
    if (res.ok) {
      onClose();
    } else {
      setErrors(res.errors);
    }
  }

  return (
    <Modal
      title="新建根管疗程"
      subtitle={`以 ${user.name}（${ROLE_LABEL[user.role]}）身份操作 · 起始阶段固定为「开髓」`}
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="患者" required>
          <select className="ctrl" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="new">＋ 新建患者档案</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.phone || "未留联系方式"}）
              </option>
            ))}
          </select>
        </Field>
        {isNew ? (
          <>
            <Field label="患者姓名" required>
              <input className="ctrl" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 张伟" />
            </Field>
            <Field label="联系方式" hint="前台后续可改">
              <input className="ctrl" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" />
            </Field>
          </>
        ) : null}
        <Field label="牙位（FDI）" required hint="11–48，可带 #">
          <input className="ctrl" value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder="如 36 或 #36" />
        </Field>
        <Field label="诊断" required>
          <input className="ctrl" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="如 慢性根尖周炎" />
        </Field>
        <Field label="负责医生" required>
          <select className="ctrl" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（{d.title}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="根管情况">
          <input className="ctrl" value={canals} onChange={(e) => setCanals(e.target.value)} placeholder="如 MB/DB/P 三根管" />
        </Field>
      </div>

      <ErrorBox errors={errors} />

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary-action" onClick={submit}>
          建立疗程
        </button>
      </div>
    </Modal>
  );
}
