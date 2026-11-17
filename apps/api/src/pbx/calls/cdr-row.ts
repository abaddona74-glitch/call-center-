/** The CDR columns the call history reads (asteriskcdrdb.cdr). `calldate` is a Tashkent wall-clock string. */
export interface CdrRow {
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
  disposition: string;
  uniqueid: string;
  linkedid: string;
  recordingfile: string;
}

export const CDR_COLUMNS = [
  'calldate',
  'clid',
  'src',
  'dst',
  'dcontext',
  'channel',
  'dstchannel',
  'lastapp',
  'lastdata',
  'duration',
  'billsec',
  'disposition',
  'uniqueid',
  'linkedid',
  'recordingfile',
] as const satisfies readonly (keyof CdrRow)[];
