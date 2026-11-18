/**
 * Facts the guide texts refer to (legacy values, copied as is). Static content, not secrets:
 * the PBX address is a LAN address already written in the architecture docs.
 */
export const PBX_HOST = '192.168.0.124';
export const SIP_PORT = 5060;

/**
 * The 3CX softphone installer. Legacy served it from `/downloads/3CXPhone6.msi` (the file was never in git);
 * the Tools section (S8) owns the download — keep this path in sync with where it serves the file.
 */
export const SOFTPHONE_MSI_URL = '/downloads/3CXPhone6.msi';

/** "Asosiy ichki raqamlar ma'lumotnomasi" — the transfer tab of the operator manual. */
export const INTERNAL_NUMBERS: readonly { ext: string; department: string; duty: string }[] = [
  { ext: '114', department: 'EDO Tizimi', duty: 'Hujjat aylanishi, ijro.uz masalalari' },
  { ext: '116', department: 'Ijro Intizomi', duty: 'Hisobotlar, ijro muddati va nazorat' },
  { ext: '119', department: 'E-Huquqshunos', duty: 'Yuridik xizmatlar, arizalar va shartnomalar' },
  { ext: '200', department: 'Maxsus Guruh', duty: "Aloqa guruhi va chuqur o'rganiladigan masalalar" },
  { ext: '207', department: 'Texnik Xizmat', duty: 'Uzcrypto, E-imzo kalitlari va tizim sozlamalari' },
];
