import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const functions = source.slice(source.indexOf('function planMinutes('), source.indexOf('function renderDailyPlan('))
const context = vm.createContext({})
vm.runInContext(functions, context)
assert.equal(vm.runInContext("planDuration('09:00', '11:00')", context), 120)
assert.equal(vm.runInContext("planDuration('23:30', '00:30')", context), 60)
assert.equal(vm.runInContext("planDuration('09:00', '09:00')", context), 0)
console.log('Daily plan durations passed')
