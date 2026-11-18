#!/usr/bin/php -q
<?php
/*
 * operator_baho.php — mijoz bosgan bahoni (1..5) asteriskcdrdb.operator_baho jadvaliga yozadi.
 * Dialplan: AGI(operator_baho.php,${BAHO})   (kontekst: [operator-baho], extensions_custom.conf)
 * Natija:   BAHO_SAVED kanal o'zgaruvchisi = 1 (yozildi) yoki 0 (xato).
 * PHP 5.4+ (Issabel 4 / CentOS 7) uchun yozilgan.
 */
set_time_limit(10);
error_reporting(E_ALL & ~E_NOTICE);
$LOG = '/var/log/asterisk/operator_baho.log';

// --- AGI muhitini o'qish (bo'sh qatorgacha) ---
$env = array();
while (($line = fgets(STDIN)) !== false) {
    $line = rtrim($line, "\r\n");
    if ($line === '') break;
    $pos = strpos($line, ':');
    if ($pos !== false) $env[substr($line, 0, $pos)] = ltrim(substr($line, $pos + 1));
}

function agi($cmd) {
    fwrite(STDOUT, $cmd . "\n");
    fflush(STDOUT);
    $r = trim((string) fgets(STDIN));
    if (preg_match('/^200 result=(-?\d+)(?: \((.*)\))?/', $r, $m)) {
        return array((int) $m[1], isset($m[2]) ? $m[2] : null);
    }
    return array(-1, null);
}
function getvar($expr) {
    list($res, $val) = agi('GET FULL VARIABLE ' . $expr);
    return ($res == 1 && $val !== null) ? $val : '';
}
function logmsg($msg) {
    global $LOG;
    @file_put_contents($LOG, date('Y-m-d H:i:s') . ' ' . $msg . "\n", FILE_APPEND);
    agi('VERBOSE "operator_baho: ' . str_replace('"', "'", $msg) . '" 1');
}
function finish($ok) {
    agi('SET VARIABLE BAHO_SAVED ' . ($ok ? '1' : '0'));
    exit(0);
}

// --- Ma'lumotlarni yig'ish ---
$baho = isset($argv[1]) ? trim($argv[1]) : '';
if (!preg_match('/^[1-5]$/', $baho)) {
    logmsg("noto'g'ri baho: '$baho'");
    finish(false);
}
$uniqueid  = isset($env['agi_uniqueid']) ? $env['agi_uniqueid'] : getvar('${UNIQUEID}');
$linkedid  = getvar('${CHANNEL(linkedid)}');
$queue     = getvar('${QUEUENUM}');
$iface     = getvar('${MEMBERINTERFACE}');   // queues_post_custom.conf: setinterfacevar=yes
$opname    = getvar('${MEMBERNAME}');
$src       = isset($env['agi_callerid']) ? $env['agi_callerid'] : getvar('${CALLERID(num)}');

// Zaxira yo'l: MEMBERINTERFACE bo'lmasa, operatorni queue_log'dan (CONNECT) topamiz
if ($iface === '') {
    $ql = '/var/log/asterisk/queue_log';
    if (is_readable($ql) && ($fh = fopen($ql, 'r'))) {
        $size = filesize($ql);
        fseek($fh, max(0, $size - 524288));          // oxirgi 512 KB
        $chunk = stream_get_contents($fh);
        fclose($fh);
        foreach (array_reverse(explode("\n", $chunk)) as $l) {
            $f = explode('|', $l);
            if (count($f) >= 5 && $f[1] === $uniqueid && $f[4] === 'CONNECT') {
                if (preg_match('#^(Local|SIP|PJSIP)/#', $f[3])) $iface = $f[3]; else $opname = $f[3];
                break;
            }
        }
    }
}
$opext = '';
if (preg_match('#^(?:Local|SIP|PJSIP)/([^@/-]+)#', $iface, $m)) $opext = $m[1];

// --- DB ulanish: /etc/amportal.conf dagi asteriskuser ---
$cfg = array('AMPDBHOST' => 'localhost', 'AMPDBUSER' => 'asteriskuser', 'AMPDBPASS' => '', 'CDRDBNAME' => 'asteriskcdrdb');
foreach (@file('/etc/amportal.conf') ?: array() as $l) {
    if (preg_match('/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/', $l, $m) && array_key_exists($m[1], $cfg) && $m[2] !== '') {
        $cfg[$m[1]] = trim($m[2], "\"'");
    }
}

try {
    $db = new PDO('mysql:host=' . $cfg['AMPDBHOST'] . ';dbname=' . $cfg['CDRDBNAME'] . ';charset=utf8',
        $cfg['AMPDBUSER'], $cfg['AMPDBPASS'],
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3));
    $st = $db->prepare('INSERT INTO operator_baho
            (rated_at, uniqueid, linkedid, queue, operator_ext, operator_name, member_interface, src, baho)
            VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE baho = VALUES(baho), rated_at = VALUES(rated_at)');
    $st->execute(array($uniqueid, $linkedid, $queue, $opext, $opname, $iface, $src, (int) $baho));
    logmsg("OK uid=$uniqueid op=$opext($opname) src=$src baho=$baho");
    finish(true);
} catch (Exception $e) {
    logmsg("DB XATO uid=$uniqueid baho=$baho: " . $e->getMessage());
    finish(false);
}
