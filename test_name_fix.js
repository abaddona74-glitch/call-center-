// Test: getOperatorName "(ext)" takrorlanishini tozalashi kerak
const svc = require('./services/issabelDbService.js');
svc.operatorNames.set('116', 'Ibrohim (116)');   // DB ifloslangan holat
svc.operatorNames.set('101', 'Oybek');           // toza holat
console.log('116 ->', svc.getOperatorName('116'));
console.log('101 ->', svc.getOperatorName('101'));
console.log('999 ->', svc.getOperatorName('999'));
