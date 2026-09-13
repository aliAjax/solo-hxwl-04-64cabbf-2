import { useState } from "react";
import type { Appointment } from "../domain";
import { useStore } from "../store";
import { ErrorBox, Field, Modal } from "./ui";

function defaultStart(base: Date): string {
  const d = new Date(base.getTime() + 24 * 3600 * 1000);
  d.setHours(9, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleModal({
  appointment,
  treatmentId,
  initialStart,
  onClose,
}: {
  appointment?: Appointment;
  treatmentId: string;
  initialStart?: string;
  onClose: () => void;
}) {
  const { run } = useStore();
  const [start, setStart] = useState(
    appointment ? appointment.start : initialStart ?? defaultStart(new Date()),
  );
  const [durationMin, setDurationMin] = useState(appointment ? appointment.durationMin : 30);
  const [purpose, setPurpose] = useState(appointment ? appointment.purpose : "");
  const [errors, setErrors] = useState<string[]>([]);

  function submit() {
    const action = appointment
      ? ({
          type: "reschedule",
          appointmentId: appointment.id,
          start,
          durationMin: Number(durationMin),
          purpose,
        } as const)
      : ({ type: "schedule", treatmentId, start, durationMin: Number(durationMin), purpose } as const);
    const res = run(action);
    if (res.ok) onClose();
    else setErrors(res.errors);
  }

  return (
    <Modal
      title={appointment ? "复诊改期" : "安排复诊"}
      subtitle="系统会检查同一医生与同一患者的时间冲突"
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="复诊时间" required>
          <input
            type="datetime-local"
            className="ctrl"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="时长（分钟）" required hint="10–480">
          <input
            type="number"
            min={10}
            max={480}
            step={5}
            className="ctrl"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          />
        </Field>
        <Field label="复诊目的" required>
          <input
            className="ctrl"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="如 复诊换药 / 根管预备"
          />
        </Field>
      </div>
      <ErrorBox errors={errors} />
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary-action" onClick={submit}>
          {appointment ? "保存改期" : "确认排期"}
        </button>
      </div>
    </Modal>
  );
}
