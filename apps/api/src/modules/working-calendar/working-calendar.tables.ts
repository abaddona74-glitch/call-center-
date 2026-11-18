import type { Generated } from 'kysely';

export interface WorkingCalendarTable {
  id: Generated<number>;
  days: number[];
  startTime: string;
  endTime: string;
  holidays: string[];
  updatedAt: Generated<Date>;
  updatedByUserId: number | null;
}

declare module '../../database/db.js' {
  interface DB {
    workingCalendar: WorkingCalendarTable;
  }
}
