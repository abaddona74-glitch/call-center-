#!/usr/bin/php -q
<?php
/*
 * operator_baho.php — stores the client's post-call rating (1..5) in asteriskcdrdb.operator_baho.
 * Dialplan: AGI(operator_baho.php,${BAHO})   (context [operator-baho], extensions_custom.conf)
 * Result:   channel variable BAHO_SAVED = 1 (stored) or 0 (not stored).
 * Written for PHP 5.4+ (Issabel 4 / CentOS 7). Test: infra/pbx/operator-survey/test/agi-test.sh.
 *
 * STDOUT is the AGI protocol: anything else printed there (a PHP warning, a stray newline from a caller ID)
 * would be read by Asterisk as a command. So errors go to STDERR and every value we echo back is sanitized.
 */
set_time_limit(10);
error_reporting(E_ALL & ~E_NOTICE);
ini_set('display_errors', 'stderr');
if (!ini_get('date.timezone')) date_default_timezone_set('Asia/Tashkent');
$LOG = getenv('BAHO_LOG') ?: '/var/log/asterisk/operator_baho.log';
$AMPORTAL = getenv('BAHO_AMPORTAL') ?: '/etc/amportal.conf';
$QUEUE_LOG = getenv('BAHO_QUEUE_LOG') ?: '/var/log/asterisk/queue_log';

// --- AGI environment (up to the empty line) ---
$env = array();
while (($line = fgets(STDIN)) !== false) {
    $line = rtrim($line, "\r\n");
    if ($line === '') break;
    $pos = strpos($line, ':');
    if ($pos !== false) $env[substr($line, 0, $pos)] = ltrim(substr($line, $pos + 1));
}

/** One line of printable text, at most $max bytes: no control characters can reach the AGI channel or the DB. */
function clean($value, $max) {
    $s = substr(trim(preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string) $value)), 0, $max);
    return $s === false ? '' : $s;   // PHP < 8: substr('', 0, n) is false, not ''
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
    $msg = clean($msg, 500);
    @file_put_contents($LOG, date('Y-m-d H:i:s') . ' ' . $msg . "\n", FILE_APPEND);
    agi('VERBOSE "operator_baho: ' . str_replace(array('\\', '"'), array('/', "'"), $msg) . '" 1');
}
function finish($ok) {
    agi('SET VARIABLE BAHO_SAVED ' . ($ok ? '1' : '0'));
    exit(0);
}

// --- Collect the data ---
$baho = isset($argv[1]) ? trim($argv[1]) : '';
if (!preg_match('/^[1-5]$/', $baho)) {
    logmsg("invalid rating: '$baho'");
    finish(false);
}
$uniqueid = clean(isset($env['agi_uniqueid']) ? $env['agi_uniqueid'] : getvar('${UNIQUEID}'), 32);
$linkedid = clean(getvar('${CHANNEL(linkedid)}'), 32);
$queue    = clean(getvar('${QUEUENUM}'), 20);
$iface    = clean(getvar('${MEMBERINTERFACE}'), 80);   // queues_post_custom.conf: setinterfacevar=yes
$opname   = clean(getvar('${MEMBERNAME}'), 80);
$src      = clean(isset($env['agi_callerid']) ? $env['agi_callerid'] : getvar('${CALLERID(num)}'), 80);

// Fallback: the member (and the queue) from the CONNECT line of queue_log for this caller channel.
if (($iface === '' || $queue === '') && is_readable($QUEUE_LOG) && ($fh = fopen($QUEUE_LOG, 'r'))) {
    fseek($fh, max(0, filesize($QUEUE_LOG) - 524288));          // last 512 KB
    $chunk = stream_get_contents($fh);
    fclose($fh);
    foreach (array_reverse(explode("\n", $chunk)) as $l) {
        $f = explode('|', $l);
        if (count($f) >= 5 && $f[1] === $uniqueid && $f[4] === 'CONNECT') {
            if ($queue === '') $queue = clean($f[2], 20);
            if ($iface === '') {
                if (preg_match('#^(Local|SIP|PJSIP)/#', $f[3])) $iface = clean($f[3], 80);
                elseif ($opname === '') $opname = clean($f[3], 80);
            }
            break;
        }
    }
}
$opext = '';
if (preg_match('#^(?:Local|SIP|PJSIP)/([0-9]{2,6})(?:[@/-]|$)#', $iface, $m)) $opext = $m[1];

// --- DB: the asteriskuser from /etc/amportal.conf ---
$cfg = array('AMPDBHOST' => 'localhost', 'AMPDBUSER' => 'asteriskuser', 'AMPDBPASS' => '', 'CDRDBNAME' => 'asteriskcdrdb');
foreach (@file($AMPORTAL) ?: array() as $l) {
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
    logmsg("OK uid=$uniqueid queue=$queue op=$opext($opname) src=$src baho=$baho");
    finish(true);
} catch (Exception $e) {
    logmsg("DB ERROR uid=$uniqueid baho=$baho: " . $e->getMessage());
    finish(false);
}
