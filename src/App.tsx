import { useMemo, useState } from "react";
import {
  DEFAULT_FILTERS,
  ROLE_LABEL,
  STAGES,
  STAGE_LABEL,
  USERS,
  buildCSV,
  computeMetrics,
  courseViews,
  filterCourses,
  isEmpty,
} from "./domain";
import type { Filters, Metrics } from "./domain";
import { StoreProvider, useStore } from "./store";
import { StageBadge } from "./components/ui";
import { NewCourseModal } from "./components/NewCourseModal";
import { CourseDetailModal } from "./components/CourseDetailModal";
import { ScheduleModal } from "./components/ScheduleModal";
import { Calendar } from "./components/Calendar";

const METRIC_DEFS: { key: keyof Metrics; label: string; sub: string; danger?: boolean }[] = [
  { key: "waiting", label: "待复诊", sub: "已安排未赴约" },
  { key: "overdue", label: "逾复诊期", sub: "已过预约时间", danger: true },
  { key: "active", label: "进行中疗程", sub: "未充填完成" },
  { key: "medicated", label: "封药病例", sub: "当前封药阶段" },
  { key: "filled", label: "已充填完成", sub: "全周期结束" },
  { key: "avgWorkingLength", label: "平均工作长度", sub: "按疗程根管均值" },
];

function RoleSwitch() {
  const { user, setUser } = useStore();
  return (
    <label className="role-switch">
      <span>当前身份</span>
      <select className="ctrl" value={user.id} onChange={(e) => setUser(e.target.value)}>
        {USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {ROLE_LABEL[u.role]}（{u.title}）
          </option>
        ))}
      </select>
    </label>
  );
}

function Metrics() {
  const { db } = useStore();
  const m = useMemo(() => computeMetrics(db), [db]);
  return (
    <section className="metrics-grid">
      {METRIC_DEFS.map((d) => (
        <article key={d.key} className={`metric-card${d.danger && m[d.key] ? " is-danger" : ""}`}>
          <span>{d.label}</span>
          <strong>{m[d.key]}</strong>
          <small>{d.sub}</small>
          <i className={d.danger && m[d.key] ? "status-danger" : "status-ok"} />
        </article>
      ))}
    </section>
  );
}

function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { db } = useStore();
  const counts = useMemo(() => {
    const views = courseViews(db);
    const c: Record<string, number> = { all: views.length };
    for (const s of STAGES) c[s.id] = views.filter((v) => v.treatment.stage === s.id).length;
    return c;
  }, [db]);

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="filter-title">阶段</span>
        <div className="chips">
          <button
            className={filters.stage === "all" ? "chip active" : "chip"}
            onClick={() => setFilters({ ...filters, stage: "all" })}
          >
            全部 {counts.all}
          </button>
          {STAGES.map((s) => (
            <button
              key={s.id}
              className={filters.stage === s.id ? "chip active" : "chip"}
              onClick={() => setFilters({ ...filters, stage: s.id })}
            >
              {s.label} {counts[s.id] ?? 0}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-row">
        <label className="search-box">
          <span>搜索</span>
          <input
            className="ctrl"
            placeholder="患者 / 牙位 / 诊断 / 医生"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
        </label>
        <label className="select-box">
          <span>医生</span>
          <select
            className="ctrl"
            value={filters.doctorId}
            onChange={(e) => setFilters({ ...filters, doctorId: e.target.value })}
          >
            <option value="all">全部医生</option>
            {USERS.filter((u) => u.role === "doctor").map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check-box">
          <input
            type="checkbox"
            checked={filters.overdueOnly}
            onChange={(e) => setFilters({ ...filters, overdueOnly: e.target.checked })}
          />
          <span>仅看逾期</span>
        </label>
        <button className="ghost-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
          重置筛选
        </button>
      </div>
    </div>
  );
}

function CourseList({ views, onOpen }: { views: ReturnType<typeof courseViews>; onOpen: (id: string) => void }) {
  const now = Date.now();
  if (!views.length) {
    return (
      <div className="empty-inline">
        <strong>当前筛选下没有疗程</strong>
        <p>可调整筛选条件，或由医生身份新建疗程。</p>
      </div>
    );
  }
  return (
    <div className="record-list">
      {views.map((v) => {
        const overdue = v.next && new Date(v.next.start).getTime() < now;
        return (
          <button key={v.treatment.id} className="record-card" onClick={() => onOpen(v.treatment.id)}>
            <div className={`record-index stage-tint-${v.treatment.stage}`}>#{v.treatment.tooth}</div>
            <div className="record-main">
              <div className="record-top">
                <h3>
                  {v.patient.name}
                  <small>{v.patient.phone || "无联系方式"}</small>
                </h3>
                <StageBadge stage={v.treatment.stage} />
              </div>
              <p className="record-dx">{v.treatment.diagnosis}</p>
              <div className="record-meta">
                <span>👨‍⚕️ {v.doctor.name}</span>
                {v.treatment.workingLength ? <span>📏 {v.treatment.workingLength}</span> : null}
                {v.treatment.masterFile ? <span>🪛 主尖锉 {v.treatment.masterFile}</span> : null}
                {v.treatment.medication ? <span>💊 {v.treatment.medication}</span> : null}
              </div>
            </div>
            <div className={`record-next${overdue ? " overdue" : ""}`}>
              {v.next ? (
                <>
                  <strong>{v.next.start.replace("T", " ").slice(5, 16)}</strong>
                  <small>{v.next.purpose}</small>
                  {overdue ? <em>已逾期</em> : <small className="weekday">周{"日一二三四五六"[new Date(v.next.start).getDay()]}</small>}
                </>
              ) : v.treatment.stage === "done" ? (
                <span className="done-tag">已完成</span>
              ) : (
                <span className="no-appt">未排复诊</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AuditPanel() {
  const { db } = useStore();
  const logs = useMemo(() => [...db.logs].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30), [db]);
  return (
    <section className="panel audit-panel">
      <div className="section-heading">
        <div>
          <p>可追溯</p>
          <h2>操作记录</h2>
        </div>
        <span className="muted-text">最近 30 条，随所有操作实时同步</span>
      </div>
      {!logs.length ? (
        <p className="muted-text">暂无操作记录。</p>
      ) : (
        <ul className="audit-list">
          {logs.map((l) => (
            <li key={l.id}>
              <time>{new Date(l.at).toLocaleString("zh-CN", { hour12: false })}</time>
              <span className={`role-tag role-${l.role}`}>{ROLE_LABEL[l.role]}</span>
              <span className="log-who">{l.actorName}</span>
              <span className="log-act">{l.action}</span>
              <p>{l.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type PickerState = { start: string } | null;

function QuickSchedulePicker({ start, onClose }: { start: string; onClose: () => void }) {
  const { db, user } = useStore();
  const [treatmentId, setTreatmentId] = useState<string | null>(null);
  const active = courseViews(db).filter((v) => v.treatment.stage !== "done");

  if (treatmentId) {
    const course = active.find((v) => v.treatment.id === treatmentId);
    return (
      <ScheduleModal
        treatmentId={treatmentId}
        appointment={course?.next ?? undefined}
        initialStart={start}
        onClose={onClose}
      />
    );
  }

  const canPick = (doctorId: string) =>
    user.role === "frontdesk" || (user.role === "doctor" && doctorId === user.id);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>选择要排期的疗程</h2>
            <p>{start.replace("T", " ")} 复诊 · 仅显示未完成疗程</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="modal-body">
          {!active.length ? (
            <p className="muted-text">没有可排期的进行中疗程。</p>
          ) : (
            <ul className="pick-list">
              {active.map((v) => {
                const disabled = !canPick(v.treatment.doctorId);
                return (
                  <li key={v.treatment.id}>
                    <button
                      className="pick-item"
                      disabled={disabled}
                      onClick={() => setTreatmentId(v.treatment.id)}
                    >
                      <strong>
                        #{v.treatment.tooth} · {v.patient.name}
                      </strong>
                      <span>
                        {STAGE_LABEL[v.treatment.stage]} · {v.doctor.name} · {v.treatment.diagnosis}
                      </span>
                      {disabled ? (
                        <small>
                          {user.role === "doctor" ? "非你负责的疗程" : "助理不能排期"}
                        </small>
                      ) : v.next ? (
                        <small>已有待赴约复诊，将改期</small>
                      ) : (
                        <small>点击安排复诊</small>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const { db, user, dispatch } = useStore();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);

  const views = useMemo(() => filterCourses(db, filters), [db, filters]);
  const empty = isEmpty(db);
  const isDoctor = user.role === "doctor";

  function exportCsv() {
    const csv = buildCSV(db, views);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `根管疗程_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({
      type: "exportData",
      scope: `阶段=${filters.stage === "all" ? "全部" : STAGE_LABEL[filters.stage as keyof typeof STAGE_LABEL] ?? filters.stage}，医生=${filters.doctorId === "all" ? "全部" : USERS.find((u) => u.id === filters.doctorId)?.name ?? filters.doctorId}`,
      count: views.length,
    });
  }

  function restoreSamples() {
    if (window.confirm("将用示例数据替换当前全部本地数据，确定继续？")) {
      dispatch({ type: "restoreSamples" });
    }
  }

  function clearAll() {
    if (window.confirm("将清空全部患者、疗程、复诊与材料记录（保留空库以便重新开始），确定？")) {
      dispatch({ type: "clearAll" });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">门诊治疗管理台 · 牙体牙髓</p>
          <h1>牙科根管治疗管理</h1>
          <p className="subtitle">
            按患者建立多牙位疗程，管理阶段、工作长度、主尖锉、封药与复诊排期。角色权限、冲突校验与操作记录全部在浏览器本地完成。
          </p>
        </div>
        <div className="stack-card">
          <RoleSwitch />
          <div className="perm-hint">
            <p><b>医生</b>：仅可修改自己负责疗程的诊断与临床数据、推进阶段、排期</p>
            <p><b>助理</b>：可登记材料，不能改诊断、不能排期</p>
            <p><b>前台</b>：只能排期、改期与修改联系方式</p>
          </div>
        </div>
      </section>

      <Metrics />

      {empty ? (
        <section className="panel empty-state">
          <h2>本地数据库为空</h2>
          <p>所有数据仅保存在本浏览器（localStorage），刷新不会丢失。</p>
          <div className="empty-actions">
            <button className="primary-action" onClick={restoreSamples}>恢复示例数据</button>
            <button onClick={() => setShowNew(true)} disabled={!isDoctor}>
              直接新建疗程
            </button>
            {!isDoctor ? <p className="perm-note">当前身份不是医生，请先切换到医生身份再建疗程。</p> : null}
          </div>
        </section>
      ) : (
        <>
          <section className="panel workspace-panel">
            <div className="section-heading">
              <div>
                <p>疗程管理</p>
                <h2>疗程列表（{views.length}/{db.treatments.length}）</h2>
              </div>
              <div className="heading-actions">
                <button onClick={exportCsv} disabled={!views.length}>
                  导出当前筛选 CSV
                </button>
                <button className="primary-action" disabled={!isDoctor} onClick={() => setShowNew(true)}>
                  新建疗程
                </button>
              </div>
            </div>
            {!isDoctor ? (
              <p className="perm-note">当前为{ROLE_LABEL[user.role]}身份：{user.role === "assistant" ? "可在疗程详情中登记材料" : "可排期与修改联系方式"}，新建疗程需医生身份。</p>
            ) : null}
            <FilterBar filters={filters} setFilters={setFilters} />
            <CourseList views={views} onOpen={setOpenId} />
          </section>

          <Calendar db={db} onOpen={setOpenId} onNew={(start) => setPicker({ start })} />

          <AuditPanel />

          <section className="danger-zone">
            <button className="ghost-btn" onClick={restoreSamples}>恢复示例数据（覆盖当前）</button>
            <button className="danger-btn" onClick={clearAll}>清空本地数据</button>
          </section>
        </>
      )}

      {showNew ? <NewCourseModal patients={db.patients} onClose={() => setShowNew(false)} /> : null}
      {openId ? (
        <CourseDetailModal key={openId} treatmentId={openId} onClose={() => setOpenId(null)} />
      ) : null}
      {picker ? <QuickSchedulePicker start={picker.start} onClose={() => setPicker(null)} /> : null}
    </main>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <strong>{t.title}</strong>
          {t.messages.length ? (
            <ul>
              {t.messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Workspace />
      <Toasts />
    </StoreProvider>
  );
}
