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
// Canonical Chinese labels for the 7 workstreams (shared by intake and display).
const WORKSTREAM_CN = {
  'Electrode Process': '电极工艺',
  'Electrode Equipment': '电极设备',
  'Stacking Process': '叠片工艺',
  'Stacking Equipment': '叠片设备',
  'Cell Assembly Process': '电芯装配工艺',
  'Cell Assembly Equipment': '电芯装配设备',
  'Other': '其他'
};

const IMPACT_AREAS = ['Safety', 'Quality', 'Output', 'Cost', 'Delivery', 'Equipment', 'Other'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const ROOT_CAUSE_STATUS = ['Not Started', 'In Progress', 'Confirmed', 'Not Confirmed', 'Not Applicable'];
const ISSUE_STATUSES = ['Open', 'Analysis', 'Solution Proposed', 'Client Approval', 'Implementation', 'Verification', 'Closed', 'On Hold'];
const ESCALATIONS = ['L1', 'L2', 'L3'];
const ACTION_TYPES = ['Process', 'Equipment', 'Quality', 'Data', 'Training', 'SOP', 'Other'];
const ACTION_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Pending Verification', 'Closed', 'On Hold'];
const APPROVAL_STATUSES = ['Draft', 'Under Technical Review', 'Recommended', 'Pending Client Approval', 'Approved', 'Rejected', 'Deferred', 'Closed'];

// Toolkit 01_RACI — 17 activities x 7 roles (Chinese source + professional EN snapshot)
const RACI_ROLES = [
  { key: 'tm', label: '技术经理', cn: '技术经理', en: 'Technical Manager', loc: '远程', enLoc: 'Remote' },
  { key: 'pm', label: '项目经理', cn: '项目经理', en: 'Project Manager', loc: '远程/现场', enLoc: 'Remote / On-site' },
  { key: 'wl', label: '专业组长', cn: '专业组长', en: 'Workstream Leader', loc: '现场', enLoc: 'On-site' },
  { key: 'ce', label: '咨询工程师', cn: '咨询工程师', en: 'Consulting Engineer', loc: '现场', enLoc: 'On-site' },
  { key: 'cpo', label: '客户生产负责人', cn: '客户生产负责人', en: 'Client Production Owner', loc: '客户', enLoc: 'Client' },
  { key: 'cqe', label: '客户质量/EHS/工程', cn: '客户质量/EHS/工程', en: 'Client Quality / EHS / Engineering', loc: '客户', enLoc: 'Client' },
  { key: 'cps', label: '客户项目发起人', cn: '客户项目发起人', en: 'Client Project Sponsor', loc: '客户', enLoc: 'Client' }
];

// [中文活动, 英文活动, ...7 个角色的 RACI 分配]
const RACI_MATRIX = [
  ['项目目标、范围与成功标准', 'Project objectives, scope and success criteria', 'A', 'R', 'C', 'I', 'C', 'C', 'I'],
  ['日常工作计划与资源协调', 'Daily work planning and resource coordination', 'I', 'A', 'R', 'C', 'I', 'I', 'I'],
  ['现场观察与数据采集', 'On-site observation and data collection', 'I', 'C', 'A', 'R', 'I', 'I', 'I'],
  ['问题陈述与证据验证', 'Problem statement and evidence validation', 'C', 'I', 'A', 'R', 'C', 'C', 'I'],
  ['根因分析', 'Root-cause analysis', 'A', 'I', 'C', 'R', 'C', 'C', 'I'],
  ['改进方案 / 技术建议', 'Improvement concept / technical recommendation', 'A', 'C', 'R', 'R', 'C', 'C', 'I'],
  ['跨工序 / 高影响方案的技术评审', 'Technical review of cross-process / high-impact solution', 'A', 'C', 'C', 'R', 'I', 'C', 'I'],
  ['客户审批 / 变更管理', 'Client approval / Management of Change', 'C', 'I', 'I', 'C', 'R', 'C', 'A'],
  ['试产计划与风险评估', 'Production trial planning and risk assessment', 'C', 'I', 'C', 'R', 'A', 'C', 'I'],
  ['工序 / 设备变更执行', 'Execution of process / equipment change', 'I', 'I', 'I', 'C', 'A', 'C', 'I'],
  ['试产期间的生产监控', 'Production monitoring during trial', 'I', 'I', 'C', 'R', 'A', 'C', 'I'],
  ['结果相对基线的验证', 'Result verification against baseline', 'C', 'I', 'C', 'R', 'A', 'R', 'I'],
  ['更新 SOP / 控制计划 / 参数标准', 'Update SOP / control plan / parameter standard', 'C', 'I', 'I', 'C', 'A', 'R', 'I'],
  ['安全或关键质量风险升级', 'Escalation of safety or critical quality risk', 'A', 'R', 'C', 'C', 'R', 'C', 'I'],
  ['周度 KPI 与项目状态报告', 'Weekly KPI and project status reporting', 'A', 'R', 'C', 'C', 'I', 'I', 'I'],
  ['客户指导委员会与范围决策', 'Customer steering committee and scope decisions', 'C', 'R', 'I', 'I', 'C', 'C', 'A'],
  ['技术决策日志与知识沉淀', 'Technical decision log and knowledge capture', 'A', 'C', 'C', 'R', 'I', 'C', 'I']
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

// 06_KPI Dashboard — 12 KPI definitions mapped 1:1 from the toolkit.
// Chinese source + professional EN snapshot; `cat` stays a stable grouping key.
// Baseline / Target / Actual are intentionally blank: enter the client's real figures.
const KPI_CATS = [
  { key: 'Production', zh: '生产', en: 'Production' },
  { key: 'Quality', zh: '质量', en: 'Quality' },
  { key: 'Improvement', zh: '改进', en: 'Improvement' },
  { key: 'Project', zh: '项目', en: 'Project' }
];

const KPI_DEFS = [
  { id: 1, cat: 'Production', name: '日合格产出', enName: 'Daily Output', def: '当日生产并检验合格的电芯数量', enDef: 'Good cells produced per day', unit: '电芯/天', enUnit: 'cells/day', owner: '客户生产', enOwner: 'Client Production', baseline: '', target: '', actual: '' },
  { id: 2, cat: 'Production', name: '设备综合效率 OEE', enName: 'OEE', def: '时间开动率 × 性能开动率 × 良品率；采用现场定义', enDef: 'Availability × Performance × Quality; use site definition', unit: '%', enUnit: '%', owner: '客户生产', enOwner: 'Client Production', baseline: '', target: '', actual: '' },
  { id: 3, cat: 'Production', name: '非计划停机', enName: 'Unplanned Downtime', def: '报告周期内的非计划停机时长', enDef: 'Unplanned downtime during reporting period', unit: '小时', enUnit: 'hours', owner: '客户设备', enOwner: 'Client Equipment', baseline: '', target: '', actual: '' },
  { id: 4, cat: 'Quality', name: '首次通过率 FPY', enName: 'FPY', def: '一次检验合格数 / 总加工数', enDef: 'First-pass accepted units / total units processed', unit: '%', enUnit: '%', owner: '客户质量', enOwner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 5, cat: 'Quality', name: '报废率', enName: 'Scrap Rate', def: '报废数 / 总加工数', enDef: 'Scrapped units / total units processed', unit: '%', enUnit: '%', owner: '客户质量', enOwner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 6, cat: 'Quality', name: '关键缺陷率', enName: 'Critical Defect Rate', def: '关键缺陷数 / 总检验数', enDef: 'Critical defects / total units inspected', unit: '%', enUnit: '%', owner: '客户质量', enOwner: 'Client Quality', baseline: '', target: '', actual: '' },
  { id: 7, cat: 'Improvement', name: '到期行动数', enName: 'Actions Due', def: '到期日落在本报告周期内的行动数量', enDef: 'Number of actions with due date in reporting period', unit: '项', enUnit: 'count', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' },
  { id: 8, cat: 'Improvement', name: '关闭并验证行动数', enName: 'Actions Closed & Verified', def: '具备验证证据的已关闭行动数量', enDef: 'Actions closed with verification evidence', unit: '项', enUnit: 'count', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' },
  { id: 9, cat: 'Improvement', name: '行动关闭率', enName: 'Action Closure Rate', def: '已关闭并验证行动数 / 到期行动数', enDef: 'Closed & verified actions / actions due', unit: '%', enUnit: '%', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' },
  { id: 10, cat: 'Improvement', name: '超期行动', enName: 'Overdue Actions', def: '超过到期日仍未关闭的行动数量', enDef: 'Open actions past due date', unit: '项', enUnit: 'count', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' },
  { id: 11, cat: 'Project', name: '里程碑达成率', enName: 'Milestone Achievement', def: '按计划或提前完成的里程碑数 / 应完成里程碑数', enDef: 'Milestones completed on or before plan / milestones due', unit: '%', enUnit: '%', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' },
  { id: 12, cat: 'Project', name: '未关闭关键/高优先级问题', enName: 'Open Critical / High Issues', def: '处于未关闭状态的关键及高优先级问题数量', enDef: 'Open critical and high priority issues', unit: '项', enUnit: 'count', owner: '项目经理', enOwner: 'PM', baseline: '', target: '', actual: '' }
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
