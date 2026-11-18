-- Minimal copy of the Issabel/FreePBX schemas the call center reads.
CREATE DATABASE IF NOT EXISTS asteriskcdrdb CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS asterisk CHARACTER SET utf8mb4;

USE asteriskcdrdb;
CREATE TABLE IF NOT EXISTS cdr (
  calldate      DATETIME     NOT NULL DEFAULT '0000-00-00 00:00:00',
  clid          VARCHAR(80)  NOT NULL DEFAULT '',
  src           VARCHAR(80)  NOT NULL DEFAULT '',
  dst           VARCHAR(80)  NOT NULL DEFAULT '',
  dcontext      VARCHAR(80)  NOT NULL DEFAULT '',
  channel       VARCHAR(80)  NOT NULL DEFAULT '',
  dstchannel    VARCHAR(80)  NOT NULL DEFAULT '',
  lastapp       VARCHAR(80)  NOT NULL DEFAULT '',
  lastdata      VARCHAR(80)  NOT NULL DEFAULT '',
  duration      INT          NOT NULL DEFAULT 0,
  billsec       INT          NOT NULL DEFAULT 0,
  disposition   VARCHAR(45)  NOT NULL DEFAULT '',
  amaflags      INT          NOT NULL DEFAULT 0,
  accountcode   VARCHAR(20)  NOT NULL DEFAULT '',
  uniqueid      VARCHAR(32)  NOT NULL DEFAULT '',
  userfield     VARCHAR(255) NOT NULL DEFAULT '',
  recordingfile VARCHAR(255) NOT NULL DEFAULT '',
  cnum          VARCHAR(40)  NOT NULL DEFAULT '',
  cnam          VARCHAR(40)  NOT NULL DEFAULT '',
  outbound_cnum VARCHAR(40)  NOT NULL DEFAULT '',
  outbound_cnam VARCHAR(40)  NOT NULL DEFAULT '',
  dst_cnam      VARCHAR(40)  NOT NULL DEFAULT '',
  did           VARCHAR(50)  NOT NULL DEFAULT '',
  linkedid      VARCHAR(32)  NOT NULL DEFAULT '',
  peeraccount   VARCHAR(80)  NOT NULL DEFAULT '',
  sequence      INT          NOT NULL DEFAULT 0,
  KEY calldate (calldate),
  KEY src (src),
  KEY dst (dst),
  KEY uniqueid (uniqueid)
);

-- Post-call survey answers, written on the real PBX by the [operator-baho] dialplan + AGI operator_baho.php.
CREATE TABLE IF NOT EXISTS operator_baho (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  rated_at         DATETIME         NOT NULL,
  uniqueid         VARCHAR(32)      NOT NULL,
  linkedid         VARCHAR(32)      NOT NULL DEFAULT '',
  queue            VARCHAR(20)      NOT NULL DEFAULT '',
  operator_ext     VARCHAR(20)      NOT NULL DEFAULT '',
  operator_name    VARCHAR(80)      NOT NULL DEFAULT '',
  member_interface VARCHAR(80)      NOT NULL DEFAULT '',
  src              VARCHAR(80)      NOT NULL DEFAULT '',
  baho             TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uniqueid (uniqueid),
  KEY idx_rated_at (rated_at),
  KEY idx_operator (operator_ext, rated_at),
  KEY idx_linkedid (linkedid)
);

USE asterisk;
CREATE TABLE IF NOT EXISTS users (
  extension VARCHAR(20) NOT NULL DEFAULT '',
  name      VARCHAR(50),
  PRIMARY KEY (extension)
);

-- Read-only account, the same kind we will create on the real PBX.
CREATE USER IF NOT EXISTS 'cc_readonly'@'%' IDENTIFIED BY 'cc_readonly_dev';
GRANT SELECT ON asteriskcdrdb.* TO 'cc_readonly'@'%';
GRANT SELECT ON asterisk.users TO 'cc_readonly'@'%';
FLUSH PRIVILEGES;
