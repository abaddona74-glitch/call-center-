/**
 * One post-call survey answer (asteriskcdrdb.operator_baho). The PBX dialplan writes it after the queue
 * member hung up and the client pressed 1–5; `linkedid`/`uniqueid` are the client channel's ids,
 * the same values the CDR legs of that call carry.
 */
export interface SurveyRating {
  uniqueid: string;
  linkedid: string;
  /** Extension of the queue member who talked (from MEMBERINTERFACE); '' when the PBX could not tell. */
  operatorExt: string;
  /** 1–5 as pressed. */
  score: number;
}
