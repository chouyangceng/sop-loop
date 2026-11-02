import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const builder = source.slice(source.indexOf('function buildWorkspaceAiData()'), source.indexOf('async function requestWorkspaceAi('))
const state = {
 sops: [{id:'s',title:'流程'}], tasks:[{id:'t',sopId:'s'}],
 dailyPlans:[{id:'p',completed:true}], calendarEvents:[{id:'c',yearly:true}],
 memo:'笔记', focusSessions:[{id:'f',taskId:'t',duration:12}],
 mistakes:[{id:'m',question:'问题',attachmentIds:['image']}],
 reviews:[{id:'r',good:'结果',aiSummary:'旧结论'}],
 settings:{apiKey:'SECRET',mistakeSyncToken:'TOKEN'},sync:{token:'SECRET'}
}
const ctx=vm.createContext({state,today:()=> '2026-11-02',Intl})
const result=vm.runInContext(builder+'\nbuildWorkspaceAiData()',ctx)
for (const key of ['sops','tasks','dailyPlans','calendar','sessions','mistakes','reviews']) assert.equal(result[key].length,1)
assert.equal(result.memo,'笔记')
assert.equal(result.mistakes[0].attachmentCount,1)
assert.equal(result.sessions[0].taskId,'t')
const text=JSON.stringify(result)
for (const secret of ['SECRET','TOKEN','旧结论','attachmentIds']) assert.ok(!text.includes(secret))
console.log('AI data coverage, relations and secret exclusion passed')
