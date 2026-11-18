/**
 * Read-only view of the Issabel PBX MariaDB as used by Kysely (MysqlDialect, no case plugin).
 * Column names are exactly as in Asterisk's CDR. Datetimes come back as strings
 * ("YYYY-MM-DD HH:mm:ss") in PBX local time (Asia/Tashkent) — see pbx-db.module.ts.
 */
export interface CdrTable {
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  dcontext: string;
  channel: string;
  dstchannel: string;
  lastapp: string;
  lastdata: string;
  duration: number;
  billsec: number;
  disposition: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED' | 'CONGESTION' | string;
  amaflags: number;
  accountcode: string;
  uniqueid: string;
  userfield: string;
  recordingfile: string;
  cnum: string;
  cnam: string;
  outbound_cnum: string;
  outbound_cnam: string;
  dst_cnam: string;
  did: string;
  linkedid: string;
  peeraccount: string;
  sequence: number;
}

/** `asterisk.users` (FreePBX/Issabel extensions). Lives in another schema/database. */
export interface AsteriskUsersTable {
  extension: string;
  name: string;
}

/**
 * Post-call survey answers, written by the PBX dialplan ([operator-baho] context + AGI operator_baho.php).
 * Optional: the table exists only after the survey is installed on the PBX and granted to the read-only user.
 */
export interface OperatorBahoTable {
  id: number;
  rated_at: string;
  uniqueid: string;
  linkedid: string;
  queue: string;
  operator_ext: string;
  operator_name: string;
  member_interface: string;
  src: string;
  baho: number;
}

export interface PbxDB {
  cdr: CdrTable;
  operator_baho: OperatorBahoTable;
  'asterisk.users': AsteriskUsersTable;
}
