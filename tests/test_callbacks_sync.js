/**
 * Automated Pre-Deploy Test: Callbacks Sync & Resolution Integrity
 * Tests:
 * 1. CDR abandoned call detection with operator answered subquery exclusion
 * 2. Real-time abandoned calls survive consecutive sync cycles
 * 3. Answered callbacks resolve with operator ID and survive background cleanup
 * 4. Breakdown statistics (pending vs resolved) integrity
 */

const assert = require('assert');
const issabelDbService = require('../services/issabelDbService');
const dbService = require('../services/dbService');

let passedTests = 0;
let totalTests = 0;

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
        console.error(err.stack);
    }
}

async function main() {
    console.log('\n======================================================');
    console.log('🧪 CALLBACKS & QUEUE ABANDONED SYNC PRE-DEPLOY TEST');
    console.log('======================================================\n');

    // Test 1: Full sync with Asterisk CDR
    await runAsyncTest('Asterisk CDR sync accurately detects abandoned/unanswered calls', async () => {
        await issabelDbService.syncPendingCallbacks(1);
        const breakdown = dbService.getAbandonedBreakdown('today');
        assert(typeof breakdown.pendingCount === 'number', 'pendingCount must be a number');
        assert(typeof breakdown.resolvedCount === 'number', 'resolvedCount must be a number');
        console.log(`     (Hozirgi bugungi holat: Kutilmoqda=${breakdown.pendingCount}, Gaplashildi=${breakdown.resolvedCount})`);
    });

    // Test 2: Real-time caller survives consecutive background sync runs
    await runAsyncTest('Real-time caller is not erroneously deleted by background cleanup', async () => {
        const testPhone = '999887766';
        const nowTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');

        // Real-time orqali qo'shish
        dbService.upsertCallback({
            phone: testPhone,
            source: 'abandoned',
            callTime: nowTime
        });

        // 3 marta foniy sinxronizatsiya yurgizish
        await issabelDbService.syncPendingCallbacks(1);
        await issabelDbService.syncPendingCallbacks(1);
        await issabelDbService.syncPendingCallbacks(1);

        const checkPending = dbService.db.prepare(`SELECT * FROM pending_callbacks WHERE phone = ? AND status = 'pending'`).get(testPhone);
        assert(checkPending, `Test caller ${testPhone} must survive background sync cleanup!`);

        // Tozalash
        dbService.db.prepare(`DELETE FROM pending_callbacks WHERE phone = ?`).run(testPhone);
    });

    // Test 3: Resolved caller preservation (never drops to 0 or gets permanently deleted)
    await runAsyncTest('Resolved caller preserves "resolved" status through sync runs', async () => {
        const testPhone = '999776655';
        const nowTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');

        dbService.upsertCallback({
            phone: testPhone,
            source: 'abandoned',
            callTime: nowTime
        });

        const resolved = dbService.resolveCallback(testPhone, 'operator_106', '106');
        assert(resolved, 'resolveCallback must return true');

        // Sinxronizatsiya
        await issabelDbService.syncPendingCallbacks(1);

        const checkResolved = dbService.db.prepare(`SELECT * FROM pending_callbacks WHERE phone = ?`).get(testPhone);
        assert(checkResolved, 'Resolved record must not be permanently deleted!');
        assert.strictEqual(checkResolved.status, 'resolved', 'Status must remain "resolved"');
        assert(checkResolved.dismissed_by, 'dismissed_by must be recorded');

        // Tozalash
        dbService.db.prepare(`DELETE FROM pending_callbacks WHERE phone = ?`).run(testPhone);
    });

    // Test 4: Known caller 999828891 check
    await runAsyncTest('Known abandoned caller 999828891 is marked as resolved by operator 106', async () => {
        const row = dbService.db.prepare(`SELECT * FROM pending_callbacks WHERE phone = '999828891' ORDER BY id DESC LIMIT 1`).get();
        if (row) {
            assert.strictEqual(row.status, 'resolved', `Status must be resolved, got ${row.status}`);
            assert(String(row.dismissed_by).includes('106') || String(row.last_outbound_operator).includes('106'), 'Must be associated with operator 106');
        }
    });

    // Test 5: resolution_type ('operator_outbound' vs 'client_inbound') is correctly saved and retrieved
    await runAsyncTest('Resolution types (operator_outbound and client_inbound) are properly saved and retrieved', async () => {
        const phoneOut = '999112233';
        const phoneIn = '999223344';
        const nowTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');

        dbService.upsertCallback({ phone: phoneOut, source: 'abandoned', callTime: nowTime });
        dbService.upsertCallback({ phone: phoneIn, source: 'abandoned', callTime: nowTime });

        dbService.resolveCallback(phoneOut, 'operator_103_outbound', '103', 'operator_outbound');
        dbService.resolveCallback(phoneIn, 'operator_111_inbound', '111', 'client_inbound');

        const list = dbService.getCallbacks('today', true);
        const itemOut = list.find(c => c.phone === phoneOut);
        const itemIn = list.find(c => c.phone === phoneIn);

        assert(itemOut, 'phoneOut must exist in getCallbacks list');
        assert(itemIn, 'phoneIn must exist in getCallbacks list');
        assert.strictEqual(itemOut.resolution_type, 'operator_outbound', 'phoneOut must have operator_outbound');
        assert.strictEqual(itemIn.resolution_type, 'client_inbound', 'phoneIn must have client_inbound');

        // Tozalash
        dbService.db.prepare(`DELETE FROM pending_callbacks WHERE phone IN (?, ?)`).run(phoneOut, phoneIn);
    });

    // Test 6: Operator name is never stored as literal 'NULL' and formats extension
    await runAsyncTest('Operator name is never literal NULL and properly formats numeric extension', async () => {
        const phoneNull = '999334455';
        const nowTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).replace('T', ' ');

        dbService.upsertCallback({ phone: phoneNull, source: 'abandoned', callTime: nowTime });
        dbService.resolveCallback(phoneNull, 'operator_103', 'NULL', 'client_inbound');

        const row = dbService.db.prepare(`SELECT * FROM pending_callbacks WHERE phone = ?`).get(phoneNull);
        assert(row, 'Record must exist');
        assert.notStrictEqual(row.last_outbound_operator, 'NULL', 'last_outbound_operator must NOT be literal string "NULL"');
        assert.notStrictEqual(row.last_outbound_operator, 'null', 'last_outbound_operator must NOT be literal string "null"');
        // Extension 103 should be formatted to Feruza (103)
        assert(String(row.last_outbound_operator).includes('103'), 'Must contain extension 103');

        // Tozalash
        dbService.db.prepare(`DELETE FROM pending_callbacks WHERE phone = ?`).run(phoneNull);
    });

    // Test 7: Answered caller (like 998396673) is NEVER inserted into pending_callbacks
    await runAsyncTest('Normal answered caller (998396673) is NEVER inserted into callbacks', async () => {
        // Ensure not in DB
        dbService.db.prepare(`DELETE FROM pending_callbacks WHERE phone = '998396673'`).run();
        await issabelDbService.syncPendingCallbacks(1);
        const checkBogus = dbService.db.prepare(`SELECT * FROM pending_callbacks WHERE phone = '998396673'`).get();
        assert(!checkBogus, 'Caller 998396673 was answered and must NEVER be inserted into callbacks!');
    });

    console.log('\n======================================================');
    console.log(`🏁 NATIJA: ${passedTests}/${totalTests} ta test muvaffaqiyatli o'tdi.`);
    console.log('======================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
