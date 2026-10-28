const WORKSPACE_KEY = 'sop-loop-workspace'
const LEGACY_KEY = 'sop-loop-v1'
const GUIDE_KEY = 'sop-loop-guide-hidden'
const GUIDE_STEPS = [
  { view: 'today', selector: '[data-tour="nav-study"]', label: '学习', title: '进入学习工作台', body: '这里放任务计划、专注计时和刚刚完成的结果。下一步会带你添加一个任务。' },
  { view: 'study', selector: '[data-tour="task-entry"]', label: '任务计划', title: '先写下一个任务', body: '输入任务、科目和计划分钟。计划分钟会在分析页和真实专注时间比较。' },
  { view: 'study', selector: '[data-tour="task-start"]', fallback: '[data-tour="task-entry"]', label: '开始', title: '从任务开始专注', body: '点击任务右侧的“开始”，完成后按“结束并记录”，系统会保留这次执行。' },
  { view: 'study', selector: '[data-tour="nav-review"]', label: '复盘', title: '每天留下复盘', body: '复盘只需要记录精力、做得好的地方、阻碍和明天的一件改动。' },
  { view: 'review', selector: '[data-tour="review-form"]', label: '复盘表单', title: '让记录变成下一步', body: '保存复盘后，可以用本地规则或 DeepSeek 整理成行动建议。' },
  { view: 'review', selector: '[data-tour="nav-analysis"]', label: '分析', title: '在分析页看模式', body: '这里会把 SOP、任务、专注、错题和复盘放进同一个时间窗口。' },
  { view: 'analysis', selector: '[data-tour="weekly-report"]', label: '生成周报', title: '生成一份周报', body: '周报会汇总计划与实际、阻碍分类、精力差异和下周实验建议。' }
]
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const clone = (value) => JSON.parse(JSON.stringify(value))
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const now = () => new Date().toISOString()

const subjectDefaults = {
  英语: { knowledgeTree: ['阅读', '翻译', '作文'], questionTypes: ['阅读', '翻译', '作文'], examEnabled: false },
  数学: { knowledgeTree: ['高等数学', '线性代数', '概率论'], questionTypes: ['选择题', '填空题', '大题', '证明题'], examEnabled: true },
  '822控制': { knowledgeTree: ['系统建模与方块图', '时域分析', '稳定性判据', '根轨迹', '频域分析', '校正与设计', '状态空间'], questionTypes: ['选择题', '大题'], examEnabled: true }
}

const seed = {
  version: 2,
  sops: [
    { id: 'focus', title: '深度工作', description: '完成一个可以交付的小结果', estimate: 90, steps: ['写下今天唯一的交付物', '连续工作 45 分钟', '休息 10 分钟后再做一轮', '记录实际完成的结果'], subject: '', active: true, version: 1, createdAt: Date.now(), updatedAt: Date.now() },
    { id: 'review', title: '每日复盘', description: '记录今天发生了什么，决定明天只改一件事', estimate: 10, steps: ['回看今天的执行记录', '写下一个做得好的地方', '写下最大的阻碍', '决定明天的一个改动'], subject: '', active: true, version: 1, createdAt: Date.now(), updatedAt: Date.now() }
  ],
  tasks: [{ id: 'sample-study', title: '线性代数特征值练习', date: today(), kind: 'today', sopId: '', subject: '数学', categoryPath: '数学/线性代数', tags: [], completed: false, completedPomodoros: 0, createdAt: Date.now(), updatedAt: Date.now() }],
  focusSessions: [], reviews: [], mistakes: [], subjectConfig: clone(subjectDefaults),
  settings: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', apiKey: '' }, sync: {}
}

let state = load()
let view = 'today'
let selectedSop = state.sops[0]?.id || null
let timer = null
let analysisText = ''
let weeklyReportText = ''
let mistakeQuery = ''
let pendingSessionId = null
let guideState = { active: false, step: 0, dontShow: localStorage.getItem(GUIDE_KEY) === '1' }
let guideKeyBound = false

function readJSON(key, fallback = null) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback } catch { return fallback } }
const assetDB = (() => {
  let promise
  function open() {
    if (!('indexedDB' in window)) return Promise.resolve(null)
    if (promise) return promise
    promise = new Promise((resolve, reject) => {
      const request = indexedDB.open('sop-loop-assets', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return promise
  }
  return {
    async put(file) { const db = await open(); if (!db) return ''; const id = uid('asset'); await new Promise((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'); tx.objectStore('assets').put({ id, name: file.name, type: file.type, blob: file }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); return id },
    async get(id) { const db = await open(); if (!db) return null; return new Promise((resolve, reject) => { const request = db.transaction('assets').objectStore('assets').get(id); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error) }) }
  }
})()
function normalizeSubjectConfig(raw) {
  const out = {}
  Object.keys(subjectDefaults).forEach((subject) => {
    const source = raw?.[subject] || {}
    const tree = Array.isArray(source.knowledgeTree) ? source.knowledgeTree : subjectDefaults[subject].knowledgeTree
    out[subject] = { ...subjectDefaults[subject], ...source, knowledgeTree: tree.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean), questionTypes: [...new Set((Array.isArray(source.questionTypes) ? source.questionTypes : subjectDefaults[subject].questionTypes).map(String).filter(Boolean))] }
  })
  return out
}
function normalizeTask(raw = {}) { const completedOn = Array.isArray(raw.completedOn) ? raw.completedOn.filter(Boolean) : (raw.completed ? [raw.completedDate || raw.date || today()] : []); return { ...raw, id: String(raw.id || uid('task')), title: String(raw.title || raw.text || '').trim(), date: raw.kind === 'habit' ? '' : (raw.date || today()), kind: raw.kind === 'habit' ? 'habit' : 'today', sopId: raw.sopId || '', subject: raw.subject || raw.categoryPath?.split?.('/')[0] || '', categoryPath: raw.categoryPath || '', tags: Array.isArray(raw.tags) ? raw.tags : [], priority: Math.min(3, Math.max(1, Number(raw.priority) || 2)), plannedMinutes: Math.max(0, Number(raw.plannedMinutes ?? raw.estimate) || 0), completedOn, completed: completedOn.includes(today()), completedPomodoros: Number(raw.completedPomodoros) || 0, createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now() } }
function normalizeSop(raw = {}) { return { ...raw, id: String(raw.id || uid('sop')), title: String(raw.title || '未命名 SOP').trim(), description: raw.description || '', estimate: Number(raw.estimate) || 30, steps: Array.isArray(raw.steps) ? raw.steps : [], subject: raw.subject || '', active: raw.active !== false, version: Number(raw.version) || 1, history: Array.isArray(raw.history) ? raw.history : [], createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now() } }
function normalizeSession(raw = {}) { return { ...raw, id: String(raw.id || uid('session')), date: raw.date || today(), taskId: raw.taskId || '', sopId: raw.sopId || '', duration: Number(raw.duration ?? raw.minutes) || 0, startedAt: Number(raw.startedAt || raw.timestamp || Date.now()), endedAt: Number(raw.endedAt || raw.timestamp || Date.now()), sessionName: raw.sessionName || raw.title || '未命名专注', sessionNote: raw.sessionNote || raw.note || '', result: raw.result || '', difficulty: raw.difficulty || '', nextAction: raw.nextAction || '', endedEarly: Boolean(raw.endedEarly) } }
function normalizeReview(raw = {}, kind = 'daily') { return { ...raw, id: String(raw.id || uid('review')), date: raw.date || today(), kind: raw.kind || kind, sourceId: raw.sourceId || raw.sessionId || '', energy: Number(raw.energy) || 3, good: raw.good || raw.selfReview || '', block: raw.block || raw.problem || '', blockerCategory: raw.blockerCategory || '其他', result: raw.result || '', next: raw.next || raw.nextAction || raw.tomorrowTasks || '', aiSummary: raw.aiSummary || raw.aiAnalysis || '', createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now() } }
function normalizeMistake(raw = {}) { const path = Array.isArray(raw.knowledgePath) ? raw.knowledgePath : [raw.module, raw.unit].filter(Boolean); return { ...raw, id: String(raw.id || uid('mistake')), subject: raw.subject || '数学', knowledgePath: path.length ? path : ['未分类'], questionType: raw.questionType || '未分类题型', topic: Array.isArray(raw.topic) ? raw.topic : raw.topic ? [raw.topic] : [], tags: Array.isArray(raw.tags) ? raw.tags : [], title: raw.title || '未命名错题', question: raw.question || '', answer: raw.answer || '', reviewCount: Number(raw.reviewCount) || 0, reviewInterval: Number(raw.reviewInterval) || 0, reviewHistory: Array.isArray(raw.reviewHistory) ? raw.reviewHistory : [], lastReviewedAt: raw.lastReviewedAt || '', nextReviewAt: raw.nextReviewAt || '', attachmentIds: Array.isArray(raw.attachmentIds) ? raw.attachmentIds : [], answerAttachmentIds: Array.isArray(raw.answerAttachmentIds) ? raw.answerAttachmentIds : [], createdAt: raw.createdAt || now(), updatedAt: raw.updatedAt || now() } }
function normalizeState(raw = {}) {
  const source = raw.appData && typeof raw.appData === 'object' ? { ...raw, ...raw.appData } : raw
  const oldRuns = Array.isArray(source.runs) ? source.runs : []
  const sessionItems = (Array.isArray(source.focusSessions) ? source.focusSessions : []).concat(oldRuns).map(normalizeSession)
  const reviewItems = []
  const addReviews = (items, kind) => (Array.isArray(items) ? items : []).forEach((item) => reviewItems.push(normalizeReview(item, kind)))
  addReviews(source.reviews, 'daily'); addReviews(source.dailyReviews, 'daily'); addReviews(source.sessionReviews, 'session'); addReviews(source.dailyCloseEntries, 'daily')
  const unique = (items) => [...new Map(items.map((item) => [item.id, item])).values()]
  return { version: 3, sops: Array.isArray(source.sops) ? source.sops.map(normalizeSop) : clone(seed.sops).map(normalizeSop), tasks: unique((Array.isArray(source.tasks) ? source.tasks : []).map(normalizeTask)), focusSessions: unique(sessionItems), reviews: unique(reviewItems), mistakes: unique((Array.isArray(source.mistakes) ? source.mistakes : (Array.isArray(source.questions) ? source.questions : [])).map(normalizeMistake)), subjectConfig: normalizeSubjectConfig(source.subjectConfig || source['shiti-subject-config']), settings: { ...seed.settings, ...(source.settings || {}), ...(source.deepseekSettings || {}) }, sync: source.sync || {} }
}
function load() {
  const raw = readJSON(WORKSPACE_KEY, null) || readJSON(LEGACY_KEY, {}) || {}
  const external = { ...raw }
  if (!external.tasks) external.tasks = readJSON('tasks', [])
  if (!external.focusSessions) external.focusSessions = readJSON('focusSessions', [])
  if (!external.questions && !external.mistakes) external.questions = readJSON('shiti-questions', [])
  if (!external.subjectConfig) external.subjectConfig = readJSON('shiti-subject-config', null)
  const result = normalizeState(external)
  if (!result.tasks.length && !raw.sops && !raw.questions) result.tasks = clone(seed.tasks)
  if (!result.sops.length) result.sops = clone(seed.sops)
  return result
}
function save() { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state)) }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function formatMinutes(total) { const min = Math.round(total); return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m` }
function dayLabel(date) { return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) }
function dateKey(value) { if (typeof value === 'number' || /^\d{10,}$/.test(String(value || ''))) return new Date(Number(value)).toISOString().slice(0, 10); return String(value || today()).slice(0, 10) }
function taskCompletedOn(task, date) { return Array.isArray(task.completedOn) ? task.completedOn.includes(date) : Boolean(task.completed && (!task.date || task.date === date)) }
function taskDoneToday(task) { return taskCompletedOn(task, today()) }
function tasksToday() { return state.tasks.filter((task) => task.kind === 'habit' || !task.date || task.date === today()) }
function tasksDue() { return state.tasks.filter((task) => task.kind === 'habit' || !task.date || task.date <= today()) }
function overdueTasks() { return state.tasks.filter((task) => task.kind !== 'habit' && task.date && task.date < today() && !taskDoneToday(task)) }
function sessionsToday() { return state.focusSessions.filter((session) => session.date === today()) }
function minutesToday() { return sessionsToday().reduce((sum, session) => sum + session.duration, 0) }
function reviewToday() { return state.reviews.find((review) => review.kind === 'daily' && review.date === today()) }
function dueMistakes() { return state.mistakes.filter((mistake) => mistake.nextReviewAt ? new Date(mistake.nextReviewAt).getTime() <= Date.now() : (!mistake.lastReviewedAt || Date.now() - new Date(mistake.lastReviewedAt).getTime() > 7 * 86400000)) }
function formatClock(seconds) { const m = Math.floor(seconds / 60).toString().padStart(2, '0'); const s = (seconds % 60).toString().padStart(2, '0'); return `${m}:${s}` }
function reviewStreak() { let count = 0; const dates = new Set(state.reviews.filter((r) => r.kind === 'daily').map((r) => r.date)); const cursor = new Date(`${today()}T12:00:00`); while (dates.has(cursor.toISOString().slice(0, 10))) { count++; cursor.setDate(cursor.getDate() - 1) } return count }
function addDays(date, days) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10) }
function priorityLabel(priority) { return priority === 3 ? '高' : priority === 1 ? '低' : '中' }
function taskSort(a, b) { const overdue = (task) => task.date && task.date < today() && !taskDoneToday(task) ? 1 : 0; return overdue(b) - overdue(a) || (b.priority || 2) - (a.priority || 2) || String(a.date || '').localeCompare(String(b.date || '')) }
function upsertDailyReview(fields = {}) { const old = reviewToday(); const review = normalizeReview({ ...(old || {}), id: old?.id || uid('daily'), date: today(), kind: 'daily', sourceId: today(), ...fields, updatedAt: Date.now() }); if (old) Object.assign(old, review); else state.reviews.unshift(review); return review }
function sessionForTask(taskId, days = null) { return state.focusSessions.filter((session) => session.taskId === taskId && (!days || days.includes(session.date))) }
function linkedSubject(session) { const task = state.tasks.find((item) => item.id === session.taskId); if (task?.subject) return task.subject; const sop = state.sops.find((item) => item.id === session.sopId); return sop?.subject || '未分类' }
function metricRows(items, empty = '还没有足够数据') { return items.length ? items.map((item) => `<div class="metric-row">${item}</div>`).join('') : `<div class="empty">${empty}</div>` }
function guideTarget(step) { const selectors = [step.selector, step.fallback].filter(Boolean); for (const selector of selectors) { const target = [...document.querySelectorAll(selector)].find((item) => { const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }) ; if (target) return target } return null }
function setGuideHidden(hidden) { guideState.dontShow = hidden; if (hidden) localStorage.setItem(GUIDE_KEY, '1'); else localStorage.removeItem(GUIDE_KEY) }
function beginGuide(force = false) { if (guideState.dontShow && !force) return; guideState = { active: true, step: 0, dontShow: guideState.dontShow }; view = GUIDE_STEPS[0].view; render() }
function closeGuide() { setGuideHidden(guideState.dontShow); guideState.active = false; guideState.step = 0; document.body.classList.remove('guide-open'); render() }
function nextGuideStep() { if (guideState.step >= GUIDE_STEPS.length - 1) { closeGuide(); return } guideState.step += 1; view = GUIDE_STEPS[guideState.step].view; render() }
function previousGuideStep() { if (guideState.step <= 0) return; guideState.step -= 1; view = GUIDE_STEPS[guideState.step].view; render() }
function renderGuide() {
  document.querySelector('.guide-overlay')?.remove()
  document.querySelectorAll('.guide-target').forEach((item) => item.classList.remove('guide-target'))
  if (!guideState.active) { document.body.classList.remove('guide-open'); return }
  const step = GUIDE_STEPS[guideState.step]
  const target = guideTarget(step)
  target?.classList.add('guide-target')
  document.body.classList.add('guide-open')
  const overlay = document.createElement('div')
  overlay.className = 'guide-overlay'
  overlay.innerHTML = `<div class="guide-card" role="dialog" aria-modal="true" aria-labelledby="guide-title"><div class="guide-card-top"><span class="guide-progress">${guideState.step + 1} / ${GUIDE_STEPS.length}</span><button class="guide-close" data-guide-action="close" aria-label="关闭操作指引">×</button></div><h3 id="guide-title">${escapeHtml(step.title)}</h3><p>${escapeHtml(step.body)}</p><div class="guide-target-label">${target ? `建议点击：${escapeHtml(step.label)}` : '可以先完成这一步，再继续'}</div><label class="guide-preference"><input id="guide-dont-show" type="checkbox" ${guideState.dontShow ? 'checked' : ''} /> 不再显示操作指引</label><div class="guide-actions"><button class="btn ghost" data-guide-action="previous" ${guideState.step === 0 ? 'disabled' : ''}>上一步</button><button class="btn ghost" data-guide-action="skip">跳过</button><button class="btn primary" data-guide-action="next">${guideState.step === GUIDE_STEPS.length - 1 ? '完成' : '下一步'}</button></div></div>`
  document.querySelector('#app').appendChild(overlay)
  overlay.querySelector('#guide-dont-show').addEventListener('change', (event) => { guideState.dontShow = event.target.checked })
  overlay.querySelectorAll('[data-guide-action]').forEach((button) => button.addEventListener('click', () => { const actionName = button.dataset.guideAction; if (actionName === 'next') nextGuideStep(); if (actionName === 'previous') previousGuideStep(); if (actionName === 'skip' || actionName === 'close') closeGuide() }))
  requestAnimationFrame(() => {
    const card = overlay.querySelector('.guide-card')
    if (!card || !target) return
    const rect = target.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const gap = 14
    const top = rect.bottom + gap + cardRect.height <= window.innerHeight ? rect.bottom + gap : Math.max(16, rect.top - cardRect.height - gap)
    const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - cardRect.width - 16))
    card.style.top = `${top}px`
    card.style.left = `${left}px`
  })
  if (!guideKeyBound) { document.addEventListener('keydown', (event) => { if (guideState.active && event.key === 'Escape') closeGuide() }); guideKeyBound = true }
}
function rangeTasks(days) { return state.tasks.filter((task) => task.kind === 'habit' ? days.some((day) => taskCompletedOn(task, day)) : days.includes(task.date)) }
function completedTasksInRange(days) { return rangeTasks(days).filter((task) => task.kind === 'habit' ? days.some((day) => taskCompletedOn(task, day)) : taskCompletedOn(task, task.date)) }
function taskActualMinutes(task, days) { return sessionForTask(task.id, days).reduce((sum, session) => sum + session.duration, 0) }
function taskPlannedMinutes(task, days) { return task.kind === 'habit' ? task.plannedMinutes * days.filter((day) => taskCompletedOn(task, day)).length : task.plannedMinutes }
function sopMetrics(days) {
  const sessions = state.focusSessions.filter((session) => days.includes(session.date))
  const grouped = new Map()
  sessions.forEach((session) => {
    const sop = state.sops.find((item) => item.id === session.sopId)
    const id = session.sopId || 'none'
    const row = grouped.get(id) || { id, title: sop?.title || '未关联 SOP', estimate: sop?.estimate || 0, sessions: 0, minutes: 0, tasks: 0, completed: 0, results: 0 }
    row.sessions += 1; row.minutes += session.duration; row.results += session.result ? 1 : 0
    grouped.set(id, row)
  })
  state.tasks.filter((task) => task.sopId && rangeTasks(days).includes(task)).forEach((task) => {
    const row = grouped.get(task.sopId) || { id: task.sopId, title: state.sops.find((s) => s.id === task.sopId)?.title || '未命名 SOP', estimate: state.sops.find((s) => s.id === task.sopId)?.estimate || 0, sessions: 0, minutes: 0, tasks: 0, completed: 0, results: 0 }
    row.tasks += 1; row.completed += task.kind === 'habit' ? (days.filter((day) => taskCompletedOn(task, day)).length > 0 ? 1 : 0) : (taskCompletedOn(task, task.date) ? 1 : 0)
    grouped.set(task.sopId, row)
  })
  return [...grouped.values()].sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions).map((row) => ({ ...row, average: row.sessions ? row.minutes / row.sessions : 0, variance: row.estimate ? ((row.minutes / Math.max(row.sessions, 1)) - row.estimate) / row.estimate * 100 : 0, completionRate: row.tasks ? row.completed / row.tasks * 100 : 0, resultRate: row.sessions ? row.results / row.sessions * 100 : 0 }))
}
function subjectMetrics(days) {
  const grouped = new Map()
  const ensure = (subject) => { const key = subject || '未分类'; if (!grouped.has(key)) grouped.set(key, { subject: key, minutes: 0, sessions: 0, tasks: 0, mistakes: 0, reviews: 0 }); return grouped.get(key) }
  state.focusSessions.filter((session) => days.includes(session.date)).forEach((session) => { const row = ensure(linkedSubject(session)); row.minutes += session.duration; row.sessions += 1 })
  completedTasksInRange(days).forEach((task) => { ensure(task.subject).tasks += 1 })
  state.mistakes.filter((mistake) => days.includes(dateKey(mistake.createdAt))).forEach((mistake) => { ensure(mistake.subject).mistakes += 1 })
  state.reviews.filter((review) => review.kind === 'mistake' && days.includes(review.date)).forEach((review) => { const mistake = state.mistakes.find((item) => item.id === review.sourceId); ensure(mistake?.subject).reviews += 1 })
  return [...grouped.values()].sort((a, b) => b.minutes - a.minutes || b.mistakes - a.mistakes)
}
function energyMetrics(days) {
  return [1, 2, 3, 4, 5].map((energy) => {
    const reviews = state.reviews.filter((review) => review.kind === 'daily' && days.includes(review.date) && Number(review.energy) === energy)
    const dates = reviews.map((review) => review.date)
    const minutes = state.focusSessions.filter((session) => dates.includes(session.date)).reduce((sum, session) => sum + session.duration, 0)
    const completed = dates.reduce((sum, date) => sum + state.tasks.filter((task) => task.kind === 'habit' ? taskCompletedOn(task, date) : task.date === date && taskCompletedOn(task, date)).length, 0)
    return { energy, days: reviews.length, minutes, averageMinutes: reviews.length ? minutes / reviews.length : 0, completed }
  }).filter((row) => row.days)
}
function blockerMetrics(days) {
  const grouped = new Map()
  state.reviews.filter((review) => review.kind === 'daily' && days.includes(review.date) && review.block).forEach((review) => {
    const category = review.blockerCategory || '其他'
    const row = grouped.get(category) || { category, count: 0, examples: [] }
    row.count += 1
    if (review.block && row.examples.length < 2) row.examples.push(review.block)
    grouped.set(category, row)
  })
  return [...grouped.values()].sort((a, b) => b.count - a.count)
}
function planVarianceMetrics(days) {
  return rangeTasks(days).filter((task) => taskPlannedMinutes(task, days) > 0).map((task) => { const planned = taskPlannedMinutes(task, days); const actual = taskActualMinutes(task, days); const ratio = actual / planned; return { task, planned, actual, ratio, variance: (ratio - 1) * 100 } }).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 8)
}
function difficultyMetrics(days) {
  const grouped = new Map()
  state.focusSessions.filter((session) => days.includes(session.date) && Number(session.difficulty) >= 1).forEach((session) => {
    const difficulty = Number(session.difficulty)
    const row = grouped.get(difficulty) || { difficulty, sessions: 0, minutes: 0, results: 0 }
    row.sessions += 1; row.minutes += session.duration; row.results += session.result ? 1 : 0
    grouped.set(difficulty, row)
  })
  return [...grouped.values()].sort((a, b) => a.difficulty - b.difficulty).map((row) => ({ ...row, averageMinutes: row.minutes / row.sessions, resultRate: row.results / row.sessions * 100 }))
}
function insightForMetrics(days) {
  const sop = sopMetrics(days).filter((row) => row.sessions && row.estimate)
  const subject = subjectMetrics(days).filter((row) => row.minutes)
  const energy = energyMetrics(days)
  const blockers = blockerMetrics(days)
  const difficulty = difficultyMetrics(days)
  const lines = []
  if (sop.length) { const high = sop.slice().sort((a, b) => b.variance - a.variance)[0]; if (high?.variance > 20) lines.push(`“${high.title}”平均比预计多 ${Math.round(high.variance)}%，可以把步骤拆成更小的交付物。`) }
  if (subject.length > 1) { const focus = subject[0]; const errors = subject.slice().sort((a, b) => b.mistakes - a.mistakes)[0]; if (errors.mistakes > 0) lines.push(`${errors.subject}错题最多（${errors.mistakes} 道），但专注 ${formatMinutes(errors.minutes)}；下周可把复习直接接到该科目的专注后。`) }
  if (energy.length > 1) { const high = energy.slice().sort((a, b) => b.averageMinutes - a.averageMinutes)[0]; const low = energy.slice().sort((a, b) => a.averageMinutes - b.averageMinutes)[0]; if (high && low && high.energy !== low.energy) lines.push(`精力 ${high.energy}/5 的日子平均专注 ${Math.round(high.averageMinutes)} 分钟，精力 ${low.energy}/5 时为 ${Math.round(low.averageMinutes)} 分钟。`) }
  if (blockers[0]) lines.push(`最常见阻碍是“${blockers[0].category}”（${blockers[0].count} 次），下一周只针对它改一条 SOP。`)
  const hard = difficulty.filter((item) => item.difficulty >= 4).sort((a, b) => b.sessions - a.sessions)[0]
  if (hard && hard.resultRate < 70) lines.push(`难度 ${hard.difficulty}/5 的专注结果记录率只有 ${Math.round(hard.resultRate)}%，结束时先写一句结果，复盘会更准确。`)
  return lines
}

function navItem(id, icon, label) { return `<button class="${view === id ? 'active' : ''}" data-view="${id}" data-tour="nav-${id}"><span class="nav-icon">${icon}</span>${label}</button>` }
function layout(content) {
  const titles = { today: ['今天', '把事情做完，再留下一个可用的记录'], study: ['学习', '任务、专注和结果放在同一处'], sops: ['SOP', '把重复的事情写成自己的方法'], mistakes: ['错题', '记下来，下一次知道从哪里开始'], review: ['每日复盘', '三分钟，留下明天有用的东西'], analysis: ['分析', '看实际发生了什么'], settings: ['设置', '数据和模型都留在你手里'] }
  const [title, subtitle] = titles[view]
  const nav = `${navItem('today', '◷', '今天')}${navItem('study', '▣', '学习')}${navItem('sops', '▤', 'SOP')}${navItem('mistakes', '△', '错题')}${navItem('review', '✎', '复盘')}${navItem('analysis', '⌁', '分析')}${navItem('settings', '⚙', '设置')}`
  return `<div class="shell"><aside class="sidebar"><div class="brand"><img class="brand-mark" src="logo.svg" alt="" /><div><strong>SOP Loop</strong><small>个人执行系统</small></div></div><nav class="nav">${nav}</nav><div class="sidebar-note">本地保存 · ${state.tasks.length} 个任务 · ${state.mistakes.length} 道错题</div></aside><main class="main"><header class="topbar"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="muted">${new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}</div></header><div class="content">${content}</div></main><nav class="mobile-nav">${nav}</nav></div>`
}

function stats() { const completed = tasksToday().filter(taskDoneToday).length; return `<div class="grid stats"><div class="stat"><span>今日任务</span><strong>${completed}<em> / ${tasksToday().length}</em></strong></div><div class="stat"><span>专注时间</span><strong>${formatMinutes(minutesToday())}</strong></div><div class="stat"><span>待复习错题</span><strong>${dueMistakes().length}</strong></div><div class="stat"><span>连续复盘</span><strong>${reviewStreak()}<em> 天</em></strong></div></div>` }
function taskRows(tasks = tasksToday(), limit = 99) { const rows = tasks.slice().sort(taskSort).slice(0, limit).map((task, index) => { const done = taskDoneToday(task); const overdue = task.date && task.date < today() && !done; const plan = task.plannedMinutes ? ` · 计划 ${task.plannedMinutes} 分钟` : ''; return `<div class="task-row ${done ? 'done' : ''}"><button class="check-btn" data-action="toggle-task" data-id="${task.id}">${done ? '✓' : ''}</button><div class="task-main"><strong>${escapeHtml(task.title || '未命名任务')}</strong><span>${overdue ? '<span class="tag warning">逾期</span> ' : ''}${escapeHtml(task.categoryPath || task.subject || '临时任务')} · ${task.kind === 'habit' ? '每日习惯' : `${dayLabel(task.date)} 计划`}${plan} · ${task.completedPomodoros || 0} 个番茄</span></div><div class="task-actions"><span class="tag priority-${task.priority || 2}">${priorityLabel(task.priority || 2)}优先级</span><button class="btn small" data-action="start-task" data-id="${task.id}" ${index === 0 ? 'data-tour="task-start"' : ''}>开始</button><button class="btn small danger" data-action="delete-task" data-id="${task.id}" title="删除任务">×</button></div></div>` }).join(''); return rows || '<div class="empty"><strong>今天没有任务</strong>先加一个最小任务。</div>' }

function renderToday() {
  const active = state.sops.filter((s) => s.active)
  const timerBox = timer ? `<div class="timer"><strong>${formatClock(Math.floor((Date.now() - timer.startedAt) / 1000))}</strong><span>正在执行：${escapeHtml(timer.title)}</span><button class="btn small primary" data-action="stop-timer" style="margin-top:12px">结束并记录</button></div>` : ''
  const cards = active.length ? active.map((s) => `<div class="sop-card"><div><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.description || '没有描述，先做起来。')}</p><div class="meta"><span class="tag">约 ${s.estimate || 0} 分钟</span><span class="tag">${s.steps.length} 个步骤</span>${s.subject ? `<span class="tag">${escapeHtml(s.subject)}</span>` : ''}</div></div><div class="sop-actions"><button class="btn small" data-action="edit-sop" data-id="${s.id}">查看</button><button class="btn small primary" data-action="start-sop" data-id="${s.id}">开始</button></div></div>`).join('') : '<div class="empty"><strong>还没有 SOP</strong>去 SOP 页面写下第一个重复流程。</div>'
  const overdueNotice = overdueTasks().length ? `<div class="notice" style="margin-bottom:12px">有 ${overdueTasks().length} 个逾期任务，先处理最小的一项。</div>` : ''
  return `${stats()}<div class="grid two-col"><section class="panel" data-tour="today-tasks"><div class="panel-head"><h3>今日学习任务</h3><button class="btn small" data-view="study">进入学习</button></div><div class="panel-body">${timerBox}${overdueNotice}<div class="task-list">${taskRows(tasksToday(), 4)}</div></div></section><section class="panel"><div class="panel-head"><h3>待复习错题</h3><button class="btn small" data-view="mistakes">打开错题</button></div><div class="panel-body">${mistakeRows(dueMistakes().slice(0, 3))}</div></section></div><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>今天的 SOP</h3><button class="btn small" data-view="review">写复盘</button></div><div class="panel-body"><div class="sop-list">${cards}</div></div></section>`
}
function pendingSessionCapture() { const session = state.focusSessions.find((item) => item.id === pendingSessionId); if (!session) return ''; return `<section class="panel session-capture"><div class="panel-head"><div><h3>补充刚才的专注结果</h3><span class="muted">${escapeHtml(session.sessionName)} · ${session.duration} 分钟</span></div><button class="btn small ghost" data-action="skip-session-capture">跳过</button></div><div class="panel-body"><form id="session-result-form" class="form" data-id="${session.id}"><div class="field"><label>完成结果</label><textarea name="result" placeholder="完成了什么，留下一个可验证的结果。">${escapeHtml(session.result || '')}</textarea></div><div class="split-form"><div class="field"><label>难度 / 阻力</label><input name="difficulty" type="range" min="1" max="5" value="${session.difficulty || 3}" /><span class="range-value" id="difficulty-value">${session.difficulty || 3}/5</span></div><div class="field"><label>下一步</label><input name="nextAction" value="${escapeHtml(session.nextAction || '')}" placeholder="下次从哪里开始" /></div></div><div class="form-actions"><button class="btn primary" type="submit">保存结果</button></div></form></div></section>` }
function renderStudy() { const upcoming = state.tasks.filter((task) => task.kind !== 'habit' && task.date > today()).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5); return `<div class="section-head"><div><h2>学习工作台</h2><p>把学习任务、专注时间和结果放在一起。</p></div><span class="tag active">${formatMinutes(minutesToday())} 专注</span></div>${timer ? `<div class="timer"><strong>${formatClock(Math.floor((Date.now() - timer.startedAt) / 1000))}</strong><span>正在执行：${escapeHtml(timer.title)}</span><button class="btn small primary" data-action="stop-timer" style="margin-top:12px">结束并记录</button></div>` : ''}${pendingSessionCapture()}<div class="grid two-col"><section class="panel"><div class="panel-head"><h3>任务计划</h3><span class="muted">${tasksDue().filter(taskDoneToday).length}/${tasksDue().length} 完成</span></div><div class="panel-body"><form id="task-form" data-tour="task-entry" class="quick-add task-form-grid"><input name="title" placeholder="添加一个学习任务" required /><input name="subject" placeholder="科目 / 知识路径" /><input name="plannedMinutes" type="number" min="0" step="5" placeholder="计划分钟" aria-label="计划分钟" /><input name="date" type="date" value="${today()}" aria-label="计划日期" /><select name="priority" aria-label="优先级"><option value="3">高优先级</option><option value="2" selected>中优先级</option><option value="1">低优先级</option></select><label class="habit-toggle"><input name="habit" type="checkbox" /> 每日习惯</label><button class="btn primary" data-tour="task-add" type="submit">添加</button></form><div class="task-list">${taskRows(tasksDue())}</div>${upcoming.length ? `<div class="upcoming"><strong>接下来</strong>${upcoming.map((task) => `<div class="upcoming-row"><span>${dayLabel(task.date)} · ${escapeHtml(task.title)}</span><span class="tag priority-${task.priority || 2}">${priorityLabel(task.priority || 2)}优先级</span></div>`).join('')}</div>` : ''}</div></section><section class="panel"><div class="panel-head"><h3>最近专注</h3></div><div class="panel-body">${state.focusSessions.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 6).map((s) => `<div class="review-card"><h4>${dayLabel(s.date)} · ${s.duration} 分钟${s.difficulty ? ` · 难度 ${s.difficulty}/5` : ''}</h4><p>${escapeHtml(s.sessionName)}${s.result ? ` · ${escapeHtml(s.result)}` : ''}${s.nextAction ? ` · 下一步：${escapeHtml(s.nextAction)}` : ''}</p></div>`).join('') || '<div class="empty">还没有专注记录</div>'}</div></section></div>` }
function recentReview() { const reviews = state.reviews.filter((r) => r.kind === 'daily').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3); if (!reviews.length) return '<div class="empty"><strong>还没有复盘</strong>今天做完后，留下几句话就够了。</div>'; return reviews.map((r) => `<div class="review-card"><h4>${dayLabel(r.date)} · 精力 ${r.energy}/5</h4><p>${escapeHtml(r.good || r.block || r.next || '没有文字记录')}</p></div>`).join('') }

function renderSops() { const current = state.sops.find((s) => s.id === selectedSop) || null; return `<div class="section-head"><div><h2>你的 SOP</h2><p>写得足够具体，下一次就能少想一点。</p></div><button class="btn primary" data-action="new-sop">新建 SOP</button></div><div class="sop-layout"><section class="panel"><div class="panel-head"><h3>全部流程</h3><span class="muted">${state.sops.length}</span></div>${state.sops.length ? state.sops.map((s) => `<div class="list-row ${s.id === selectedSop ? 'selected' : ''}" data-action="select-sop" data-id="${s.id}"><strong>${escapeHtml(s.title)}</strong><span>v${s.version || 1} · ${s.estimate || 0} 分钟 · ${s.steps.length} 步${s.subject ? ` · ${escapeHtml(s.subject)}` : ''}</span></div>`).join('') : '<div class="empty">还没有 SOP</div>'}</section>${current ? sopEditor(current) : '<section class="panel"><div class="empty"><strong>选择一个 SOP</strong>或者新建一个。</div></section>'}</div>` }
function sopEditor(s) { const history = (s.history || []).slice().reverse(); return `<section class="panel"><div class="panel-head"><h3>编辑 SOP · v${s.version || 1}</h3><button class="btn small danger" data-action="delete-sop" data-id="${s.id}">删除</button></div><div class="panel-body"><form class="form" id="sop-form" data-id="${s.id}"><div class="field"><label>名称</label><input name="title" value="${escapeHtml(s.title)}" required /></div><div class="field"><label>一句话说明</label><input name="description" value="${escapeHtml(s.description || '')}" /></div><div class="split-form"><div class="field"><label>预计分钟</label><input name="estimate" type="number" min="1" value="${s.estimate || 30}" /></div><div class="field"><label>科目</label><input name="subject" value="${escapeHtml(s.subject || '')}" placeholder="可留空" /></div></div><div class="field"><label>步骤（一行一步）</label><textarea name="steps">${escapeHtml(s.steps.join('\n'))}</textarea></div><div class="field"><label><input name="active" type="checkbox" ${s.active ? 'checked' : ''} /> 出现在今天</label></div><div class="form-actions"><button class="btn" type="button" data-action="add-task-from-sop" data-id="${s.id}">加入今日任务</button><button class="btn primary" type="submit">保存为新版本</button></div></form><div class="panel-head" style="margin:18px -19px -18px"><h3>当前步骤</h3></div><div class="steps">${s.steps.map((step) => `<div class="step">${escapeHtml(step)}</div>`).join('')}</div>${history.length ? `<div class="panel-head" style="margin:18px -19px -18px"><h3>历史版本</h3><span class="muted">保留最近 ${history.length} 个</span></div><div class="sop-history">${history.map((item) => `<div class="history-row"><strong>v${item.version}</strong><span>${dayLabel(dateKey(item.updatedAt))} · ${escapeHtml(item.title)}</span><small>${item.estimate || 0} 分钟 · ${(item.steps || []).length} 步</small></div>`).join('')}</div>` : ''}</div></section>` }

function subjectOptions(selected = '') { return ['<option value="">选择科目</option>', ...Object.keys(state.subjectConfig).map((subject) => `<option value="${escapeHtml(subject)}" ${subject === selected ? 'selected' : ''}>${escapeHtml(subject)}</option>`)].join('') }
function mistakeRows(items) { if (!items.length) return '<div class="empty"><strong>还没有匹配的错题</strong>换个关键词，或者先记下一道。</div>'; return items.map((m) => { const attachments = [...m.attachmentIds, ...m.answerAttachmentIds]; const next = m.nextReviewAt ? `下次 ${dayLabel(dateKey(m.nextReviewAt))}` : '待安排'; return `<article class="mistake-card"><div class="mistake-head"><div><strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(m.subject)} · ${escapeHtml(m.knowledgePath.join(' / '))} · ${escapeHtml(m.questionType)}</span></div><span class="tag">复习 ${m.reviewCount} 次 · ${next}</span></div><p>${escapeHtml(m.question || '题干见附件')}</p>${attachments.length ? `<div class="meta"><span class="tag">${attachments.length} 个附件</span>${attachments.map((id) => `<button class="btn small" data-action="open-attachment" data-id="${escapeHtml(id)}">打开附件</button>`).join('')}</div>` : ''}<details><summary>查看答案</summary><p>${escapeHtml(m.answer || '还没有填写答案')}</p></details><div class="mistake-actions"><button class="btn small primary" data-action="review-mistake" data-id="${m.id}">记一次复习</button><button class="btn small danger" data-action="delete-mistake" data-id="${m.id}">删除</button></div></article>` }).join('') }
function renderMistakes() { const subject = document.querySelector('#mistake-subject-filter')?.value || ''; const query = mistakeQuery.trim().toLowerCase(); const list = state.mistakes.filter((m) => { const haystack = [m.title, m.question, m.answer, m.subject, m.questionType, ...m.knowledgePath, ...m.tags].join(' ').toLowerCase(); return (!subject || m.subject === subject) && (!query || haystack.includes(query)) }); return `<div class="section-head"><div><h2>错题本</h2><p>${state.mistakes.length} 道题 · ${dueMistakes().length} 道待复习</p></div><span class="tag active">复习间隔会逐步拉长</span></div><div class="grid two-col"><section class="panel"><div class="panel-head"><h3>快速录入</h3></div><div class="panel-body"><form id="mistake-form" class="form"><div class="split-form"><div class="field"><label>科目</label><select name="subject">${subjectOptions('数学')}</select></div><div class="field"><label>题型</label><input name="questionType" placeholder="选择题 / 大题" /></div></div><div class="field"><label>知识路径</label><input name="knowledgePath" placeholder="例如：数学 / 线性代数" /></div><div class="field"><label>标题</label><input name="title" placeholder="给这道题一个名字" required /></div><div class="field"><label>题目</label><textarea name="question" placeholder="题干、错误过程或截图说明"></textarea></div><div class="field"><label>答案 / 解析</label><textarea name="answer" placeholder="正确方法和下次提醒"></textarea></div><div class="split-form"><div class="field"><label>题目图片 / PDF</label><input name="questionFiles" type="file" multiple accept="image/*,application/pdf" /></div><div class="field"><label>答案图片 / PDF</label><input name="answerFiles" type="file" multiple accept="image/*,application/pdf" /></div></div><div class="field"><label>标签</label><input name="tags" placeholder="计算错误, 概念混淆" /></div><div class="form-actions"><button class="btn primary" type="submit">保存错题</button></div></form></div></section><section class="panel"><div class="panel-head mistake-tools"><h3>错题列表</h3><div><input id="mistake-query" value="${escapeHtml(mistakeQuery)}" placeholder="搜索标题、题干、标签" /><select id="mistake-subject-filter"><option value="">全部科目</option>${Object.keys(state.subjectConfig).map((s) => `<option value="${escapeHtml(s)}" ${s === subject ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select></div></div><div class="panel-body"><div class="mistake-list">${mistakeRows(list)}</div></div></section></div>` }

function renderReview() {
  const r = reviewToday() || { energy: 3, good: '', block: '', blockerCategory: '其他', next: '', aiSummary: '' }
  const facts = `<div class="review-facts"><span><strong>${tasksToday().filter(taskDoneToday).length}</strong>完成任务</span><span><strong>${formatMinutes(minutesToday())}</strong>专注</span><span><strong>${state.mistakes.filter((m) => dateKey(m.createdAt) === today()).length}</strong>新增错题</span><span><strong>${blockerMetrics([today()]).reduce((sum, item) => sum + item.count, 0)}</strong>次阻碍</span></div>`
  const summary = analysisText || r.aiSummary
  const blockerOptions = ['时间估计', '任务拆分', '环境干扰', '精力状态', '知识卡点', '其他'].map((item) => `<option value="${item}" ${r.blockerCategory === item ? 'selected' : ''}>${item}</option>`).join('')
  return `<div class="section-head"><div><h2>今天怎么样</h2><p>不用写完整，只留下明天用得上的东西。</p></div><span class="tag ${reviewToday() ? 'active' : ''}">${reviewToday() ? '今天已保存' : '还没保存'}</span></div><section class="panel"><div class="panel-body">${facts}<form class="form" id="review-form" data-tour="review-form"><div class="field"><label>精力</label><div class="range-line"><input name="energy" type="range" min="1" max="5" value="${r.energy}" /><span class="range-value" id="energy-value">${r.energy}/5</span></div></div><div class="field"><label>今天做得好的地方</label><textarea name="good" placeholder="完成了什么，或者哪一刻进入了状态？">${escapeHtml(r.good)}</textarea></div><div class="field"><label>最大的阻碍</label><textarea name="block" placeholder="什么让事情变慢或中断？">${escapeHtml(r.block)}</textarea></div><div class="field"><label>阻碍分类</label><select name="blockerCategory">${blockerOptions}</select></div><div class="field"><label>明天只改一件事</label><textarea name="next" placeholder="让下一次执行更容易一点。">${escapeHtml(r.next)}</textarea></div><div class="form-actions"><button class="btn" type="button" data-action="ai-review">让 AI 整理</button><button class="btn primary" type="submit">保存复盘</button></div></form>${summary ? `<div class="success" style="margin-top:16px"><strong>AI 整理</strong><br>${escapeHtml(summary).replaceAll('\n', '<br>')}</div>` : ''}</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>最近复盘</h3></div><div class="panel-body">${recentReview()}</div></section>`
}
function shiftDay(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function buildWeeklyReport() {
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(-(6 - i)))
  const sessions = state.focusSessions.filter((session) => days.includes(session.date))
  const tasks = completedTasksInRange(days)
  const reviews = state.reviews.filter((review) => days.includes(review.date))
  const sop = sopMetrics(days)
  const blockers = blockerMetrics(days)
  const energy = energyMetrics(days)
  const planned = rangeTasks(days).reduce((sum, task) => sum + taskPlannedMinutes(task, days), 0)
  const actual = rangeTasks(days).reduce((sum, task) => sum + taskActualMinutes(task, days), 0)
  const highEnergy = energy.slice().sort((a, b) => b.averageMinutes - a.averageMinutes)[0]
  const lowEnergy = energy.slice().sort((a, b) => a.averageMinutes - b.averageMinutes)[0]
  const newMistakes = state.mistakes.filter((mistake) => days.includes(dateKey(mistake.createdAt))).length
  const blockerText = blockers.length ? blockers.map((item) => `- ${item.category}：${item.count} 次${item.examples[0] ? `（${item.examples[0]}）` : ''}`).join('\n') : '- 暂无分类阻碍'
  const sopText = sop.length ? sop.slice(0, 5).map((item) => `- ${item.title}：${item.sessions} 次，平均 ${Math.round(item.average)} 分钟，预计 ${item.estimate || 0} 分钟，偏差 ${item.estimate ? `${item.variance > 0 ? '+' : ''}${Math.round(item.variance)}%` : '未设置预计时长'}`).join('\n') : '- 暂无 SOP 执行记录'
  const suggestion = insightForMetrics(days)[0] || (blockers[0] ? `先处理“${blockers[0].category}”` : '继续记录一周，再做下一次调整')
  return `# 每周学习复盘\n\n- 周期：${days[0]} 至 ${days[days.length - 1]}\n- 专注：${formatMinutes(sessions.reduce((sum, session) => sum + session.duration, 0))}（${sessions.length} 次）\n- 完成任务：${tasks.length}\n- 计划 / 实际：${formatMinutes(planned)} / ${formatMinutes(actual)}\n- 复盘：${reviews.filter((review) => review.kind === 'daily').length}\n- 新增错题：${newMistakes}\n- 错题复习：${reviews.filter((review) => review.kind === 'mistake').length}\n\n## SOP 表现\n${sopText}\n\n## 阻碍分类\n${blockerText}\n\n## 精力与专注\n${highEnergy ? `- 精力 ${highEnergy.energy}/5：平均 ${Math.round(highEnergy.averageMinutes)} 分钟专注（${highEnergy.days} 天）` : '- 暂无足够复盘'}\n${lowEnergy && highEnergy && lowEnergy.energy !== highEnergy.energy ? `- 精力 ${lowEnergy.energy}/5：平均 ${Math.round(lowEnergy.averageMinutes)} 分钟专注（${lowEnergy.days} 天）` : ''}\n\n## 下周实验\n- ${suggestion}\n- 只改一个 SOP 步骤，连续观察 7 天。`
}
function renderAnalysis() {
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(-(6 - i)))
  const values = days.map((date) => ({ date, minutes: state.focusSessions.filter((session) => session.date === date).reduce((sum, session) => sum + session.duration, 0) }))
  const max = Math.max(...values.map((item) => item.minutes), 1)
  const sop = sopMetrics(days)
  const subjects = subjectMetrics(days)
  const energy = energyMetrics(days)
  const blockers = blockerMetrics(days)
  const difficulty = difficultyMetrics(days)
  const variance = planVarianceMetrics(days)
  const completed = completedTasksInRange(days).length
  const planned = rangeTasks(days).reduce((sum, task) => sum + taskPlannedMinutes(task, days), 0)
  const actual = state.focusSessions.filter((session) => days.includes(session.date)).reduce((sum, session) => sum + session.duration, 0)
  const insights = insightForMetrics(days)
  const sopRows = sop.map((item) => `<div class="metric-row"><strong>${escapeHtml(item.title)}</strong><span>${item.sessions} 次 · 平均 ${Math.round(item.average)}m · 预计 ${item.estimate || 0}m · <em class="${item.variance > 0 ? 'variance-positive' : 'variance-negative'}">${item.estimate ? `${item.variance > 0 ? '+' : ''}${Math.round(item.variance)}%` : '—'}</em>${item.tasks ? ` · 完成率 ${Math.round(item.completionRate)}%` : ''} · 结果 ${Math.round(item.resultRate)}%</span></div>`)
  const subjectRows = subjects.map((item) => `<div class="metric-row"><strong>${escapeHtml(item.subject)}</strong><span>${formatMinutes(item.minutes)} · ${item.sessions} 次专注 · ${item.tasks} 个任务 · ${item.mistakes} 道错题 · ${item.reviews} 次复习</span></div>`)
  const energyRows = energy.map((item) => `<div class="metric-row"><strong>精力 ${item.energy}/5</strong><span>${item.days} 天 · 平均 ${Math.round(item.averageMinutes)}m 专注 · ${item.completed} 个任务完成</span></div>`)
  const blockerRows = blockers.map((item) => `<div class="metric-row"><strong>${escapeHtml(item.category)}</strong><span>${item.count} 次${item.examples[0] ? ` · ${escapeHtml(item.examples[0])}` : ''}</span></div>`)
  const difficultyRows = difficulty.map((item) => `<div class="metric-row"><strong>难度 ${item.difficulty}/5</strong><span>${item.sessions} 次 · 平均 ${Math.round(item.averageMinutes)}m · 结果记录率 ${Math.round(item.resultRate)}%</span></div>`)
  const varianceRows = variance.map((item) => `<div class="metric-row"><strong>${escapeHtml(item.task.title)}</strong><span>计划 ${item.planned}m · 实际 ${item.actual}m · <em class="${item.variance > 0 ? 'variance-positive' : 'variance-negative'}">${item.variance > 0 ? '+' : ''}${Math.round(item.variance)}%</em></span></div>`)
  return `<div class="section-head"><div><h2>实际发生了什么</h2><p>先看事实，再决定要不要改 SOP。</p></div><button class="btn primary" data-action="weekly-report" data-tour="weekly-report">生成周报</button></div><div class="grid two-col"><section class="panel"><div class="panel-head"><h3>最近 7 天专注时间</h3><span class="muted">总计 ${formatMinutes(values.reduce((sum, item) => sum + item.minutes, 0))}</span></div><div class="panel-body"><div class="bars">${values.map((item) => `<div class="bar-row"><span>${dayLabel(item.date)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.minutes / max * 100)}%"></div></div><strong>${item.minutes}m</strong></div>`).join('')}</div></div></section><section class="panel"><div class="panel-head"><h3>可行动洞察</h3></div><div class="panel-body">${metricRows(insights.map((item) => `<div class="insight"><strong>${escapeHtml(item)}</strong><p>来自最近 7 天的执行、复盘和错题记录</p></div>`), '继续记录几天，系统会识别稳定模式。')}</div></section></div><div class="grid metrics-grid"><section class="panel analysis-card"><div class="panel-head"><h3>SOP 表现</h3><span class="muted">执行次数 / 实际偏差</span></div><div class="panel-body metric-table">${metricRows(sopRows)}</div></section><section class="panel analysis-card"><div class="panel-head"><h3>科目表现</h3><span class="muted">专注 / 任务 / 错题</span></div><div class="panel-body metric-table">${metricRows(subjectRows)}</div></section><section class="panel analysis-card"><div class="panel-head"><h3>精力与专注</h3><span class="muted">按复盘精力分组</span></div><div class="panel-body metric-table">${metricRows(energyRows)}</div></section><section class="panel analysis-card"><div class="panel-head"><h3>专注难度</h3><span class="muted">难度 / 结果记录</span></div><div class="panel-body metric-table">${metricRows(difficultyRows)}</div></section><section class="panel analysis-card"><div class="panel-head"><h3>阻碍分类</h3><span class="muted">复盘中主动标记</span></div><div class="panel-body metric-table">${metricRows(blockerRows)}</div></section><section class="panel analysis-card"><div class="panel-head"><h3>计划与实际</h3><span class="muted">偏差最大的任务</span></div><div class="panel-body metric-table">${metricRows(varianceRows)}</div></section></div><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>学习结果</h3><span class="muted">过去 7 天</span></div><div class="panel-body"><div class="review-facts"><span><strong>${completed}</strong>完成任务</span><span><strong>${formatMinutes(planned)}</strong>计划时长</span><span><strong>${formatMinutes(actual)}</strong>实际专注</span><span><strong>${overdueTasks().length}</strong>逾期任务</span><span><strong>${state.mistakes.filter((mistake) => days.includes(dateKey(mistake.createdAt))).length}</strong>新增错题</span><span><strong>${state.reviews.filter((review) => review.kind === 'mistake' && days.includes(review.date)).length}</strong>次错题复习</span></div>${weeklyReportText ? `<pre class="weekly-report">${escapeHtml(weeklyReportText)}</pre>` : ''}</div></section>`
}
function renderSettings() { return `<div class="section-head"><div><h2>设置</h2><p>数据和模型都保存在当前设备。</p></div></div><div class="grid two-col"><section class="panel"><div class="panel-head"><h3>AI 模型</h3></div><div class="panel-body"><form class="form" id="settings-form"><div class="field"><label>接口地址</label><input name="endpoint" value="${escapeHtml(state.settings.endpoint)}" /></div><div class="field"><label>模型</label><input name="model" value="${escapeHtml(state.settings.model)}" /></div><div class="field"><label>API Key</label><input name="apiKey" type="password" value="${escapeHtml(state.settings.apiKey)}" placeholder="留空则使用本地整理" /></div><div class="form-actions"><button class="btn primary" type="submit">保存设置</button></div></form></div></section><section class="panel"><div class="panel-head"><h3>数据</h3></div><div class="panel-body form"><button class="btn" data-action="export">导出 SOP Loop 备份</button><label class="btn" style="text-align:center">导入其他项目备份<input id="import-file" type="file" accept="application/json" hidden /></label><p class="muted" style="font-size:12px;line-height:1.6;margin:0">支持 SOP Loop、virtual-study-room 和 mistake-notebook 的 JSON 备份。</p><button class="btn danger" data-action="reset">清空所有数据</button></div></section><section class="panel"><div class="panel-head"><h3>操作指引</h3></div><div class="panel-body"><p class="muted guide-settings-copy">重新查看一遍主要页面和按钮的作用。</p><button class="btn" data-action="start-guide">重新打开操作指引</button><p class="muted guide-settings-status">${guideState.dontShow ? '当前已选择不再自动显示。' : '首次打开时会自动显示。'}</p></div></section></div>` }

function render() { const content = view === 'today' ? renderToday() : view === 'study' ? renderStudy() : view === 'sops' ? renderSops() : view === 'mistakes' ? renderMistakes() : view === 'review' ? renderReview() : view === 'analysis' ? renderAnalysis() : renderSettings(); document.querySelector('#app').innerHTML = layout(content); bind(); renderGuide() }
function bind() {
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => { view = el.dataset.view; analysisText = ''; render() }))
  document.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => action(el.dataset.action, el.dataset.id)))
  const reviewForm = document.querySelector('#review-form')
  if (reviewForm) { reviewForm.querySelector('[name="energy"]').addEventListener('input', (e) => { document.querySelector('#energy-value').textContent = `${e.target.value}/5` }); reviewForm.addEventListener('submit', (e) => { e.preventDefault(); const form = new FormData(reviewForm); upsertDailyReview({ energy: Number(form.get('energy')), good: form.get('good'), block: form.get('block'), blockerCategory: form.get('blockerCategory'), next: form.get('next') }); save(); analysisText = ''; render() }) }
  const sessionResultForm = document.querySelector('#session-result-form')
  if (sessionResultForm) { sessionResultForm.querySelector('[name="difficulty"]').addEventListener('input', (e) => { document.querySelector('#difficulty-value').textContent = `${e.target.value}/5` }); sessionResultForm.addEventListener('submit', (e) => { e.preventDefault(); const form = new FormData(sessionResultForm); const session = state.focusSessions.find((item) => item.id === sessionResultForm.dataset.id); if (session) Object.assign(session, { result: form.get('result'), difficulty: Number(form.get('difficulty')), nextAction: form.get('nextAction') }); pendingSessionId = null; save(); render() }) }
  const sopForm = document.querySelector('#sop-form')
  if (sopForm) sopForm.addEventListener('submit', (e) => { e.preventDefault(); const form = new FormData(sopForm); const s = state.sops.find((x) => x.id === sopForm.dataset.id); const snapshot = { version: s.version || 1, title: s.title, description: s.description, estimate: s.estimate, subject: s.subject, steps: [...s.steps], active: s.active, updatedAt: s.updatedAt || Date.now() }; s.history = [...(s.history || []), snapshot].slice(-8); Object.assign(s, { title: form.get('title'), description: form.get('description'), estimate: Number(form.get('estimate')) || 30, subject: form.get('subject'), steps: String(form.get('steps')).split('\n').map((x) => x.trim()).filter(Boolean), active: form.get('active') === 'on', updatedAt: Date.now(), version: (s.version || 1) + 1 }); save(); render() })
  const taskForm = document.querySelector('#task-form')
  if (taskForm) taskForm.addEventListener('submit', (e) => { e.preventDefault(); const form = new FormData(taskForm); const subject = String(form.get('subject') || '').trim(); const habit = form.get('habit') === 'on'; state.tasks.unshift(normalizeTask({ id: uid('task'), title: form.get('title'), subject, categoryPath: subject, plannedMinutes: Number(form.get('plannedMinutes')) || 0, date: habit ? '' : (form.get('date') || today()), kind: habit ? 'habit' : 'today', priority: Number(form.get('priority')) || 2 })); save(); render() })
  const mistakeForm = document.querySelector('#mistake-form')
  if (mistakeForm) mistakeForm.addEventListener('submit', async (e) => { e.preventDefault(); const form = new FormData(mistakeForm); const path = String(form.get('knowledgePath') || '').split(/[\/>＞]+/).map((x) => x.trim()).filter(Boolean); const questionFiles = [...mistakeForm.querySelector('[name="questionFiles"]').files]; const answerFiles = [...mistakeForm.querySelector('[name="answerFiles"]').files]; const attachmentIds = (await Promise.all(questionFiles.map((file) => assetDB.put(file)))).filter(Boolean); const answerAttachmentIds = (await Promise.all(answerFiles.map((file) => assetDB.put(file)))).filter(Boolean); state.mistakes.unshift(normalizeMistake({ id: uid('mistake'), subject: form.get('subject'), questionType: form.get('questionType') || '未分类题型', knowledgePath: path, title: form.get('title'), question: form.get('question'), answer: form.get('answer'), attachmentIds, answerAttachmentIds, tags: String(form.get('tags') || '').split(/[,，]+/).map((x) => x.trim()).filter(Boolean) })); save(); render() })
  document.querySelector('#mistake-subject-filter')?.addEventListener('change', (e) => { mistakeQuery = document.querySelector('#mistake-query')?.value || mistakeQuery; render() })
  document.querySelector('#mistake-query')?.addEventListener('change', (e) => { mistakeQuery = e.target.value; render() })
  const settingsForm = document.querySelector('#settings-form')
  if (settingsForm) settingsForm.addEventListener('submit', (e) => { e.preventDefault(); const form = new FormData(settingsForm); state.settings = { ...state.settings, endpoint: form.get('endpoint'), model: form.get('model'), apiKey: form.get('apiKey') }; save(); render() })
  document.querySelector('#import-file')?.addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { mergeImported(JSON.parse(await file.text())); alert('已导入并合并'); render() } catch { alert('JSON 文件无法读取') } })
}

function mergeImported(raw) { const incoming = normalizeState(raw); const merge = (local, added) => [...new Map([...local, ...added].map((item) => [item.id, item])).values()]; state.sops = merge(state.sops, incoming.sops); state.tasks = merge(state.tasks, incoming.tasks); state.focusSessions = merge(state.focusSessions, incoming.focusSessions); state.reviews = merge(state.reviews, incoming.reviews); state.mistakes = merge(state.mistakes, incoming.mistakes); state.subjectConfig = normalizeSubjectConfig({ ...state.subjectConfig, ...incoming.subjectConfig }); save() }
function action(type, id) {
  if (type === 'new-sop') { const s = normalizeSop({ id: uid('sop'), title: '新的 SOP', description: '', estimate: 30, steps: ['写下完成标准'], subject: '', active: true, version: 1, createdAt: Date.now(), updatedAt: Date.now() }); state.sops.unshift(s); selectedSop = s.id; save(); view = 'sops'; render() }
  if (type === 'select-sop' || type === 'edit-sop') { selectedSop = id; view = 'sops'; render() }
  if (type === 'delete-sop') { state.sops = state.sops.filter((s) => s.id !== id); selectedSop = state.sops[0]?.id || null; save(); render() }
  if (type === 'add-task-from-sop') { const s = state.sops.find((x) => x.id === id); if (s) state.tasks.unshift(normalizeTask({ id: uid('task'), title: s.title, subject: s.subject, categoryPath: s.subject, sopId: s.id, plannedMinutes: s.estimate, date: today() })); save(); view = 'study'; render() }
  if (type === 'start-sop') { const s = state.sops.find((x) => x.id === id); if (s) startTimer({ sopId: s.id, title: s.title }) }
  if (type === 'start-task') { const task = state.tasks.find((x) => x.id === id); if (task) startTimer({ taskId: task.id, sopId: task.sopId, title: task.title }) }
  if (type === 'toggle-task') { const task = state.tasks.find((x) => x.id === id); if (task) { const dates = new Set(task.completedOn || []); if (dates.has(today())) dates.delete(today()); else dates.add(today()); task.completedOn = [...dates].sort(); task.completed = dates.has(today()); task.updatedAt = Date.now(); save(); render() } }
  if (type === 'delete-task') { if (confirm('删除这个任务？')) { state.tasks = state.tasks.filter((x) => x.id !== id); save(); render() } }
  if (type === 'stop-timer') finishTimer()
  if (type === 'skip-session-capture') { pendingSessionId = null; render() }
  if (type === 'review-mistake') { const mistake = state.mistakes.find((x) => x.id === id); if (mistake) { mistake.reviewCount++; mistake.reviewInterval = [1, 3, 7, 14, 30][Math.min(mistake.reviewCount - 1, 4)]; mistake.lastReviewedAt = now(); mistake.nextReviewAt = addDays(today(), mistake.reviewInterval); mistake.reviewHistory.push({ date: mistake.lastReviewedAt, result: 'reviewed', nextReviewAt: mistake.nextReviewAt }); state.reviews.unshift(normalizeReview({ id: uid('mistake-review'), date: today(), kind: 'mistake', sourceId: mistake.id, result: `复习：${mistake.title}，下次 ${mistake.nextReviewAt}` }, 'mistake')); save(); render() } }
  if (type === 'delete-mistake') { state.mistakes = state.mistakes.filter((x) => x.id !== id); save(); render() }
  if (type === 'open-attachment') openAttachment(id)
  if (type === 'weekly-report') { weeklyReportText = buildWeeklyReport(); render() }
  if (type === 'ai-review') aiReview()
  if (type === 'start-guide') beginGuide(true)
  if (type === 'export') exportData()
  if (type === 'reset' && confirm('确定清空本地数据吗？')) { localStorage.removeItem(WORKSPACE_KEY); state = normalizeState(seed); selectedSop = state.sops[0].id; render() }
}
async function openAttachment(id) { const asset = await assetDB.get(id); if (!asset) return; const url = URL.createObjectURL(asset.blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000) }
function startTimer(details) { if (timer) finishTimer(); timer = { ...details, startedAt: Date.now() }; view = details.taskId ? 'study' : 'today'; render(); timerInterval() }
function finishTimer() { if (!timer) return; const minutes = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000)); const session = normalizeSession({ id: uid('session'), date: today(), taskId: timer.taskId, sopId: timer.sopId, duration: minutes, startedAt: timer.startedAt, endedAt: Date.now(), sessionName: timer.title }); state.focusSessions.unshift(session); const task = state.tasks.find((x) => x.id === timer.taskId); if (task) task.completedPomodoros = (task.completedPomodoros || 0) + 1; pendingSessionId = session.id; timer = null; clearInterval(timerInterval.id); save(); view = 'study'; render() }
function timerInterval() { clearInterval(timerInterval.id); timerInterval.id = setInterval(() => { const strong = document.querySelector('.timer strong'); if (timer && strong) strong.textContent = formatClock(Math.floor((Date.now() - timer.startedAt) / 1000)) }, 1000) }
async function aiReview() { const form = document.querySelector('#review-form'); if (!form) return; const data = new FormData(form); const days = Array.from({ length: 7 }, (_, i) => shiftDay(-(6 - i))); const input = { energy: data.get('energy'), good: data.get('good'), block: data.get('block'), blockerCategory: data.get('blockerCategory'), next: data.get('next'), facts: { tasks: tasksToday().filter(taskDoneToday).length, focusMinutes: minutesToday(), newMistakes: state.mistakes.filter((m) => dateKey(m.createdAt) === today()).length, sessions: sessionsToday().map((session) => ({ name: session.sessionName, minutes: session.duration, difficulty: session.difficulty, result: session.result, nextAction: session.nextAction })), weeklyInsights: insightForMetrics(days) } }; const review = upsertDailyReview(input); review.aiSummary = '正在整理…'; save(); analysisText = '正在整理…'; render(); if (!state.settings.apiKey) { analysisText = localSummary(input); review.aiSummary = analysisText; save(); render(); return } try { const response = await fetch(state.settings.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.settings.apiKey}` }, body: JSON.stringify({ model: state.settings.model, messages: [{ role: 'system', content: '你是个人学习复盘助手。用中文，简短、具体，只根据输入整理成四行：事实、主要问题、明天一个动作、下周实验。不要泛泛鼓励。' }, { role: 'user', content: JSON.stringify(input) }], temperature: .3 }) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const json = await response.json(); analysisText = json.choices?.[0]?.message?.content || '没有得到模型回复'; review.aiSummary = analysisText; save(); render() } catch (error) { analysisText = `请求失败：${error.message}\n${localSummary(input)}`; review.aiSummary = analysisText; save(); render() } }
function localSummary(input) { const insight = input.facts.weeklyInsights?.[0]; const results = input.facts.sessions?.filter((session) => session.result).length || 0; return `事实：完成 ${input.facts.tasks} 个任务，专注 ${input.facts.focusMinutes} 分钟，新增 ${input.facts.newMistakes} 道错题，记录 ${results} 个专注结果。\n问题：${input.block || '没有记录明显阻碍'}（${input.blockerCategory || '其他'}）\n明天：${input.next || '先完成一个最小步骤'}${insight ? `\n下周实验：${insight}` : ''}` }
function exportData() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sop-loop-workspace-${today()}.json`; a.click(); URL.revokeObjectURL(url) }

render()
if (!guideState.dontShow) setTimeout(() => beginGuide(), 180)
