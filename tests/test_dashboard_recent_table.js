const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- TEST: Dashboard Recent Calls Table Rendering ---');

// Mock DOM elements
class ElementMock {
    constructor(id) {
        this.id = id;
        this.innerHTML = '';
        this.value = '';
        this.style = {};
        this.classList = {
            contains: () => false,
            add: () => {},
            remove: () => {}
        };
    }
}

const elements = {
    'dashboardCallsTable': new ElementMock('dashboardCallsTable'),
    'recentFilterOperator': new ElementMock('recentFilterOperator'),
    'recentFilterStatus': new ElementMock('recentFilterStatus'),
    'recentFilterDirection': new ElementMock('recentFilterDirection'),
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
        addEventListener: () => {}
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
const code = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

// Extract and eval updateSortIcons, applyDashboardRecentFilters, renderDashboardRecentTable
const vm = require('vm');
// Read dashboard.js and extract the recent calls block
const fullCode = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');
const startIdx = fullCode.indexOf('let dashboardRecentCallsList = [];');
const endIdx = fullCode.indexOf('async function playDashboardRecording', startIdx);
assert(startIdx !== -1 && endIdx !== -1, 'Must find recent calls block in dashboard.js');
const recentCallsCode = fullCode.substring(startIdx, endIdx);

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
    Map: Map
};

vm.createContext(context);
vm.runInContext(recentCallsCode, context);

// Test 1: Empty list renders empty row
assert(typeof context.renderDashboardRecentTable === 'function', 'renderDashboardRecentTable must be defined');
context.renderDashboardRecentTable([]);
assert(elements.dashboardCallsTable.innerHTML.includes("Hozircha qo'ng'iroqlar yo'q"), 'Empty table must show empty message');
console.log('✅ Test 1: Empty state renders correctly');

// Test 2: Populated list renders rows without hangupDisplay or other reference errors
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
        hangupParty: 'Operator',
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
        hangupParty: 'Mijoz',
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
        hangupParty: "Ko'tarilmadi",
        time: new Date().toISOString()
    }
];

elements['recentFilterStatus'].value = 'all';
elements['recentFilterDirection'].value = 'all';

vm.runInContext(`dashboardRecentCallsList = ${JSON.stringify(sampleCalls)};`, context);
context.applyDashboardRecentFilters();

const html = elements.dashboardCallsTable.innerHTML;
assert(!html.includes("Hozircha qo'ng'iroqlar yo'q"), 'Populated table must not show empty message');
assert(html.includes('901234567'), 'HTML must contain first caller ID');
assert(html.includes('998909876543'), 'HTML must contain second caller ID');
assert(html.includes('Operator'), 'HTML must render hangup party');
assert(html.includes('Mijoz'), 'HTML must render Mijoz hangup party');
console.log('✅ Test 2: Real-time calls render correctly with all badges and hangup parties!');

console.log('🎉 All Recent Table Rendering tests PASSED!');
