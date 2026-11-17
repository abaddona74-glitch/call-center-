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

export interface PbxDB {
  cdr: CdrTable;
  'asterisk.users': AsteriskUsersTable;
}
