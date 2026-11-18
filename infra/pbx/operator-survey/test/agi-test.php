<?php
/*
 * Plays Asterisk for agi-bin/operator_baho.php: feeds the AGI environment, answers its commands, then checks the
 * row in operator_baho and that STDOUT carried nothing but AGI commands. Needs a MariaDB with the table and a writer
 * (test/agi-test.sh sets it up). PHP 5.4+ like the PBX.
 */
$agi = dirname(__FILE__) . '/../agi-bin/operator_baho.php';
$dsn = getenv('TEST_DSN');
$db = new PDO($dsn, getenv('TEST_USER'), getenv('TEST_PASS'), array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION));
$fail = 0;
function eq($name, $got, $want) {
    global $fail;
    if ($got === $want) { echo "ok   $name\n"; } else { echo "FAIL $name: expected " . var_export($want, true) . ', got ' . var_export($got, true) . "\n"; $fail = 1; }
}

/** Runs the AGI with argv $rating; $vars = channel variables Asterisk would return. Returns [commands, stderr]. */
function run_agi($rating, $env, $vars) {
    global $agi;
    $p = proc_open('php -d display_errors=1 ' . escapeshellarg($agi) . ' ' . escapeshellarg($rating),
        array(0 => array('pipe', 'r'), 1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
    foreach ($env as $k => $v) fwrite($pipes[0], "$k: $v\n");
    fwrite($pipes[0], "\n");
    fflush($pipes[0]);
    $cmds = array();
    while (($line = fgets($pipes[1])) !== false) {
        $line = rtrim($line, "\n");
        $cmds[] = $line;
        if (preg_match('/^GET FULL VARIABLE (.*)$/', $line, $m)) {
            $reply = isset($vars[$m[1]]) ? '200 result=1 (' . $vars[$m[1]] . ')' : '200 result=0';
        } else {
            $reply = '200 result=1';
        }
        fwrite($pipes[0], $reply . "\n");
        fflush($pipes[0]);
    }
    $err = stream_get_contents($pipes[2]);
    proc_close($p);
    return array($cmds, $err);
}
function only_agi_commands($cmds) {
    foreach ($cmds as $c) if (!preg_match('/^(GET FULL VARIABLE |VERBOSE "|SET VARIABLE )/', $c)) return $c;
    return true;
}
function row($uid) {
    global $db;
    $st = $db->prepare('SELECT uniqueid, linkedid, queue, operator_ext, operator_name, member_interface, src, baho FROM operator_baho WHERE uniqueid = ?');
    $st->execute(array($uid));
    return $st->fetch(PDO::FETCH_ASSOC);
}

$db->exec("DELETE FROM operator_baho WHERE uniqueid LIKE 'agitest%'");
file_put_contents(getenv('BAHO_QUEUE_LOG'), '');

// 1. Normal rating: member from setinterfacevar.
list($cmds, $err) = run_agi('4', array('agi_uniqueid' => 'agitest.1', 'agi_callerid' => '998901234567'), array(
    '${CHANNEL(linkedid)}' => 'agitest.1', '${QUEUENUM}' => '2020159',
    '${MEMBERINTERFACE}' => 'Local/111@from-queue/n', '${MEMBERNAME}' => 'Oybek'));
eq('rating stored', row('agitest.1'), array('uniqueid' => 'agitest.1', 'linkedid' => 'agitest.1', 'queue' => '2020159',
    'operator_ext' => '111', 'operator_name' => 'Oybek', 'member_interface' => 'Local/111@from-queue/n', 'src' => '998901234567', 'baho' => '4'));
eq('BAHO_SAVED=1', end($cmds), 'SET VARIABLE BAHO_SAVED 1');
eq('stdout = AGI commands only', only_agi_commands($cmds), true);

// 2. The same call rated again: one row, the latest score.
run_agi('2', array('agi_uniqueid' => 'agitest.1', 'agi_callerid' => '998901234567'), array('${MEMBERINTERFACE}' => 'Local/111@from-queue/n'));
$n = $db->query("SELECT COUNT(*) FROM operator_baho WHERE uniqueid = 'agitest.1'")->fetchColumn();
eq('one row per call', (string) $n, '1');
eq('latest score kept', row('agitest.1')['baho'], '2');

// 3. Not 1-5: nothing stored.
list($cmds) = run_agi('7', array('agi_uniqueid' => 'agitest.3'), array());
eq('invalid rating not stored', row('agitest.3'), false);
eq('BAHO_SAVED=0', end($cmds), 'SET VARIABLE BAHO_SAVED 0');

// 4. Hostile caller name/number: quotes, backslashes, control chars never leave the VERBOSE string, values are cut.
list($cmds) = run_agi('5', array('agi_uniqueid' => 'agitest.4', 'agi_callerid' => str_repeat('9', 70) . "\" \\ \x07\" EXEC Dial"),
    array('${MEMBERNAME}' => "Bad\"Name\\\x01", '${MEMBERINTERFACE}' => 'SIP/105-0000001a'));
eq('stdout still AGI commands only', only_agi_commands($cmds), true);
$verbose = array_values(array_filter($cmds, function ($c) { return strpos($c, 'VERBOSE') === 0; }));
eq('VERBOSE has exactly two quotes', substr_count($verbose[0], '"'), 2);
$r = row('agitest.4');
eq('src cut to the column size', strlen($r['src']), 80);
eq('operator from SIP/105-…', $r['operator_ext'], '105');

// 5. No MEMBERINTERFACE / QUEUENUM: taken from the CONNECT line of queue_log.
file_put_contents(getenv('BAHO_QUEUE_LOG'),
    "1794993000|agitest.5|2020159|NONE|ENTERQUEUE||998901112233|1\n" .
    "1794993004|agitest.5|2020159|Local/112@from-queue/n|CONNECT|4|1794993001.9|3\n");
run_agi('3', array('agi_uniqueid' => 'agitest.5', 'agi_callerid' => '998901112233'), array());
$r = row('agitest.5');
eq('queue_log fallback: operator', $r['operator_ext'], '112');
eq('queue_log fallback: queue', $r['queue'], '2020159');

$db->exec("DELETE FROM operator_baho WHERE uniqueid LIKE 'agitest%'");
exit($fail);
