import { useMemo, useState } from "react";
import { STAGE_LABEL, USERS } from "../domain";
import type { Appointment, DB } from "../domain";
import { useStore } from "../store";

const WEEK_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameDay(a: string, day: string): boolean {
  return a.startsWith(day);
}

export function Calendar({
  db,
  onOpen,
  onNew,
}: {
  db: DB;
  onOpen: (treatmentId: string) => void;
  onNew: (start: string) => void;
}) {
  const { user } = useStore();
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const patientOf = (id: string) => db.patients.find((p) => p.id === id);
  const treatmentOf = (id: string) => db.treatments.find((t) => t.id === id);

  // 月历格子（周一起始）
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const scheduled = db.appointments.filter((a) => a.status === "scheduled");
  const todayStr = ymd(today);
  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;

  const canSchedule = user.role !== "assistant";

  function dayAppts(day: string): Appointment[] {
    return scheduled
      .filter((a) => sameDay(a.start, day))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }

  return (
    <section className="panel calendar-panel">
      <div className="section-heading">
        <div>
          <p>复诊排期</p>
          <h2>月历</h2>
        </div>
        <div className="cal-nav">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="上个月"
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="下个月"
          >
            ›
          </button>
          <button className="ghost-btn" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            回到今天
          </button>
        </div>
      </div>

      <div className="calendar-grid">
        {WEEK_HEADS.map((w) => (
          <div className="cal-head" key={w}>
            周{w}
          </div>
        ))}
        {cells.map((d) => {
          const day = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = day === todayStr;
          const list = dayAppts(day);
          const isPast = day < todayStr;
          return (
            <div
              key={day}
              className={`cal-cell${inMonth ? "" : " dim"}${isToday ? " today" : ""}${list.length ? " has" : ""}`}
              onDoubleClick={() => canSchedule && !isPast && onNew(`${day}T09:30`)}
              title={canSchedule && !isPast ? "双击空白日可新建复诊" : undefined}
            >
              <div className="cal-date">
                <span className={isToday ? "today-num" : ""}>{d.getDate()}</span>
                {list.length ? <em>{list.length}</em> : null}
              </div>
              <div className="cal-events">
                {list.slice(0, 3).map((a) => {
                  const p = patientOf(a.patientId);
                  const t = treatmentOf(a.treatmentId);
                  const overdue = isPast || (day === todayStr && a.start.slice(11, 16) < `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`);
                  const mine = a.doctorId === user.id;
                  return (
                    <button
                      key={a.id}
                      className={`cal-event${overdue ? " ev-overdue" : ""}${mine ? " mine" : ""}`}
                      onClick={() => onOpen(a.treatmentId)}
                      title={`${a.start.slice(11, 16)} ${p?.name ?? ""} #${t?.tooth ?? ""} · ${a.purpose}`}
                    >
                      <time>{a.start.slice(11, 16)}</time>
                      <span>
                        {p?.name ?? "?"} #{t?.tooth ?? "?"}
                      </span>
                      <small>{STAGE_LABEL[t?.stage ?? "access"]}</small>
                    </button>
                  );
                })}
                {list.length > 3 ? <small className="cal-more">还有 {list.length - 3} 条…</small> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted-text calendar-hint">
        双击空白日期可先选择疗程再排期；点击事件打开疗程详情。当前登录：{user.name}（
        {USERS.find((u) => u.id === user.id)?.title}）。
      </p>
    </section>
  );
}
