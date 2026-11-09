/**
 * Automated Pre-Deploy Test Suite for Call Center AI
 * Tests:
 * 1. Inbound call direction stability (never flashes as outbound)
 * 2. Outbound call duration calculation (never 00:00 for answered calls)
 * 3. Outbound call client number extraction (never trunk 712020159)
 * 4. Phantom trunk 712020159 filtering
 * 5. Operator 106 naming (Ubaydullayeva Gulchehra)
 * 6. Callback queue leg deduplication
 */

const assert = require('assert');
const amiService = require('../services/amiService');
const issabelDbService = require('../services/issabelDbService');
const dbService = require('../services/dbService');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
        console.error(err.stack);
    }
}

console.log('\n======================================================');
console.log('🧪 CALL CENTER AUTOMATED PRE-DEPLOYMENT TEST SUITE');
console.log('======================================================\n');

// 1. Operator 106 Name Check
runTest('Operator 106 name is Ubaydullayeva Gulchehra across DB services', () => {
    const defaultName = issabelDbService.getOperatorName('106');
    assert(defaultName.includes('Ubaydullayeva Gulchehra'), `Expected Ubaydullayeva Gulchehra in defaultName, got: ${defaultName}`);
});

// 2. Inbound Queue Call Direction Stability
runTest('Inbound queue call is STRICTLY inbound and never labeled as outbound', () => {
    amiService.activeChannels.clear();
    amiService.channelToOperator.clear();
    amiService.operatorOutboundCalls.clear();
    amiService.ensureOperatorExists('119');

    const trunkChan = 'SIP/712020159-0000a1b2';
    const opChan = 'SIP/119-0000c3d4';
    const clientPhone = '997948800';

    // A) Trunk channel created
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: trunkChan,
        calleridnum: clientPhone,
        context: 'from-trunk',
        exten: '712020159'
    });

    // B) Operator channel created
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: opChan,
        calleridnum: clientPhone,
        context: 'from-internal',
        exten: '119'
    });

    // C) Queue rings operator 119
    amiService.handleManagerEvent({
        event: 'DialBegin',
        channel: trunkChan,
        destchannel: opChan,
        calleridnum: clientPhone,
        destcalleridnum: '119'
    });

    // Verify channel directions
    const tChanData = amiService.activeChannels.get(trunkChan);
    const opChanData = amiService.activeChannels.get(opChan);
    assert(tChanData, 'Trunk channel must exist');
    assert(opChanData, 'Operator channel must exist');
    assert.strictEqual(tChanData.direction, 'inbound', 'Trunk channel must be inbound');
    assert.strictEqual(opChanData.direction, 'inbound', 'Operator receiving channel must be inbound');

    // D) Operator answers call (AgentConnect)
    amiService.handleManagerEvent({
        event: 'AgentConnect',
        channel: trunkChan,
        destchannel: opChan,
        calleridnum: clientPhone,
        interface: 'SIP/119'
    });

    // E) CoreShowChannel poll (which previously had from-internal bug)
    amiService.handleManagerEvent({
        event: 'CoreShowChannel',
        channel: opChan,
        calleridnum: clientPhone,
        extension: '119',
        context: 'from-internal',
        channelstatedesc: 'Up'
    });

    const opChanAfterPoll = amiService.activeChannels.get(opChan);
    assert.strictEqual(opChanAfterPoll.direction, 'inbound', 'Operator channel after CoreShowChannel poll must remain inbound');

    // F) Recalculate conversations
    amiService.recalculateConversations();
    const convs = Array.from(amiService.activeConversations.values());
    const opConv = convs.find(c => c.operatorExten === '119');
    assert(opConv, 'Active conversation for operator 119 must exist');
    assert.strictEqual(opConv.direction, 'inbound', 'Conversation direction MUST BE inbound, never outbound');
    assert.strictEqual(opConv.callerId, clientPhone, `Caller ID must be client ${clientPhone}`);
});

// 3. Outbound Call Duration & CallerId Verification
runTest('Outbound call accurately records talk duration and dialed client number (not 00:00 or 712020159)', () => {
    amiService.activeChannels.clear();
    amiService.channelToOperator.clear();
    amiService.operatorOutboundCalls.clear();
    amiService.callHistory = [];
    amiService.ensureOperatorExists('114');

    const opChan = 'SIP/114-0000e5f6';
    const trunkChan = 'SIP/712020159-0000g7h8';
    const clientPhone = '991234567';

    // A) Channels created
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: opChan,
        calleridnum: '114',
        context: 'from-internal',
        exten: clientPhone
    });
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: trunkChan,
        calleridnum: '114',
        context: 'macro-dialout-trunk',
        exten: clientPhone
    });

    // B) Operator 114 dials client 991234567
    amiService.handleManagerEvent({
        event: 'DialBegin',
        channel: opChan,
        destchannel: trunkChan,
        calleridnum: '114',
        destcalleridnum: clientPhone,
        dialstring: clientPhone
    });

    const outCall = amiService.operatorOutboundCalls.get('114');
    assert(outCall, 'Outbound call record must exist for operator 114');
    assert.strictEqual(outCall.dialedNumber, clientPhone, 'Dialed number must be 991234567');

    // C) Client answers the phone (DialEnd ANSWER + Bridge Link)
    amiService.handleManagerEvent({
        event: 'DialEnd',
        channel: opChan,
        destchannel: trunkChan,
        dialstatus: 'ANSWER'
    });

    const opChanData = amiService.activeChannels.get(opChan);
    assert(opChanData, 'Operator channel must exist');
    assert.strictEqual(opChanData.state, 'Talking', 'Channel state must be Talking on ANSWER');
    assert(opChanData.answeredTime, 'answeredTime must be set on ANSWER');

    const opObj = amiService.operators.get('114');
    assert.strictEqual(opObj.presence, 'talking', 'Operator presence must be talking on ANSWER');

    // Bridge event (Asterisk 11/13/16 Link)
    amiService.handleManagerEvent({
        event: 'Bridge',
        bridgestate: 'Link',
        channel1: opChan,
        channel2: trunkChan
    });

    // D) Hangup after 42 seconds with Asterisk AMI billsec: 42
    amiService.handleManagerEvent({
        event: 'Hangup',
        channel: opChan,
        uniqueid: '1741234567.114',
        billsec: '42',
        duration: '50',
        cause: '16'
    });

    assert(amiService.callHistory.length > 0, 'Call history must contain record');
    const recordedCall = amiService.callHistory[0];
    assert.strictEqual(recordedCall.direction, 'outbound', 'Recorded call direction must be outbound');
    assert.strictEqual(recordedCall.callerId, clientPhone, `Caller ID must be client ${clientPhone}, not trunk 712020159`);
    assert.strictEqual(recordedCall.status, 'ANSWERED', 'Status must be ANSWERED');
    assert.strictEqual(recordedCall.duration, 42, `Duration must be 42 seconds from AMI billsec, got: ${recordedCall.duration}`);
});

// 4. Outbound Duration Fallback when AMI billsec is missing
runTest('Outbound call duration falls back to answeredTime/startTime when billsec is 0 or missing', () => {
    amiService.activeChannels.clear();
    amiService.channelToOperator.clear();
    amiService.operatorOutboundCalls.clear();
    amiService.callHistory = [];
    amiService.ensureOperatorExists('114');

    const opChan = 'SIP/114-0000x1y2';
    const trunkChan = 'SIP/712020159-0000x3y4';
    const clientPhone = '901234567';

    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: opChan,
        calleridnum: '114',
        context: 'from-internal',
        exten: clientPhone
    });
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: trunkChan,
        calleridnum: '114',
        context: 'macro-dialout-trunk',
        exten: clientPhone
    });

    amiService.handleManagerEvent({
        event: 'DialBegin',
        channel: opChan,
        destchannel: trunkChan,
        calleridnum: '114',
        dialstring: clientPhone
    });

    // DialEnd ANSWER 25 seconds ago
    const twentyFiveSecAgo = new Date(Date.now() - 25000);
    amiService.handleManagerEvent({
        event: 'DialEnd',
        channel: opChan,
        destchannel: trunkChan,
        dialstatus: 'ANSWER'
    });

    // Artificially adjust answeredTime back 25 seconds to test calculation
    amiService.activeChannels.get(opChan).answeredTime = twentyFiveSecAgo;

    // Hangup with no billsec
    amiService.handleManagerEvent({
        event: 'Hangup',
        channel: opChan,
        uniqueid: '1741234567.999',
        billsec: '0',
        duration: '0',
        cause: '16'
    });

    const recordedCall = amiService.callHistory[0];
    assert(recordedCall, 'Recorded call must exist');
    assert.strictEqual(recordedCall.status, 'ANSWERED');
    assert(recordedCall.duration >= 24 && recordedCall.duration <= 26, `Duration should be ~25 sec, got: ${recordedCall.duration}`);
});

// 5. Phantom Outbound 712020159 Trunk Filtering
runTest('Trunk channel 712020159 without client number is never saved to call history', () => {
    amiService.activeChannels.clear();
    amiService.channelToOperator.clear();
    amiService.operatorOutboundCalls.clear();
    amiService.callHistory = [];

    const trunkChan = 'SIP/712020159-0000phantom';
    amiService.activeChannels.set(trunkChan, {
        channel: trunkChan,
        callerId: '712020159',
        callerName: 'Trunk',
        extension: '2020159',
        context: 'macro-dialout-trunk',
        state: 'Up',
        direction: 'outbound',
        startTime: new Date(),
        dialedPhone: null
    });

    amiService.handleManagerEvent({
        event: 'Hangup',
        channel: trunkChan,
        uniqueid: '1741234567.phantom',
        cause: '16'
    });

    assert.strictEqual(amiService.callHistory.length, 0, 'Phantom trunk channel must NOT be added to call history');
});

// 6. Callback Queue Leg Deduplication
runTest('Intermediate queue member ring failure does not trigger callback upsert', () => {
    const testPhone = '998991112233';

    amiService.activeChannels.set('SIP/114-0000leg', {
        channel: 'SIP/114-0000leg',
        callerId: testPhone,
        callerName: '',
        extension: '114',
        context: 'from-internal',
        state: 'Ring',
        direction: 'inbound',
        startTime: new Date()
    });

    // Operator phone stops ringing because next operator in queue is ringing
    amiService.handleManagerEvent({
        event: 'Hangup',
        channel: 'SIP/114-0000leg',
        cause: '16'
    });

    // Verify it didn't create a false callback for testPhone
    const afterCallbacks = dbService.getCallbacks();
    const created = afterCallbacks.find(c => c.phone.includes('991112233'));
    assert(!created, 'Intermediate queue leg must not create an abandoned callback');
});

// 7. Outbound call survives concurrent busy queue rings and trunk hangup
runTest('Outbound call through trunk is strictly outbound with dialed client number and accurate duration despite background queue rings', () => {
    amiService.activeChannels.clear();
    amiService.channelToOperator.clear();
    amiService.operatorOutboundCalls.clear();
    amiService.callHistory = [];
    amiService.ensureOperatorExists('114');

    const opChan = 'SIP/114-0000004c';
    const trunkChan = 'SIP/712020159-0000004d';
    const clientPhone = '903600903';

    // A) Channels created
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: opChan,
        calleridnum: '114',
        context: 'from-internal',
        exten: clientPhone
    });
    amiService.handleManagerEvent({
        event: 'Newchannel',
        channel: trunkChan,
        calleridnum: '712020159',
        context: 'from-trunk',
        exten: '2020159'
    });

    // B) DialBegin with dialstring SIP/712020159/903600903
    amiService.handleManagerEvent({
        event: 'DialBegin',
        channel: opChan,
        destchannel: trunkChan,
        calleridnum: '114',
        destcalleridnum: clientPhone,
        dialstring: `SIP/712020159/${clientPhone}`
    });

    // C) DialEnd ANSWER
    const fifteenMinAgo = new Date(Date.now() - 899000);
    amiService.handleManagerEvent({
        event: 'DialEnd',
        channel: opChan,
        destchannel: trunkChan,
        dialstatus: 'ANSWER'
    });

    amiService.activeChannels.get(opChan).startTime = fifteenMinAgo;
    amiService.activeChannels.get(opChan).answeredTime = fifteenMinAgo;
    amiService.activeChannels.get(trunkChan).startTime = fifteenMinAgo;
    amiService.activeChannels.get(trunkChan).answeredTime = fifteenMinAgo;

    // D) Background queue ring attempt to 114 while 114 is busy
    amiService.handleManagerEvent({
        event: 'DialBegin',
        channel: 'SIP/712020159-0000queue',
        destchannel: 'Local/114@from-queue-00001394;1',
        calleridnum: '903745500',
        destcalleridnum: '114'
    });
    amiService.handleManagerEvent({
        event: 'DialEnd',
        channel: 'SIP/712020159-0000queue',
        destchannel: 'Local/114@from-queue-00001394;1',
        dialstatus: 'BUSY'
    });

    // E) CoreShowChannel poll on trunk channel
    amiService.handleManagerEvent({
        event: 'CoreShowChannel',
        channel: trunkChan,
        calleridnum: '712020159',
        extension: clientPhone,
        context: 'from-trunk',
        channelstatedesc: 'Up'
    });

    // F) Hangup on trunk channel
    amiService.handleManagerEvent({
        event: 'Hangup',
        channel: trunkChan,
        uniqueid: '1791375725.41316',
        cause: '16'
    });

    assert(amiService.callHistory.length > 0, 'Outbound call must be saved in callHistory');
    const call = amiService.callHistory[0];
    assert.strictEqual(call.direction, 'outbound', 'Direction must be outbound, never inbound');
    assert.strictEqual(call.callerId, clientPhone, `Caller must be ${clientPhone}, not trunk or private`);
    assert.strictEqual(call.status, 'ANSWERED', 'Status must be ANSWERED');
    assert(call.duration >= 890, `Duration must be ~899s, got: ${call.duration}`);
    assert.strictEqual(call.hangupParty, 'Operator', 'Hangup party for outbound answered call must be Operator');
});

console.log('\n======================================================');
console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
console.log('======================================================\n');

if (passedTests !== totalTests) {
    console.error('❌ SOME TESTS FAILED! ABORTING DEPLOYMENT.');
    process.exit(1);
} else {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
}
