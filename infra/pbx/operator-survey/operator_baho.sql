-- Operator bahosi (1..5) — CDR'dan ALOHIDA jadval, CDR bilan uniqueid orqali bog'lanadi.
-- Bitta qo'ng'iroqqa bitta baho (UNIQUE uniqueid).
CREATE TABLE IF NOT EXISTS asteriskcdrdb.operator_baho (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  rated_at         DATETIME         NOT NULL,               -- baho bosilgan vaqt
  uniqueid         VARCHAR(32)      NOT NULL,               -- = cdr.uniqueid (mijoz kanali)
  linkedid         VARCHAR(32)      NOT NULL DEFAULT '',    -- = cdr.linkedid
  queue            VARCHAR(20)      NOT NULL DEFAULT '',    -- navbat raqami (2020159)
  operator_ext     VARCHAR(20)      NOT NULL DEFAULT '',    -- operator ichki raqami (101, 114 ...)
  operator_name    VARCHAR(80)      NOT NULL DEFAULT '',    -- navbatdagi ism (Oybek, Maxmud ...)
  member_interface VARCHAR(80)      NOT NULL DEFAULT '',    -- Local/101@from-queue/n
  src              VARCHAR(80)      NOT NULL DEFAULT '',    -- mijoz raqami
  baho             TINYINT UNSIGNED NOT NULL,               -- 1..5
  PRIMARY KEY (id),
  UNIQUE KEY uq_uniqueid (uniqueid),
  KEY idx_rated_at (rated_at),
  KEY idx_operator (operator_ext, rated_at),
  KEY idx_linkedid (linkedid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- AGI asteriskuser (/etc/amportal.conf) nomidan yozadi. Odatda unda asteriskcdrdb.* ga
-- to'liq huquq bor; bo'lmasa quyidagini root bilan bajaring:
-- GRANT SELECT, INSERT, UPDATE ON asteriskcdrdb.operator_baho TO 'asteriskuser'@'localhost';
