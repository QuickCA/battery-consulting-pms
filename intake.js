/* ============================================================
   智能录入 / Smart Intake
   Paste a free-form description -> classify -> extract -> confirm
   -> write to Issue Log / Action Tracker / Decision Log / Daily Report
   ============================================================ */

const INTAKE_ROLES = [
  { label: '现场工程师', owner: '装配工艺工程师A', report: '装配工艺工程师A' },
  { label: '设备工程师', owner: '叠片设备工程师', report: '叠片设备工程师' },
  { label: '工艺工程师', owner: '电极工艺工程师A', report: '电极工艺工程师A' },
  { label: '焊接专家', owner: '超声波焊接专家', report: '超声波焊接专家' },
  { label: '专业组长', owner: '技术经理', report: '项目经理' },
  { label: '主管 / 经理', owner: '项目经理', report: '项目经理' }
];

let intakeItems = [];
let intakeParsed = false;

/* ---------------- text analysis ---------------- */
function intakeBlocks(text) {
  const raw = text.split(/[\n。；;！!]+/)
    .map(s => s.replace(/^\s*(?:[0-9]+|[一二三四五六七八九十]+)\s*[.、）)]\s*/, '').trim())
    .filter(s => s.length >= 5);
  // A finding followed by further "发现 / 观察 / 怀疑 …" clauses is one causal
  // chain (symptom + observation + hypothesis), not separate issues.
  // Splitting these apart is what produced two shallow, duplicated entries.
  const CONT = /^(?:发现|观察|怀疑|确认|检查|查见|看到|可见|表明|说明|推测|疑似|可能|判断|分析|测得|测量|复测|同时|另外|并且|此外|而且|其中|经查|现场发现|现场观察)/;
  const ABNORMAL = /异常|不良|缺陷|超标|偏差|超出|报警|故障|失效|断带|偏移|不一致|波动|针孔|毛刺|虚焊|漏率|卡滞|褶皱|限位/;
  const merged = [];
  raw.forEach(b => {
    const prev = merged[merged.length - 1];
    if (prev && CONT.test(b) && ABNORMAL.test(prev)) merged[merged.length - 1] = prev + '；' + b;
    else merged.push(b);
  });
  return merged.flatMap(block => {
    if (block.length < 26) return [block];
    const m = block.match(/(?:^|[，,；;])\s*(?:需要|要求|请|计划|安排|务必|建议|决定|批准|采用|推荐)/);
    if (!m || m.index < 8) return [block];
    let at = m.index;
    if (/[，,；;]/.test(m[0][0])) at += 1;
    return [block.slice(0, at), block.slice(at)].map(s => s.trim()).filter(s => s.length >= 5);
  });
}

function countHits(t, reList) {
  return reList.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
}

const INTENT_RULES = {
  issue: [
    /异常|不良|缺陷|超标|偏差|超出|虚焊|划伤|针孔|毛刺|气胀|停机|报警|故障|失效|泄漏|漏液|短路|波动|不合格|偏移|断裂|污染|破损|变形|风险|异常率|不良率/,
    /高于|低于|超过规格|不满足|不符合|失效|卡滞|褶皱|飞溅|漏率|针孔/
  ],
  action: [
    /需要|要求|请|计划|安排|务必|跟进|推进|更换|调整|优化|校准|清洗|培训|更新|执行|完成|整改|改善|实施|验证|负责|限期|落实/
  ],
  decision: [
    /决定|批准|审批|同意|否决|推荐|采用|变更|MoC|裁定|决议|方案\s*[A-D]/
  ],
  report: [
    /今日|今天|跟线|班次|产出|FPY|OEE|次日|当日|本班|观察|重点/
  ]
};

function detectKind(t) {
  if (/决定|决议|审批|采用方案|方案\s*[A-D]|MoC[-A-Za-z0-9]/i.test(t)) return 'decision';
  const defect = /发现|出现|异常|不良|缺陷|超标|偏差|虚焊|划伤|针孔|毛刺|气胀|停机|报警|故障|失效|泄漏|漏液|短路|波动|不合格|偏移|断裂|污染|破损|变形|漏率/.test(t);
  const imperative = /需要|请|计划|安排|务必|更换|校准|清洗|培训|更新|整改|落实|跟进|推进/.test(t);
  if (defect && !imperative) return 'issue';
  if (imperative && !defect) return 'action';
  const score = {
    issue: countHits(t, INTENT_RULES.issue),
    action: countHits(t, INTENT_RULES.action) * 1.1,
    decision: countHits(t, INTENT_RULES.decision) * 1.6,
    report: countHits(t, INTENT_RULES.report) * 0.7
  };
  if (/决定|批准|审批|采用方案|方案\s*[A-D]/.test(t) && score.decision >= 1.6) return 'decision';
  if (/需要|要求|请|计划|安排|更换|校准|培训/.test(t) && score.action >= 1.1) return 'action';
  if (/FPY|OEE|产出|班次|次日重点/.test(t) && score.report >= 0.7) return 'report';
  const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
  return score[best] > 0 ? best : 'issue';
}

const EQUIP_RULES = [
  { re: /顶盖激光焊|顶盖焊|顶盖焊缝|lid\s*laser|laser\s*(?:lid|cover)|顶盖气密/i, ws: 'Cell Assembly Equipment', eq: '顶盖激光焊机' },
  { re: /集流盘焊|collector[\s-]*(?:disc|plate)?[\s-]*weld/i, ws: 'Cell Assembly Equipment', eq: '集流盘焊接机' },
  { re: /超声波焊接|超声焊|极耳超声|ultrasonic|\bUSW\b/i, ws: 'Cell Assembly Equipment', eq: '超声波焊接机' },
  { re: /叠片机|叠片|stacker|stacking\s*machine/i, ws: 'Stacking Equipment', eq: '叠片机' },
  { re: /隔膜放卷|放卷张力|隔膜张力/i, ws: 'Stacking Equipment', eq: '隔膜放卷工位' },
  { re: /卷绕机|winder/i, ws: 'Stacking Equipment', eq: '卷绕机' },
  { re: /涂布机|涂布模头|涂布头|coater|coating\s*machine|coating/i, ws: 'Electrode Equipment', eq: '涂布机' },
  { re: /辊压机|辊压|压延|calender|calendering/i, ws: 'Electrode Equipment', eq: '辊压机' },
  { re: /激光模切分条一体机|模切分条一体机|激光模切|模切分条|分条一体机/i, ws: 'Electrode Equipment', eq: '激光模切分条一体机' },
  { re: /分切机|分切|slitter|slitting/i, ws: 'Electrode Equipment', eq: '分切机' },
  { re: /入壳机|入壳工位|电芯入壳|insertion|cell\s*insert/i, ws: 'Cell Assembly Equipment', eq: '电芯入壳机' },
  { re: /装配线|assembly\s*line/i, ws: 'Cell Assembly Equipment', eq: '装配线' },
  { re: /装配工序|assembly\s*process/i, ws: 'Cell Assembly Process', eq: '装配线' },
  { re: /化成柜|化成|formation/i, ws: 'Cell Assembly Equipment', eq: '化成柜' },
  { re: /注液机|注液|filling/i, ws: 'Cell Assembly Equipment', eq: '注液机' }
];
const EQUIP_INFER = [
  [/针孔|气密|氦检|漏率/, 'Cell Assembly Equipment', '顶盖激光焊机'],
  [/虚焊|拉力|焊点/, 'Cell Assembly Equipment', '超声波焊接机'],
  [/飞溅/, 'Cell Assembly Equipment', '集流盘焊接机'],
  [/毛刺/, 'Electrode Process', '分切机'],
  [/对齐度|褶皱/, 'Stacking Process', '叠片机'],
  [/划伤/, 'Cell Assembly Process', '电芯入壳机'],
  [/气胀/, 'Cell Assembly Process', '化成柜'],
  [/节拍/, 'Cell Assembly Process', '装配线'],
  [/面密度/, 'Electrode Process', '涂布机'],
  [/回弹/, 'Electrode Equipment', '辊压机']
];

function intakeMachineNo(t, idx) {
  if (idx == null) return '';
  const txt = String(t || '');
  const near = txt.slice(Math.max(0, idx - 8), idx + 80);
  const numRe = [/#\s*(\d+)/, /(\d+)\s*#(?:机|线)?/, /(?:机台|第)\s*(\d+)\s*号?/, /(\d+)\s*号(?:机|线)?/, /[Ll]ine\s*#?\s*(\d+)/];
  let m = null;
  for (const re of numRe) { m = near.match(re); if (m) break; }
  if (!m) for (const re of numRe) { m = txt.match(re); if (m) break; }
  return m ? '#' + m[1] : '';
}

function intakeIdentify(t) {
  const txt = String(t || '');
  let best = null;
  EQUIP_RULES.forEach(r => {
    const m = r.re.exec(txt);
    if (m && (!best || m.index < best.idx)) best = { ws: r.ws, eq: r.eq, idx: m.index };
  });
  if (!best) {
    for (const [re, ws, eq] of EQUIP_INFER) if (re.test(txt)) return { workstream: ws, equipment: eq };
    return { workstream: '', equipment: '' };
  }
  const no = intakeMachineNo(txt, best.idx);
  return { workstream: best.ws, equipment: polishNorm(best.eq + (no ? ' ' + no : '')) };
}
function intakeWorkstream(t) { return intakeIdentify(t).workstream; }
function intakeEquipment(t) { return intakeIdentify(t).equipment; }

function intakePriority(t) {
  if (/安全|停线|气密|氦检|漏液|短路|起火|Critical|P1|严重|关键风险/i.test(t)) return 'Critical';
  if (/High|高优先|优先级高|P2|重要/i.test(t)) return 'High';
  if (/Low|低优先|优先级低|P3/i.test(t)) return 'Low';
  return 'Medium';
}

function intakeImpact(t) {
  if (/安全|短路|漏液|气密|起火|EHS/i.test(t)) return 'Safety';
  if (/产出|节拍|产量|停机|OEE|效率|产能|cells\//i.test(t)) return 'Output';
  if (/设备|故障|报警|传感器|伺服|维修/i.test(t)) return 'Equipment';
  if (/成本|费用/i.test(t)) return 'Cost';
  if (/交付|交期|延期/i.test(t)) return 'Delivery';
  return 'Quality';
}

function intakeEscalation(t) {
  if (/L3|Sponsor|停线|安全|法规|规格变更/i.test(t)) return 'L3';
  if (/L2|升级|技术经理介入|跨工序/i.test(t)) return 'L2';
  return 'L1';
}

function pad2(n) { return String(n).padStart(2, '0'); }
function addDays(base, n) {
  const d = parseD(base) || new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function intakeDate(t, fallbackDays) {
  let m = t.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
  m = t.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m) return '2026-' + pad2(+m[1]) + '-' + pad2(+m[2]);
  if (/今天|今日/.test(t)) return TODAY;
  if (/明天|次日/.test(t)) return addDays(TODAY, 1);
  if (/后天/.test(t)) return addDays(TODAY, 2);
  if (/下周/.test(t)) return addDays(TODAY, 7);
  return addDays(TODAY, fallbackDays);
}

function intakeOwner(t, pool, fallback) {
  for (const name of pool) {
    if (t.includes(name)) return name;
    const short = name.split(' ')[0];
    if (short.length >= 3 && t.includes(short)) return name;
  }
  const m = t.match(/由([^\s，,；;。]{2,8})(?:负责|执行|跟进|牵头|主导|确认)/);
  return m ? m[1] : fallback;
}

function intakeEvidence(t) {
  return polishEvidence(t);
}

function intakeFragment(t, markers, maxLen) {
  for (const re of markers) {
    const m = t.match(re);
    if (m && m.index != null) return t.slice(m.index).slice(0, maxLen || 120);
  }
  return '';
}

/* ---------------- language polishing ----------------
   Raw sentences are never copied into a register verbatim.
   Each field is rebuilt as: object + phenomenon + measured value
   + acceptance criteria + evidence, using only facts present in the text. */
const POLISH_UNITS = '%|µm|um|mm|mΩ|mohm|s/件|ppm|MPa|°C|N|V|A|cells/day|L/min|mbar·l/s|mbar|Mm|片|卷|件|点';
const POLISH_DEFECTS = [
  '面密度横向偏差', '厚度回弹波动', '对齐度偏移', '直流电阻偏高', '氦检漏率超标',
  '漏率超标', '虚焊', '针孔', '毛刺', '气胀', '褶皱', '飞溅', '划伤', '偏移',
  '波动', '超标', '偏差', '不良', '异常', '失效', '泄漏', '漏液', '短路',
  '停机', '报警', '故障', '破损', '变形', '污染', '不合格', '卡滞',
  '虚焊率偏高', '虚焊率', '气密失效', '短路风险', '节拍', '瓶颈',
  '电阻偏高', '毛刺超标', '对齐度偏移', '厚度回弹', '褶皱', '划伤'
];
const POLISH_VERBS = '(?:更换|校准|清洗|调整|优化|培训|更新|执行|完成|整改|改善|实施|验证|重设|缩短|延长|增加|提升|降低|建立|复核|检查|安装|补充|提交|制定|改为|恢复|并行化|标准化)';

function polishNorm(s) {
  let x = String(s == null ? '' : s)
    .replace(/^[\s，,。；;：:、]+|[\s，,。；;、]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/([±+\-]?\d[\d,]*(?:\.\d+)?)\s*(mm|µm|um|mΩ|mohm|MPa|°C|N|V|A|L\/min|cells\/day|s\/件|Mm|片|卷|件|点)/gi, '$1 $2')
    .replace(/#\s+(\d)/g, '#$1')
    .replace(/\s+#(\d)/g, '#$1')
    .replace(/正负\s*/g, '±');
  return x.trim();
}
function polishEnd(s, limit) {
  let x = polishNorm(s);
  if (limit && x.length > limit) x = x.slice(0, limit) + '…';
  return x && !/[。；]$/.test(x) ? x + '。' : x;
}
function polishClauses(t) {
  return String(t || '').split(/[。；;\n]/).map(polishNorm).filter(x => x.length >= 3);
}
function polishNumbers(t) {
  const re = new RegExp('[±+\\-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?\\s*(?:' + POLISH_UNITS + ')', 'gi');
  return [...new Set((String(t || '').match(re) || []).map(polishNorm))];
}
function polishMethods(t) {
  const pats = [/CCD[^，。；]{0,24}/gi, /X-ray[^，。；]{0,24}/gi, /显微镜[^，。；]{0,20}/gi,
    /金相[^，。；]{0,20}/gi, /拉力测试[^，。；]{0,24}/gi, /氦检[^，。；]{0,28}/gi,
    /SPC[^，。；]{0,20}/gi, /面密度扫描[^，。；]{0,20}/gi, /采样[^，。；]{0,20}/gi,
    /测量记录[^，。；]{0,20}/gi];
  const tidy = x => polishNorm(x)
    .replace(/拍了|拍摄|已拍/g, m => m === '已拍' ? '已采集' : '采样')
    .replace(/扫了/g, '扫描').replace(/测了/g, '测量')
    .replace(/采样(\d)/g, '采样 $1').replace(/扫描(\d)/g, '扫描 $1')
    .replace(/显微镜[^，。；]{0,20}/g, '显微镜检查').replace(/氦检漏率[^，。；]{0,28}/g, '氦检')
    .replace(/确认确认/g, '确认');
  const out = [];
  pats.forEach(re => { (String(t || '').match(re) || []).forEach(m => { const v = tidy(m); if (v && !out.includes(v)) out.push(v); }); });
  return out.filter((v, i) => !out.some((o, j) => j !== i && o.length > v.length && o.includes(v)));
}
function polishEvidence(t) {
  return [...new Set([...polishMethods(t), ...polishNumbers(t)])].join('；');
}
function polishSpec(t) {
  const parts = String(t || '').split(/[。；;\n，,]/);
  const p = parts.find(x => /规格|标准|判据|要求|目标|上限|下限|工艺窗口|超过|高于|低于|达不到/.test(x)) || String(t || '');
  let m = p.match(/(?:规格(?:要求)?|标准|判据|要求|目标|上限|下限|工艺窗口)\s*([^，。；;]{1,28})/);
  if (!m) m = p.match(/(?:超过|高于|低于)\s*([±+\-]?\d[\d,]*(?:\.\d+)?\s*(?:[a-zA-Zµ°·/]*\d*[a-zA-Zµ°·/]*|\S{0,8}))/i);
  if (!m) m = p.match(new RegExp('[≤≥±]\\s*\\d+(?:\\.\\d+)?\\s*(?:' + POLISH_UNITS + ')', 'i'));
  if (!m) return { value: '', cmp: '' };
  const value = polishNorm(m[1]);
  let cmp = /目标/.test(p) ? '未达目标' : /工艺窗口/.test(p) ? '超出工艺窗口'
    : /超过|高于|上限|≤/.test(p) ? '超出规格上限'
    : /低于|下限|≥/.test(p) ? '低于规格下限'
    : /±/.test(value) ? '超出公差范围' : '不满足规格要求';
  return { value, cmp };
}
function polishEquipment(t) {
  return intakeIdentify(t).equipment;
}
function polishDefect(t) {
  const txt = polishRough(t)
    .replace(/有点高/g, '偏高').replace(/有点低/g, '偏低')
    .replace(/有点偏|偏了/g, '偏移').replace(/不严/g, '不达标')
    .replace(/坏了/g, '失效').replace(/漏了/g, '泄漏');
  const hit = POLISH_DEFECTS.slice().sort((a, b) => b.length - a.length).find(x => txt.includes(x));
  if (!hit) return '';
  const idx = txt.indexOf(hit);
  const before = txt.slice(Math.max(0, idx - 14), idx);
  const noun = (before.match(/[\u4e00-\u9fa5A-Za-z]{1,10}$/) || [''])[0]
    .replace(/^(?:发现|出现|存在|发生|确认|跟线|今天|今日)\s*/, '')
    .replace(/有$/, '').replace(/^[的,，\s]+/, '');
  return polishNorm(noun + hit) || hit;
}
function polishRough(s) {
  return String(s || '')
    .replace(/好像|似乎|感觉|估计|据说|听说/g, '疑似')
    .replace(/大概|约莫/g, '约')
    .replace(/就是|然后|这个|那个|有些|比较|嗯|啊/g, '')
    .replace(/有点偏|偏了/g, '偏移')
    .replace(/有点高/g, '偏高')
    .replace(/有点低/g, '偏低')
    .replace(/太高|过大|过多/g, '偏高')
    .replace(/太低|过小|过少/g, '偏低')
    .replace(/不好|不对劲/g, '异常')
    .replace(/很多|好多/g, '较多')
    .replace(/^[的了]\s*/, '');
}
/* ---------- professional problem statement helpers (8D D2 / 5W2H) ---------- */
const POLISH_WS_CN = WORKSTREAM_CN;
const POLISH_PHENOMENA = [
  [/CCD边缘识别异常|CCD抓边|抓边/, 'CCD边缘识别异常'],
  [/极片边缘波浪|陶瓷边区域波浪边|陶瓷边波浪边|波浪边|边浪/, '极片边缘波浪'],
  [/对齐度偏移|对齐不良|对齐超差/, '极片对齐度偏移'],
  [/顶盖焊缝针孔|焊缝针孔|密封焊针孔|针孔/, '顶盖密封焊缝针孔'],
  [/虚焊率偏高|虚焊率|虚焊/, '焊点虚焊'],
  [/拉力偏低|拉力不足|焊点拉力/, '极耳焊点拉力不足'],
  [/毛刺超标|毛刺/, '极片切边毛刺'],
  [/面密度(?:横向)?偏差|面密度不均/, '涂层面密度偏差'],
  [/厚度回弹波动|厚度回弹|回弹/, '辊压后厚度回弹'],
  [/漏率超标|氦检漏率|气密失效|气密不良|气密异常/, '电芯气密漏率超标'],
  [/气胀/, '电芯气胀'],
  [/纠偏.*(?:限位|断带)|(?:单向|一直向一个方向|向一个方向)纠偏|张紧不一致|左右.*张紧|极片断带|断带/, '纠偏单向到底导致极片断带'],
  [/褶皱/, '极片褶皱'],
  [/飞溅/, '焊接飞溅'],
  [/划伤/, '外观划伤'],
  [/短路风险/, '内部短路风险'],
  [/漏液|电解液泄漏/, '电解液泄漏'],
  [/停机/, '设备停机'],
  [/报警/, '设备报警'],
  [/卡滞/, '设备卡滞']
];

function polishPhenomenon(defect, eq) {
  if (!defect) return '';
  for (const pair of POLISH_PHENOMENA) {
    if (!pair[0].test(defect)) continue;
    const phrase = pair[1];
    if (phrase === '顶盖密封焊缝针孔' && !/顶盖|lid|激光焊/i.test(eq)) return '焊缝针孔';
    if (phrase === '极片切边毛刺' && !/分切|涂布|辊压/i.test(eq)) return '毛刺超标';
    if (phrase === '极片对齐度偏移' && !/叠片|卷绕|stacker/i.test(eq)) return '对齐度偏移';
    if (phrase === '极耳焊点拉力不足' && !/超声|USW/i.test(eq)) return '焊点拉力不足';
    return phrase;
  }
  return defect;
}
function polishWsCn(ws) { return POLISH_WS_CN[ws] || ws || ''; }
function polishNum(v) {
  const m = String(v == null ? '' : v).match(/[±+\-]?\s*(\d[\d,]*(?:\.\d+)?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}
function polishUnit(v) {
  const m = String(v == null ? '' : v).match(/(mbar·l\/s|mbar|cells\/day|L\/min|µm|um|mm|mΩ|mohm|MPa|°C|s\/件|%|N|V|A)/i);
  return m ? m[1] : '';
}
function trimNum(n) { return String(Math.round(n * 100) / 100); }
function polishDeviation(meas, spec, cmp) {
  const a = polishNum(meas), b = polishNum(spec);
  if (a == null || b == null || b === 0) return '';
  let d = 0, label = '';
  if (/公差/.test(cmp)) { d = Math.abs(a) - b; label = '公差带超差'; }
  else if (/上限/.test(cmp)) { d = a - b; label = '超上限幅度'; }
  else if (/下限/.test(cmp)) { d = b - a; label = '低于下限幅度'; }
  else if (/目标/.test(cmp)) { d = Math.abs(a - b); label = '目标缺口'; }
  else if (/窗口/.test(cmp)) { d = Math.abs(a) - b; label = '越窗幅度'; }
  else { d = Math.abs(a) - b; label = '偏差量'; }
  if (!(d > 0)) return '';
  const unit = polishUnit(spec) || polishUnit(meas);
  const u = unit === '%' ? '个百分点' : unit;
  const pct = Math.round(d / b * 100);
  return label + ' ' + trimNum(d) + (u ? ' ' + u : '') + '（相对偏差 ' + pct + '%）';
}
function polishWhen(t) {
  const bits = [];
  let m = t.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) bits.push(m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]));
  else {
    m = t.match(/(\d{1,2})月(\d{1,2})[日号]/);
    if (m) bits.push('2026-' + pad2(+m[1]) + '-' + pad2(+m[2]));
    else if (/今天|今日|本班/.test(t)) bits.push(TODAY);
    else if (/昨天/.test(t)) bits.push(addDays(TODAY, -1));
  }
  const shift = (t.match(/Shift\s*[A-D]/i) || t.match(/[A-D]\s*班/) || t.match(/白班|夜班|中班|早班|晚班/) || [''])[0];
  if (shift) bits.push(polishNorm(shift));
  const tm = t.match(/\d{1,2}:\d{2}|\d{1,2}\s*点(?:\d{1,2}\s*分)?/);
  if (tm) bits.push(tm[0].replace(/\s/g, ''));
  const dur = t.match(/连续\s*\d+\s*(?:片|天|班|小时|h)/i);
  if (dur) bits.push(polishNorm(dur[0]));
  return bits.join(' ');
}
function polishSampleInfo(t) {
  const m = String(t || '').match(/(?:采样|抽检|抽查|抽样|抽验|测了|拍了|拍摄|测量|检测|取样|核对|复核)\s*(\d[\d,]*)\s*(片|点|支|卷|件|个|次|只)?/i)
    || String(t || '').match(/(\d[\d,]*)\s*(片|点|支|卷|件|个|次|只)\s*(?:样品|样本|电芯)?/);
  if (!m) return '';
  const num = polishNorm(m[1]);
  const unit = m[2] ? ' ' + m[2] : '';
  return /(?:采样|抽检|抽查|抽样|抽验|测了|拍了|拍摄|测量|检测|取样|核对|复核)/.test(m[0]) ? '抽样 ' + num + unit : num + unit;
}
function polishProdContext(t) {
  const txt = String(t || '');
  const bits = [];
  let m = txt.match(/产出\s*([\d,]+)\s*cells\/day/i); if (m) bits.push('产出 ' + m[1] + ' cells/day');
  m = txt.match(/FPY\s*(\d+(?:\.\d+)?)\s*%/i); if (m) bits.push('FPY ' + m[1] + '%');
  m = txt.match(/OEE\s*(\d+(?:\.\d+)?)\s*%/i); if (m) bits.push('OEE ' + m[1] + '%');
  return bits;
}
function polishDefectRate(t) {
  const txt = String(t || '');
  const m = txt.match(/不良率\s*(?:约|达|为)?\s*(\d+(?:\.\d+)?)\s*%/)
    || txt.match(/(?:不良|缺陷|异常)率\s*(?:约|达|为)?\s*(\d+(?:\.\d+)?)\s*%/)
    || txt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:不良|不良率|缺陷率)/)
    || txt.match(/不良\s*(\d+(?:\.\d+)?)\s*(?:片|支|个|件)/);
  return m ? m[1] + (/%/.test(m[0]) ? '%' : '') : '';
}
function polishLocation(t) {
  const m = String(t || '').match(/(?:位置|部位|缺陷位置|发生位置)\s*(?:在|为|：|:)?\s*([^，。；;]{2,24})/);
  return m ? polishNorm(m[1]) : '';
}
function polishBatchInfo(t) {
  const m = String(t || '').match(/(?:批次|批号|LOT\s*#?|Lot\s*No\.?)\s*[:：]?\s*([A-Za-z0-9\-_/]{3,20})/i);
  return m ? polishNorm(m[1]) : '';
}
function polishEvidenceFull(t, base) {
  const bits = [];
  const methods = polishMethods(t);
  const sample = polishSampleInfo(t);
  const rate = polishDefectRate(t);
  const batch = polishBatchInfo(t);
  const sampleCore = sample ? sample.replace(/^抽样\s*/, '') : '';
  const baseStr = String(base || '');
  if (base) {
    baseStr.split('；').forEach(x => {
      if (!x) return;
      if (sampleCore && x === sampleCore && !/^[A-Za-z\u4e00-\u9fa5]/.test(x)) return;
      bits.push(x);
    });
  }
  if (sample && !baseStr.includes(sampleCore)) bits.push(/^抽样/.test(sample) ? sample : '抽样 ' + sample);
  if (rate) bits.push('不良率 ' + rate);
  if (batch) bits.push('批次 ' + batch);
  return bits.join('；');
}

/* ---------- technical deep-analysis knowledge base ----------
   Mechanism directions and downstream impact chains are HYPOTHESES derived
   from battery manufacturing practice. They are always labelled as inference
   and never presented as confirmed facts. No numeric value is invented. */
const POLISH_DEEP_KB = [
  {
    re: /抓边|波浪边|陶瓷边|边缘识别异常/i,
    mechanism: ['辊压过渡拉伸使极片陶瓷边区域产生波浪边，边缘轮廓失真导致 CCD 抓边失效', '来料极片陶瓷边涂覆宽度或边界波动', 'CCD 边缘识别算法阈值或光源角度漂移', '叠片机放片张力或吸盘取片位置偏移'],
    chain: '陶瓷边区域波浪边导致 CCD 抓边识别失败或边缘基准漂移，直接影响叠片对齐精度与极耳位置一致性，并向下传递至超声波焊接极耳定位与入壳间隙控制；若持续存在，可能压缩电芯内部安全间隙、增大内部短路风险并造成卷芯厚度一致性下降与 FPY 损失',
    verify: ['陶瓷边区域边缘轮廓与波浪度实测（边缘直线度 / 波纹幅值）', '辊压延伸率与辊缝 / 张力参数记录', 'CCD 边缘识别阈值、光源与标定校验记录', '来料极片陶瓷边涂覆宽度与边缘位置 Cpk']
  },
  {
    re: /对齐|叠片|stacker/i,
    mechanism: ['定位销 / 限位挡块磨损或松动导致极片基准偏移', 'CCD 视觉标定漂移或标定片超期', '来料极片裁切尺寸与边缘位置波动', '吸盘真空不足导致取片偏位'],
    chain: '叠片对齐度超差会改变极耳位置一致性，向下传递至超声波焊接的极耳定位与装配入壳间隙控制；若偏差持续存在，可能压缩电芯内部安全间隙并增大内部短路风险，同时造成卷芯厚度一致性下降与后续 FPY 损失',
    verify: ['定位销磨损量及更换记录', 'CCD 标定有效期与标定片复测结果', '来料极片边缘位置 Cpk', '连续对齐度趋势图（SPC）']
  },
  {
    re: /针孔|气密|漏率|氦检|lid|顶盖/i,
    mechanism: ['焊接功率 / 速度 / 离焦量偏离工艺窗口', '焊缝坡口氧化层或残液导致清洁度不足', '工装压紧力不足形成局部间隙', '保护气流量或纯度不足', '焊材污染'],
    chain: '顶盖密封焊缝针孔将直接造成氦检漏率超标，进一步引发电解液泄漏与外界水汽侵入，导致电芯气胀、容量衰减，并构成热失控安全风险；客户端需执行隔离、复检与可能的批次报废',
    verify: ['焊缝金相切片（针孔深度与形貌）', '焊接参数记录与工艺窗口比对', '焊缝清洁度与工装压紧力点检记录', '氦检复测与漏点定位结果']
  },
  {
    re: /虚焊|拉力|焊点|超声|USW|tab/i,
    mechanism: ['超声焊头 / 砧座磨损导致能量传递衰减', '焊接能量 / 压力 / 时间参数漂移', '极耳表面氧化或污染', '来料极耳镀层厚度波动'],
    chain: '焊点拉力不足会导致接触电阻升高，在大电流充放电时局部发热，进而引发焊点熔断或开路、容量衰减与安全隐患；下游入壳工序中焊点受力还存在开裂风险',
    verify: ['拉力测试分布与破坏模式（界面剥离 / 母材撕裂）', '焊头磨损与振幅校准记录', '极耳表面氧化与镀层检测', '焊接参数 SPC 趋势']
  },
  {
    re: /面密度|涂布|coating/i,
    mechanism: ['模头间隙或唇口磨损', '浆料粘度 / 固含量波动', '涂布速度与供料泵速匹配偏差', '烘箱温度曲线不均'],
    chain: '涂层面密度偏差会传导为辊压后厚度与压实密度波动，造成电芯容量一致性下降与容量极差扩大；局部面密度过低区域在循环中存在析锂风险',
    verify: ['面密度横向 / 纵向扫描图谱', '浆料粘度与固含量检测记录', '模头间隙实测与涂布速度匹配性', '对应位置辊压后厚度比对']
  },
  {
    re: /回弹|辊压|calender/i,
    mechanism: ['辊缝设定漂移', '辊压力与辊速匹配偏差', '极片压实密度超限引发弹性回复', '来料面密度波动'],
    chain: '厚度回弹会造成叠片后卷芯厚度超差，影响入壳间隙并可能引起壳体鼓胀与装配应力异常，同时降低电芯容量一致性',
    verify: ['辊缝实际值与设定值比对', '辊压力与辊速记录', '压实密度测试结果', '回弹量与放置时间关系曲线']
  },
  {
    re: /纠偏|张紧不一致|一边紧.*一边松|断带|模切分条|料区延展|主驱辊/i,
    mechanism: ['极片料区延展不一致导致分切前左右张力失衡，纠偏系统持续向单一方向纠偏直至触发限位', '主驱辊水平度偏差（辊面不平行）造成左右极片张紧不一致，形成稳定的跑偏驱动力', '纠偏传感器零点 / 量程漂移或纠偏辊响应滞后', '分切前各段张力设定与锥度控制不匹配，来料卷径 / 端面不齐'],
    chain: '分切前左右极片张紧不一致使纠偏系统持续单向纠偏，达到限位后极片失稳断带，直接造成产线停机与在制品报废；若未及时纠正，分切后极片宽度与边缘位置一致性下降，向下传递至叠片对齐与极耳位置控制，影响电芯容量一致性与内部安全间隙，并带来 FPY 损失',
    verify: ['纠偏过辊左右侧极片张力实测与张力传感器校验', '主驱辊水平度 / 辊面平行度与跳动检测', '极片料区纵向 / 横向延展率与厚度分布测量', '分切前各段张力设定、锥度参数与纠偏响应记录']
  },
  {
    re: /毛刺|分切|slitter/i,
    mechanism: ['分切刀具磨损或刀缝间隙不当', '分切速度与张力匹配偏差', '来料厚度波动'],
    chain: '极片切边毛刺可能刺穿隔膜形成内部微短路，造成自放电率升高与热失控风险，并干扰叠片边缘对齐与隔膜覆盖',
    verify: ['毛刺高度与数量的金相测量', '刀具磨损与更换记录', '分切张力与速度参数', '隔膜穿刺测试结果']
  },
  {
    re: /划伤|入壳|insertion/i,
    mechanism: ['入壳工装 / 导向面毛刺或磨损', '电芯与壳体定位偏差导致刮擦', '壳体来料边缘毛刺', '搬运器具接触'],
    chain: '壳体或电芯外观划伤除造成外观判退外，还可能损伤绝缘层并形成局部应力集中，长期循环中存在壳体腐蚀与漏液风险',
    verify: ['划伤位置分布与工装接触点比对', '导向面 / 夹具毛刺点检', '壳体来料外观抽检', '入壳定位精度复测']
  },
  {
    re: /气胀|化成|formation/i,
    mechanism: ['化成产气异常（SEI 膜不稳定）', '注液量不足或分布不均', '水分超标引发副反应', '化成温度 / 电流曲线偏离'],
    chain: '电芯气胀会导致壳体变形与气密风险，伴随容量衰减和循环寿命下降，严重时构成安全风险并影响客户端装配',
    verify: ['注液量记录与称重数据', '水分含量检测', '化成曲线与温度记录', '气胀电芯拆解分析']
  },
  {
    re: /飞溅|集流盘|collector/i,
    mechanism: ['焊接功率过高或离焦量不当', '工件表面清洁度不足', '工装压紧力异常'],
    chain: '焊接飞溅会造成外观不良与有效焊核减小，导致连接电阻升高、集流效率下降与局部发热',
    verify: ['飞溅位置分布记录', '焊接参数记录核对', '焊核直径金相测量', '工件表面清洁度点检']
  },
  {
    re: /节拍|产出|瓶颈|takt|产出|OEE/i,
    mechanism: ['瓶颈工位节拍与线速不匹配', '设备稼动率损失（换型 / 故障 / 待料）', '人员操作标准化不足', '上下游供料节拍不均衡'],
    chain: '装配节拍损失会直接降低单班产出，造成在制品积压与交付延期，并推高单位制造成本；若瓶颈持续，将限制整线产能爬坡',
    verify: ['各工位节拍实测与线平衡率分析', 'OEE 损失分解（换型 / 故障 / 待料）', '标准作业时间与实操比对', '上下游供料节拍记录']
  },
  {
    re: /褶皱|隔膜|放卷|tension/i,
    mechanism: ['放卷张力波动或张力控制精度不足', '隔膜来料卷径 / 端面不齐', '导辊平行度偏差', '环境温湿度影响隔膜尺寸稳定性'],
    chain: '隔膜褶皱会破坏极片与隔膜的贴合一致性，造成局部间距异常与叠片对齐度偏差，极端情况下引发内部短路风险',
    verify: ['放卷张力记录与波动趋势', '隔膜来料卷径与端面检查', '导辊平行度与跳动检测', '环境温湿度记录']
  }
];

/* ------------------------------------------------------------
   English technical deep-analysis knowledge base.
   Index-aligned with POLISH_DEEP_KB. Text is written in professional
   lithium-ion cell manufacturing English (NOT translated from Chinese),
   covering 8D D2 problem description, impact chain and 5M1E verification.
   All mechanism/chain statements are labelled as inference, never facts.
   ------------------------------------------------------------ */
const POLISH_DEEP_KB_EN = [
  { // CCD edge detection / ceramic-coated edge waviness
    mechanism: [
      'Excessive tensile stretching during calendering producing edge waviness in the ceramic-coated edge zone, distorting the edge profile and defeating CCD edge detection',
      'Incoming variation in ceramic-coating width or edge boundary of the electrode',
      'CCD edge-detection threshold or illumination-angle drift',
      'Stacker feed tension or pick-up position deviation'
    ],
    chain: 'Edge waviness in the ceramic-coated edge zone causes CCD edge-detection failure or edge-datum drift, directly degrading stacking alignment accuracy and tab-position consistency, then propagating downstream to ultrasonic-welding tab positioning and cell-insertion gap control. If it persists, it may reduce internal safety clearance, increase internal short-circuit risk, and degrade jellyroll thickness consistency with downstream FPY loss.',
    verify: ['Measured edge profile and waviness amplitude in the ceramic-coated edge zone (edge straightness)', 'Calendering elongation and gap / tension parameter records', 'CCD edge-detection threshold, illumination and calibration verification', 'Incoming electrode ceramic-coating width and edge-position Cpk']
  },
  { // stacking / alignment
    mechanism: [
      'Locating-pin or stop-block wear/looseness causing electrode datum shift',
      'CCD vision-calibration drift or expired calibration target',
      'Incoming electrode cut-size and edge-position variation',
      'Insufficient chuck vacuum causing electrode pick-up misalignment'
    ],
    chain: 'Stacking alignment deviation alters tab-position consistency and propagates downstream to ultrasonic-welding tab positioning and cell-insertion gap control. If the deviation persists, it may reduce internal safety clearance and increase internal short-circuit risk, while degrading jellyroll thickness consistency and causing downstream FPY loss.',
    verify: ['Locating-pin wear measurement and replacement records', 'CCD calibration validity and calibration-target retest results', 'Incoming electrode edge-position Cpk', 'Continuous alignment trend chart (SPC)']
  },
  { // lid seal / pinhole / leak
    mechanism: [
      'Welding power / speed / defocus outside the process window',
      'Oxide layer or residual fluid on the weld groove causing insufficient cleanliness',
      'Insufficient fixture clamping force forming a local gap',
      'Insufficient shielding-gas flow or purity',
      'Weld-material contamination'
    ],
    chain: 'Pinholes in the lid seal weld directly cause helium leak-rate exceedance and can further lead to electrolyte leakage and moisture ingress, resulting in cell swelling and capacity fade, and posing a thermal-runaway safety risk; the client may need to isolate, re-inspect and potentially scrap the affected lot.',
    verify: ['Weld cross-section metallography (pinhole depth and morphology)', 'Welding parameter records vs. process window', 'Weld cleanliness and fixture clamping-force checks', 'Helium leak retest and leak-location results']
  },
  { // ultrasonic weld / pull strength
    mechanism: [
      'Ultrasonic horn / anvil wear causing energy-transfer attenuation',
      'Weld energy / pressure / time parameter drift',
      'Tab surface oxidation or contamination',
      'Incoming tab plating-thickness variation'
    ],
    chain: 'Insufficient weld pull strength raises contact resistance and causes local heating during high-current charge/discharge, potentially leading to weld fusion or open circuit, capacity fade and safety hazards. The weld is also at risk of cracking under load in the downstream cell-insertion process.',
    verify: ['Pull-test distribution and failure modes (interfacial peel / base-metal tear)', 'Horn wear and amplitude calibration records', 'Tab surface oxidation and plating inspection', 'Welding parameter SPC trend']
  },
  { // coating / areal density
    mechanism: [
      'Die gap or die-lip wear',
      'Slurry viscosity / solid-content variation',
      'Coating speed to feed-pump speed mismatch',
      'Non-uniform oven temperature profile'
    ],
    chain: 'Coating areal-density deviation propagates to post-calendering thickness and compacted-density variation, reducing cell capacity consistency and widening the capacity spread. Local low-areal-density areas pose a lithium-plating risk during cycling.',
    verify: ['Areal-density transverse / longitudinal scan map', 'Slurry viscosity and solid-content test records', 'Measured die gap and coating-speed matching', 'Post-calender thickness comparison at corresponding positions']
  },
  { // calendering / springback
    mechanism: [
      'Roll-gap setting drift',
      'Roll-pressure to roll-speed mismatch',
      'Electrode compacted density exceeding the limit and causing elastic recovery',
      'Incoming areal-density variation'
    ],
    chain: 'Thickness springback causes jellyroll thickness out of tolerance after stacking, affecting insertion clearance and potentially causing can bulging and abnormal assembly stress, while reducing cell capacity consistency.',
    verify: ['Roll-gap actual vs. set-point comparison', 'Roll pressure and speed records', 'Compacted-density test results', 'Springback vs. dwell-time curve']
  },
  { // web guiding / tension imbalance / strip break
    mechanism: [
      'Inconsistent electrode web elongation across the material zone creating left/right tension imbalance upstream of slitting and driving continuous one-directional web guiding to the stroke limit',
      'Main-drive roll out-of-level (non-parallel roll faces) producing unequal web tension across the electrode width and a persistent tracking force',
      'Web-guide sensor zero / span drift or lagging guide-roll response',
      'Mismatched tension and taper settings upstream of slitting, or incoming roll diameter and edge-alignment variation'
    ],
    chain: 'Unequal left/right electrode tension upstream of slitting drives continuous one-directional web guiding until the stroke limit is reached; the web then loses stability and breaks, causing immediate line stoppage and scrap of in-process electrode. If left uncorrected, slit-width and edge-position consistency degrade and propagate to stacking alignment and tab-position control, affecting cell capacity consistency and internal safety clearance with downstream FPY loss.',
    verify: ['Measured left/right web tension at the guide roll and tension-transducer calibration', 'Main-drive roll levelness, face parallelism and runout inspection', 'Electrode elongation (MD/TD) and thickness profile across the material zone', 'Pre-slit tension setpoints, taper parameters and web-guide response records']
  },
  { // slitting / burr
    mechanism: [
      'Slitting blade wear or improper blade gap',
      'Slitting speed to tension mismatch',
      'Incoming electrode thickness variation'
    ],
    chain: 'Electrode edge burrs may pierce the separator and form internal micro-shorts, raising the self-discharge rate and thermal-runaway risk, and interfering with stacking edge alignment and separator coverage.',
    verify: ['Metallographic measurement of burr height and count', 'Blade wear and replacement records', 'Slitting tension and speed parameters', 'Separator puncture test results']
  },
  { // insertion / scratch
    mechanism: [
      'Burr or wear on the insertion fixture / guide surface',
      'Cell-to-can misalignment causing scraping',
      'Burr on incoming can edge',
      'Handling-tool contact'
    ],
    chain: 'Cosmetic scratches on the can or cell not only cause appearance rejection but may also damage the insulation layer and create local stress concentration, posing long-term can-corrosion and leakage risks during cycling.',
    verify: ['Scratch location distribution vs. fixture contact points', 'Guide-surface / clamp burr checks', 'Incoming can appearance sampling', 'Insertion positioning-accuracy retest']
  },
  { // formation / swelling
    mechanism: [
      'Abnormal gas generation during formation (unstable SEI layer)',
      'Insufficient or uneven electrolyte filling',
      'Excess moisture causing side reactions',
      'Formation temperature / current profile deviation'
    ],
    chain: 'Cell swelling leads to can deformation and gas-tightness risk, accompanied by capacity fade and cycle-life reduction; in severe cases it poses a safety risk and affects client-side assembly.',
    verify: ['Electrolyte-filling records and weighing data', 'Moisture-content testing', 'Formation curve and temperature records', 'Teardown analysis of swollen cells']
  },
  { // collector weld / spatter
    mechanism: [
      'Excessive welding power or improper defocus',
      'Insufficient workpiece surface cleanliness',
      'Abnormal fixture clamping force'
    ],
    chain: 'Weld spatter causes cosmetic defects and reduces the effective weld nugget, increasing connection resistance, reducing current-collection efficiency and causing local heating.',
    verify: ['Spatter location distribution record', 'Welding parameter record review', 'Metallographic measurement of weld-nugget diameter', 'Workpiece surface-cleanliness checks']
  },
  { // takt / output / bottleneck
    mechanism: [
      'Bottleneck-station takt mismatched with line speed',
      'Equipment availability loss (changeover / fault / starvation)',
      'Insufficient operator standardization',
      'Unbalanced upstream / downstream supply takt'
    ],
    chain: 'Assembly takt loss directly reduces per-shift output, causing WIP accumulation and delivery delay and raising unit manufacturing cost; a persistent bottleneck limits line ramp-up capacity.',
    verify: ['Station takt measurement and line-balance analysis', 'OEE loss breakdown (changeover / fault / starvation)', 'Standard work time vs. actual practice comparison', 'Upstream / downstream supply-takt records']
  },
  { // separator / wrinkle / unwind
    mechanism: [
      'Unwind tension fluctuation or insufficient tension-control accuracy',
      'Incoming separator roll-diameter / edge misalignment',
      'Guide-roller parallelism deviation',
      'Ambient temperature / humidity affecting separator dimensional stability'
    ],
    chain: 'Separator wrinkles disrupt electrode-to-separator contact consistency, causing local gap anomalies and stacking alignment deviation, and in extreme cases pose an internal short-circuit risk.',
    verify: ['Unwind tension records and fluctuation trend', 'Incoming separator roll diameter and edge inspection', 'Guide-roller parallelism and runout inspection', 'Ambient temperature / humidity records']
  }
];
const POLISH_DEEP_KB_EN_FALLBACK = {
  mechanism: ['Investigate systematically by 5M1E (Man / Machine / Material / Method / Measurement / Environment)'],
  chain: 'The specific impact must be assessed against the defect location, the process where it was detected and the downstream routing, in terms of downstream processes and final cell performance',
  verify: ['Defect photos and location distribution', 'Occurrence frequency and defect rate', 'Affected batch scope', 'Equipment parameters and inspection records']
};
function polishDeepKbIndex(phenomenon) {
  const key = String(phenomenon || '');
  return POLISH_DEEP_KB.findIndex(k => k.re.test(key));
}
function polishDeepEn(phenomenon) {
  const idx = polishDeepKbIndex(phenomenon);
  return idx >= 0 && POLISH_DEEP_KB_EN[idx] ? POLISH_DEEP_KB_EN[idx] : POLISH_DEEP_KB_EN_FALLBACK;
}

function polishDeepKb(phenomenon) {
  const key = String(phenomenon || '');
  return POLISH_DEEP_KB.find(k => k.re.test(key)) || {
    mechanism: ['需按 5M1E（人 / 机 / 料 / 法 / 测 / 环）逐项排查'],
    chain: '具体影响需结合缺陷部位、发现工序及后续流转路径评估对下游工序与最终电芯性能的影响',
    verify: ['缺陷照片与部位分布', '发生频次与不良率', '受影响批次范围', '设备参数与点检记录']
  };
}
function polishJoinNums(items, limit) {
  const out = [];
  items.forEach(x => { const v = polishNorm(x); if (v && !out.includes(v)) out.push(v); });
  return out.slice(0, limit || 4);
}

function polishProblem(t) {
  const txt = String(t || '');
  const ident = intakeIdentify(txt);
  const eq = ident.equipment;
  const wsCn = polishWsCn(ident.workstream);
  const parts = polishClauses(txt).flatMap(c => String(c).split(/[，,]/)).map(polishNorm).filter(x => x.length >= 2);
  const signals = POLISH_DEFECTS.concat(['有点偏', '偏了', '偏低', '偏高', '偏大', '偏小', '异常', '问题', '不良', '超过', '高于', '低于', '瓶颈']);
  const pIdx = Math.max(0, parts.findIndex(x => signals.some(k => x.includes(k))));
  const spec = polishSpec(txt);
  let defect = polishDefect(partSafe(parts, pIdx)) || polishDefect(parts.slice(0, pIdx + 2).join('，')) || polishRough(parts[pIdx] || txt).slice(0, 40);
  defect = defect.replace(/^(?:今天|今日|本班|昨天|白班|夜班|中班|早班|晚班|Shift\s*[A-D]|现场|跟线|发现|出现|存在|有)\s*/i, '')
                 .replace(/(?:属于|优先级|影响域).*$/, '');
  if (/节拍$/.test(defect) && spec.cmp === '未达目标') defect += '偏高';
  // Web-guiding / tension scenarios: anchor the defect on the actual abnormal
  // clause, not on the leading date or on a bare equipment noun.
  if (/纠偏|断带|张紧不一致|一边紧.*一边松|模切分条|料区延展|主驱辊/.test(txt)) {
    const anchor = parts.find(x => /纠偏|断带|张紧|料区延展|主驱辊/.test(x) && !/^20\d{2}/.test(x));
    if (anchor) defect = anchor;
  }
  const eqCore = eq.replace(/#\d+/, '').trim();
  let common = 0;
  while (common < Math.min(eqCore.length, defect.length) && eqCore[common] === defect[common]) common++;
  let body = common >= 2 ? defect.slice(common) : defect;
  if (/^超声/.test(eqCore) && /^超声焊/.test(defect)) body = defect.slice(3);
  const phenomenon = polishPhenomenon(body || defect, eq);
  const location = polishLocation(txt);
  const kb = polishDeepKb(phenomenon);

  const specPart = parts.find(x => /规格|标准|判据|要求|目标|上限|下限|工艺窗口|超过|高于|低于|达不到/.test(x));
  const measureParts = parts.slice(pIdx, pIdx + 3)
    .filter(x => x !== specPart && !/不良率|缺陷率|FPY|OEE|产出|良率/.test(x));
  let nums = polishNumbers(measureParts.join('，'))
    .filter(x => !/^100\s*%$/.test(x) && !/^\d+\s*(?:片|点|卷|件)$/.test(x));
  if (spec.value && polishUnit(spec.value)) {
    const same = nums.filter(x => polishUnit(x) === polishUnit(spec.value));
    if (same.length) nums = same.concat(nums.filter(x => !same.includes(x)));
  }
  const approx = /左右|大概|约|疑似/.test(measureParts.join('，'));

  const when = polishWhen(txt);
  const methods = polishMethods(txt);
  const sample = polishSampleInfo(txt);
  const rate = polishDefectRate(txt);
  const batch = polishBatchInfo(txt);
  const prod = polishProdContext(txt);
  const contain = polishContainment(txt).replace(/^临时围堵：/, '');
  const statedCause = ((txt.match(/(?:根因(?:是|为|：|:)?|原因是|由于|因为|怀疑是?|疑似|推测(?:是|为)?|可能是?)([^，。；;]{3,60})/) || [])[1] || '')
    .replace(/^(?:确认是|确认|是|为)\s*/, '')
    .replace(/(?:导致的|导致|造成|引起|所致)$/, '');
  const statedImpact = (txt.match(/(?:导致|造成|引起|使得|瓶颈在)\s*([^，。；;]{2,42})/)
    || txt.match(/存在([^，。；;]{2,30}(?:风险|隐患))/) || [])[1] || '';

  /* 1 - confirmed facts only */
  let facts = (when ? when + '，' : '') + (wsCn ? wsCn + '，' : '') + (eq || '工序 / 设备待确认') + '，'
    + (/发现|跟线|观察到|看到|确认/.test(txt) ? '现场确认' : '') + (phenomenon || '异常现象待补充');
  if (location) facts += '，缺陷位置为' + location;
  if (nums.length) facts += '，实测' + (approx ? '约 ' : ' ') + nums.slice(0, 2).join('、');
  if (spec.value) facts += '，' + spec.cmp + '（' + spec.value + '）';
  const dev = polishDeviation(nums[0], spec.value, spec.cmp);
  if (dev) facts += '，' + dev;
  const evBits = [];
  if (methods.length) evBits.push(methods.slice(0, 3).join('、'));
  if (sample && !methods.some(x => polishNum(x) === polishNum(sample) && polishNum(sample) != null)) evBits.push('样本 ' + sample);
  if (rate) evBits.push('不良率 ' + rate);
  if (prod.length) evBits.push(prod.join('、'));
  if (evBits.length) facts += '。检测依据：' + evBits.join('；');
  if (batch) facts += '；涉及批次 ' + batch;
  // Trigger condition and direct observations are first-hand facts, not inference.
  const trigger = (txt.match(/每次(?:开始)?走带时|开始走带时|每次启动|开机时|换卷后/) || [''])[0];
  if (trigger) facts += '；触发条件：' + polishNorm(trigger);
  const obsBits = [];
  if (/一边紧.*一边松/.test(txt)) obsBits.push('纠偏过辊极片一边紧一边松');
  if (/主驱左右极片张紧不一致|左右极片张紧不一致/.test(txt)) obsBits.push('分切前主驱左右极片张紧不一致');
  if (obsBits.length) facts += '；现场观察：' + obsBits.join('，');
  if (statedCause && /确认|证实/.test(txt)) facts += '；根因已确认：' + polishRough(statedCause);
  facts = polishEnd(facts, 460);

  /* 2 - downstream impact chain (inference) */
  let chain = kb.chain;
  if (statedImpact) {
    const clean = polishRough(statedImpact).replace(/^存在\s*/, '');
    chain += '；现场记录的影响指向' + clean + '，与上述推断方向一致';
  }
  const needSupport = [];
  if (!rate) needSupport.push('不良率');
  if (!batch) needSupport.push('批次范围');
  chain += needSupport.length ? '。该影响推断尚缺' + needSupport.join('与') + '数据支撑，暂不作为定级结论' : '。该影响推断需以复测与追溯结果最终确认';
  chain = polishEnd(chain, 420);

  /* 3 - hypotheses and verification direction (explicitly not conclusions) */
  const hypo = [];
  if (statedCause && !/确认|证实/.test(txt)) hypo.push('现场初步指向：' + polishRough(statedCause) + '（待数据验证）');
  const causeConfirmed = !!(statedCause && /确认|证实/.test(txt));
  kb.mechanism.forEach(m => {
    if (hypo.length < 4 && !hypo.some(h => h.includes(m)) && !(causeConfirmed && m.includes(statedCause))) hypo.push(m);
  });
  const hypoLines = hypo.slice(0, 4).map((x, i) => (i + 1) + '）' + x + '。');
  let hypothesis = '【待验证假设｜非结论】\n' + (hypoLines.length ? hypoLines.join('\n') : '暂无明确机理方向，需现场补充排查。');
  const verifyLines = polishJoinNums(kb.verify, 4).map((x, i) => (i + 1) + '）' + x + '。');
  hypothesis += '\n' + (causeConfirmed ? '根因已确认，以下用于确认根因与现象的因果关系：' : '建议验证项：') + '\n' + verifyLines.join('\n');

  /* 4 - containment and information gaps */
  const actions = [];
  if (contain) actions.push('已执行：' + contain);
  const gaps = [];
  if (!sample && !methods.length) gaps.push('检测方法与抽样量');
  if (!rate) gaps.push('不良率 / 发生频次');
  if (!batch) gaps.push('受影响批次范围');
  if (!prod.length) gaps.push('同期产出 / FPY 数据');
  let handling = '【当前处置与信息缺口】' + (actions.length ? actions.join('；') : '现场暂未记录临时围堵措施，需确认在制品是否受控');
  handling += gaps.length ? '；原文未提供' + gaps.slice(0, 4).join('、') + '，需现场补充后完成严重度定级与批次追溯' : '；关键数据已记录，可进入根因分析与对策阶段';
  handling = polishEnd(handling, 340);

  return ['【已确认事实】' + facts, '【影响链分析｜推断】' + chain, hypothesis, handling].join('\n');
}

function partSafe(parts, i) { return parts[i] || ''; }

function polishContainment(t) {
  const txt = String(t || '');
  const out = [];
  const pats = [
    /(客户)?(?:已经|已)?\s*隔离[^，。；;]{0,28}/,
    /(客户)?(?:已经|已)?\s*(?:暂停|停线|停止)[^，。；;]{0,28}/,
    /(?:加严|加强)\s*[^，。；;]{0,28}/,
    /(?:全检|100%\s*(?:抽检|检验|氦检))[^，。；;]{0,20}/,
    /(?:围堵|受控|不得流入)[^，。；;]{0,28}/
  ];
  pats.forEach(re => {
    const m = txt.match(re);
    if (!m) return;
    const v = polishNorm(m[0]).replace(/^已经/, '已');
    if (v && !out.some(x => x.includes(v) || v.includes(x))) out.push(v);
  });
  return out.length ? '临时围堵：' + out.slice(0, 3).join('；') : '';
}
function polishCause(t) {
  const m = String(t || '').match(/(?:根因(?:是|为|：|:)?|原因是|由于|因为)([^，。；;]{3,100})/);
  if (!m) return '';
  return polishEnd((/确认|证实/.test(t) ? '根因确认：' : '初步判断：') + m[1], 160);
}
function polishSolution(t) {
  const m = String(t || '').match(/(?:建议|对策|方案(?:是|为|：|:)?)([^，。；;]{3,120})/);
  return m ? polishEnd('建议对策：' + m[1], 160) : '';
}
function polishActionClauses(t) {
  return polishClauses(t).flatMap(c => String(c).split(/[，,]/));
}
function polishAction(t) {
  const eq = polishEquipment(t);
  const eqCore = eq.replace(/#\d+/, '').trim();
  const steps = [];
  polishActionClauses(t).forEach(raw => {
    if (!new RegExp(POLISH_VERBS).test(raw)) return;
    let x = polishNorm(raw)
      .replace(/^(?:今天|今日|本班)?\s*(?:需要|要求|请|计划|安排|务必|建议|由)[^，。；]{0,18}?(?:在|于)?\s*(?:\d{1,2}月\d{1,2}日|20\d{2}[-/]\d{1,2}[-/]\d{1,2})\s*(?:前|之前)?\s*/, '')
      .replace(/^(?:在|于)?\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日)\s*(?:前|之前)?\s*/, '')
      .replace(/^前\s*/, '')
      .replace(/^(?:并|且|然后|接着|同时|将|把|需要|请|要)\s*/, '').replace(/^(?:并|且|同时|将|把)\s*/, '')
      .replace(/改为/g, '调整为').replace(/换为/g, '更换为')
      .replace(/(?:，|,)?\s*(?:验收标准|验收依据|判定标准|属于|优先级).*$/i, '');
    x = polishNorm(x);
    const first = x.match(new RegExp('^' + POLISH_VERBS));
    if (eq && first && eqCore.length <= 8 && !x.includes(eqCore)) x = first[0] + eq + x.slice(first[0].length);
    if (x.length >= 3) steps.push(x);
  });
  return steps.length ? polishEnd(steps.join('；'), 180)
                      : polishEnd('执行：' + String(t || '').slice(0, 150), 180);
}
function polishAcceptance(t) {
  const m = String(t || '').match(/(?:验收标准|判定标准|验收依据|目标|要求)\s*([^。；;]{2,90})/);
  return m ? polishEnd('验收标准：' + m[1].replace(/[，,]?属于.*$/, ''), 120) : '';
}
function polishBlocker(t) {
  const m = String(t || '').match(/(?:阻塞|依赖|等待|卡在|受限于)([^，。；;]{2,50})/);
  return m ? polishNorm('阻塞项：' + m[1]) : '';
}
function polishDecisionTopic(t) {
  const eq = polishEquipment(t);
  const clause = polishClauses(t).find(c => /决定|决议|批准|审批|采用|推荐|方案\s*[A-D]/i.test(c)) || String(t || '');
  let core = clause.replace(/^.*?(?:采用|推荐|建议|决定|批准|审批)\s*/, '').replace(/^(?:采用|推荐|建议)\s*/, '')
                   .replace(/^方案\s*[A-D][：:]?\s*/i, '')
                   .replace(/[，,]/g, '与').replace(/并/g, '与');
  core = polishNorm(core).replace(/[。；]$/, '');
  if (!core) core = '技术方案';
  core = core.replace(/(?:，|,)?\s*(?:客户批准人|批准人|按\s*MoC|MoC-|执行|属于|优先级).*$/i, '');
  core = core.replace(/[与和]$/, '');
  return polishNorm((eq ? eq + ' ' : '') + core + (/(?:决策|方案|审批|变更)$/.test(core) ? '' : '决策')).slice(0, 64);
}
function polishOptions(t) {
  const out = [];
  const re = /方案\s*([A-D])[：:]?\s*([^，。；;]{2,50})/gi;
  let m;
  while ((m = re.exec(String(t || ''))) !== null) {
    const line = '方案 ' + m[1].toUpperCase() + '：' + polishNorm(m[2]);
    if (!out.includes(line)) out.push(line);
  }
  return out.join('；');
}
function polishRecommend(t, options) {
  const m = String(t || '').match(/方案\s*([A-D])/i);
  if (m) {
    const key = '方案 ' + m[1].toUpperCase();
    return options.split('；').find(x => x.startsWith(key)) || key;
  }
  const n = String(t || '').match(/(?:采用|推荐|建议)\s*([^，。；;]{2,32})/);
  return n ? polishNorm(n[1]) : '';
}
function polishRationale(t) {
  const moc = (String(t || '').match(/MoC[-A-Za-z0-9]+/i) || [''])[0];
  const why = String(t || '').match(/(?:因为|由于|依据)([^，。；;]{4,60})/);
  let s = '技术评审关注方案可行性与风险边界';
  if (why) s += '，依据 ' + polishNorm(why[1]);
  s += moc ? '；按变更控制流程 ' + moc + ' 提交客户审批' : '；需客户变更控制审批后实施';
  return polishEnd(s, 160);
}
function polishDecisionBackground(t, options) {
  if (POLISH_DEFECTS.some(x => String(t || '').includes(x))) return polishProblem(t);
  const rec = polishRecommend(t, options) || options || '推荐方案';
  const moc = (String(t || '').match(/MoC[-A-Za-z0-9]+/i) || [''])[0];
  const client = (String(t || '').match(/(?:客户批准人|批准人)\s*([^，。；;]{2,20})/) || [''])[1];
  let s = '基于现场改进需求，拟采用 ' + rec;
  if (moc) s += '，变更依据 ' + moc;
  if (client) s += '，客户审批方 ' + polishNorm(client);
  return polishEnd(s, 170);
}
function polishFollowUp(owner) {
  return '由 ' + (owner || '客户责任人') + ' 负责实施，完成后提交验证结果与客户签署。';
}
function polishReport(t) {
  const clauses = polishClauses(t).filter(c => !/次日|明天|明日|重点/.test(c));
  if (!clauses.length) return '';
  const eq = polishEquipment(t);
  const shift = (String(t || '').match(/Shift\s*[AB]|白班|夜班/i) || [''])[0];
  const head = (shift ? shift + ' ' : '') + (eq ? eq + ' ' : '') + '本班记录：';
  const body = clauses.map(c => c.replace(/^(?:今日|今天)\s*/, '')).join('；');
  return polishEnd(head + body, 220);
}
function polishKpiContext(t) {
  const parts = [];
  const out = (String(t || '').match(/([\d,.]+\s*cells\/day)/i) || []);
  if (out[1]) parts.push('产出 ' + polishNorm(out[1]));
  ['FPY', 'OEE', '良率', '节拍', '直通率'].forEach(k => {
    const m = String(t || '').match(new RegExp(k + '\\s*[:：]?\\s*([\\d,.]+)\\s*(%|s/件)?', 'i'));
    if (m) parts.push(k + ' ' + polishNorm(m[1] + (m[2] || '')));
  });
  if (!parts.length) parts.push(...polishNumbers(t).slice(0, 3));
  return [...new Set(parts)].join('；');
}
function polishNextDay(t) {
  const m = String(t || '').match(/(?:次日重点|次日|明天|明日)([^。；;]{0,100})/);
  if (!m) return '';
  const steps = m[1].split(/[，、,]|并|且|同时/).map(polishNorm).filter(x => x.length >= 2);
  return steps.map((x, i) => (i + 1) + ') ' + x).join('；');
}

/* ============================================================
   Structured ENGLISH generation — parallel to the Chinese polish* chain.
   English is COMPOSED from extracted variables (equipment, measurements,
   spec, evidence, knowledge base), never translated word-by-word from the
   Chinese output. This avoids Chinese/English mixing entirely.
   ============================================================ */
const EN_WS = {
  'Electrode Process': 'Electrode Process',
  'Electrode Equipment': 'Electrode Equipment',
  'Stacking Process': 'Stacking Process',
  'Stacking Equipment': 'Stacking Equipment',
  'Cell Assembly Process': 'Cell Assembly Process',
  'Cell Assembly Equipment': 'Cell Assembly Equipment',
  'Other': 'Other'
};
function enEq(eq) {
  // translate the equipment token (e.g. 叠片机 #3 -> Stacker #3) via i18n term layer
  try { return window.I18N && window.I18N.convert ? window.I18N.convert(eq) : eq; }
  catch (e) { return eq; }
}
function enList(arr, joiner) { return (arr || []).filter(Boolean).join(joiner || '; '); }
function enJoinNumbers(items, limit) {
  const out = [];
  (items || []).forEach(x => { if (x && !out.includes(x)) out.push(x); });
  return out.slice(0, limit || 4);
}
function enNumbered(items, limit) {
  return enJoinNumbers(items, limit).map((x, i) => '(' + (i + 1) + ') ' + x + '.').join('\n');
}
function enPhenomenon(defect, eq) {
  // English phenomenon mapped from normalized Chinese phenomenon token
  const map = [
    [/CCD边缘识别异常|CCD抓边|抓边/, 'CCD edge-detection anomaly'],
    [/极片边缘波浪|陶瓷边区域波浪边|陶瓷边波浪边|波浪边|边浪/, 'electrode edge waviness'],
    [/极片对齐度偏移|对齐度偏移|对齐超差/, 'electrode alignment offset'],
    [/顶盖密封焊缝针孔|焊缝针孔|针孔/, 'lid seal-weld pinhole'],
    [/焊点虚焊|虚焊/, 'weld nugget (cold weld)'],
    [/拉力不足/, 'insufficient tab weld pull strength'],
    [/极片切边毛刺|毛刺超标/, 'electrode edge burr'],
    [/涂层面密度偏差|面密度/, 'coating areal-density deviation'],
    [/厚度回弹/, 'post-calendering thickness springback'],
    [/气密漏率超标|漏率超标|气密/, 'cell helium leak-rate exceedance'],
    [/气胀/, 'cell swelling'],
    [/纠偏单向到底导致极片断带|纠偏.*限位|断带/, 'web break after one-directional web guiding to the stroke limit'],
    [/褶皱/, 'separator / electrode wrinkle'],
    [/飞溅/, 'weld spatter'],
    [/划伤/, 'cosmetic scratch'],
    [/内部短路风险|短路/, 'internal short-circuit risk'],
    [/电解液泄漏|漏液/, 'electrolyte leakage'],
    [/停机/, 'equipment downtime'],
    [/报警/, 'equipment alarm'],
    [/卡滞/, 'equipment jam']
  ];
  const key = String(defect || '');
  for (const [re, en] of map) if (re.test(key)) return en;
  try { return window.I18N && window.I18N.convert ? window.I18N.convert(key) : key; }
  catch (e) { return key; }
}
function enSpec(spec) {
  if (!spec || !spec.value) return '';
  const cmpMap = {
    '未达目标': 'below target', '超出工艺窗口': 'outside process window',
    '超出规格上限': 'above upper specification limit', '低于规格下限': 'below lower specification limit',
    '超出公差范围': 'outside tolerance band', '不满足规格要求': 'does not meet specification'
  };
  return (cmpMap[spec.cmp] || 'specification') + ' (' + forceEn(spec.value) + ')';
}
function enDeviation(meas, spec, cmp) {
  const a = polishNum(meas), b = polishNum(spec);
  if (a == null || b == null || b === 0) return '';
  let d = 0, label = '';
  if (/公差/.test(cmp)) { d = Math.abs(a) - b; label = 'tolerance-band exceedance'; }
  else if (/上限/.test(cmp)) { d = a - b; label = 'exceedance above upper limit'; }
  else if (/下限/.test(cmp)) { d = b - a; label = 'shortfall below lower limit'; }
  else if (/目标/.test(cmp)) { d = Math.abs(a - b); label = 'gap to target'; }
  else if (/窗口/.test(cmp)) { d = Math.abs(a) - b; label = 'process-window excursion'; }
  else { d = Math.abs(a) - b; label = 'deviation'; }
  if (!(d > 0)) return '';
  const unit = polishUnit(spec) || polishUnit(meas);
  const pct = Math.round(d / b * 100);
  return label + ' ' + trimNum(d) + (unit && unit !== '%' ? ' ' + unit : (unit === '%' ? ' pp' : '')) + ' (relative deviation ' + pct + '%)';
}
/* ---------- Battery-domain phrase dictionary (phrase-level, longest-first) ----------
   Every Chinese fragment embedded into an English sentence goes through here.
   Whole phrases map to professional English BEFORE the generic per-word layer,
   so technical expressions never survive as Chinese fragments. */
const EN_DOMAIN = {
  /* defect / phenomenon phrases */
  '激光模切分条一体机': 'laser die-cutting and slitting integrated machine',
  '纠偏单向到底导致极片断带': 'electrode web break after one-directional web guiding to the stroke limit',
  '极片料区延展不一致': 'inconsistent electrode elongation across the material zone',
  '主驱左右极片张紧不一致': 'left/right electrode web tension imbalance upstream of slitting',
  '左右极片张紧不一致': 'left/right web tension imbalance',
  '纠偏过辊': 'web-guide roll',
  '主驱辊不水平': 'main-drive roll out of level',
  '主驱辊': 'main-drive roll',
  '极片断带': 'electrode web break',
  '断带': 'web break',
  '张紧不一致': 'tension imbalance',
  '达到限位': 'reaching the stroke limit',
  '限位': 'stroke limit',
  '纠偏': 'web guiding',
  '每次开始走带时': 'at every start of web travel',
  '开始走带时': 'at web start-up',
  '一边紧': 'tight on one side',
  '一边松': 'loose on the other side',
  'CCD抓边问题': 'CCD edge-detection anomaly',
  'CCD抓边': 'CCD edge-detection deviation',
  '抓边不良': 'edge-detection failure',
  '抓边': 'edge detection',
  '陶瓷边区域波浪边': 'edge waviness in the ceramic-coated edge zone',
  '陶瓷边波浪边': 'edge waviness at the ceramic-coated edge',
  '陶瓷边区域有波浪边': 'edge waviness in the ceramic-coated edge zone',
  '波浪边': 'edge waviness',
  '边浪': 'edge waviness',
  '极片对齐度偏移': 'electrode alignment offset',
  '对齐度偏移': 'alignment offset',
  '对齐超差': 'alignment out of tolerance',
  '切边毛刺': 'edge burr',
  '毛刺超标': 'excessive edge burr',
  '毛刺': 'burr',
  '顶盖焊缝针孔': 'lid seal-weld pinhole',
  '焊缝针孔': 'weld pinhole',
  '针孔': 'pinhole',
  '焊点虚焊': 'cold weld nugget',
  '虚焊': 'cold weld',
  '气密漏率超标': 'helium leak-rate exceedance',
  '漏率超标': 'leak-rate exceedance',
  '气密失效': 'hermetic seal failure',
  '气胀': 'cell swelling',
  '褶皱': 'wrinkle',
  '飞溅': 'weld spatter',
  '划伤': 'scratch',
  '电解液泄漏': 'electrolyte leakage',
  '漏液': 'electrolyte leakage',
  '面密度偏差': 'areal-density deviation',
  '厚度回弹': 'thickness springback',
  '内部短路风险': 'internal short-circuit risk',
  '短路风险': 'short-circuit risk',
  '内部短路': 'internal short circuit',
  '节拍': 'takt time',
  '瓶颈': 'bottleneck',
  /* components / zones */
  '正极极片': 'cathode electrode',
  '负极极片': 'anode electrode',
  '陶瓷边区域': 'ceramic-coated edge zone',
  '陶瓷涂层': 'ceramic coating',
  '陶瓷边': 'ceramic-coated edge',
  '正极': 'cathode',
  '负极': 'anode',
  '极片': 'electrode',
  '隔膜': 'separator',
  '极耳': 'tab',
  '卷芯': 'jellyroll',
  '电芯': 'cell',
  '顶盖': 'lid',
  '壳体': 'cell can',
  '装配线': 'assembly line',
  '边缘': 'edge',
  '区域': 'zone',
  /* process / equipment */
  '叠片机': 'stacker',
  '叠片': 'stacking',
  '辊压': 'calendering',
  '涂布': 'coating',
  '分切': 'slitting',
  '超声波焊接机': 'ultrasonic welding machine',
  '超声焊': 'ultrasonic welding',
  '激光焊': 'laser welding',
  '顶盖激光焊机': 'lid laser welder',
  '化成柜': 'formation cabinet',
  '化成': 'formation',
  '装配': 'assembly',
  '视觉标定': 'vision calibration',
  '视觉': 'vision',
  '氦检': 'helium leak test',
  '模头间隙': 'die-head gap',
  '温度曲线': 'temperature profile',
  '烘箱': 'oven',
  '定位销': 'locating pin',
  '来料': 'incoming material',
  /* mechanism / cause */
  '过渡拉伸': 'excessive tensile stretching',
  '过拉伸': 'over-stretching',
  '拉伸': 'tensile stretching',
  '标定': 'calibration',
  '漂移': 'drift',
  '磨损': 'wear',
  '松动': 'looseness',
  '间隙': 'gap',
  /* connectives / actions */
  '主要是由于在': 'mainly due to',
  '主要是由于': 'mainly due to',
  '主要是': 'mainly',
  '由于': 'due to',
  '因为': 'because',
  '怀疑是': 'suspected to be',
  '怀疑': 'suspected',
  '推测是': 'presumed to be',
  '推测': 'presumed',
  '初步判断': 'preliminary assessment',
  '现在': 'currently',
  '目前': 'currently',
  '当前': 'currently',
  '导致': 'causing',
  '造成': 'resulting in',
  '引起': 'leading to',
  '发现': 'identified',
  '出现': 'observed',
  '存在': 'identified',
  '跟线': 'line walk',
  '现场': 'on site',
  '复查': 're-inspection',
  '每周': 'weekly',
  '审批': 'approval',
  '切片': 'cross-section',
  '检查气路': 'inspect the gas line',
  '气路': 'gas line',
  '受影响批次': 'affected lot',
  '受影响': 'affected',
  '继续': 'continue',
  '检查': 'inspect',
  '调整': 'adjust',
  '不均': 'non-uniform',
  '的问题': '',
  '问题': 'anomaly',
  '异常': 'anomaly',
  '的': ' ',
  '有': ' ',
  '在': ' '
};
const EN_DOMAIN_KEYS = Object.keys(EN_DOMAIN).sort((a, b) => b.length - a.length);

/* Force residual Chinese through the domain phrase table first, then the
   generic term layer, then strip stray Chinese so EN never mixes scripts. */
function forceEn(x) {
  let s = String(x == null ? '' : x);
  if (!/[\u4e00-\u9fff]/.test(s)) return s;
  // Protect intentional line breaks so whitespace collapsing cannot merge segments.
  s = s.replace(/\n/g, '\u0001');
  EN_DOMAIN_KEYS.forEach(k => { if (s.indexOf(k) >= 0) s = s.split(k).join(' ' + EN_DOMAIN[k] + ' '); });
  if (/[\u4e00-\u9fff]/.test(s)) {
    try { s = window.I18N && window.I18N.convert ? window.I18N.convert(s) : s; } catch (e) {}
  }
  s = s.replace(/[\u4e00-\u9fff]+/g, ' ').replace(/[，、]/g, ', ').replace(/\s{2,}/g, ' ').replace(/\u0001/g, '\n').trim();
  return s;
}
function enMethods(t) {
  const out = [];
  const txt = String(t || '');
  // Compose detection evidence in English directly from the source.
  const defs = [
    [/CCD[^，。；,;]{0,24}/gi, m => m.replace(/拍了|拍摄|采集|采样\s*/g, 'captured ').replace(/片/g, ' pcs').replace(/(\d)\s*pcs/, '$1 pcs')],
    [/X-ray[^，。；,;]{0,24}/gi, m => m.replace(/拍了|拍摄|采集|采样\s*/g, 'captured ').replace(/片/g, ' pcs')],
    [/金相[^，。；,;]{0,20}/g, m => 'metallography' + m.replace(/^金相\s*/, '')],
    [/拉力测试[^，。；,;]{0,24}/g, m => 'pull test' + m.replace(/^拉力测试\s*/, '')],
    [/氦检[^，。；,;]{0,28}/g, m => 'helium leak test' + m.replace(/^氦检\s*/, '')],
    [/显微镜[^，。；,;]{0,20}/g, () => 'microscopic inspection'],
    [/SPC[^，。；,;]{0,20}/gi, m => m],
    [/面密度扫描[^，。；,;]{0,20}/g, m => 'areal-density scan' + m.replace(/^面密度扫描\s*/, '')]
  ];
  defs.forEach(([re, fn]) => {
    (txt.match(re) || []).forEach(m => {
      let v = forceEn(fn(m)).replace(/\s+/g, ' ').replace(/\s+pcs\s*$/, ' pcs').trim();
      if (v && !out.includes(v)) out.push(v);
    });
  });
  return out;
}
function enSample(t) {
  const s = polishSampleInfo(t);
  if (!s) return '';
  return forceEn(s.replace(/^抽样\s*/, 'sampled ').replace(/片$/, ' pcs').replace(/点$/, ' points')
          .replace(/卷$/, ' rolls').replace(/件$/, ' pcs').replace(/个$/, ' pcs').replace(/次$/, ' times'))
          .replace(/\s+/g, ' ').trim();
}
function enProd(t) {
  const bits = [];
  let m = String(t || '').match(/产出\s*([\d,]+)\s*cells\/day/i); if (m) bits.push('output ' + m[1] + ' cells/day');
  m = String(t || '').match(/FPY\s*(\d+(?:\.\d+)?)\s*%/i); if (m) bits.push('FPY ' + m[1] + '%');
  m = String(t || '').match(/OEE\s*(\d+(?:\.\d+)?)\s*%/i); if (m) bits.push('OEE ' + m[1] + '%');
  return bits;
}

function polishProblemEn(t) {
  const txt = String(t || '');
  const ident = intakeIdentify(txt);
  const eq = enEq(ident.equipment);
  const wsEn = EN_WS[ident.workstream] || ident.workstream || '';
  const parts = polishClauses(txt).flatMap(c => String(c).split(/[，,]/)).map(polishNorm).filter(x => x.length >= 2);
  const signals = POLISH_DEFECTS.concat(['有点偏', '偏了', '偏低', '偏高', '偏大', '偏小', '异常', '问题', '不良', '超过', '高于', '低于', '瓶颈']);
  const pIdx = Math.max(0, parts.findIndex(x => signals.some(k => x.includes(k))));
  const spec = polishSpec(txt);
  let defect = polishDefect(partSafe(parts, pIdx)) || polishDefect(parts.slice(0, pIdx + 2).join('，')) || polishRough(parts[pIdx] || txt).slice(0, 40);
  if (/节拍$/.test(defect) && spec.cmp === '未达目标') defect += '偏高';
  if (/纠偏|断带|张紧不一致|一边紧.*一边松|模切分条|料区延展|主驱辊/.test(txt)) {
    const anchor = parts.find(x => /纠偏|断带|张紧|料区延展|主驱辊/.test(x) && !/^20\d{2}/.test(x));
    if (anchor) defect = anchor;
  }
  const zhPhenomenon = polishPhenomenon(defect, ident.equipment);
  const phenomenon = enPhenomenon(zhPhenomenon, ident.equipment);
  const when = polishWhen(txt);
  const measureParts = parts.slice(pIdx, pIdx + 3)
    .filter(x => !/不良率|缺陷率|FPY|OEE|产出|良率/.test(x));
  let nums = polishNumbers(measureParts.join('，'))
    .filter(x => !/^100\s*%$/.test(x) && !/^\d+\s*(?:片|点|卷|件)$/.test(x));
  if (spec.value && polishUnit(spec.value)) {
    const same = nums.filter(x => polishUnit(x) === polishUnit(spec.value));
    if (same.length) nums = same.concat(nums.filter(x => !same.includes(x)));
  }
  const approx = /左右|大概|约|疑似/.test(measureParts.join('，'));
  const rate = polishDefectRate(txt);
  const batch = polishBatchInfo(txt);
  const loc = polishLocation(txt);
  // Look up the knowledge base by the Chinese phenomenon token (its regexes are Chinese).
  const kb = polishDeepEn(zhPhenomenon + ' ' + defect + ' ' + ident.equipment);
  const methods = enMethods(txt);
  const sample = enSample(txt);
  const dev = enDeviation(nums[0], spec.value, spec.cmp);

  /* 1 - confirmed facts */
  const f = [];
  if (when) f.push(when);
  if (wsEn) f.push(wsEn);
  if (eq) f.push(eq);
  f.push('confirmed on site ' + (phenomenon || 'anomaly to be specified'));
  if (loc) f.push('defect location ' + forceEn(loc));
  // Measurement values only: exclude anything equal to the spec limit.
  const measNums = nums.filter(n => polishUnit(spec.value) !== polishUnit(n) || String(n).replace(/\s/g, '') !== String(spec.value).replace(/\s/g, ''));
  const shownNums = measNums.length ? measNums : nums.filter(n => String(n).replace(/\s/g, '') !== String(spec.value).replace(/\s/g, ''));
  if (shownNums.length) f.push('measured ' + (approx ? 'approximately ' : '') + shownNums.slice(0, 2).join(' / '));
  const sp = enSpec(spec); if (sp) f.push(sp);
  if (dev) f.push(dev);
  let facts = f.join(', ') + '.';
  const ev = [];
  if (methods.length) ev.push(methods.slice(0, 3).join('; '));
  if (sample && !methods.some(x => /\d/.test(x) && /\d/.test(sample))) ev.push('sample ' + sample);
  if (rate) ev.push('defect rate ' + rate);
  ev.push(...enProd(txt));
  if (ev.length) facts += ' Inspection basis: ' + ev.join('; ') + '.';
  if (batch) facts += ' Affected lot: ' + batch + '.';
  const trigEn = (txt.match(/每次(?:开始)?走带时|开始走带时|每次启动|开机时|换卷后/) || [''])[0];
  if (trigEn) facts += ' Trigger condition: ' + forceEn(polishNorm(trigEn)) + '.';
  const obsEn = [];
  if (/一边紧.*一边松/.test(txt)) obsEn.push('web tight on one side and loose on the other at the web-guide roll');
  if (/主驱左右极片张紧不一致|左右极片张紧不一致/.test(txt)) obsEn.push('left/right electrode web tension imbalance upstream of slitting');
  if (obsEn.length) facts += ' Direct observations: ' + obsEn.join('; ') + '.';

  /* 2 - impact chain (inference) */
  let chain = kb.chain;
  const statedImpact = (txt.match(/(?:导致|造成|引起|使得|瓶颈在)\s*([^，。；;]{2,42})/)
    || txt.match(/存在([^，。；;]{2,30}(?:风险|隐患))/) || [])[1] || '';
  if (statedImpact) {
    const cleanI = forceEn(polishRough(statedImpact).replace(/^存在\s*/, ''));
    chain += ' The on-site record points to ' + cleanI + ', consistent with the inference above.';
  }
  const need = [];
  if (!rate) need.push('defect rate');
  if (!batch) need.push('batch scope');
  chain += need.length
    ? ' This impact inference lacks ' + need.join(' and ') + ' data support and is NOT used for severity grading.'
    : ' This impact inference requires final confirmation by retest and lot traceability.';

  /* 3 - hypotheses (explicitly not conclusions) */
  const cause = ((txt.match(/(?:怀疑(?:是)?|推测(?:是)?|初步判断(?:是)?)([^，。；;]{3,60})/) || txt.match(/(?:根因(?:是|为|：|:)?|原因是|由于|因为)([^，。；;]{3,60})/) || [])[1] || '')
    .replace(/^(?:确认是|确认|是|为)\s*/, '').replace(/(?:导致的|导致|造成|引起|所致)$/, '');
  const confirmed = !!(cause && /确认|证实/.test(txt));
  const hypo = [];
  let onSiteText = '';
  if (cause && !confirmed) {
    const contribH = (txt.match(/主要是由于([^，。；;]{2,40})/) || [])[1] || '';
    const lead = contribH ? forceEn(contribH) + '; ' : '';
    onSiteText = forceEn(polishRough(cause));
    hypo.push('Preliminary on-site indication: ' + lead + onSiteText + ' (pending data verification)');
  }
  kb.mechanism.forEach(m => {
    if (hypo.length >= 4) return;
    // Keep mechanism directions that add causal detail beyond the on-site
    // indication; drop only near-verbatim duplicates. Keyword-overlap removal
    // was discarding the two most relevant mechanisms in web-break cases.
    const ml = m.toLowerCase();
    const ol = onSiteText.toLowerCase();
    if (ol.includes(ml) || ml.includes(ol)) return;
    hypo.push(m);
  });
  let h = '[Hypotheses to verify | NOT conclusions]\n' + (hypo.length ? enNumbered(hypo, 4) : 'No clear mechanism identified; on-site investigation required.');
  h += '\n' + (confirmed ? 'Root cause confirmed; the following confirm the causal link between root cause and symptom:' : 'Recommended verification items:') + '\n' + enNumbered(kb.verify, 4);

  /* 4 - containment and data gaps */
  const contain = polishContainment(txt).replace(/^临时围堵：/, '');
  const hd = [];
  hd.push(contain ? 'Containment executed: ' + contain : 'No temporary containment recorded on site; confirm whether WIP is controlled');
  const gaps = [];
  if (!sample && !methods.length) gaps.push('inspection method and sample size');
  if (!rate) gaps.push('defect rate / occurrence frequency');
  if (!batch) gaps.push('affected batch scope');
  if (!enProd(txt).length) gaps.push('concurrent output / FPY data');
  hd.push(gaps.length ? 'Not provided in source: ' + gaps.slice(0, 4).join(', ') + '; on-site supplement required to complete severity grading and lot traceability' : 'Key data recorded; proceed to root cause analysis and countermeasure phase');
  const handling = '[Current disposition & data gaps] ' + hd.join('; ') + '.';

  return forceEn(['[Confirmed facts] ' + facts, '[Impact chain | INFERENCE] ' + chain, h, handling].join('\n'));
}

function polishEvidenceEn(t) {
  const bits = [];
  const methods = enMethods(t);
  const sample = enSample(t);
  const rate = polishDefectRate(t);
  const batch = polishBatchInfo(t);
  if (methods.length) bits.push(methods.slice(0, 3).join('; '));
  if (sample) bits.push('sample ' + sample);
  if (rate) bits.push('defect rate ' + rate);
  if (batch) bits.push('lot ' + batch);
  bits.push(...enProd(t));
  return bits.join('; ');
}
function polishContainmentEn(t) {
  const c = polishContainment(t).replace(/^临时围堵：/, '');
  if (!c) return '';
  return 'Temporary containment: ' + c.split('；').map(x => {
    return x.replace(/^已/, '').replace(/隔离/, 'isolation').replace(/暂停|停线|停止/, 'line stop').replace(/加严|加强/, 'tightened inspection')
            .replace(/全检/, '100% inspection').replace(/抽检/, 'sampling').replace(/受控/, 'control').replace(/不得流入/, 'do not release downstream');
  }).join('; ');
}
function polishCauseEn(t) {
  const m = String(t || '').match(/(?:根因(?:是|为|：|:)?|原因是|由于|因为)([^，。；;]{3,100})/);
  if (!m) return '';
  return (/确认|证实/.test(t) ? 'Root cause confirmed: ' : 'Preliminary assessment: ') + polishRough(m[1]);
}
function polishSolutionEn(t) {
  const m = String(t || '').match(/(?:建议|对策|方案(?:是|为|：|:)?)([^，。；;]{3,120})/);
  return m ? 'Recommended countermeasure: ' + polishRough(m[1]) : '';
}
function polishActionEn(t) {
  const eq = enEq(polishEquipment(t));
  const eqCore = eq.replace(/#\d+/, '').trim();
  const steps = [];
  polishActionClauses(t).forEach(raw => {
    if (!new RegExp(POLISH_VERBS).test(raw)) return;
    let x = polishNorm(raw)
      .replace(/^(?:今天|今日|本班)?\s*(?:需要|要求|请|计划|安排|务必|建议|由)[^，。；]{0,18}?(?:在|于)?\s*(?:\d{1,2}月\d{1,2}日|20\d{2}[-/]\d{1,2}[-/]\d{1,2})\s*(?:前|之前)?\s*/, '')
      .replace(/^(?:在|于)?\s*(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日)\s*(?:前|之前)?\s*/, '')
      .replace(/^前\s*/, '').replace(/^(?:并|且|然后|接着|同时|将|把|需要|请|要)\s*/, '')
      .replace(/调整为|改为/g, 'adjust to ').replace(/换为/g, 'replace with ')
      .replace(/(?:，|,)?\s*(?:验收标准|验收依据|判定标准|属于|优先级).*$/i, '');
    x = polishNorm(x);
    if (x.length >= 3) steps.push(x);
  });
  if (!steps.length) {
    return 'Execute: ' + forceEn(String(t || '').slice(0, 120));
  }
  // Convert each Chinese verb phrase using i18n term layer (short phrases translate reliably)
  const enSteps = steps.map(x => {
    return forceEn(x);
  });
  return enSteps.join('; ') + '.';
}
function polishAcceptanceEn(t) {
  const m = String(t || '').match(/(?:验收标准|判定标准|验收依据|目标|要求)\s*([^。；;]{2,90})/);
  if (!m) return '';
  let x = m[1].replace(/[，,]?属于.*$/, '');
  x = forceEn(x);
  return 'Acceptance criteria: ' + x + '.';
}
function polishDecisionTopicEn(t) {
  const eq = enEq(polishEquipment(t));
  const clause = polishClauses(t).find(c => /决定|决议|批准|审批|采用|推荐|方案\s*[A-D]/i.test(c)) || String(t || '');
  let core = clause.replace(/^.*?(?:采用|推荐|建议|决定|批准|审批)\s*/, '').replace(/^(?:采用|推荐|建议)\s*/, '')
                   .replace(/^方案\s*[A-D][：:]?\s*/i, '').replace(/[，,]/g, ' and ').replace(/并/g, ' and ');
  core = forceEn(polishNorm(core).replace(/[。；]$/, ''));
  return (eq ? eq + ' ' : '') + (core || 'technical option') + ' decision';
}
function polishOptionsEn(t) {
  const out = [];
  const re = /方案\s*([A-D])[：:]?\s*([^，。；;]{2,50})/gi;
  let m;
  while ((m = re.exec(String(t || ''))) !== null) {
    let v = forceEn(m[2]);
    const line = 'Option ' + m[1].toUpperCase() + ': ' + v;
    if (!out.includes(line)) out.push(line);
  }
  return out.join('; ');
}
function polishRecommendEn(t, optionsEn) {
  const m = String(t || '').match(/方案\s*([A-D])/i);
  if (m) return optionsEn.split('; ').find(x => x.startsWith('Option ' + m[1].toUpperCase())) || 'Option ' + m[1].toUpperCase();
  const n = String(t || '').match(/(?:采用|推荐|建议)\s*([^，。；;]{2,32})/);
  if (!n) return '';
  return forceEn(n[1]);
}
function polishRationaleEn(t) {
  const moc = (String(t || '').match(/MoC[-A-Za-z0-9]+/i) || [''])[0];
  const why = String(t || '').match(/(?:因为|由于|依据)([^，。；;]{4,60})/);
  let s = 'Technical review addresses solution feasibility and risk boundaries';
  if (why) { s += '; basis: ' + forceEn(why[1]); }
  s += moc ? '; submitted for client approval under change control ' + moc : '; client change-control approval required before implementation';
  return s + '.';
}
function polishDecisionBackgroundEn(t, optionsEn) {
  const rec = polishRecommendEn(t, optionsEn) || optionsEn || 'recommended option';
  const moc = (String(t || '').match(/MoC[-A-Za-z0-9]+/i) || [''])[0];
  const client = (String(t || '').match(/(?:客户批准人|批准人)\s*([^，。；;]{2,20})/) || [''])[1];
  let s = 'Based on on-site improvement needs, propose ' + rec;
  if (moc) s += '; change-control reference ' + moc;
  if (client) s += '; client approver ' + client;
  return s + '.';
}
function polishFollowUpEn(owner) {
  return 'Implemented by ' + (owner || 'client owner') + '; verification results and client sign-off to be submitted upon completion.';
}
function polishReportEn(t) {
  const clauses = polishClauses(t).filter(c => !/次日|明天|明日|重点/.test(c));
  if (!clauses.length) return '';
  const eq = enEq(polishEquipment(t));
  const shift = (String(t || '').match(/Shift\s*[AB]|白班|夜班/i) || [''])[0];
  const head = (shift ? shift + ' ' : '') + (eq ? eq + ' ' : '') + 'Shift record: ';
  const body = clauses.map(c => {
    let x = c.replace(/^(?:今日|今天)\s*/, '');
    return forceEn(x);
  }).join('; ');
  return head + body + '.';
}
function polishKpiContextEn(t) {
  return enProd(t).join('; ');
}
function polishNextDayEn(t) {
  const m = String(t || '').match(/(?:次日重点|次日|明天|明日)([^。；;]{0,100})/);
  if (!m) return '';
  const steps = m[1].split(/[，、,]|并|且|同时/).map(polishNorm).filter(x => x.length >= 2);
  return steps.map((x, i) => {
    return '(' + (i + 1) + ') ' + forceEn(x);
  }).join('; ');
}

function buildItem(kind, t, role) {
  const ident = intakeIdentify(t);
  const ws = ident.workstream;
  const ev = intakeEvidence(t);
  const consult = intakeOwner(t, CONSULTING_OWNERS, role.owner);
  const client = intakeOwner(t, CLIENT_OWNERS, CLIENT_OWNERS[0]);
  let data;

  if (kind === 'issue') {
    data = {
      dateRaised: intakeDate(t, 0),
      workstream: ws,
      processEquipment: ident.equipment,
      problemStatement: polishProblem(t),
      evidenceData: polishEvidenceFull(t, ev),
      impactArea: intakeImpact(t),
      priority: intakePriority(t),
      initialContainmentRiskNote: polishContainment(t),
      rootCauseStatus: /根因(?:已)?确认|原因(?:已)?确认|证实/.test(t) ? 'Confirmed' : 'Not Started',
      rootCauseAnalysis: polishCause(t),
      proposedSolution: polishSolution(t),
      consultingOwner: consult,
      clientActionOwner: client,
      targetDate: intakeDate(t, 7),
      status: 'Open',
      escalationLevel: intakeEscalation(t),
      lastUpdate: TODAY,
      closureEvidenceResult: ''
    };
  } else if (kind === 'action') {
    let type = 'Process';
    if (/更换|校准|设备|维修|备件|传感器/.test(t)) type = 'Equipment';
    if (/培训|SOP|标准作业|点检表/.test(t)) type = 'Training';
    if (/SOP|文件|规范/.test(t)) type = 'SOP';
    if (/数据|报告|MES|SPC/.test(t)) type = 'Data';
    data = {
      linkedIssueId: (t.match(/ISS-\d+/i) || [''])[0],
      improvementAction: polishAction(t),
      expectedOutcomeAcceptanceCriteria: polishAcceptance(t) || (ev ? '验收依据：' + ev + '。' : ''),
      actionType: type,
      clientActionOwner: client,
      consultingSupportOwner: consult,
      dateAssigned: TODAY,
      dueDate: intakeDate(t, 3),
      status: 'Not Started',
      percentComplete: 0,
      blockerDependency: polishBlocker(t),
      escalationRequired: /升级|紧急|L2|L3/.test(t) ? 'Yes' : 'No',
      completionDate: '',
      verificationOwner: client,
      verificationResultEvidence: ''
    };
  } else if (kind === 'decision') {
    const options = polishOptions(t);
    data = {
      dateRaised: intakeDate(t, 0),
      linkedIssueId: (t.match(/ISS-\d+/i) || [''])[0],
      decisionTopic: polishDecisionTopic(t),
      backgroundEvidence: polishDecisionBackground(t, options),
      optionsConsidered: options,
      recommendedOption: polishRecommend(t, options),
      technicalRationaleRisks: polishRationale(t),
      technicalReviewer: '技术经理',
      clientApprover: client,
      approvalStatus: /已批准|批准了|审批通过|同意采用|Approved/i.test(t) ? 'Approved' : /否决|拒绝|Rejected/i.test(t) ? 'Rejected' : 'Pending Client Approval',
      decisionDate: /已批准|批准了|审批通过|同意采用/.test(t) ? intakeDate(t, 0) : '',
      conditionsChangeControlRef: (t.match(/MoC[-A-Za-z0-9]+/i) || [''])[0],
      implementationOwner: client,
      effectiveDate: '',
      outcomeFollowUp: polishFollowUp(client)
    };
  } else {
    data = {
      date: intakeDate(t, 0),
      workstream: ws,
      reportingLead: role.report,
      shiftLine: (t.match(/Shift\s*[AB]|白班|夜班/i) || [''])[0],
      productionContextKpi: polishKpiContext(t),
      activitiesObservations: polishReport(t),
      newIssueIds: (t.match(/ISS-\d+/gi) || []).join(', '),
      actionsDecisionsRequired: '',
      clientContactOwner: client,
      nextDayPriorities: polishNextDay(t),
      evidenceLink: ''
    };
  }

  /* ---- parallel English data, composed from the same source t ---- */
  const dataEn = buildItemEn(kind, t, role, data);
  return { kind, data, dataEn, include: true, text: t, textEn: rawDescriptionEn(t), polished: true };
}

function buildItemEn(kind, t, role, cn) {
  if (kind === 'issue') {
    return {
      dateRaised: cn.dateRaised, workstream: EN_WS[cn.workstream] || cn.workstream,
      processEquipment: enEq(cn.processEquipment), problemStatement: polishProblemEn(t),
      evidenceData: polishEvidenceEn(t), impactArea: cn.impactArea, priority: cn.priority,
      initialContainmentRiskNote: polishContainmentEn(t), rootCauseStatus: cn.rootCauseStatus,
      rootCauseAnalysis: polishCauseEn(t), proposedSolution: polishSolutionEn(t),
      consultingOwner: cn.consultingOwner, clientActionOwner: cn.clientActionOwner,
      targetDate: cn.targetDate, status: cn.status, escalationLevel: cn.escalationLevel,
      lastUpdate: cn.lastUpdate, closureEvidenceResult: ''
    };
  }
  if (kind === 'action') {
    const optionsEn = '';
    return {
      linkedIssueId: cn.linkedIssueId, improvementAction: polishActionEn(t),
      expectedOutcomeAcceptanceCriteria: polishAcceptanceEn(t) || (cn.expectedOutcomeAcceptanceCriteria ? 'Inspection basis: ' + enEq(String(cn.expectedOutcomeAcceptanceCriteria).replace(/^验收依据：/, '')) + '.' : ''),
      actionType: cn.actionType, clientActionOwner: cn.clientActionOwner,
      consultingSupportOwner: cn.consultingSupportOwner, dateAssigned: cn.dateAssigned,
      dueDate: cn.dueDate, status: cn.status, percentComplete: cn.percentComplete,
      blockerDependency: cn.blockerDependency ? enEq(cn.blockerDependency) : '',
      escalationRequired: cn.escalationRequired, completionDate: cn.completionDate,
      verificationOwner: cn.verificationOwner, verificationResultEvidence: ''
    };
  }
  if (kind === 'decision') {
    const optionsEn = polishOptionsEn(t);
    return {
      dateRaised: cn.dateRaised, linkedIssueId: cn.linkedIssueId,
      decisionTopic: polishDecisionTopicEn(t), backgroundEvidence: polishDecisionBackgroundEn(t, optionsEn),
      optionsConsidered: optionsEn, recommendedOption: polishRecommendEn(t, optionsEn),
      technicalRationaleRisks: polishRationaleEn(t), technicalReviewer: 'Technical Manager',
      clientApprover: cn.clientApprover, approvalStatus: cn.approvalStatus,
      decisionDate: cn.decisionDate, conditionsChangeControlRef: cn.conditionsChangeControlRef,
      implementationOwner: cn.implementationOwner, effectiveDate: cn.effectiveDate,
      outcomeFollowUp: polishFollowUpEn(cn.implementationOwner)
    };
  }
  return {
    date: cn.date, workstream: EN_WS[cn.workstream] || cn.workstream,
    reportingLead: cn.reportingLead, shiftLine: cn.shiftLine,
    productionContextKpi: polishKpiContextEn(t), activitiesObservations: polishReportEn(t),
    newIssueIds: cn.newIssueIds, actionsDecisionsRequired: '',
    clientContactOwner: cn.clientContactOwner, nextDayPriorities: polishNextDayEn(t), evidenceLink: ''
  };
}

/* English rendering of the raw source description, composed from structured
   signals rather than word-by-word translation of the free-form Chinese. */
function rawDescriptionEn(t) {
  const txt = String(t || '');
  const eq = enEq(polishEquipment(txt));
  const wsEn = EN_WS[intakeIdentify(txt).workstream] || '';
  const when = polishWhen(txt);
  const nums = polishNumbers(txt);
  const rate = polishDefectRate(txt);
  const batch = polishBatchInfo(txt);
  const prod = enProd(txt);
  const clauses = polishClauses(txt);
  const out = [];
  if (when || wsEn || eq) out.push([when, wsEn, eq].filter(Boolean).join(' - ') + ':');
  // defect / observation clauses
  const obs = clauses.filter(c => /发现|出现|异常|不良|缺陷|超标|偏差|虚焊|针孔|毛刺|气胀|褶皱|飞溅|划伤|漏|偏移|波动|停机|报警/.test(c));
  obs.forEach(c => {
    const d = polishDefect(c);
    let ph = enPhenomenon(polishPhenomenon(d, polishEquipment(txt)), polishEquipment(txt));
    if (!ph) ph = enPhenomenon(c, polishEquipment(txt));
    let line;
    if (ph) {
      line = eq ? (eq + ' — ' + ph) : ph;
    } else {
      line = forceEn(polishNorm(c).replace(/^(?:今天|今日|本班|跟线|现场|发现|出现)\s*/, ''));
      line = line.charAt(0).toUpperCase() + line.slice(1);
    }
    const localNums = polishNumbers(c).filter(n => nums.includes(n));
    if (localNums.length && !/[0-9]/.test(line)) line += ' ' + localNums.slice(0, 2).join(' / ');
    out.push('- ' + line + '.');
    const contrib = c.match(/主要是由于([^，。；;]{2,40})/);
    if (contrib) out.push('- Contributing observation: ' + forceEn(contrib[1]) + '.');
    const susp = c.match(/(?:怀疑(?:是)?|推测(?:是)?|初步判断(?:是)?)([^，。；;]{3,60})/);
    if (susp) out.push('- Suspected cause: ' + forceEn(susp[1].replace(/(?:导致|造成|引起|所致)$/, '')) + '.');
  });
  const spec = enSpec(polishSpec(txt));
  if (spec) out.push('- Specification: ' + spec + '.');
  const sample = enSample(txt);
  if (sample) out.push('- Sample: ' + sample + '.');
  const methods = enMethods(txt);
  if (methods.length) out.push('- Inspection: ' + methods.slice(0, 3).join('; ') + '.');
  if (rate) out.push('- Defect rate: ' + rate + '.');
  if (batch) out.push('- Lot: ' + batch + '.');
  if (prod.length) out.push('- ' + prod.join('; ') + '.');
  // action clauses
  const actions = clauses.filter(c => /需要|要求|请|计划|安排|务必|建议|更换|校准|调整|培训|更新|复核|缩短|延长/.test(c));
  actions.forEach(c => {
    const due = intakeDate(c, 3);
    let v = c.replace(/^(?:需要|要求|请|计划|安排|务必|建议)\s*/, '')
             .replace(/在\s*\d{1,2}月\d{1,2}日前?\s*/, '').replace(/(?:\d{1,2}月\d{1,2}日)前\s*/, '');
    v = forceEn(v);
    out.push('- Action: ' + v + (due ? ' (due ' + due + ')' : '') + '.');
  });
  const decision = clauses.find(c => /决定|决议|批准|采用|推荐|方案\s*[A-D]|MoC/i.test(c));
  if (decision) {
    let v = forceEn(decision);
    out.push('- Decision: ' + v + '.');
  }
  if (!out.length) {
    return forceEn(txt);
  }
  return forceEn(out.join('\n'));
}

function mergeIntakeReports(items) {
  const out = [];
  items.forEach(it => {
    const last = out[out.length - 1];
    if (it.kind === 'report' && last && last.kind === 'report') {
      if (it.data.activitiesObservations) last.data.activitiesObservations += '；' + it.data.activitiesObservations;
      if (it.dataEn && it.dataEn.activitiesObservations) last.dataEn.activitiesObservations += '; ' + it.dataEn.activitiesObservations;
      last.text += '；' + it.text;
      if (it.textEn) last.textEn = (last.textEn ? last.textEn + '\n' : '') + it.textEn;
      if (it.data.productionContextKpi && !last.data.productionContextKpi.includes(it.data.productionContextKpi)) {
        last.data.productionContextKpi += (last.data.productionContextKpi ? '；' : '') + it.data.productionContextKpi;
        if (it.dataEn && it.dataEn.productionContextKpi) last.dataEn.productionContextKpi += (last.dataEn.productionContextKpi ? '; ' : '') + it.dataEn.productionContextKpi;
      }
      if (it.data.nextDayPriorities && !last.data.nextDayPriorities) {
        last.data.nextDayPriorities = it.data.nextDayPriorities;
        if (it.dataEn) last.dataEn.nextDayPriorities = it.dataEn.nextDayPriorities;
      }
    } else out.push(it);
  });
  return out;
}

function parseIntakeText(text, role) {
  intakeItems = mergeIntakeReports(intakeBlocks(text).map(b => buildItem(detectKind(b), b, role)));
  const shift = text.match(/Shift\s*[AB]|白班|夜班/i);
  if (shift) intakeItems.filter(i => i.kind === 'report').forEach(i => { i.data.shiftLine = shift[0]; });
  // whole-source professional English rendering (structured, not word-by-word)
  window._intakeDraftEn = intakeItems.map(i => i.textEn).filter(Boolean).join('\n\n');
  intakeParsed = true;
  return intakeItems;
}

/* ---------------- rendering ---------------- */
const INTAKE_EDIT_FIELDS = {
  issue: [
    ['problemStatement', 'textarea'], ['processEquipment', 'text'],
    ['workstream', 'select:WORKSTREAMS'], ['priority', 'select:PRIORITIES'],
    ['impactArea', 'select:IMPACT_AREAS'], ['escalationLevel', 'select:ESCALATIONS'],
    ['consultingOwner', 'select:CONSULTING_OWNERS'], ['clientActionOwner', 'select:CLIENT_OWNERS'],
    ['targetDate', 'date'], ['dateRaised', 'date']
  ],
  action: [
    ['improvementAction', 'textarea'], ['expectedOutcomeAcceptanceCriteria', 'text'],
    ['actionType', 'select:ACTION_TYPES'], ['linkedIssueId', 'text'],
    ['clientActionOwner', 'select:CLIENT_OWNERS'], ['consultingSupportOwner', 'select:CONSULTING_OWNERS'],
    ['dueDate', 'date'], ['escalationRequired', 'select:["No","Yes"]']
  ],
  decision: [
    ['decisionTopic', 'text'], ['recommendedOption', 'text'],
    ['approvalStatus', 'select:APPROVAL_STATUSES'], ['clientApprover', 'select:CLIENT_OWNERS'],
    ['linkedIssueId', 'text'], ['conditionsChangeControlRef', 'text']
  ],
  report: [
    ['activitiesObservations', 'textarea'], ['workstream', 'select:WORKSTREAMS'],
    ['reportingLead', 'select:CONSULTING_OWNERS'], ['shiftLine', 'text'],
    ['productionContextKpi', 'text'], ['nextDayPriorities', 'text']
  ]
};

const INTAKE_FIELD_LABELS = {
  problemStatement: '问题陈述', processEquipment: '工序 / 设备', workstream: '专业组', priority: '优先级',
  impactArea: '影响域', escalationLevel: '升级级别', consultingOwner: '我方负责人', clientActionOwner: '客户执行人',
  targetDate: '目标日期', dateRaised: '发现日期', improvementAction: '改进行动', expectedOutcomeAcceptanceCriteria: '验收标准',
  actionType: '行动类型', linkedIssueId: '关联问题', dueDate: '到期日', consultingSupportOwner: '我方支持',
  escalationRequired: '需升级', decisionTopic: '决策主题', recommendedOption: '推荐方案', approvalStatus: '审批状态',
  clientApprover: '客户批准人', conditionsChangeControlRef: 'MoC 编号', activitiesObservations: '跟线观察',
  reportingLead: '报告人', shiftLine: '班次 / 产线', productionContextKpi: '生产背景 / KPI', nextDayPriorities: '次日重点'
};

const INTAKE_LABELS = {
  issue: { name: '技术问题', target: '技术问题台账', cls: 'blue' },
  action: { name: '改进行动', target: '改进行动跟踪', cls: 'teal' },
  decision: { name: '技术决策', target: '技术决策日志', cls: 'purple' },
  report: { name: '跟线日报', target: '每日跟线报告', cls: 'warn' }
};

/* Personnel fields allow a name beyond the preset roster (mirrors app.js). */
const OWNER_CUSTOM_VAL = '__CUSTOM_PERSON__';
function intakeIsOwnerKey(k) { return /Owner$|Lead$|Approver$|Reviewer$/.test(String(k || '')); }
function intakeOwnerLabels() {
  const en = (() => { try { return !!(window.I18N && window.I18N.lang === 'en'); } catch (e) { return false; } })();
  return en
    ? { option: '✎ Enter name manually…', placeholder: 'Enter the specific person name' }
    : { option: '✎ 手动输入具体人员…', placeholder: '输入具体人员姓名' };
}

function intakeSelectOptions(spec) {
  if (spec.startsWith('select:')) {
    const expr = spec.slice(7);
    let list;
    try { list = eval(expr); } catch (e) { list = []; }
    return opts(list, null);
  }
  return '';
}

function renderIntake() {
  const counts = { issue: 0, action: 0, decision: 0, report: 0 };
  intakeItems.forEach(i => { if (i.include) counts[i.kind]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return `
  <div class="page-head"><div><h1>智能录入</h1><p>把整段描述粘贴进来，系统自动识别问题、行动、决策与日报，确认后写入对应台账</p></div>
    <div class="actions"><button class="btn" id="btnIntakeClear">清空</button></div></div>

  <div class="grid grid-23" style="margin-bottom:18px">
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">原始描述</h3><div class="card-sub">支持一段话、多行记录、会议纪要或日报原文</div></div></div>
      <div class="card-body">
        <div class="fld" style="margin-bottom:12px"><label>录入人角色</label>
          <select id="intakeRole">${INTAKE_ROLES.map(r => `<option value="${esc(r.label)}">${esc(r.label)}</option>`).join('')}</select>
          <div class="hint">未明确写出责任人时，按角色自动带入默认负责人</div>
        </div>
        <div class="fld"><label>描述内容 <span class="req">*</span></label>
          <textarea id="intakeText" data-i18n-value="1" data-en-value="${esc(window._intakeDraftEn || '')}" rows="14" placeholder="例：今天跟线叠片机#3，发现对齐度偏移±0.8mm，规格±0.5mm，CCD 200片确认。需要设备工程师在11月26日前更换定位销……">${esc(window._intakeDraft || '')}</textarea>
          <div class="hint" id="intakeLangHint" data-i18n-en-only="1" style="display:none">当前为英文对照显示，中文原文已保留；如需编辑或重新识别，请切回中文</div>
          <div class="hint">系统按句号、分号、换行切分，识别四类内容，并将口语化原文整理为结构化表述后填入条目</div>
        </div>
        <button class="btn btn-primary btn-block" id="btnIntakeParse" style="margin-top:14px">分析并整理</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><h3 class="card-title">识别规则</h3><div class="card-sub">从描述中自动提取的字段</div></div></div>
      <div class="card-body">
        <div class="sec-title" style="margin-top:0"><span class="n">1</span>自动分类</div>
        <div class="rule-list">
          <div class="rule"><div class="rule-ic l" data-i18n-en="I">问</div><div><b>问题 → 技术问题台账</b><p>异常、超标、虚焊、划伤、针孔、毛刺、偏移、停机、气胀、不良等。</p></div></div>
          <div class="rule"><div class="rule-ic m" data-i18n-en="A">行</div><div><b>行动 → 改进行动跟踪</b><p>需要、要求、计划、更换、校准、培训、更新、跟进、前完成等。</p></div></div>
          <div class="rule"><div class="rule-ic l" data-i18n-en="D">决</div><div><b>决策 → 技术决策日志</b><p>决定、批准、审批、推荐、采用、方案 A/B、MoC 编号等。</p></div></div>
          <div class="rule"><div class="rule-ic m" data-i18n-en="R">报</div><div><b>日报 → 每日跟线报告</b><p>今日跟线、班次、产出、FPY/OEE、次日重点等。</p></div></div>
        </div>
        <div class="sec-title"><span class="n">2</span>语言优化规则</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.9;border-left:2px solid var(--primary);padding-left:10px;margin-bottom:12px">
          问题：按技术深度分析生成四段式 —— 【已确认事实】只写原文事实与量化偏差；【影响链分析｜推断】给出下游工序与电芯性能 / 安全的影响路径；【待验证假设｜非结论】列出 5M1E 机理方向与验证项；【当前处置与信息缺口】明确围堵状态与缺失数据。推断与事实严格分离，不臆造数值<br>
          行动：动作 + 设备对象 + 要求（去掉"需要 / 请 / 在…前"等口语前缀）<br>
          决策：主题 + 备选方案 + 推荐项 + 变更控制依据<br>
          日报：班次 / 设备 + 客观记录 + 编号化的次日重点<br>
          <b>不照搬原话，不臆造原文没有的事实。</b>
        </div>
        <div class="sec-title"><span class="n">3</span>自动提取字段</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.9">
          工序设备：按设备/工位关键词 + 机台号精确识别（叠片机#3、顶盖激光焊机#1、Coating #2）<br>
          优先级：Critical / High / Medium / Low（安全与停线自动判 Critical）<br>
          日期：2026-11-26、11月26日、明天、下周<br>
          责任人：匹配团队成员与客户接口人姓名<br>
          数值证据：自动统一单位格式（±0.8 mm、93.7%、3.8 mΩ）<br>
          关联问题：自动抓取文中的 ISS-xxx 编号
        </div>
        <div class="callout" style="margin-top:14px"><b>确认后写入：</b>所有条目先在此预览，可逐字段修改、勾选或剔除；点击"确认写入"才真正进入台账，不会直接改动原始数据。</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div><h3 class="card-title">整理结果</h3><div class="card-sub">${intakeParsed ? `共识别 ${intakeItems.length} 条，勾选写入 ${total} 条` : '尚未分析'}</div></div>
      <div class="right">
        ${intakeParsed ? `<span class="tag blue">问题 ${counts.issue}</span><span class="tag teal">行动 ${counts.action}</span><span class="tag purple">决策 ${counts.decision}</span><span class="tag warn">日报 ${counts.report}</span>` : ''}
        ${intakeParsed ? `<button class="btn btn-sm" id="btnIntakeAll">全选</button><button class="btn btn-primary btn-sm" id="btnIntakeCommit">确认写入 ${total} 条</button>` : ''}
      </div></div>
    <div class="card-body" id="intakeResults">
      ${!intakeParsed ? `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><div>粘贴描述后点击"分析并整理"，结果会显示在这里</div></div>` : intakeItems.length ? intakeItems.map((it, idx) => {
        const meta = INTAKE_LABELS[it.kind];
        const fields = INTAKE_EDIT_FIELDS[it.kind].map(([key, type]) => {
          const val = it.data[key] == null ? '' : String(it.data[key]);
          const enVal = it.dataEn && it.dataEn[key] != null ? String(it.dataEn[key]) : '';
          let ctrl;
          if (type === 'textarea') {
            const rows = key === 'problemStatement' ? 14 : (key === 'improvementAction' || key === 'activitiesObservations' ? 4 : 2);
            ctrl = `<textarea data-i18n-value="1" data-en-value="${esc(enVal)}" data-idx="${idx}" data-key="${key}" rows="${rows}">${esc(val)}</textarea>`;
          }
          else if (type.startsWith('select:')) {
            const spec = type.slice(7);
            let list;
            try { list = eval(spec); } catch (e) { list = []; }
            // select values stay canonical (Chinese data keys); option display is translated by i18n
            if (intakeIsOwnerKey(key)) {
              const isCustom = val && !list.includes(val);
              const L = intakeOwnerLabels();
              const selVal = isCustom ? OWNER_CUSTOM_VAL : val;
              ctrl = `<div class="owner-field"><select data-idx="${idx}" data-key="${key}" data-owner-select="1">${opts(list, selVal)}<option value="${OWNER_CUSTOM_VAL}"${isCustom ? ' selected' : ''}>${esc(L.option)}</option></select>`
                + `<input type="text" class="owner-custom" data-idx="${idx}" data-key="${key}" data-owner-custom="1" value="${esc(isCustom ? val : '')}" placeholder="${esc(L.placeholder)}" style="${isCustom ? '' : 'display:none'}"></div>`;
            } else {
              ctrl = `<select data-idx="${idx}" data-key="${key}">${opts(list, val)}</select>`;
            }
          } else ctrl = `<input type="${type}" data-i18n-value="1" data-en-value="${esc(enVal)}" data-idx="${idx}" data-key="${key}" value="${esc(val)}">`;
          return `<div class="fld"><label>${esc(INTAKE_FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()))}</label>${ctrl}</div>`;
        }).join('');
        return `<div class="intake-item" style="border:1px solid var(--border);border-radius:9px;padding:14px;margin-bottom:12px;background:${it.include ? '#fff' : 'var(--surface-2)'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer"><input type="checkbox" data-include="${idx}" ${it.include ? 'checked' : ''}> 纳入</label>
            <span class="tag ${meta.cls}">${esc(meta.name)}</span>
            <span class="small">写入 → <b>${esc(meta.target)}</b></span>
            <span class="small" style="margin-left:auto">已按结构化语言整理</span>
          </div>
          <details class="small" style="margin-bottom:10px;color:var(--muted)"><summary>核对原文（写入内容以整理后的字段为准）</summary><div data-i18n-en="${esc(it.textEn || '')}" style="margin-top:6px;padding:8px;background:var(--surface-2);border-radius:5px;line-height:1.6">${esc(it.text)}</div></details>
          <div class="form-grid c3">${fields}</div>
        </div>`;
      }).join('') : `<div class="empty">未识别到有效内容，请检查描述后重试</div>`}
    </div>
  </div>`;
}

/* ---------------- commit ---------------- */
function intakeNextIds(arr, prefix, key, n) {
  const max = arr.reduce((m, x) => {
    const v = String(x[key] || '').match(/(\d+)$/);
    return v ? Math.max(m, +v[1]) : m;
  }, 0);
  return Array.from({ length: n }, (_, i) => prefix + String(max + 1 + i).padStart(3, '0'));
}

function commitIntake() {
  const selected = intakeItems.filter(i => i.include);
  if (!selected.length) { toast('请至少勾选一条内容'); return; }
  const issueIds = intakeNextIds(DB.issues, 'ISS-', 'issueId', selected.filter(i => i.kind === 'issue').length);
  const actionIds = intakeNextIds(DB.actions, 'ACT-', 'actionId', selected.filter(i => i.kind === 'action').length);
  const decIds = intakeNextIds(DB.decisions, 'DEC-', 'decisionId', selected.filter(i => i.kind === 'decision').length);
  let ni = 0, na = 0, nd = 0;
  const madeIssues = [];

  selected.forEach(it => {
    const d = Object.assign({}, it.data);
    // Carry a parallel English copy so the ledger can render professional EN
    // text instead of word-by-word translating the Chinese source.
    if (it.dataEn) d._en = Object.assign({}, it.dataEn);
    if (it.kind === 'issue') {
      d.issueId = issueIds[ni++];
      DB.issues.push(d); madeIssues.push(d.issueId);
    } else if (it.kind === 'action') {
      d.actionId = actionIds[na++];
      if (!d.linkedIssueId) d.linkedIssueId = madeIssues[0] || (DB.issues[DB.issues.length - 1] || {}).issueId || '';
      DB.actions.push(d);
    } else if (it.kind === 'decision') {
      d.decisionId = decIds[nd++];
      if (!d.linkedIssueId) d.linkedIssueId = madeIssues[0] || '';
      DB.decisions.push(d);
    } else {
      DB.reports.unshift(d);
    }
  });
  saveDB();
  const parts = [];
  if (ni) parts.push('问题 ' + ni);
  if (na) parts.push('行动 ' + na);
  if (nd) parts.push('决策 ' + nd);
  if (selected.length - ni - na - nd) parts.push('日报 ' + (selected.length - ni - na - nd));
  intakeItems = [];
  intakeParsed = false;
  window._intakeDraft = '';
  toast('已写入：' + parts.join(' / '));
  route();
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('#btnTopIntake')) { location.hash = 'intake'; return; }
  if (currentPage !== 'intake') return;
  if (e.target.closest('#btnIntakeClear')) {
    window._intakeDraft = '';
    intakeItems = []; intakeParsed = false;
    route();
    return;
  }
  if (e.target.closest('#btnIntakeParse')) {
    const ta = document.getElementById('intakeText');
    const roleSel = document.getElementById('intakeRole');
    const text = ta ? String(window.I18N && window.I18N.sourceValue ? window.I18N.sourceValue(ta) : ta.value).trim() : '';
    if (!text) { toast('请先粘贴描述内容'); return; }
    window._intakeDraft = text;
    const role = INTAKE_ROLES.find(r => r.label === (roleSel ? roleSel.value : '')) || INTAKE_ROLES[0];
    const found = parseIntakeText(text, role);
    toast('识别到 ' + found.length + ' 条内容');
    route();
    return;
  }
  if (e.target.closest('#btnIntakeAll')) {
    intakeItems.forEach(i => { i.include = true; });
    route();
    return;
  }
  if (e.target.closest('#btnIntakeCommit')) { commitIntake(); return; }
});

document.addEventListener('change', (e) => {
  if (currentPage !== 'intake') return;
  const inc = e.target.dataset.include;
  if (inc != null) { intakeItems[+inc].include = e.target.checked; route(); return; }
  // Owner select: reveal custom-name input and write the chosen value.
  if (e.target.hasAttribute('data-owner-select')) {
    const idx = e.target.dataset.idx, key = e.target.dataset.key;
    const wrap = e.target.closest('.owner-field');
    const custom = wrap && wrap.querySelector('[data-owner-custom]');
    const isCustom = e.target.value === OWNER_CUSTOM_VAL;
    if (custom) { custom.style.display = isCustom ? '' : 'none'; if (isCustom) custom.focus(); }
    if (idx != null && key && intakeItems[+idx]) {
      const chosen = isCustom ? (custom ? custom.value : '') : e.target.value;
      intakeItems[+idx].data[key] = chosen;
      if (intakeItems[+idx].dataEn) intakeItems[+idx].dataEn[key] = chosen;
    }
    return;
  }
  const idx = e.target.dataset.idx, key = e.target.dataset.key;
  if (idx != null && key && intakeItems[+idx]) intakeItems[+idx].data[key] = e.target.value;
});

function intakeIsEn() { return !!(window.I18N && window.I18N.lang === 'en'); }
document.addEventListener('input', (e) => {
  if (currentPage !== 'intake') return;
  // Custom owner name: keep as typed in BOTH language copies (names are not translated).
  if (e.target.hasAttribute && e.target.hasAttribute('data-owner-custom')) {
    const idx = e.target.dataset.idx, key = e.target.dataset.key;
    if (idx != null && key && intakeItems[+idx]) {
      intakeItems[+idx].data[key] = e.target.value;
      if (intakeItems[+idx].dataEn) intakeItems[+idx].dataEn[key] = e.target.value;
    }
    return;
  }
  const idx = e.target.dataset.idx, key = e.target.dataset.key;
  if (idx != null && key && intakeItems[+idx]) {
    // Keep the edited text in the active-language data object; the other
    // language keeps its structured version. Written ledger always uses data (Chinese).
    if (intakeIsEn() && intakeItems[+idx].dataEn) intakeItems[+idx].dataEn[key] = e.target.value;
    else intakeItems[+idx].data[key] = e.target.value;
  }
  if (e.target.id === 'intakeText') window._intakeDraft = e.target.value;
});
