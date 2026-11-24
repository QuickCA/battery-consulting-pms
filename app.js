/* ============================================================
   电芯技术咨询 · 现场问题闭环管理系统
   Application logic — single source of truth, local persistence
   ============================================================ */

const STORE_KEY = 'batteryPms.v2';
// Drop the legacy seeded dataset so no pre-filled demo content survives an upgrade.
try { localStorage.removeItem('batteryPms.v1'); } catch (e) {}

function weekRange(base) {
  const dt = parseD(base) || new Date();
  const offset = (dt.getDay() + 6) % 7;
  const mon = new Date(dt); mon.setDate(dt.getDate() - offset);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  return [f(mon), f(sun)];
}

function seedDB() {
  return {
    issues: JSON.parse(JSON.stringify(SEED_ISSUES)),
    actions: JSON.parse(JSON.stringify(SEED_ACTIONS)),
    decisions: JSON.parse(JSON.stringify(SEED_DECISIONS)),
    reports: JSON.parse(JSON.stringify(SEED_REPORTS)),
    kpis: JSON.parse(JSON.stringify(KPI_DEFS)),
    meta: { project: '欧洲电芯厂良率与产出提升技术咨询', period: weekRange(TODAY).join(' ~ '), updated: TODAY }
  };
}

/* Map legacy workstream values to the current 7-value taxonomy. */
const WS_LEGACY_MAP = {
  'Stacking': 'Stacking Equipment',
  'Assembly Process': 'Cell Assembly Process',
  'Welding & Assembly Equipment': 'Cell Assembly Equipment',
  'Project Management': 'Other'
};
function normalizeWorkstream(v) {
  if (v == null || v === '') return v;
  return WS_LEGACY_MAP[v] || v;
}
function migrateWorkstreams(db) {
  ['issues', 'actions', 'decisions', 'reports'].forEach(k => {
    (db[k] || []).forEach(row => {
      row.workstream = normalizeWorkstream(row.workstream);
      if (row._en) row._en.workstream = normalizeWorkstream(row._en.workstream);
    });
  });
  return db;
}
/* Refresh canonical KPI metadata by id while preserving user-entered figures.
   Older local storage still holds the English-only KPI source. */
function migrateKpis(db) {
  if (!Array.isArray(db.kpis)) { db.kpis = JSON.parse(JSON.stringify(KPI_DEFS)); return db; }
  const keys = ['cat', 'name', 'enName', 'def', 'enDef', 'unit', 'enUnit', 'owner', 'enOwner'];
  db.kpis.forEach(k => {
    const def = KPI_DEFS.find(x => String(x.id) === String(k.id));
    if (def) keys.forEach(key => { k[key] = def[key]; });
    ['baseline', 'target', 'actual'].forEach(key => {
      if (k[key] == null) k[key] = '';
    });
  });
  return db;
}
function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.issues && parsed.actions) return migrateKpis(migrateWorkstreams(parsed));
    }
  } catch (e) { /* fall through to seed */ }
  return seedDB();
}

let DB = loadDB();
function saveDB() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
  catch (e) { toast('本地存储不可用，本次修改仅在当前页面有效'); }
}

/* ---------------- helpers ---------------- */
const $ = (sel) => document.querySelector(sel);
const esc = (v) => v == null ? '' : String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');
const byId = (arr, id) => arr.find(x => Object.values(x).some(v => v === id));

/* Display helper: in EN mode prefer the pre-generated professional English
   snapshot stored on intake-created records (_en). Falls back to the Chinese
   source field, which the i18n layer then translates as before. */
function isEn() {
  try { return !!(window.I18N && window.I18N.lang === 'en'); } catch (e) { return false; }
}
function disp(item, key) {
  if (item && isEn() && item._en && item._en[key] != null && item._en[key] !== '') return item._en[key];
  return item ? item[key] : '';
}
/* Enum values are stored in English as stable data keys. Display helpers map
   them to Chinese in zh mode; en mode keeps the canonical English value. */
function wsLabel(v) {
  if (!v) return v;
  return (!isEn() && WORKSTREAM_CN[v]) ? WORKSTREAM_CN[v] : v;
}
const STATUS_CN = {
  'Open': '开放', 'Analysis': '分析中', 'Solution Proposed': '方案已提出',
  'Client Approval': '客户审批中', 'Implementation': '实施中',
  'Verification': '验证中', 'Closed': '已关闭', 'On Hold': '暂停',
  'Not Started': '未开始', 'In Progress': '进行中', 'Blocked': '被阻塞',
  'Pending Verification': '待验证', 'Draft': '草稿',
  'Under Technical Review': '技术评审中', 'Recommended': '已推荐',
  'Pending Client Approval': '待客户批准', 'Approved': '已批准',
  'Rejected': '已否决', 'Deferred': '已延期'
};
function statusLabel(v) {
  if (!v) return v;
  return (!isEn() && STATUS_CN[v]) ? STATUS_CN[v] : v;
}

/* Render the four-section technical problem statement into visually separated
   blocks. Sections are detected by their leading labels (Chinese or English);
   numbered lines are kept on their own line. Falls back to plain nl2br for
   free-form text that has no section labels. */
const PS_LABELS = [
  { re: /^【已确认事实】|^\[Confirmed facts\]/, cls: 'fact', zh: '已确认事实', en: 'Confirmed Facts' },
  { re: /^【影响链分析[｜|]推断】|^\[Impact chain[^\]]*\]/, cls: 'chain', zh: '影响链分析｜推断', en: 'Impact Chain · INFERENCE' },
  { re: /^【待验证假设[｜|]非结论】|^\[Hypotheses to verify[^\]]*\]/, cls: 'hypo', zh: '待验证假设｜非结论', en: 'Hypotheses to Verify · NOT Conclusions' },
  { re: /^【当前处置与信息缺口】|^\[Current disposition[^\]]*\]/, cls: 'gap', zh: '当前处置与信息缺口', en: 'Current Disposition & Data Gaps' }
];
function problemStatementHTML(v) {
  const text = String(v == null ? '' : v);
  if (!text.trim()) return '—';
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const hasLabels = lines.some(l => PS_LABELS.some(p => p.re.test(l)));
  if (!hasLabels) return nl2br(text);
  const sections = [];
  let cur = null;
  lines.forEach(line => {
    const hit = PS_LABELS.find(p => p.re.test(line));
    if (hit) {
      cur = { meta: hit, body: line.replace(hit.re, '').trim() };
      sections.push(cur);
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line;
    } else {
      cur = { meta: null, body: line };
      sections.push(cur);
    }
  });
  return '<div class="ps-blocks">' + sections.map(s => {
    const meta = s.meta;
    const label = meta ? (isEn() ? meta.en : meta.zh) : '';
    const body = String(s.body || '').split(/\n+/).map(x => x.trim()).filter(Boolean)
      .map(x => `<div class="ps-line">${esc(x)}</div>`).join('');
    return `<div class="ps-sec ${meta ? meta.cls : 'plain'}">${meta ? `<div class="ps-sec-t">${esc(label)}</div>` : ''}<div class="ps-sec-b">${body}</div></div>`;
  }).join('') + '</div>';
}

/* Personnel fields accept names beyond the preset roster. Selecting the
   custom option reveals a free-text input; the typed name becomes the value. */
const CUSTOM_OWNER = '__CUSTOM_PERSON__';
function isOwnerKey(k) { return /Owner$|Lead$|Approver$|Reviewer$/.test(String(k || '')); }
function ownerLabels() {
  const en = (() => { try { return !!(window.I18N && window.I18N.lang === 'en'); } catch (e) { return false; } })();
  return {
    option: en ? '✎ Enter name manually…' : '✎ 手动输入具体人员…',
    placeholder: en ? 'Enter the specific person name' : '输入具体人员姓名'
  };
}

function parseD(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function diffDays(a, b) {
  const da = typeof a === 'string' ? parseD(a) : a;
  const db = typeof b === 'string' ? parseD(b) : b;
  if (!da || !db) return 0;
  return Math.round((da - db) / 86400000);
}
function overdue(action) {
  if (!action.dueDate || action.status === 'Closed') return 0;
  return Math.max(0, diffDays(TODAY, action.dueDate));
}
function dueClass(date, status) {
  if (!date || status === 'Closed') return '';
  const n = diffDays(TODAY, date);
  if (n > 0) return 'due-over';
  if (n >= -2) return 'due-soon';
  return '';
}
function nextId(arr, prefix, key) {
  const max = arr.reduce((m, x) => {
    const v = String(x[key] || '').match(/(\d+)$/);
    return v ? Math.max(m, +v[1]) : m;
  }, 0);
  return prefix + String(max + 1).padStart(3, '0');
}
function pillStatus(s) {
  const map = {
    'Open': 's-open', 'Analysis': 's-diag', 'Solution Proposed': 's-solution',
    'Client Approval': 's-client', 'Implementation': 's-solution',
    'Verification': 's-verify', 'Closed': 's-closed', 'On Hold': 's-overdue',
    'Not Started': 's-open', 'In Progress': 's-solution', 'Blocked': 's-overdue',
    'Pending Verification': 's-verify', 'Draft': 's-open',
    'Under Technical Review': 's-diag', 'Recommended': 's-solution',
    'Pending Client Approval': 's-client', 'Approved': 's-closed',
    'Rejected': 's-overdue', 'Deferred': 's-open'
  };
  return `<span class="pill ${map[s] || 's-open'}">${esc(statusLabel(s))}</span>`;
}
function pillPriority(p) {
  const cls = p === 'Critical' ? 'p1' : p === 'High' ? 'p2' : p === 'Medium' ? 'p3' : 's-open';
  return `<span class="pill ${cls}">${esc(p)}</span>`;
}
function pillEsc(e) {
  const cls = e === 'L3' ? 'p1' : e === 'L2' ? 'p2' : 'p3';
  return `<span class="pill ${cls}">${esc(e)}</span>`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function empty(text) {
  return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 7h18v13H3zM8 7V4h8v3"/></svg><div>${esc(text)}</div></div>`;
}
function isOverdueIssue(i) {
  if (i.status === 'Closed' || !i.targetDate) return false;
  return diffDays(TODAY, i.targetDate) > 0;
}
function opts(list, selected) {
  return list.map(x => `<option value="${esc(x)}"${x === selected ? ' selected' : ''}>${esc(x)}</option>`).join('');
}
function fieldHTML(f, val) {
  if (f.type === 'section') return `<div class="sec-title full"><span class="n">${esc(f.n || '·')}</span>${esc(f.label)}</div>`;
  const v = val == null ? (f.def || '') : val;
  const id = 'f_' + f.key;
  let ctrl;
  if (f.type === 'select') {
    if (isOwnerKey(f.key)) {
      const isCustom = v && !f.options.includes(v);
      const L = ownerLabels();
      const selVal = isCustom ? CUSTOM_OWNER : v;
      ctrl = `<div class="owner-field"><select id="${id}" data-owner-select="1">${opts(f.options, selVal)}<option value="${CUSTOM_OWNER}"${isCustom ? ' selected' : ''}>${esc(L.option)}</option></select>`
        + `<input type="text" id="${id}_custom" class="owner-custom" data-owner-custom="1" value="${esc(isCustom ? v : '')}" placeholder="${esc(L.placeholder)}" style="${isCustom ? '' : 'display:none'}"></div>`;
    } else {
      ctrl = `<select id="${id}">${opts(f.options, v)}</select>`;
    }
  } else if (f.type === 'textarea') {
    ctrl = `<textarea id="${id}" rows="${f.rows || 3}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  } else if (f.type === 'date') {
    ctrl = `<input type="date" id="${id}" value="${esc(v)}">`;
  } else if (f.type === 'number') {
    ctrl = `<input type="number" id="${id}" value="${esc(v)}" min="${f.min || 0}" max="${f.max || 100}">`;
  } else {
    ctrl = `<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" ${f.readonly ? 'readonly' : ''}>`;
  }
  return `<div class="fld${f.full ? ' full' : ''}"><label>${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>${ctrl}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

/* ---------------- modal form ---------------- */
let formSubmit = null;
function openForm(title, fields, values, onSubmit, submitLabel) {
  formSubmit = onSubmit;
  const body = fields.map(f => fieldHTML(f, values ? values[f.key] : undefined)).join('');
  $('#modal').innerHTML = `
    <div class="modal-head"><h3>${esc(title)}</h3><button class="close" data-close="1">×</button></div>
    <div class="modal-body"><div class="form-grid">${body}</div></div>
    <div class="modal-foot"><button class="btn" data-close="1">取消</button><button class="btn btn-primary" id="formSave">${esc(submitLabel || '保存')}</button></div>`;
  $('#overlay').classList.add('show');
  $('#modal').classList.add('show');
  // Owner fields: toggle the custom-name input when the custom option is picked.
  fields.filter(f => f.type === 'select' && isOwnerKey(f.key)).forEach(f => {
    const sel = $('#f_' + f.key);
    const custom = $('#f_' + f.key + '_custom');
    if (!sel || !custom) return;
    const sync = () => { custom.style.display = sel.value === CUSTOM_OWNER ? '' : 'none'; };
    sel.addEventListener('change', sync);
    sync();
  });
  $('#formSave').onclick = () => {
    const out = {};
    let missing = null;
    fields.forEach(f => {
      if (f.type === 'section') return;
      const el = $('#f_' + f.key);
      if (!el) return;
      let value = el.value.trim();
      if (value === CUSTOM_OWNER) {
        const custom = $('#f_' + f.key + '_custom');
        value = custom ? custom.value.trim() : '';
      }
      out[f.key] = value;
      if (f.req && !out[f.key] && !missing) missing = f.label;
    });
    if (missing) { toast('请填写：' + missing); return; }
    if (formSubmit(out) !== false) closeAll();
  };
}
function closeAll() {
  $('#overlay').classList.remove('show');
  $('#drawer').classList.remove('show');
  $('#modal').classList.remove('show');
}
function openDrawer(html) {
  $('#drawer').innerHTML = html;
  $('#overlay').classList.add('show');
  $('#drawer').classList.add('show');
}

/* ---------------- field definitions ---------------- */
const ISSUE_FIELDS = [
  { key: 'issueId', label: 'Issue ID', type: 'text', readonly: true, def: nextId(DB.issues, 'ISS-', 'issueId'), hint: '系统自动生成，对应工具包 Issue ID' },
  { key: 'dateRaised', label: 'Date Raised / 发现日期', type: 'date', req: true, def: TODAY },
  { key: 'workstream', label: 'Workstream / 专业组', type: 'select', options: WORKSTREAMS, req: true },
  { key: 'processEquipment', label: 'Process / Equipment / 工序设备', type: 'text', req: true, ph: '例：Coating / 涂布机 #2' },
  { key: 'problemStatement', label: 'Problem Statement / 问题陈述（事实化、量化）', type: 'textarea', full: true, req: true, ph: '描述现象、偏差量、发生频次，避免主观判断' },
  { key: 'evidenceData', label: 'Evidence / Data / 证据与数据', type: 'textarea', full: true, ph: '测点、照片编号、SPC 趋势、报告路径' },
  { key: 'impactArea', label: 'Impact Area / 影响域', type: 'select', options: IMPACT_AREAS, req: true },
  { key: 'priority', label: 'Priority / 优先级', type: 'select', options: PRIORITIES, req: true },
  { key: 'initialContainmentRiskNote', label: 'Initial Containment / Risk Note / 临时围堵与风险', type: 'textarea', full: true, ph: 'Must / shall we ask the client to contain the risk? 需客户执行' },
  { key: 'rootCauseStatus', label: 'Root Cause Status / 根因状态', type: 'select', options: ROOT_CAUSE_STATUS },
  { key: 'rootCauseAnalysis', label: 'Root Cause / Analysis / 根因分析', type: 'textarea', full: true, ph: '5Why / 鱼骨 / DOE 结论，需有证据支撑' },
  { key: 'proposedSolution', label: 'Proposed Solution / 建议方案', type: 'textarea', full: true, ph: '对策、责任、验证标准、风险提示' },
  { key: 'consultingOwner', label: 'Consulting Owner / 我方负责人', type: 'select', options: CONSULTING_OWNERS, req: true },
  { key: 'clientActionOwner', label: 'Client Action Owner / 客户执行人', type: 'select', options: CLIENT_OWNERS, req: true },
  { key: 'targetDate', label: 'Target Date / 目标日期', type: 'date', req: true },
  { key: 'status', label: 'Status / 状态', type: 'select', options: ISSUE_STATUSES, req: true },
  { key: 'escalationLevel', label: 'Escalation Level / 升级级别', type: 'select', options: ESCALATIONS },
  { key: 'lastUpdate', label: 'Last Update / 最后更新', type: 'date', def: TODAY },
  { key: 'closureEvidenceResult', label: 'Closure Evidence / Result / 关闭证据', type: 'textarea', full: true, ph: '前后对比数据 + 客户验证签署，无证据不得关闭' }
];

const ACTION_FIELDS = [
  { key: 'actionId', label: 'Action ID', type: 'text', readonly: true, def: nextId(DB.actions, 'ACT-', 'actionId') },
  { key: 'linkedIssueId', label: 'Linked Issue ID / 关联问题', type: 'select', options: DB.issues.map(i => i.issueId), req: true },
  { key: 'improvementAction', label: 'Improvement Action / 改进行动', type: 'textarea', full: true, req: true },
  { key: 'expectedOutcomeAcceptanceCriteria', label: 'Expected Outcome / Acceptance Criteria / 验收标准', type: 'textarea', full: true },
  { key: 'actionType', label: 'Action Type / 类型', type: 'select', options: ACTION_TYPES },
  { key: 'clientActionOwner', label: 'Client Action Owner / 客户执行人', type: 'select', options: CLIENT_OWNERS, req: true },
  { key: 'consultingSupportOwner', label: 'Consulting Support Owner / 我方支持', type: 'select', options: CONSULTING_OWNERS },
  { key: 'dateAssigned', label: 'Date Assigned / 分派日期', type: 'date', def: TODAY },
  { key: 'dueDate', label: 'Due Date / 到期日', type: 'date', req: true },
  { key: 'status', label: 'Status / 状态', type: 'select', options: ACTION_STATUSES, req: true },
  { key: 'percentComplete', label: '% Complete / 完成率', type: 'number', max: 100, def: 0 },
  { key: 'blockerDependency', label: 'Blocker / Dependency / 阻塞与依赖', type: 'text' },
  { key: 'escalationRequired', label: 'Escalation Required? / 需升级', type: 'select', options: ['No', 'Yes'] },
  { key: 'completionDate', label: 'Completion Date / 完成日期', type: 'date' },
  { key: 'verificationOwner', label: 'Verification Owner / 验证人', type: 'select', options: CLIENT_OWNERS.concat(['技术经理']) },
  { key: 'verificationResultEvidence', label: 'Verification Result / Evidence / 验证结果与证据', type: 'textarea', full: true }
];

const DECISION_FIELDS = [
  { key: 'decisionId', label: 'Decision ID', type: 'text', readonly: true, def: nextId(DB.decisions, 'DEC-', 'decisionId') },
  { key: 'dateRaised', label: 'Date Raised / 提出日期', type: 'date', def: TODAY },
  { key: 'linkedIssueId', label: 'Linked Issue ID / 关联问题', type: 'select', options: DB.issues.map(i => i.issueId) },
  { key: 'decisionTopic', label: 'Decision Topic / 决策主题', type: 'text', full: true, req: true },
  { key: 'backgroundEvidence', label: 'Background / Evidence / 背景证据', type: 'textarea', full: true },
  { key: 'optionsConsidered', label: 'Options Considered / 备选方案', type: 'textarea', full: true },
  { key: 'recommendedOption', label: 'Recommended Option / 推荐方案', type: 'text', req: true, ph: 'A / B / C 或文字描述' },
  { key: 'technicalRationaleRisks', label: 'Technical Rationale / Risks / 技术理由与风险', type: 'textarea', full: true },
  { key: 'technicalReviewer', label: 'Technical Reviewer / 技术审核', type: 'select', options: CONSULTING_OWNERS, def: '技术经理' },
  { key: 'clientApprover', label: 'Client Approver / 客户批准人', type: 'select', options: CLIENT_OWNERS },
  { key: 'approvalStatus', label: 'Approval Status / 审批状态', type: 'select', options: APPROVAL_STATUSES, req: true },
  { key: 'decisionDate', label: 'Decision Date / 决策日期', type: 'date' },
  { key: 'conditionsChangeControlRef', label: 'Change-Control Ref / 变更控制编号', type: 'text' },
  { key: 'implementationOwner', label: 'Implementation Owner / 执行责任人', type: 'select', options: CLIENT_OWNERS },
  { key: 'effectiveDate', label: 'Effective Date / 生效日期', type: 'date' },
  { key: 'outcomeFollowUp', label: 'Outcome / Follow-up / 结果与后续', type: 'textarea', full: true }
];

const REPORT_FIELDS = [
  { key: 'date', label: 'Date / 日期', type: 'date', req: true, def: TODAY },
  { key: 'workstream', label: 'Workstream / 专业组', type: 'select', options: WORKSTREAMS, req: true },
  { key: 'reportingLead', label: 'Reporting Lead / 报告人', type: 'select', options: CONSULTING_OWNERS, req: true },
  { key: 'shiftLine', label: 'Shift / Line / 班次产线', type: 'text', ph: 'Shift A / Line #2' },
  { key: 'productionContextKpi', label: 'Production Context / KPI / 生产背景', type: 'text', full: true },
  { key: 'activitiesObservations', label: 'Activities & Observations / 跟线观察（事实）', type: 'textarea', full: true, req: true },
  { key: 'newIssueIds', label: 'New Issue IDs / 新增问题', type: 'text', ph: 'ISS-014, ISS-015 或 —' },
  { key: 'actionsDecisionsRequired', label: 'Actions / Decisions Required / 需要的行动或决策', type: 'textarea', full: true },
  { key: 'clientContactOwner', label: 'Client Contact / Owner / 客户接口人', type: 'select', options: CLIENT_OWNERS },
  { key: 'nextDayPriorities', label: 'Next-day Priorities / 次日重点', type: 'textarea', full: true },
  { key: 'evidenceLink', label: 'Evidence Link / 证据路径', type: 'text', full: true }
];

/* ---------------- computed metrics ---------------- */
function metrics() {
  const issues = DB.issues, actions = DB.actions, decisions = DB.decisions;
  const open = issues.filter(i => i.status !== 'Closed');
  const ch = open.filter(i => i.priority === 'Critical' || i.priority === 'High');
  const overdueActions = actions.filter(a => overdue(a) > 0);
  const closed = issues.filter(i => i.status === 'Closed');
  const closureRate = issues.length ? Math.round(closed.length / issues.length * 100) : 0;
  const cycles = issues.filter(i => i.closureEvidenceResult && (i.status === 'Closed' || i.status === 'Verification'))
    .map(i => diffDays(i.lastUpdate, i.dateRaised)).filter(n => n > 0);
  const avgCycle = cycles.length ? (cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1) : '—';
  const fpy = DB.kpis.find(k => String(k.id) === '4' || k.enName === 'FPY' || k.name === 'FPY');
  const numeric = v => v !== '' && v != null && !isNaN(Number(v));
  const fpyGain = fpy && numeric(fpy.actual) && numeric(fpy.baseline)
    ? (Number(fpy.actual) - Number(fpy.baseline)).toFixed(1) : null;
  return { open, ch, overdueActions, closed, closureRate, avgCycle, fpyGain, fpy };
}

function exceptions() {
  const out = [];
  DB.issues.filter(i => i.status !== 'Closed' && (i.escalationLevel === 'L2' || i.escalationLevel === 'L3' || isOverdueIssue(i)))
    .forEach(i => out.push({ type: '问题', id: i.issueId, title: i.problemStatement, owner: i.consingOwner || i.consultingOwner, age: diffDays(TODAY, i.dateRaised), level: i.escalationLevel, status: i.status, ref: i.issueId }));
  DB.actions.filter(a => a.status !== 'Closed' && (a.escalationRequired === 'Yes' || overdue(a) > 0))
    .forEach(a => out.push({ type: '行动', id: a.actionId, title: a.improvementAction, owner: a.clientActionOwner, age: overdue(a) > 0 ? overdue(a) : 0, level: overdue(a) > 2 ? 'L2' : 'L1', status: a.status, ref: a.actionId }));
  DB.decisions.filter(d => ['Pending Client Approval', 'Under Technical Review'].includes(d.approvalStatus))
    .forEach(d => out.push({ type: '决策', id: d.decisionId, title: d.decisionTopic, owner: d.clientApprover, age: diffDays(TODAY, d.dateRaised), level: diffDays(TODAY, d.dateRaised) > 3 ? 'L2' : 'L1', status: d.approvalStatus, ref: d.decisionId }));
  return out.sort((a, b) => (a.level === b.level ? b.age - a.age : (a.level === 'L3' ? -1 : b.level === 'L3' ? 1 : a.level === 'L2' ? -1 : 1)));
}

/* ---------------- page: dashboard ---------------- */
function renderDashboard() {
  const m = metrics(), ex = exceptions();
  const byWS = WORKSTREAMS.map(w => ({ w, n: DB.issues.filter(i => i.workstream === w && i.status !== 'Closed').length })).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...byWS.map(x => x.n));
  const byStatus = ISSUE_STATUSES.filter(s => s !== 'On Hold').map(s => ({ s, n: DB.issues.filter(i => i.status === s).length }));
  const statusColors = { 'Open': '#94a3b8', 'Analysis': '#7c3aed', 'Solution Proposed': '#1557d6', 'Client Approval': '#e07b00', 'Implementation': '#3b82f6', 'Verification': '#0d9488', 'Closed': '#0f9d58' };
  const totStatus = Math.max(1, byStatus.reduce((a, b) => a + b.n, 0));
  const feed = [];
  DB.reports.slice(0, 4).forEach(r => feed.push({ date: r.date, txt: `<b>${esc(disp(r,'reportingLead'))}</b> 提交 ${esc(wsLabel(disp(r,'workstream')))} 跟线报告`, meta: esc(disp(r,'activitiesObservations').slice(0, 70)) + '…', c: 'green' }));
  DB.issues.slice().sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate)).slice(0, 4).forEach(i => feed.push({ date: i.lastUpdate, txt: `<b>${esc(disp(i,'issueId'))}</b> 状态更新为 ${esc(disp(i,'status'))}`, meta: esc(disp(i,'problemStatement').slice(0, 68)) + '…', c: i.priority === 'Critical' ? 'red' : '' }));
  feed.sort((a, b) => b.date.localeCompare(a.date));

  return `
  <div class="page-head"><div><h1>总览驾驶舱</h1><p>项目：${esc(DB.meta.project)} · 报告周期 ${esc(DB.meta.period)} · 数据截至 ${esc(TODAY)}</p></div>
    <div class="actions"><button class="btn" data-go="intake">智能录入</button><button class="btn" data-go="weekly">生成周报</button></div></div>

  <div class="grid grid-kpi" style="margin-bottom:18px">
    <div class="card kpi"><div class="kpi-label">${isEn() ? 'Open Issues' : '开放问题'}</div><div class="kpi-value">${m.open.length}<small> / ${DB.issues.length}</small></div><div class="kpi-foot">${isEn() ? 'Critical / High' : '关键 / 高优先级'} <b style="color:var(--danger)">${m.ch.length}</b> ${isEn() ? '' : '项'}</div></div>
    <div class="card kpi danger"><div class="kpi-label">${isEn() ? 'Overdue Client Actions' : '超期客户行动'}</div><div class="kpi-value">${m.overdueActions.length}</div><div class="kpi-foot">${isEn() ? 'Escalate to technical manager' : '需技术经理介入升级'}</div></div>
    <div class="card kpi teal"><div class="kpi-label">${isEn() ? 'Closure Rate' : '关闭率'}</div><div class="kpi-value">${m.closureRate}<small>%</small></div><div class="kpi-foot">${isEn() ? 'Verified closures only' : '仅计有验证证据的关闭'}</div></div>
    <div class="card kpi purple"><div class="kpi-label">${isEn() ? 'Average Closure Cycle' : '平均闭环周期'}</div><div class="kpi-value">${m.avgCycle}<small> ${isEn() ? 'days' : '天'}</small></div><div class="kpi-foot">${isEn() ? 'Raised → verification sign-off' : '发现 → 验证签署'}</div></div>
    <div class="card kpi warn"><div class="kpi-label">${isEn() ? 'FPY Gain' : 'FPY 改善'}</div><div class="kpi-value">${m.fpyGain === null ? '—' : (m.fpyGain >= 0 ? '+' : '') + m.fpyGain}<small> pp</small></div><div class="kpi-foot">${m.fpy && m.fpy.baseline !== '' ? (isEn() ? 'Baseline ' : '基线 ') + esc(m.fpy.baseline) + '% ' + (isEn() ? '→ Current ' : '→ 当前 ') + esc(m.fpy.actual || '—') + '%' : (isEn() ? 'Awaiting baseline / current value' : '待客户提供基线 / 当前值')}</div></div>
  </div>

  <div class="grid grid-32" style="margin-bottom:18px">
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">开放问题 · 专业组分布</h3><div class="card-sub">现场资源投向哪里</div></div><div class="right"><button class="btn btn-sm" data-go="issues">查看台账</button></div></div>
      <div class="card-body">${byWS.map(x => `<div class="bar-row"><div class="bar-label" title="${esc(wsLabel(x.w))}">${esc(wsLabel(x.w))}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(x.n / max * 100)}%"></div></div><div class="bar-val">${x.n}</div></div>`).join('')}</div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">状态漏斗</h3><div class="card-sub">7 阶段在制分布</div></div></div>
      <div class="card-body">
        <div class="funnel">${byStatus.map(s => `<div style="flex:${Math.max(.3, s.n / totStatus)};background:${statusColors[s.s]}" title="${esc(statusLabel(s.s))}: ${s.n}">${s.n}</div>`).join('')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${byStatus.map(s => `<div class="small"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${statusColors[s.s]};margin-right:4px"></span>${esc(statusLabel(s.s))} ${s.n}</div>`).join('')}</div>
        <div class="callout" style="margin-top:14px">装配工序占开放问题 <b>${DB.issues.filter(i => (i.workstream === 'Cell Assembly Process' || i.workstream === 'Cell Assembly Equipment') && i.status !== 'Closed').length}</b> 项，是当前资源投入重点。</div>
      </div>
    </div>
  </div>

  <div class="grid grid-32" style="margin-bottom:18px">
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">技术经理例外队列</h3><div class="card-sub">按升级级别与滞留天数排序 · ${ex.length} 项</div></div><div class="right"><span class="tag warn">L2/L3 + 超期</span></div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>类型</th><th>事项</th><th>责任人</th><th>滞留</th><th>级别</th><th></th></tr></thead><tbody>
      ${ex.slice(0, 8).map(e => `<tr><td><span class="tag ${e.type === '问题' ? 'blue' : e.type === '行动' ? 'teal' : 'purple'}">${esc(e.type)}</span></td><td><div class="titlecell" style="max-width:300px">${esc(e.title.slice(0, 52))}${e.title.length > 52 ? '…' : ''}</div><div class="sub mono">${esc(e.id)}</div></td><td class="small">${esc(e.owner || '—')}</td><td class="${e.age > 2 ? 'due-over' : ''}">${e.age} 天</td><td>${pillEsc(e.level)}</td><td><button class="btn btn-xs" data-open="${esc(e.ref)}">处理</button></td></tr>`).join('') || `<tr><td colspan="6">${empty('暂无例外事项')}</td></tr>`}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">现场动态</h3><div class="card-sub">日报与状态更新</div></div><div class="right"><button class="btn btn-sm" data-go="reports">全部日报</button></div></div>
      <div class="card-body"><div class="feed">${feed.slice(0, 7).map(f => `<div class="feed-item"><div class="feed-dot ${f.c}"></div><div class="feed-main"><div class="feed-txt">${f.txt}</div><div class="feed-meta">${esc(f.date)} · ${f.meta}</div></div></div>`).join('')}</div></div>
    </div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">本周到期客户行动</h3><div class="card-sub">执行责任在客户，我方跟踪与验证</div></div><div class="right"><button class="btn btn-sm" data-go="actions">行动跟踪</button></div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>行动</th><th>客户责任人</th><th>到期</th><th>状态</th><th>超期</th></tr></thead><tbody>
      ${DB.actions.filter(a => a.status !== 'Closed').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6).map(a => `<tr><td><div class="titlecell" style="max-width:250px">${esc(disp(a,'improvementAction').slice(0, 46))}…</div><div class="sub mono">${esc(disp(a,'actionId'))} → ${esc(disp(a,'linkedIssueId'))}</div></td><td class="small">${esc(disp(a,'clientActionOwner'))}</td><td class="${dueClass(a.dueDate, a.status)}">${esc(disp(a,'dueDate'))}</td><td>${pillStatus(a.status)}</td><td class="${overdue(a) ? 'due-over' : ''}">${overdue(a) ? overdue(a) + 'd' : '—'}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">${isEn() ? 'Key KPI Snapshot' : '关键 KPI 快照'}</h3><div class="card-sub">${isEn() ? 'Baseline / Target / Actual — provided by the client' : '基线 / 目标 / 实际值 — 数据由客户提供'}</div></div><div class="right"><button class="btn btn-sm" data-go="kpi">${isEn() ? 'All KPIs' : '全部 KPI'}</button></div></div>
      <div class="card-body">${DB.kpis.filter(k => [1, 2, 4, 5, 6].includes(k.id)).map(k => {
        const num = v => v !== '' && v != null && !isNaN(Number(v));
        const has = num(k.baseline) && num(k.target) && num(k.actual);
        const p = has && +k.target !== +k.baseline ? Math.min(100, Math.max(0, Math.round((+k.actual - +k.baseline) / (+k.target - +k.baseline) * 100))) : 0;
        const unit = isEn() ? k.enUnit : k.unit;
        return `<div style="margin-bottom:13px"><div style="display:flex;font-size:12px;margin-bottom:5px"><b>${esc(isEn() ? k.enName : k.name)}</b><span style="margin-left:auto" class="mono">${has ? esc(k.actual) + esc(unit === '%' ? '%' : '') + ' <span class="small">/ ' + (isEn() ? 'Target' : '目标') + ' ' + esc(k.target) + '</span>' : '<span class="small">' + (isEn() ? 'Pending' : '待录入') + '</span>'}</span></div><div class="progress"><div style="width:${p}%;background:${p >= 100 ? 'var(--success)' : 'var(--primary)'}"></div></div></div>`;
      }).join('')}</div>
    </div>
  </div>`;
}

/* ---------------- page: issues ---------------- */
let issueFilter = { q: '', ws: '', status: '', prio: '' };
function renderIssues() {
  const list = DB.issues.filter(i => {
    if (issueFilter.ws && i.workstream !== issueFilter.ws) return false;
    if (issueFilter.status && i.status !== issueFilter.status) return false;
    if (issueFilter.prio && i.priority !== issueFilter.prio) return false;
    if (issueFilter.q) {
      const q = issueFilter.q.toLowerCase();
      return [i.issueId, i.problemStatement, i.processEquipment, i.rootCauseAnalysis, i.proposedSolution, i.consultingOwner].join(' ').toLowerCase().includes(q);
    }
    return true;
  });
  return `
  <div class="page-head"><div><h1>技术问题台账</h1><p>Technical Issue Log · 一个问题一行，从发现到关闭全程留痕（工具包 03_Issue Log）</p></div>
    <div class="actions"><button class="btn" id="btnNewAction">+ 改进行动</button><button class="btn btn-primary" id="btnNewIssue2">+ 新建问题</button></div></div>
  <div class="filterbar">
    <input id="fq" placeholder="搜索问题陈述 / 工序 / 负责人" value="${esc(issueFilter.q)}" style="width:250px">
    <select id="fws"><option value="">全部专业组</option>${opts(WORKSTREAMS, issueFilter.ws)}</select>
    <select id="fst"><option value="">全部状态</option>${opts(ISSUE_STATUSES, issueFilter.status)}</select>
    <select id="fpr"><option value="">全部优先级</option>${opts(PRIORITIES, issueFilter.prio)}</select>
    <div class="spacer"></div><div class="count">显示 ${list.length} / ${DB.issues.length} 项</div>
  </div>
  <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>
    <th>Issue ID</th><th>问题陈述 / 工序</th><th>影响</th><th>优先级</th><th>状态</th><th>我方负责人</th><th>客户执行人</th><th>目标日</th><th>升级</th><th></th>
  </tr></thead><tbody>
  ${list.map(i => `<tr data-issue="${esc(disp(i,'issueId'))}" style="cursor:pointer">
    <td class="idcell">${esc(disp(i,'issueId'))}</td>
    <td><div class="titlecell">${esc(disp(i,'problemStatement').slice(0, 58))}${i.problemStatement.length > 58 ? '…' : ''}</div><div class="sub">${esc(disp(i,'processEquipment'))}</div></td>
    <td class="small">${esc(disp(i,'impactArea'))}</td>
    <td>${pillPriority(i.priority)}</td>
    <td>${pillStatus(i.status)}</td>
    <td class="small">${esc(disp(i,'consultingOwner'))}</td>
    <td class="small">${esc(disp(i,'clientActionOwner'))}</td>
    <td class="${dueClass(i.targetDate, i.status)} small">${esc(disp(i,'targetDate'))}${isOverdueIssue(i) ? ' ⚠' : ''}</td>
    <td>${pillEsc(i.escalationLevel)}</td>
    <td><button class="btn btn-xs" data-open="${esc(disp(i,'issueId'))}">详情</button></td>
  </tr>`).join('') || `<tr><td colspan="10">${empty('没有符合条件的问题')}</td></tr>`}
  </tbody></table></div></div>`;
}

function openIssue(id) {
  const i = DB.issues.find(x => x.issueId === id);
  if (!i) { toast('未找到该问题'); return; }
  const acts = DB.actions.filter(a => a.linkedIssueId === id);
  const decs = DB.decisions.filter(x => x.linkedIssueId === id);
  const idx = ISSUE_STATUSES.indexOf(i.status);
  const next = ISSUE_STATUSES[idx + 1] && ISSUE_STATUSES[idx + 1] !== 'On Hold' ? ISSUE_STATUSES[idx + 1] : null;
  const kv = (k, v) => `<dt>${esc(k)}</dt><dd>${v || '—'}</dd>`;
  openDrawer(`
    <div class="drawer-head"><div><div class="small mono" style="margin-bottom:4px">${esc(disp(i,'issueId'))} · TECHNICAL ISSUE LOG</div><h2>${esc(disp(i,'processEquipment') || disp(i,'issueId'))}</h2>
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">${pillPriority(i.priority)}${pillStatus(i.status)}${pillEsc(i.escalationLevel)}<span class="tag">${esc(wsLabel(disp(i,'workstream')))}</span></div></div>
      <button class="close" data-close="1">×</button></div>
    <div class="drawer-body">
      <div class="sec-title"><span class="n">1</span>问题事实与证据</div>
      <dl class="detail-grid">
        ${kv('发现日期', esc(disp(i,'dateRaised')))}${kv('工序 / 设备', esc(disp(i,'processEquipment')))}
        ${kv('影响域', esc(disp(i,'impactArea')))}${kv('目标日期', `<span class="${dueClass(i.targetDate, i.status)}">${esc(disp(i,'targetDate'))}${isOverdueIssue(i) ? ' · 已超期' : ''}</span>`)}
        ${kv('我方负责人', esc(disp(i,'consultingOwner')))}${kv('客户执行人', esc(disp(i,'clientActionOwner')))}
        ${kv('根因状态', esc(disp(i,'rootCauseStatus')))}${kv('最后更新', esc(disp(i,'lastUpdate')))}
      </dl>
      <div class="ps-card" style="margin-top:12px"><div class="ps-card-t">问题陈述 / Problem Statement</div>${problemStatementHTML(disp(i,'problemStatement'))}</div>
      <div class="callout" style="margin-top:8px"><b>证据 / 数据：</b>${nl2br(disp(i,'evidenceData')) || '—'}</div>
      ${i.initialContainmentRiskNote ? `<div class="callout warn" style="margin-top:8px"><b>临时围堵 / 风险：</b>${nl2br(disp(i,'initialContainmentRiskNote'))}</div>` : ''}

      <div class="sec-title"><span class="n">2</span>根因分析与建议方案（G2 技术评审）</div>
      <dl class="detail-grid">${kv('根因分析', nl2br(disp(i,'rootCauseAnalysis')))}</dl>
      <div style="margin-top:10px"><b style="font-size:12px">建议方案：</b><div style="font-size:12.5px;color:var(--text-2);line-height:1.7;margin-top:4px">${nl2br(disp(i,'proposedSolution')) || '—'}</div></div>

      <div class="sec-title"><span class="n">3</span>客户执行行动（${acts.length}）</div>
      ${acts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Action</th><th>行动</th><th>客户责任人</th><th>到期</th><th>状态</th></tr></thead><tbody>
      ${acts.map(a => `<tr><td class="idcell">${esc(disp(a,'actionId'))}</td><td class="small">${esc(disp(a,'improvementAction').slice(0, 48))}…</td><td class="small">${esc(disp(a,'clientActionOwner'))}</td><td class="${dueClass(a.dueDate, a.status)} small">${esc(disp(a,'dueDate'))}</td><td>${pillStatus(a.status)}</td></tr>`).join('')}
      </tbody></table></div>` : empty('尚未创建客户行动')}
      <button class="btn btn-sm" style="margin-top:10px" id="drawerNewAction">+ 为该问题创建行动</button>

      <div class="sec-title"><span class="n">4</span>技术决策（${decs.length}）</div>
      ${decs.length ? decs.map(x => `<div class="rule"><div class="rule-ic l">D</div><div><b>${esc(disp(x,'decisionTopic'))}</b><p>推荐方案 ${esc(disp(x,'recommendedOption'))} · 客户批准人 ${esc(disp(x,'clientApprover'))}</p>${pillStatus(x.approvalStatus)}</div></div>`).join('') : empty('无关联决策')}

      <div class="sec-title"><span class="n">5</span>验证与关闭证据（G4）</div>
      <div class="callout ${i.closureEvidenceResult ? 'green' : 'warn'}">${nl2br(disp(i,'closureEvidenceResult')) || '尚未上传验证证据。根据治理规则，执行完成不等于关闭，必须有前后数据对比与客户签署。'}</div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-danger" id="drawerEsc">升级级别</button>
      <button class="btn" id="drawerEdit">编辑</button>
      ${next ? `<button class="btn btn-teal" id="drawerNext">推进至 ${esc(next)}</button>` : ''}
    </div>`);

  $('#drawerEdit').onclick = () => {
    openForm('编辑问题 · ' + i.issueId, ISSUE_FIELDS, i, (v) => { Object.assign(i, v); i.lastUpdate = TODAY; saveDB(); toast('已保存'); route(); openIssue(id); });
  };
  if (next) $('#drawerNext').onclick = () => {
    i.status = next; i.lastUpdate = TODAY;
    if (next === 'Closed' && !i.closureEvidenceResult) { toast('请先填写关闭证据再关闭'); return; }
    saveDB(); toast('状态推进至 ' + next); route(); openIssue(id);
  };
  $('#drawerEsc').onclick = () => {
    const order = ['L1', 'L2', 'L3'];
    i.escalationLevel = order[(order.indexOf(i.escalationLevel) + 1) % 3];
    i.lastUpdate = TODAY; saveDB(); toast('升级级别调整为 ' + i.escalationLevel); route(); openIssue(id);
  };
  $('#drawerNewAction').onclick = () => openActionForm(null, id);
}

/* ---------------- page: actions ---------------- */
let actionFilter = { q: '', status: '', over: false };
function renderActions() {
  const list = DB.actions.filter(a => {
    if (actionFilter.status && a.status !== actionFilter.status) return false;
    if (actionFilter.over && overdue(a) === 0) return false;
    if (actionFilter.q) {
      const q = actionFilter.q.toLowerCase();
      return [a.actionId, a.linkedIssueId, a.improvementAction, a.clientActionOwner].join(' ').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => overdue(b) - overdue(a) || a.dueDate.localeCompare(b.dueDate));
  return `
  <div class="page-head"><div><h1>改进行动跟踪</h1><p>Improvement Action Tracker · 客户拥有执行责任，我方提供支持与验证（工具包 04_Action Tracker）</p></div>
    <div class="actions"><button class="btn ${actionFilter.over ? 'btn-primary' : ''}" id="btnOverdue">仅看超期</button><button class="btn btn-primary" id="btnNewAction2">+ 新建行动</button></div></div>
  <div class="grid grid-kpi" style="margin-bottom:18px">
    <div class="card kpi danger"><div class="kpi-label">超期行动</div><div class="kpi-value">${DB.actions.filter(a => overdue(a) > 0).length}</div><div class="kpi-foot">自动按到期日计算</div></div>
    <div class="card kpi warn"><div class="kpi-label">被阻塞 Blocked</div><div class="kpi-value">${DB.actions.filter(a => a.status === 'Blocked').length}</div><div class="kpi-foot">多为客户审批/资源问题</div></div>
    <div class="card kpi teal"><div class="kpi-label">待验证</div><div class="kpi-value">${DB.actions.filter(a => a.status === 'Pending Verification').length}</div><div class="kpi-foot">执行 ≠ 关闭</div></div>
    <div class="card kpi"><div class="kpi-label">已关闭并验证</div><div class="kpi-value">${DB.actions.filter(a => a.status === 'Closed' && a.verificationResultEvidence).length}</div><div class="kpi-foot">有验证证据才计入</div></div>
  </div>
  <div class="filterbar">
    <input id="fq" placeholder="搜索行动 / 关联问题 / 客户责任人" value="${esc(actionFilter.q)}" style="width:250px">
    <select id="fst"><option value="">全部状态</option>${opts(ACTION_STATUSES, actionFilter.status)}</select>
    <div class="spacer"></div><div class="count">显示 ${list.length} / ${DB.actions.length} 项</div>
  </div>
  <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>
    <th>Action ID</th><th>改进行动 / 验收标准</th><th>关联问题</th><th>客户执行人</th><th>到期日</th><th>状态</th><th>完成度</th><th>超期</th><th>验证</th><th></th>
  </tr></thead><tbody>
  ${list.map(a => `<tr>
    <td class="idcell">${esc(disp(a,'actionId'))}</td>
    <td><div class="titlecell" style="max-width:280px">${esc(disp(a,'improvementAction').slice(0, 52))}${a.improvementAction.length > 52 ? '…' : ''}</div><div class="sub">${esc(disp(a,'expectedOutcomeAcceptanceCriteria').slice(0, 46))}…</div></td>
    <td><span class="tag blue mono">${esc(disp(a,'linkedIssueId'))}</span></td>
    <td class="small">${esc(disp(a,'clientActionOwner'))}</td>
    <td class="${dueClass(a.dueDate, a.status)} small">${esc(disp(a,'dueDate'))}</td>
    <td>${pillStatus(a.status)}</td>
    <td><div style="display:flex;align-items:center;gap:6px"><div class="progress" style="width:52px"><div style="width:${+a.percentComplete || 0}%"></div></div><span class="small">${esc(disp(a,'percentComplete'))}%</span></div></td>
    <td class="${overdue(a) ? 'due-over' : ''}">${overdue(a) ? overdue(a) + ' d' : '—'}</td>
    <td class="small">${a.verificationResultEvidence ? '<span class="tag teal">有证据</span>' : '<span class="tag">待验证</span>'}</td>
    <td><button class="btn btn-xs" data-open="${esc(disp(a,'actionId'))}">详情</button></td>
  </tr>`).join('') || `<tr><td colspan="10">${empty('没有符合条件的行动')}</td></tr>`}
  </tbody></table></div></div>`;
}

function openActionForm(existing, linkedId) {
  const fields = ACTION_FIELDS.map(f => f.key === 'linkedIssueId' && linkedId ? { ...f, def: linkedId } : f);
  openForm(existing ? '编辑行动 · ' + existing.actionId : '新建改进行动', fields, existing || null, (v) => {
    if (existing) Object.assign(existing, v);
    else DB.actions.push(v);
    saveDB(); toast(existing ? '行动已更新' : '行动已创建'); closeAll(); route();
  }, existing ? '保存修改' : '创建行动');
}

function openAction(id) {
  const a = DB.actions.find(x => x.actionId === id);
  if (!a) return;
  const issue = DB.issues.find(i => i.issueId === a.linkedIssueId);
  const kv = (k, v) => `<dt>${esc(k)}</dt><dd>${v || '—'}</dd>`;
  openDrawer(`
    <div class="drawer-head"><div><div class="small mono" style="margin-bottom:4px">${esc(disp(a,'actionId'))} · IMPROVEMENT ACTION TRACKER</div><h2>${esc(disp(a,'improvementAction'))}</h2>
      <div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">${pillStatus(a.status)}<span class="tag blue mono">${esc(disp(a,'linkedIssueId'))}</span>${overdue(a) ? `<span class="pill p1">超期 ${overdue(a)} 天</span>` : ''}</div></div><button class="close" data-close="1">×</button></div>
    <div class="drawer-body">
      ${overdue(a) ? `<div class="callout red" style="margin-bottom:14px"><b>超期提醒：</b>该行动已超期 ${overdue(a)} 天${a.escalationRequired === 'Yes' ? '，并已标记需升级。' : '。'}请项目经理推动客户责任人更新承诺日期。</div>` : ''}
      <div class="sec-title"><span class="n">1</span>行动定义</div>
      <dl class="detail-grid">
        ${kv('关联问题', `${esc(disp(a,'linkedIssueId'))} — ${esc(issue ? issue.problemStatement.slice(0, 60) : '')}`)}
        ${kv('行动类型', esc(disp(a,'actionType')))}${kv('分配日期', esc(disp(a,'dateAssigned')))}
        ${kv('客户执行人', esc(disp(a,'clientActionOwner')))}${kv('我方支持', esc(disp(a,'consultingSupportOwner')))}
        ${kv('到期日', `<span class="${dueClass(a.dueDate, a.status)}">${esc(disp(a,'dueDate'))}</span>`)}${kv('完成日期', esc(disp(a,'completionDate')))}
        ${kv('完成度', esc(disp(a,'percentComplete')) + '%')}${kv('需升级', esc(disp(a,'escalationRequired')))}
      </dl>
      <div class="callout" style="margin-top:12px"><b>验收标准：</b>${nl2br(disp(a,'expectedOutcomeAcceptanceCriteria')) || '—'}</div>
      ${a.blockerDependency ? `<div class="callout warn" style="margin-top:8px"><b>阻塞 / 依赖：</b>${nl2br(disp(a,'blockerDependency'))}</div>` : ''}
      <div class="sec-title"><span class="n">2</span>验证（G4）</div>
      <dl class="detail-grid">${kv('验证责任人', esc(disp(a,'verificationOwner')))}${kv('验证结果', nl2br(disp(a,'verificationResultEvidence')))}</dl>
      <div class="callout green" style="margin-top:12px">治理规则：客户完成实施后仍需我方与客户质量共同验证，未取得验证证据不得标记为 Closed。</div>
    </div>
    <div class="drawer-foot">
      <button class="btn" id="actEdit">编辑</button>
      <button class="btn btn-danger" id="actEsc">${a.escalationRequired === 'Yes' ? '取消升级标记' : '标记升级'}</button>
      <button class="btn btn-primary" id="actNext">推进状态</button>
    </div>`);
  $('#actEdit').onclick = () => openActionForm(a);
  $('#actEsc').onclick = () => { a.escalationRequired = a.escalationRequired === 'Yes' ? 'No' : 'Yes'; saveDB(); toast('升级标记已更新'); route(); openAction(id); };
  $('#actNext').onclick = () => {
    const idx = ACTION_STATUSES.indexOf(a.status);
    let next = ACTION_STATUSES[idx + 1] || 'Closed';
    if (next === 'Closed' && !a.verificationResultEvidence) { toast('请先填写验证结果证据'); return; }
    a.status = next;
    if (next === 'Closed') { a.completionDate = TODAY; a.percentComplete = 100; }
    saveDB(); toast('状态推进至 ' + next); route(); openAction(id);
  };
}

/* ---------------- page: reports ---------------- */
let reportFilter = '';
function renderReports() {
  const list = DB.reports.filter(r => !reportFilter || r.workstream === reportFilter);
  return `
  <div class="page-head"><div><h1>每日跟线报告</h1><p>Daily Activity Report · 每个专业组每天一份，只记录事实与证据（工具包 02_Daily Report）</p></div>
    <div class="actions"><button class="btn btn-primary" id="btnNewReport">+ 提交日报</button></div></div>
  <div class="filterbar"><select id="fws"><option value="">全部专业组</option>${opts(WORKSTREAMS, reportFilter)}</select><div class="spacer"></div><div class="count">${list.length} 份报告</div></div>
  ${list.map(r => `<div class="card" style="margin-bottom:14px"><div class="card-head">
    <div><h3 class="card-title">${esc(disp(r,'date'))} · ${esc(wsLabel(disp(r,'workstream')))}</h3><div class="card-sub">${esc(disp(r,'reportingLead'))} · ${esc(disp(r,'shiftLine'))}</div></div>
    <div class="right">${r.newIssueIds && r.newIssueIds !== '—' ? `<span class="tag blue">新增 ${esc(disp(r,'newIssueIds'))}</span>` : ''}<button class="btn btn-sm" data-edit-report="${esc(r.date + '|' + r.workstream)}">编辑</button></div>
  </div><div class="card-body">
    <div class="detail-grid" style="grid-template-columns:132px 1fr">
      <dt>生产背景 / KPI</dt><dd>${esc(disp(r,'productionContextKpi'))}</dd>
      <dt>跟线观察</dt><dd>${nl2br(disp(r,'activitiesObservations'))}</dd>
      <dt>需要的行动 / 决策</dt><dd>${nl2br(disp(r,'actionsDecisionsRequired')) || '—'}</dd>
      <dt>客户接口人</dt><dd>${esc(disp(r,'clientContactOwner'))}</dd>
      <dt>次日重点</dt><dd>${nl2br(disp(r,'nextDayPriorities'))}</dd>
      <dt>证据路径</dt><dd class="mono small">${esc(disp(r,'evidenceLink'))}</dd>
    </div>
  </div></div>`).join('') || empty('暂无日报')}`;
}

/* ---------------- page: decisions ---------------- */
function renderDecisions() {
  return `
  <div class="page-head"><div><h1>技术决策日志</h1><p>Technical Decision Log · 建议权在我方，批准权在客户（工具包 05_Decision Log）</p></div>
    <div class="actions"><button class="btn btn-primary" id="btnNewDecision">+ 新建决策</button></div></div>
  <div class="grid grid-kpi" style="margin-bottom:18px">
    <div class="card kpi warn"><div class="kpi-label">待客户批准</div><div class="kpi-value">${DB.decisions.filter(x => x.approvalStatus === 'Pending Client Approval').length}</div><div class="kpi-foot">SLA 48 h，超期自动升级</div></div>
    <div class="card kpi purple"><div class="kpi-label">技术评审中</div><div class="kpi-value">${DB.decisions.filter(x => x.approvalStatus === 'Under Technical Review').length}</div><div class="kpi-foot">技术经理 G2 闸门</div></div>
    <div class="card kpi teal"><div class="kpi-label">已批准 / 已关闭</div><div class="kpi-value">${DB.decisions.filter(x => ['Approved', 'Closed'].includes(x.approvalStatus)).length}</div><div class="kpi-foot">含 MoC 变更控制编号</div></div>
  </div>
  <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Decision ID</th><th>决策主题</th><th>关联问题</th><th>推荐</th><th>技术审核</th><th>客户批准人</th><th>审批状态</th><th>变更控制</th><th></th></tr></thead><tbody>
  ${DB.decisions.map(x => `<tr><td class="idcell">${esc(disp(x,'decisionId'))}</td><td class="titlecell" style="max-width:250px">${esc(disp(x,'decisionTopic'))}</td><td><span class="tag blue mono">${esc(x.linkedIssueId || '—')}</span></td><td><b>${esc(disp(x,'recommendedOption'))}</b></td><td class="small">${esc(disp(x,'technicalReviewer'))}</td><td class="small">${esc(disp(x,'clientApprover'))}</td><td>${pillStatus(x.approvalStatus)}</td><td class="mono small">${esc(x.conditionsChangeControlRef || '—')}</td><td><button class="btn btn-xs" data-open="${esc(disp(x,'decisionId'))}">详情</button></td></tr>`).join('')}
  </tbody></table></div></div>`;
}

function openDecision(id) {
  const x = DB.decisions.find(v => v.decisionId === id);
  if (!x) return;
  const kv = (k, v) => `<dt>${esc(k)}</dt><dd>${v || '—'}</dd>`;
  openDrawer(`
    <div class="drawer-head"><div><div class="small mono" style="margin-bottom:4px">${esc(disp(x,'decisionId'))} · TECHNICAL DECISION LOG</div><h2>${esc(disp(x,'decisionTopic'))}</h2>
      <div style="margin-top:9px">${pillStatus(x.approvalStatus)} <span class="tag blue mono">${esc(x.linkedIssueId || '—')}</span></div></div><button class="close" data-close="1">×</button></div>
    <div class="drawer-body">
      <div class="sec-title"><span class="n">1</span>背景与备选方案</div>
      <div class="callout">${nl2br(disp(x,'backgroundEvidence')) || '—'}</div>
      <div style="margin-top:10px;font-size:12.5px">${nl2br(disp(x,'optionsConsidered')) || '—'}</div>
      <div class="sec-title"><span class="n">2</span>推荐方案与技术理由</div>
      <div class="callout green"><b>推荐方案 ${esc(disp(x,'recommendedOption'))}</b><br>${nl2br(disp(x,'technicalRationaleRisks'))}</div>
      <div class="sec-title"><span class="n">3</span>审批与变更控制</div>
      <dl class="detail-grid">
        ${kv('技术审核', esc(disp(x,'technicalReviewer')))}${kv('客户批准人', esc(disp(x,'clientApprover')))}
        ${kv('决策日期', esc(disp(x,'decisionDate')))}${kv('生效日期', esc(disp(x,'effectiveDate')))}
        ${kv('MoC 编号', `<span class="mono">${esc(disp(x,'conditionsChangeControlRef'))}</span>`)}${kv('执行责任人', esc(disp(x,'implementationOwner')))}
      </dl>
      <div class="callout warn" style="margin-top:12px"><b>边界：</b>客户授权人负责批准与我方无关的生产变更；咨询方不得代替客户执行变更控制。</div>
      <div class="sec-title"><span class="n">4</span>结果与后续</div><div>${nl2br(disp(x,'outcomeFollowUp')) || '—'}</div>
    </div>
    <div class="drawer-foot"><button class="btn" id="decEdit">编辑</button><button class="btn btn-primary" id="decNext">推进审批状态</button></div>`);
  $('#decEdit').onclick = () => openForm('编辑决策 · ' + x.decisionId, DECISION_FIELDS, x, v => { Object.assign(x, v); saveDB(); toast('已保存'); route(); openDecision(id); });
  $('#decNext').onclick = () => {
    const idx = APPROVAL_STATUSES.indexOf(x.approvalStatus);
    x.approvalStatus = APPROVAL_STATUSES[idx + 1] || 'Closed';
    if (x.approvalStatus === 'Approved' && !x.decisionDate) x.decisionDate = TODAY;
    saveDB(); toast('审批状态推进至 ' + x.approvalStatus); route(); openDecision(id);
  };
}

/* ---------------- page: team ---------------- */
const RACI_ROLE_CN = { Accountable: '最终负责', Responsible: '执行', Consulted: '被咨询', Informed: '被告知' };
const raciRoleCn = (v) => RACI_ROLE_CN[v] || v;
function renderTeam() {
  const byArea = {};
  TEAM.forEach(t => { byArea[t.area] = (byArea[t.area] || 0) + t.count; });
  return `
  <div class="page-head"><div><h1>团队与 RACI</h1><p>17 项关键活动 × 7 类角色 · 每个活动只有一个 A（最终负责）</p></div></div>
  <div class="grid grid-kpi" style="margin-bottom:18px">
    <div class="card kpi"><div class="kpi-label">咨询团队总人数</div><div class="kpi-value">${TEAM.reduce((a, b) => a + b.count, 0)}</div><div class="kpi-foot">现场 ${TEAM.filter(t => t.site === '现场').reduce((a, b) => a + b.count, 0)} · 远程/双地 ${TEAM.filter(t => t.site !== '现场').reduce((a, b) => a + b.count, 0)}</div></div>
    <div class="card kpi teal"><div class="kpi-label">技术经理为 A 的活动</div><div class="kpi-value">${RACI_MATRIX.filter(r => r[2] === 'A').length}</div><div class="kpi-foot">共 ${RACI_MATRIX.length} 项活动</div></div>
    <div class="card kpi purple"><div class="kpi-label">客户侧角色</div><div class="kpi-value">3</div><div class="kpi-foot">生产 / 质量EHS工程 / 发起人</div></div>
  </div>
  <div class="grid grid-3" style="margin-bottom:18px">
    ${TEAM.map(t => `<div class="team-card"><div class="t-top"><div class="avatar" style="background:var(--primary-soft);color:var(--primary)">${esc(avatarInitial(t))}</div><div><div class="t-name">${esc(t.name)} ×${t.count}</div><div class="t-role">${esc(isEn() ? t.en : raciRoleCn(t.role))}</div></div></div><div class="t-tags"><span class="tag blue">${esc(t.area)}</span><span class="tag teal">${esc(t.site)}</span><span class="tag purple">${esc(isEn() ? t.role : raciRoleCn(t.role))}</span></div><div class="small" style="margin-top:9px;line-height:1.6">${esc(t.duty)}</div></div>`).join('')}
  </div>
  <div class="card">
    <div class="card-head"><div><h3 class="card-title">RACI 责任矩阵</h3><div class="card-sub">源自工具包 01_RACI · A=最终负责 R=执行 C=被咨询 I=被告知</div></div></div>
    <div class="table-wrap"><table class="tbl matrix"><thead><tr><th style="min-width:280px">${isEn() ? 'Activity / Deliverable' : '活动 / 交付物'}</th>${RACI_ROLES.map(r => `<th style="text-align:center">${esc(isEn() ? r.en : r.label)}<small>${esc(isEn() ? r.enLoc : r.loc)}</small></th>`).join('')}</tr></thead><tbody>
    ${RACI_MATRIX.map(row => `<tr><td class="titlecell">${esc(isEn() ? row[1] : row[0])}</td>${row.slice(2).map(v => `<td class="r ${v.toLowerCase()}">${v}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div class="card-body"><div class="legend"><span><b class="r a">A</b> ${isEn() ? 'Accountable' : '最终负责'}</span><span><b class="r r">R</b> ${isEn() ? 'Responsible' : '执行'}</span><span><b class="r c">C</b> ${isEn() ? 'Consulted' : '被咨询'}</span><span><b class="r i">I</b> ${isEn() ? 'Informed' : '被告知'}</span></div>
    </div>
  </div>`;
}

/* ---------------- page: kpi ---------------- */
function renderKpi() {
  const t = (zh, en) => isEn() ? en : zh;
  return `
  <div class="page-head"><div><h1>${t('KPI 看板', 'KPI Dashboard')}</h1><p>${t('项目 KPI 看板 · 口径来自工具包 06_KPI Dashboard；基线 / 目标 / 实际值可直接填写客户真实数据', 'Project KPI Dashboard · definitions from toolkit 06_KPI Dashboard; baseline / target / actual can be filled with actual client data')}</p></div></div>
  ${KPI_CATS.map(c => `<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3 class="card-title">${esc(t(c.zh, c.en))}</h3></div></div><div class="table-wrap"><table class="tbl"><thead><tr><th>${t('KPI 指标', 'KPI')}</th><th>${t('定义 / 计算口径', 'Definition')}</th><th>${t('单位', 'Unit')}</th><th>${t('基线', 'Baseline')}</th><th>${t('目标', 'Target')}</th><th>${t('实际值', 'Actual')}</th><th>${t('达成度', 'Attainment')}</th><th>${t('数据责任人', 'Data Owner')}</th></tr></thead><tbody>
    ${DB.kpis.filter(k => k.cat === c.key).map(k => {
      const num = v => v !== '' && v != null && !isNaN(Number(v));
      const has = num(k.baseline) && num(k.target) && num(k.actual);
      const prog = has && +k.target !== +k.baseline ? Math.min(100, Math.max(0, Math.round((+k.actual - +k.baseline) / (+k.target - +k.baseline) * 100))) : null;
      const cell = key => `<input class="cell-input" type="number" step="any" data-kpi-id="${k.id}" data-kpi-key="${key}" value="${esc(k[key])}" placeholder="—">`;
      return `<tr><td class="titlecell">${esc(t(k.name, k.enName))}</td><td class="small">${esc(t(k.def, k.enDef))}</td><td class="small">${esc(t(k.unit, k.enUnit))}</td><td>${cell('baseline')}</td><td>${cell('target')}</td><td>${cell('actual')}</td><td><div style="display:flex;align-items:center;gap:7px"><div class="progress" style="width:70px"><div style="width:${prog == null ? 0 : prog}%;background:${prog != null && prog >= 100 ? 'var(--success)' : 'var(--primary)'}"></div></div><span class="small">${prog == null ? t('待录入', 'Pending') : prog + '%'}</span></div></td><td class="small">${esc(t(k.owner, k.enOwner))}</td></tr>`;
    }).join('')}
  </tbody></table></div></div>`).join('')}`;
}

/* ---------------- page: weekly ---------------- */
function renderWeekly() {
  const wr = weekRange(TODAY), start = wr[0], end = wr[1];
  const inWeek = (s) => s && s >= start && s <= end;
  const newIssues = DB.issues.filter(i => inWeek(i.dateRaised));
  const closedIssues = DB.issues.filter(i => inWeek(i.lastUpdate) && i.status === 'Closed');
  const dueActions = DB.actions.filter(a => inWeek(a.dueDate));
  const over = DB.actions.filter(a => overdue(a) > 0);
  const pending = DB.decisions.filter(x => ['Pending Client Approval', 'Under Technical Review'].includes(x.approvalStatus));
  const m = metrics();
  const hot = DB.issues.filter(i => i.priority === 'Critical' || i.escalationLevel === 'L3').slice(0, 3).map(i => i.issueId + '（' + i.escalationLevel + '）').join('、');
  const fpyTxt = m.fpyGain === null ? 'KPI 基线 / 当前值待客户提供' :
    'FPY 基线 ' + esc(m.fpy.baseline) + '% → 当前 ' + esc(m.fpy.actual) + '%（' + (m.fpyGain >= 0 ? '+' : '') + m.fpyGain + ' pp）';
  const summary = (DB.issues.length || DB.actions.length || DB.decisions.length || DB.reports.length)
    ? fpyTxt + '。本周新增问题 ' + newIssues.length + ' 项、关闭 ' + closedIssues.length + ' 项；到期客户行动 ' + dueActions.length + ' 项，其中超期 ' + over.length + ' 项；待客户决策 ' + pending.length + ' 项。' + (hot ? '重点风险：' + esc(hot) + '。' : '')
    : '当前尚未录入问题、行动与决策记录。请在「智能录入」中粘贴跟线描述，系统整理并写入台账后，本报告将自动生成执行摘要。';
  const nextSteps = [];
  DB.issues.filter(i => i.status !== 'Closed' && (i.priority === 'Critical' || i.escalationLevel === 'L3')).slice(0, 2)
    .forEach(i => nextSteps.push('推进 ' + i.issueId + '：' + disp(i,'problemStatement').slice(0, 40)));
  DB.actions.filter(a => overdue(a) > 0).slice(0, 2)
    .forEach(a => nextSteps.push('催办超期行动 ' + a.actionId + '（' + a.clientActionOwner + '）'));
  DB.decisions.filter(x => x.approvalStatus === 'Pending Client Approval').slice(0, 2)
    .forEach(x => nextSteps.push('推动客户审批 ' + x.decisionId + '：' + x.decisionTopic));
  while (nextSteps.length < 4) nextSteps.push('待录入数据后自动生成');
  return `
  <div class="page-head"><div><h1>周报中心</h1><p>Weekly Project Review · ${start} ~ ${end} · 可直接打印或导出</p></div>
    <div class="actions"><button class="btn" id="btnExportCsv">导出 CSV</button><button class="btn btn-primary" id="btnPrint">打印 / 存为 PDF</button></div></div>
  <div class="card"><div class="card-head"><div><h3 class="card-title">本周项目状态报告</h3><div class="card-sub">欧洲电芯厂良率与产出提升技术咨询 · 技术经理远程评审用</div></div><div class="right"><span class="tag blue">自动生成</span></div></div>
  <div class="card-body">
    <div class="grid grid-kpi" style="margin-bottom:20px">
      <div class="card kpi"><div class="kpi-label">本周新增问题</div><div class="kpi-value">${newIssues.length}</div><div class="kpi-foot">Critical ${newIssues.filter(i => i.priority === 'Critical').length} 项</div></div>
      <div class="card kpi teal"><div class="kpi-label">本周关闭</div><div class="kpi-value">${closedIssues.length}</div><div class="kpi-foot">均有验证证据</div></div>
      <div class="card kpi"><div class="kpi-label">到期行动</div><div class="kpi-value">${dueActions.length}</div><div class="kpi-foot">客户执行 ${dueActions.filter(a => a.status !== 'Closed').length} 项未完成</div></div>
      <div class="card kpi danger"><div class="kpi-label">超期 / 升级</div><div class="kpi-value">${over.length}</div><div class="kpi-foot">已同步例外队列</div></div>
    </div>
    <div class="sec-title"><span class="n">1</span>执行摘要</div>
    <div class="callout">${summary}</div>
    <div class="sec-title"><span class="n">2</span>本周新增 / 更新问题</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>问题</th><th>专业组</th><th>优先级</th><th>状态</th><th>升级</th></tr></thead><tbody>${newIssues.map(i => `<tr><td class="idcell">${esc(disp(i,'issueId'))}</td><td class="titlecell">${esc(disp(i,'problemStatement').slice(0, 60))}…</td><td class="small">${esc(disp(i,'workstream'))}</td><td>${pillPriority(i.priority)}</td><td>${pillStatus(i.status)}</td><td>${pillEsc(i.escalationLevel)}</td></tr>`).join('')}</tbody></table></div>
    <div class="sec-title"><span class="n">3</span>客户行动承诺与超期</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>行动</th><th>客户责任人</th><th>到期</th><th>状态</th><th>超期</th></tr></thead><tbody>${over.concat(dueActions.filter(a => overdue(a) === 0)).slice(0, 10).map(a => `<tr><td class="idcell">${esc(disp(a,'actionId'))}</td><td class="titlecell">${esc(disp(a,'improvementAction').slice(0, 54))}…</td><td class="small">${esc(disp(a,'clientActionOwner'))}</td><td class="${dueClass(a.dueDate, a.status)}">${esc(disp(a,'dueDate'))}</td><td>${pillStatus(a.status)}</td><td class="${overdue(a) ? 'due-over' : ''}">${overdue(a) ? overdue(a) + 'd' : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="sec-title"><span class="n">4</span>待客户决策（审批 SLA 48h）</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>决策主题</th><th>推荐</th><th>客户批准人</th><th>状态</th><th>滞留</th></tr></thead><tbody>${pending.map(x => `<tr><td class="idcell">${esc(disp(x,'decisionId'))}</td><td class="titlecell">${esc(disp(x,'decisionTopic'))}</td><td>${esc(disp(x,'recommendedOption'))}</td><td class="small">${esc(disp(x,'clientApprover'))}</td><td>${pillStatus(x.approvalStatus)}</td><td class="${diffDays(TODAY, x.dateRaised) > 2 ? 'due-over' : ''}">${diffDays(TODAY, x.dateRaised)} d</td></tr>`).join('')}</tbody></table></div>
    <div class="sec-title"><span class="n">5</span>下周重点</div>
    <div class="grid grid-2">${nextSteps.slice(0, 4).map((t, n) => `<div class="rule"><div class="rule-ic l">${n + 1}</div><div><p style="margin:2px 0 0;color:var(--text)">${esc(t)}</p></div></div>`).join('')}</div>
  </div></div>`;
}

/* ---------------- page: knowledge ---------------- */
let knowFilter = '';
function renderKnowledge() {
  const list = DB.issues.filter(i => (i.status === 'Closed' || i.status === 'Verification') && i.rootCauseAnalysis && (!knowFilter || i.workstream === knowFilter));
  return `
  <div class="page-head"><div><h1>知识库 · 可复用解决方案</h1><p>关闭/验证阶段的问题自动沉淀为标准案例，供新项目复用</p></div></div>
  <div class="filterbar"><select id="fws"><option value="">全部专业组</option>${opts(WORKSTREAMS, knowFilter)}</select><div class="spacer"></div><div class="count">${list.length} 个案例</div></div>
  <div class="grid grid-2">${list.map(i => `<div class="card"><div class="card-head"><div><h3 class="card-title">${esc(disp(i,'issueId'))} · ${esc(disp(i,'processEquipment'))}</h3><div class="card-sub">${esc(wsLabel(disp(i,'workstream')))} · ${esc(disp(i,'impactArea'))}</div></div><div class="right">${pillStatus(i.status)}</div></div>
    <div class="card-body">
      <div class="small" style="font-weight:700;color:var(--text-2);margin-bottom:4px">问题 / Problem</div><div style="font-size:12.5px;margin-bottom:10px">${problemStatementHTML(disp(i,'problemStatement'))}</div>
      <div class="small" style="font-weight:700;color:var(--text-2);margin-bottom:4px">根因 / Root Cause</div><div class="callout" style="font-size:12px;margin-bottom:10px">${nl2br(disp(i,'rootCauseAnalysis'))}</div>
      <div class="small" style="font-weight:700;color:var(--text-2);margin-bottom:4px">标准对策 / Standard Solution</div><div style="font-size:12.5px;line-height:1.65">${nl2br(disp(i,'proposedSolution'))}</div>
      ${i.closureEvidenceResult ? `<div class="callout green" style="font-size:11.5px;margin-top:10px"><b>验证：</b>${nl2br(disp(i,'closureEvidenceResult'))}</div>` : ''}
      <div style="margin-top:12px"><button class="btn btn-sm" data-open="${esc(disp(i,'issueId'))}">查看完整案例</button></div>
    </div></div>`).join('') || empty('暂无可复用案例')}</div>`;
}

/* ---------------- page: data ---------------- */
function renderData() {
  const map = [
    ['01_RACI', isEn() ? 'RACI Matrix (17 activities × 7 roles)' : 'RACI 责任矩阵（17 项活动 × 7 类角色）', '团队与 RACI'],
    ['02_Daily Report', isEn() ? 'Daily Activity Report (11 fields)' : '每日跟线报告（11 字段）', '每日跟线报告'],
    ['03_Issue Log', isEn() ? 'Technical Issue Log (19 fields)' : '技术问题台账（19 字段）', '技术问题台账'],
    ['04_Action Tracker', isEn() ? 'Improvement Action Tracker (17 fields)' : '改进行动跟踪（17 字段）', '改进行动跟踪'],
    ['05_Decision Log', isEn() ? 'Technical Decision Log (16 fields)' : '技术决策日志（16 字段）', '技术决策日志'],
    ['06_KPI Dashboard', isEn() ? 'Project KPI Dashboard (12 KPIs)' : '项目 KPI 看板（12 项）', 'KPI 看板']
  ];
  return `
  <div class="page-head"><div><h1>数据管理</h1><p>单一数据源 · 所有模块共用同一份数据，修改后自动保存到本机浏览器</p></div></div>
  <div class="grid grid-2" style="margin-bottom:18px">
    <div class="card"><div class="card-head"><div><h3 class="card-title">数据导出与备份</h3><div class="card-sub">用于跨地同步、客户交付与归档</div></div></div><div class="card-body">
      <div class="rule-list">
        <div class="rule"><div class="rule-ic l">1</div><div><b>导出完整数据（JSON）</b><p>包含问题、行动、决策、日报、KPI，可用于另一台机器导入。</p></div></div>
        <div class="rule"><div class="rule-ic l">2</div><div><b>导出台账（CSV）</b><p>按工具包字段输出问题与行动台账，可直接用 Excel 打开。</p></div></div>
        <div class="rule"><div class="rule-ic l">3</div><div><b>导入数据（JSON）</b><p>恢复备份或合并其他成员的数据快照。</p></div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px"><button class="btn btn-primary" id="btnExportJson">导出 JSON</button><button class="btn" id="btnExportCsv2">导出 CSV</button><button class="btn" id="btnImport">导入 JSON</button><button class="btn btn-danger" id="btnReset">清空全部数据</button></div>
      <input type="file" id="fileInput" accept=".json" class="hidden">
    </div></div>
    <div class="card"><div class="card-head"><div><h3 class="card-title">当前数据规模</h3></div></div><div class="card-body">
      <dl class="detail-grid">
        <dt>问题 Issues</dt><dd>${DB.issues.length} 条</dd>
        <dt>行动 Actions</dt><dd>${DB.actions.length} 条</dd>
        <dt>决策 Decisions</dt><dd>${DB.decisions.length} 条</dd>
        <dt>跟线日报 Reports</dt><dd>${DB.reports.length} 条</dd>
        <dt>KPI</dt><dd>${DB.kpis.length} 项</dd>
        <dt>更新时间</dt><dd>${esc(DB.meta.updated)}</dd>
      </dl>
      <div class="callout warn" style="margin-top:14px">本系统为浏览器本地持久化原型。正式部署到团队共享环境时，应将存储层替换为服务端数据库，并配置角色权限、客户审批电子签名与证据文件库。</div>
    </div></div>
  </div>
  <div class="card"><div class="card-head"><div><h3 class="card-title">工具包 → 系统模块映射</h3><div class="card-sub">字段级继承，未丢失原模板口径</div></div></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>源工作表</th><th>用途</th><th>对应系统模块</th></tr></thead><tbody>${map.map(r => `<tr><td class="idcell">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="titlecell">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
}

/* ---------------- search ---------------- */
function renderSearch(q) {
  const ql = q.toLowerCase();
  const hit = (o) => Object.values(o).join(' ').toLowerCase().includes(ql);
  const iss = DB.issues.filter(hit), acts = DB.actions.filter(hit), decs = DB.decisions.filter(hit), reps = DB.reports.filter(hit);
  return `<div class="page-head"><div><h1>搜索结果：「${esc(q)}」</h1><p>共 ${iss.length + acts.length + decs.length + reps.length} 条匹配</p></div></div>
  ${iss.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3 class="card-title">问题 (${iss.length})</h3></div><div class="table-wrap"><table class="tbl"><tbody>${iss.map(i => `<tr data-go-issue="${esc(disp(i,'issueId'))}" style="cursor:pointer"><td class="idcell">${esc(disp(i,'issueId'))}</td><td>${esc(disp(i,'problemStatement'))}</td><td>${pillStatus(i.status)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  ${acts.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3 class="card-title">行动 (${acts.length})</h3></div><div class="table-wrap"><table class="tbl"><tbody>${acts.map(a => `<tr data-go-action="${esc(disp(a,'actionId'))}" style="cursor:pointer"><td class="idcell">${esc(disp(a,'actionId'))}</td><td>${esc(disp(a,'improvementAction'))}</td><td>${pillStatus(a.status)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  ${decs.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h3 class="card-title">决策 (${decs.length})</h3></div><div class="table-wrap"><table class="tbl"><tbody>${decs.map(x => `<tr data-go-decision="${esc(disp(x,'decisionId'))}" style="cursor:pointer"><td class="idcell">${esc(disp(x,'decisionId'))}</td><td>${esc(disp(x,'decisionTopic'))}</td><td>${pillStatus(x.approvalStatus)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  ${reps.length ? `<div class="card"><div class="card-head"><h3 class="card-title">跟线日报 (${reps.length})</h3></div><div class="table-wrap"><table class="tbl"><tbody>${reps.map(r => `<tr><td class="idcell">${esc(disp(r,'date'))}</td><td>${esc(wsLabel(disp(r,'workstream')))}</td><td class="small">${esc(disp(r,'activitiesObservations').slice(0, 100))}…</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  ${(iss.length + acts.length + decs.length + reps.length) === 0 ? empty('未找到匹配内容') : ''}`;
}

/* ---------------- router ---------------- */
const PAGES = {
  intake: { t: '智能录入', r: renderIntake },
  dashboard: { t: '总览驾驶舱', r: renderDashboard },
  issues: { t: '技术问题台账', r: renderIssues },
  actions: { t: '改进行动跟踪', r: renderActions },
  reports: { t: '每日跟线报告', r: renderReports },
  decisions: { t: '技术决策日志', r: renderDecisions },
  team: { t: '团队与 RACI', r: renderTeam },
  kpi: { t: 'KPI 看板', r: renderKpi },
  weekly: { t: '周报中心', r: renderWeekly },
  knowledge: { t: '知识库', r: renderKnowledge },
  data: { t: '数据管理', r: renderData }
};
let currentPage = 'dashboard';

function route() {
  const p = location.hash.replace('#', '') || 'dashboard';
  currentPage = PAGES[p] ? p : 'dashboard';
  $('#content').innerHTML = PAGES[currentPage].r();
  $('#crumbPage').textContent = PAGES[currentPage].t;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === currentPage));
  updateBadges();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function updateBadges() {
  const m = metrics();
  const a = $('#navIssueBadge'), b = $('#navActionBadge');
  if (a) a.textContent = m.ch.length;
  if (b) b.textContent = m.overdueActions.length;
}

/* ---------------- export ---------------- */
function download(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
function exportCSV() {
  const iHead = ['Issue ID', 'Date Raised', 'Workstream', 'Process / Equipment', 'Problem Statement', 'Evidence / Data', 'Impact Area', 'Priority', 'Initial Containment / Risk Note', 'Root Cause Status', 'Root Cause / Analysis', 'Proposed Solution', 'Consulting Owner', 'Client Action Owner', 'Target Date', 'Status', 'Escalation Level', 'Last Update', 'Closure Evidence / Result'];
  const iKeys = ['issueId', 'dateRaised', 'workstream', 'processEquipment', 'problemStatement', 'evidenceData', 'impactArea', 'priority', 'initialContainmentRiskNote', 'rootCauseStatus', 'rootCauseAnalysis', 'proposedSolution', 'consultingOwner', 'clientActionOwner', 'targetDate', 'status', 'escalationLevel', 'lastUpdate', 'closureEvidenceResult'];
  const aHead = ['Action ID', 'Linked Issue ID', 'Improvement Action', 'Expected Outcome / Acceptance Criteria', 'Action Type', 'Client Action Owner', 'Consulting Support Owner', 'Date Assigned', 'Due Date', 'Status', '% Complete', 'Blocker / Dependency', 'Escalation Required?', 'Completion Date', 'Verification Owner', 'Verification Result / Evidence', 'Days Overdue'];
  const aKeys = ['actionId', 'linkedIssueId', 'improvementAction', 'expectedOutcomeAcceptanceCriteria', 'actionType', 'clientActionOwner', 'consultingSupportOwner', 'dateAssigned', 'dueDate', 'status', 'percentComplete', 'blockerDependency', 'escalationRequired', 'completionDate', 'verificationOwner', 'verificationResultEvidence'];
  let csv = '\uFEFF' + iHead.map(csvCell).join(',') + '\n';
  DB.issues.forEach(i => csv += iKeys.map(k => csvCell(i[k])).join(',') + '\n');
  csv += '\n' + aHead.map(csvCell).join(',') + '\n';
  DB.actions.forEach(a => csv += aKeys.map(k => csvCell(a[k])).join(',') + ',' + overdue(a) + '\n');
  download('Issue_Action_Tracker_' + TODAY + '.csv', csv, 'text/csv;charset=utf-8');
  toast('CSV 已导出');
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-item');
  if (nav) { location.hash = nav.dataset.page; return; }
  if (e.target.closest('[data-close]')) { closeAll(); return; }
  if (e.target === $('#overlay')) { closeAll(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; return; }
  const NewIssue = e.target.closest('#btnNewIssue,#btnNewIssue2');
  if (NewIssue) { openForm('新建技术问题 · Issue Log', ISSUE_FIELDS, null, v => { DB.issues.push(v); saveDB(); toast('问题已创建：' + v.issueId); location.hash = 'issues'; }, '创建问题'); return; }
  const NewAction = e.target.closest('#btnNewAction,#btnNewAction2');
  if (NewAction) { openActionForm(null); return; }
  const NewDec = e.target.closest('#btnNewDecision');
  if (NewDec) { openForm('新建技术决策', DECISION_FIELDS, null, v => { DB.decisions.push(v); saveDB(); toast('决策已创建'); location.hash = 'decisions'; }, '创建决策'); return; }
  const NewRep = e.target.closest('#btnNewReport');
  if (NewRep) { openForm('提交每日跟线报告', REPORT_FIELDS, null, v => { DB.reports.unshift(v); saveDB(); toast('日报已提交'); location.hash = 'reports'; }, '提交日报'); return; }
  const editRep = e.target.closest('[data-edit-report]');
  if (editRep) {
    const [dt, ws] = editRep.dataset.editReport.split('|');
    const r = DB.reports.find(x => x.date === dt && x.workstream === ws);
    if (r) openForm('编辑日报 · ' + dt, REPORT_FIELDS, r, v => { Object.assign(r, v); saveDB(); toast('日报已更新'); route(); }, '保存修改');
    return;
  }
  const op = e.target.closest('[data-open]');
  if (op) {
    const id = op.dataset.open;
    if (id.startsWith('ISS-')) openIssue(id);
    else if (id.startsWith('ACT-')) openAction(id);
    else if (id.startsWith('DEC-')) openDecision(id);
    return;
  }
  const gi = e.target.closest('[data-go-issue]');
  if (gi) { openIssue(gi.dataset.goIssue); return; }
  const ga = e.target.closest('[data-go-action]');
  if (ga) { openAction(ga.dataset.goAction); return; }
  const gd = e.target.closest('[data-go-decision]');
  if (gd) { openDecision(gd.dataset.goDecision); return; }
  const row = e.target.closest('tr[data-issue]');
  if (row) { openIssue(row.dataset.issue); return; }
  const overBtn = e.target.closest('#btnOverdue');
  if (overBtn) { actionFilter.over = !actionFilter.over; route(); return; }
  const expJ = e.target.closest('#btnExportJson');
  if (expJ) { download('Consulting_PMS_Backup_' + TODAY + '.json', JSON.stringify(DB, null, 2), 'application/json'); toast('JSON 已导出'); return; }
  const expC = e.target.closest('#btnExportCsv,#btnExportCsv2');
  if (expC) { exportCSV(); return; }
  const imp = e.target.closest('#btnImport');
  if (imp) { $('#fileInput').click(); return; }
  const rst = e.target.closest('#btnReset');
  if (rst) { if (confirm('确认清空全部数据？问题、行动、决策、日报与 KPI 数值将被删除，且不可撤销。')) { DB = seedDB(); saveDB(); route(); toast('已清空'); } return; }
  const pr = e.target.closest('#btnPrint');
  if (pr) { window.print(); return; }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'fws') {
    if (currentPage === 'issues') { issueFilter.ws = e.target.value; route(); }
    else if (currentPage === 'reports') { reportFilter = e.target.value; route(); }
    else if (currentPage === 'knowledge') { knowFilter = e.target.value; route(); }
  }
  if (currentPage === 'issues' && e.target.id === 'fst') { issueFilter.status = e.target.value; route(); }
  if (currentPage === 'issues' && e.target.id === 'fpr') { issueFilter.prio = e.target.value; route(); }
  if (currentPage === 'actions' && e.target.id === 'fst') { actionFilter.status = e.target.value; route(); }
  if (e.target.id === 'fileInput' && e.target.files[0]) {
    const f = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.issues || !data.actions) throw new Error('格式不符');
        DB = data; saveDB(); route(); toast('数据已导入');
      } catch (err) { toast('导入失败：文件不是有效的系统备份'); }
    };
    reader.readAsText(f);
  }
});

let searchTimer;
document.addEventListener('input', (e) => {
  if (e.target.id === 'globalSearch') {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => {
      if (q) { $('#content').innerHTML = renderSearch(q); }
      else route();
    }, 220);
  }
  if (e.target.id === 'fq') {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => {
      if (currentPage === 'issues') { issueFilter.q = v; route(); $('#fq').focus(); }
      if (currentPage === 'actions') { actionFilter.q = v; route(); $('#fq').focus(); }
    }, 260);
  }
});

$('#topDate').textContent = TODAY;
window.addEventListener('hashchange', route);
window.addEventListener('i18n:change', () => route());
saveDB();
route();


/* ---------------- language-aware avatar initial ---------------- */
function avatarInitial(t) {
  if (typeof I18N_LANG !== 'undefined' && I18N_LANG === 'en') {
    return String(t.en || '').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
  }
  return t.name.slice(0, 1);
}

/* ---------------- KPI inline editing ---------------- */
document.addEventListener('change', (e) => {
  const id = e.target.dataset && e.target.dataset.kpiId;
  if (!id) return;
  const k = DB.kpis.find(x => String(x.id) === id);
  if (k) { k[e.target.dataset.kpiKey] = e.target.value; saveDB(); route(); toast('KPI 已更新'); }
});
