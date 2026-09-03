const issabelDbService = require('./services/issabelDbService');

async function test() {
    console.log('Testing fetchCallsDetail...');
    const outRes = await issabelDbService.fetchCallsDetail({ type: 'outbound', limit: 10 });
    console.log('OUTBOUND RESULT:', { total: outRes.total, count: outRes.data.length, sample: outRes.data[0] });

    const inRes = await issabelDbService.fetchCallsDetail({ type: 'inbound', limit: 10 });
    console.log('INBOUND RESULT:', { total: inRes.total, count: inRes.data.length, sample: inRes.data[0] });

    const ansRes = await issabelDbService.fetchCallsDetail({ type: 'answered', limit: 10 });
    console.log('ANSWERED RESULT:', { total: ansRes.total, count: ansRes.data.length, sample: ansRes.data[0] });

    process.exit(0);
}

test().catch(e => {
    console.error('ERROR:', e);
    process.exit(1);
});
