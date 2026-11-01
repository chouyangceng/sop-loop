import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const fn = source.slice(source.indexOf('function syncCalendarToMemo()'), source.indexOf('function save()'))
const event = { id: 'a', title: '考试', date: '2026-11-03', time: '09:00', yearly: false }
const context = vm.createContext({ state: { memo: '原有笔记', calendarEvents: [event], memoCalendarIds: [] } })
const sync = () => vm.runInContext(fn + '\nsyncCalendarToMemo()', context)
sync()
assert.match(context.state.memo, /原有笔记/)
assert.match(context.state.memo, /2026-11-03 09:00 · 考试/)
const once = context.state.memo
sync()
assert.equal(context.state.memo, once)
context.state.memo = ''
context.state = JSON.parse(JSON.stringify(context.state))
sync()
assert.equal(context.state.memo, '')
assert.equal(context.state.calendarEvents[0].title, '考试')
context.state.calendarEvents.push({ ...event, id: 'b', title: '生日', yearly: true })
sync()
assert.match(context.state.memo, /生日（每年固定）/)
assert.doesNotMatch(context.state.memo, /考试/)
console.log('Calendar to memo: append, deduplication, deletion persistence and isolation passed')
