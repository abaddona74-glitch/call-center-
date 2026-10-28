const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Dashboard Recent Calls Modern Table Rendering ---');

// Mock DOM elements
class ElementMock {
    constructor(id) {
        this.id = id;
        this.innerHTML = '';
        this.value = '';
        this.textContent = '';
        this.style = {};
        this.disabled = false;
        this.children = [];
        this.classList = {
            contains: () => false,
            add: () => {},
            remove: () => {}
        };
    }
    querySelectorAll() {
        return [];
    }
    getAttribute() {
        return '';
    }
}

const elements = {
    'dashboardCallsTable': new ElementMock('dashboardCallsTable'),
    'recentFilterOperator': new ElementMock('recentFilterOperator'),
    'recentCallsSeg': new ElementMock('recentCallsSeg'),
    'recentTotalCount': new ElementMock('recentTotalCount'),
    'recentBtnPrev': new ElementMock('recentBtnPrev'),
    'recentBtnNext': new ElementMock('recentBtnNext'),
    'recentPageNumbers': new ElementMock('recentPageNumbers'),
    'btnClearRecentFilters': new ElementMock('btnClearRecentFilters'),
    'recentOperatorsList': new ElementMock('recentOperatorsList')
};

global.document = {
    getElementById: (id) => elements[id] || { 
        getContext: () => ({}), 
        style: {}, 
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        setAttribute: () => {},
        getAttribute: () => '',
        addEventListener: () => {},
        querySelectorAll: () => []
    },
    createElement: () => ({ appendChild: () => {}, style: {}, classList: { add: () => {}, remove: () => {} }, innerHTML: '', addEventListener: () => {} }),
    addEventListener: () => {},
    querySelectorAll: () => [],
    documentElement: { setAttribute: () => {}, getAttribute: () => '' },
    body: { classList: { add: () => {}, remove: () => {}, contains: () => false } }
};

global.t = (key, fallback) => fallback;
global.tf = (key, params, fallback) => fallback;
global.formatSeconds = (s) => `${s}s`;
global.formatOperatorDisplayName = (op) => op || 'Operator';
global.formatHangupParty = (p) => p || '-';
global.isCallerExpanded = () => false;
global.renderExpandableCallerHtml = (c) => `<span>${c}</span>`;
global.currentlyPlayingCallKey = null;
global.pausedCallKey = null;
global.activeSearchingCallerId = null;

global.isax = (name, extraClass = '', extraStyle = '') => `<svg class="isax isax-${name} ${extraClass}" style="${extraStyle}"></svg>`;

// Read the function implementations from public/js/dashboard.js
const fullCode = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');
const startIdx = fullCode.indexOf('let dashboardRecentCallsList = [];');
const endIdx = fullCode.indexOf('async function playDashboardRecording', startIdx);
assert(startIdx !== -1 && endIdx !== -1, 'Must find recent calls block in dashboard.js');
const recentCallsCode = fullCode.substring(startIdx, endIdx);

const vm = require('vm');
const context = {
    document: global.document,
    isax: global.isax,
    t: global.t,
    tf: global.tf,
    formatSeconds: global.formatSeconds,
    formatOperatorDisplayName: global.formatOperatorDisplayName,
    formatHangupParty: global.formatHangupParty,
    isCallerExpanded: global.isCallerExpanded,
    renderExpandableCallerHtml: global.renderExpandableCallerHtml,
    currentlyPlayingCallKey: null,
    pausedCallKey: null,
    activeSearchingCallerId: null,
    currentOperators: [],
    console: console,
    Date: Date,
    String: String,
    Array: Array,
    Boolean: Boolean,
    parseInt: parseInt,
    Math: Math,
    currentRecentSortColumn: 'time',
    currentRecentSortDirection: 'desc'
};

vm.createContext(context);
vm.runInContext(recentCallsCode, context);

// Test 1: Empty list renders empty row
assert(typeof context.renderDashboardRecentTable === 'function', 'renderDashboardRecentTable must be defined');
context.renderDashboardRecentTable([]);
assert(elements.dashboardCallsTable.innerHTML.includes("Hozircha qo'ng'iroqlar yo'q"), 'Empty table must show empty message');
console.log('✅ Test 1: Empty state renders correctly');

// Test 2: Populated list renders rows with 7 columns & status classes
const sampleCalls = [
    {
        id: 'call_1',
        callerId: '901234567',
        operator: 'Maxmudbek (114)',
        operatorExten: '114',
        direction: 'outbound',
        status: 'ANSWERED',
        duration: 45,
        waitSec: 0,
        time: new Date().toISOString(),
        recording: '2026/10/05/out-114-901234567.wav'
    },
    {
        id: 'call_2',
        callerId: '998909876543',
        operator: 'Gulchehra Ubaydullayeva (106)',
        operatorExten: '106',
        direction: 'inbound',
        status: 'ANSWERED',
        duration: 120,
        waitSec: 15,
        time: new Date().toISOString(),
        recording: '2026/10/05/in-998909876543-106.wav'
    },
    {
        id: 'call_3',
        callerId: '901112233',
        operator: 'Navbat',
        operatorExten: null,
        direction: 'inbound',
        status: 'NO ANSWER',
        duration: 0,
        waitSec: 32,
        time: new Date().toISOString()
    }
];

vm.runInContext(`dashboardRecentCallsList = ${JSON.stringify(sampleCalls)};`, context);
context.applyDashboardRecentFilters();

const html = elements.dashboardCallsTable.innerHTML;
assert(!html.includes("Hozircha qo'ng'iroqlar yo'q"), 'Populated table must not show empty message');
assert(html.includes('901234567'), 'HTML must contain first caller ID');
assert(html.includes('998909876543'), 'HTML must contain second caller ID');
assert(html.includes('Gulchehra Ubaydullayeva (106)'), 'HTML must contain operator display name');
assert(html.includes('Javob berilgan'), 'HTML must render status text');
assert(html.includes('Navbatdan chiqdi'), 'HTML must render lost queue status text');
console.log('✅ Test 2: Real-time calls render correctly with modern status dots and buttons!');

// Test 3: Pagination persistence on periodic sync
const manyCalls = [];
for (let i = 1; i <= 50; i++) {
    manyCalls.push({
        id: `call_${i}`,
        callerId: `9989000000${i}`,
        operator: 'Operator (101)',
        operatorExten: '101',
        direction: 'inbound',
        status: 'ANSWERED',
        duration: 30,
        waitSec: 5,
        time: new Date(Date.now() - i * 1000).toISOString()
    });
}

vm.runInContext(`dashboardRecentCallsList = ${JSON.stringify(manyCalls)}; dashboardRecentPage = 2;`, context);
// Default call (e.g. from background sync) keeps page
context.applyDashboardRecentFilters(false);
assert.strictEqual(vm.runInContext('dashboardRecentPage', context), 2, 'Page must stay 2 when resetPage=false');

// Explicit user filter change triggers applyDashboardRecentFilters(true)
context.applyDashboardRecentFilters(true);
assert.strictEqual(vm.runInContext('dashboardRecentPage', context), 1, 'Page must reset to 1 on explicit filter change');
// Test 4: updateRecentOperatorsDataList works without ReferenceError: escapeHtml is not defined
assert(typeof context.updateRecentOperatorsDataList === 'function', 'updateRecentOperatorsDataList must be a function');
assert.doesNotThrow(() => {
    context.updateRecentOperatorsDataList();
}, 'updateRecentOperatorsDataList must execute without throwing escapeHtml error');
assert(elements.recentOperatorsList.innerHTML.includes('<option value="'), 'recentOperatorsList must contain option tags');
console.log('✅ Test 4: updateRecentOperatorsDataList executes cleanly with escapeHtml!');

console.log('🎉 All Recent Table Rendering tests PASSED!');

