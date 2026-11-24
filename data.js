/* ============================================================
   Reference data & seed — mapped 1:1 from the uploaded toolkit
   Project_Management_Toolkit_Battery_Consulting.xlsx
   ============================================================ */

const WORKSTREAMS = [
  'Electrode Process', 'Electrode Equipment',
  'Stacking Process', 'Stacking Equipment',
  'Cell Assembly Process', 'Cell Assembly Equipment',
  'Other'
];

const IMPACT_AREAS = ['Safety', 'Quality', 'Output', 'Cost', 'Delivery', 'Equipment', 'Other'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const ROOT_CAUSE_STATUS = ['Not Started', 'In Progress', 'Confirmed', 'Not Confirmed', 'Not Applicable'];
const ISSUE_STATUSES = ['Open', 'Analysis', 'Solution Proposed', 'Client Approval', 'Implementation', 'Verification', 'Closed', 'On Hold'];
const ESCALATIONS = ['L1', 'L2', 'L3'];
const ACTION_TYPES = ['Process', 'Equipment', 'Quality', 'Data', 'Training', 'SOP', 'Other'];
const ACTION_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Pending Verification', 'Closed', 'On Hold'];
const APPROVAL_STATUSES = ['Draft', 'Under Technical Review', 'Recommended', 'Pending Client Approval', 'Approved', 'Rejected', 'Deferred', 'Closed'];

// Toolkit 01_RACI — 17 activities x 7 roles
const RACI_ROLES = [
  { key: 'tm', label: 'Technical Manager', cn: '技术经理', loc: '远程' },
  { key: 'pm', label: 'Project Manager', cn: '项目经理', loc: '远程/现场' },
  { key: 'wl', label: 'Workstream Leader', cn: '专业组长', loc: '现场' },
  { key: 'ce', label: 'Consulting Engineer', cn: '咨询工程师', loc: '现场' },
  { key: 'cpo', label: 'Client Production Owner', cn: '客户生产负责人', loc: '客户' },
  { key: 'cqe', label: 'Client Quality / EHS / Eng.', cn: '客户质量/EHS/工程', loc: '客户' },
  { key: 'cps', label: 'Client Project Sponsor', cn: '客户项目发起人', loc: '客户' }
];

const RACI_MATRIX = [
  ['Project objectives, scope and success criteria', 'A', 'R', 'C', 'I', 'C', 'C', 'I'],
  ['Daily work planning and resource coordination', 'I', 'A', 'R', 'C', 'I', 'I', 'I'],
  ['On-site observation and data collection', 'I', 'C', 'A', 'R', 'I', 'I', 'I'],
  ['Problem statement and evidence validation', 'C', 'I', 'A', 'R', 'C', 'C', 'I'],
  ['Root-cause analysis', 'A', 'I', 'C', 'R', 'C', 'C', 'I'],
  ['Improvement concept / technical recommendation', 'A', 'C', 'R', 'R', 'C', 'C', 'I'],
  ['Technical review of cross-process / high-impact solution', 'A', 'C', 'C', 'R', 'I', 'C', 'I'],
  ['Client approval / Management of Change', 'C', 'I', 'I', 'C', 'R', 'C', 'A'],
  ['Production trial planning and risk assessment', 'C', 'I', 'C', 'R', 'A', 'C', 'I'],
  ['Execution of process / equipment change', 'I', 'I', 'I', 'C', 'A', 'C', 'I'],
  ['Production monitoring during trial', 'I', 'I', 'C', 'R', 'A', 'C', 'I'],
  ['Result verification against baseline', 'C', 'I', 'C', 'R', 'A', 'R', 'I'],
  ['Update SOP / control plan / parameter standard', 'C', 'I', 'I', 'C', 'A', 'R', 'I'],
  ['Escalation of safety or critical quality risk', 'A', 'R', 'C', 'C', 'R', 'C', 'I'],
  ['Weekly KPI and project status reporting', 'A', 'R', 'C', 'C', 'I', 'I', 'I'],
  ['Customer steering committee and scope decisions', 'C', 'R', 'I', 'I', 'C', 'C', 'A'],
  ['Technical decision log and knowledge capture', 'A', 'C', 'C', 'R', 'I', 'C', 'I']
];
const TEAM = [
  { id: 'T01', name: '技术经理', en: 'Technical Manager', area: '治理 / 决策', role: 'Accountable', site: '远程', count: 1, duty: '技术治理、闸门审批、L2/L3升级、周评审主持' },
  { id: 'T02', name: '客户经理', en: 'Customer Manager', area: '商务接口', role: 'Consulted', site: '远程/现场', count: 1, duty: '客户关系、商务边界、签证合规、合同变更' },
  { id: 'T03', name: '项目经理', en: 'Project Manager', area: '项目协调', role: 'Responsible', site: '双地', count: 1, duty: '计划、行动跟踪、会议节奏、周报与KPI' },
  { id: 'T04', name: '电极工艺工程师', en: 'Electrode Process Engineer', area: '电极制造', role: 'Responsible', site: '现场', count: 2, duty: '涂布/辊压/分切工艺诊断、参数验证' },
  { id: 'T05', name: '电极设备技师', en: 'Electrode Equipment Technician', area: '电极制造', role: 'Responsible', site: '现场', count: 2, duty: '设备状态、机械/电气异常、点检数据' },
  { id: 'T06', name: '叠片设备工程师', en: 'Stacking Equipment Engineer', area: '#1 叠片', role: 'Responsible', site: '现场', count: 1, duty: '叠片机对齐度、隔膜张力、设备节拍' },
  { id: 'T07', name: '叠片工艺工程师', en: 'Stacking Process Engineer', area: '#1 叠片', role: 'Responsible', site: '现场', count: 1, duty: '叠片工艺窗口、极片/隔膜来料影响' },
  { id: 'T08', name: '装配设备工程师', en: 'Assembly Equipment Engineer', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '装配线设备联调、节拍与故障分析' },
  { id: 'T09', name: '装配工艺工程师', en: 'Assembly Process Engineer', area: '#2 装配', role: 'Responsible', site: '现场', count: 2, duty: '装配工序流程、FFU/环境、入壳与封装' },
  { id: 'T10', name: '超声波焊接专家', en: 'Ultrasonic Welding Specialist', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '极耳超声焊能量/压力/时间窗口、虚焊判定' },
  { id: 'T11', name: '集流盘焊接专家', en: 'Current Collector Welding Specialist', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '集流盘焊点质量、飞溅与热影响区' },
  { id: 'T12', name: '激光顶盖焊接专家', en: 'Laser Lid Welding Specialist', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '顶盖激光焊缝、气密性、针孔缺陷' },
  { id: 'T13', name: '电芯入壳专家', en: 'Cell Insertion Specialist', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '入壳定位、壳体划伤防护、夹持治具' },
  { id: 'T14', name: '装配设备技师', en: 'Assembly Equipment Technician', area: '#2 装配', role: 'Responsible', site: '现场', count: 1, duty: '装配设备日常点检、工装夹具维护' }
];

const CONSULTING_OWNERS = [
  '电极工艺工程师A', '电极工艺工程师B', '电极设备技师A', '电极设备技师B',
  '叠片设备工程师', '叠片工艺工程师', '装配设备工程师',
  '装配工艺工程师A', '装配工艺工程师B', '超声波焊接专家',
  '集流盘焊接专家', '激光顶盖焊接专家', '电芯入壳专家', '装配设备技师',
  '项目经理', '技术经理'
];

// Client-side roles only — replace with the real names when provided by the client
const CLIENT_OWNERS = [
  '客户生产负责人', '客户质量负责人', '客户工程负责人',
  '客户设备负责人', '客户 EHS 负责人', '客户项目发起人'
];

// 06_KPI Dashboard — 12 KPI definitions from the toolkit.
// Baseline / Target / Actual are intentionally blank: enter the client's real figures.
const KPI_DEFS = [
  { id: 1, cat: 'Production', name: 'Daily Output', def: 'Good cells produced per day', unit: 'cells/day', owner: 'Client Production', baseline: '', target: '', actual: '' },
  { id: 2, cat: 'Production', name: 'OEE', def: 'Availability × Performance × Quality; use site definition', unit: '%', owner: 'Client Production', baseline: '', target: '', actual: '' },
  { id: 3, cat: 'Production', name: 'Unplanned Downtime', def: 'Unplanned downtime during reporting period', unit: 'hours', owner: 'Client Equipment', baseline: '', target: '', actual: '' },
  { id: 4, cat: 'Quality', name: 'FPY', def: 'First-pass accepted units / total units processed', unit: '%', owner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 5, cat: 'Quality', name: 'Scrap Rate', def: 'Scrapped units / total units processed', unit: '%', owner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 6, cat: 'Quality', name: 'Critical Defect Rate', def: 'Critical defects / total units inspected', unit: '%', owner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 7, cat: 'Improvement', name: 'Actions Due', def: 'Number of actions with due date in reporting period', unit: 'count', owner: 'PM', baseline: '', target: '', actual: '' },
  { id: 8, cat: 'Improvement', name: 'Actions Closed & Verified', def: 'Actions closed with verification evidence', unit: 'count', owner: 'PM', baseline: '', target: '', actual: '' },
  { id: 9, cat: 'Improvement', name: 'Action Closure Rate', def: 'Closed & verified actions / actions due', unit: '%', owner: 'PM', baseline: '', target: '', actual: '' },
  { id: 10, cat: 'Improvement', name: 'Overdue Actions', def: 'Open actions past due date', unit: 'count', owner: 'PM', baseline: '', target: '', actual: '' },
  { id: 11, cat: 'Project', name: 'Milestone Achievement', def: 'Milestones completed on or before plan / milestones due', unit: '%', owner: 'PM', baseline: '', target: '', actual: '' },
  { id: 12, cat: 'Project', name: 'Open Critical / High Issues', def: 'Open critical and high priority issues', unit: 'count', owner: 'PM', baseline: '', target: '', actual: '' }
];

const TODAY = (() => {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
})();
const d = (s) => s;

// All registers start empty — records are created through the smart intake window
// or through the individual "new entry" forms. No pre-filled demo content.
const SEED_ISSUES = [];
const SEED_ACTIONS = [];
const SEED_DECISIONS = [];
const SEED_REPORTS = [];
