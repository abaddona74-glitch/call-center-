import { INTERNAL_NUMBERS, PBX_HOST, SIP_PORT } from '../../config/content';

/*
 * Tabs of the legacy "Operator manual" modal (`viewer/public/index.html`, `modalOperatorManual`).
 * Static content in Uzbek, moved as is (not translated). Only change: the 3CX Desktop Agent is no longer
 * mentioned (the agent is removed, DECISIONS.md).
 */

/** "Salomlashish standarti" */
export function RulesTab() {
  return (
    <>
      <div className="manual-card manual-card--accent">
        <h4 className="manual-h4 is-accent">1. Qo'ng'iroqni qabul qilish (Birinchi 3 soniya)</h4>
        <div className="manual-quote">
          <strong className="text-ink">🗣️ Rasmiy salomlashish shabloni:</strong>
          <br />
          <span className="manual-say">
            "Assalomu alaykum! Call Center xizmati, operator [Ismingiz] sizni eshitmoqda. Qanday yordam bera olaman?"
          </span>
        </div>
        <p className="manual-note">
          📌 <b>Asosiy qoida:</b> Qo'ng'iroq 3-chaqiruvdan (gudok) oshmasdan qabul qilinishi lozim. Operator ovozi aniq,
          do'stona va ishonchli yangrashi kerak.
        </p>
      </div>

      <div className="manual-card manual-card--success">
        <h4 className="manual-h4 is-success">2. Suhbat jarayoni va diqqat bilan tinglash</h4>
        <ul className="manual-list">
          <li>
            <b>Mijoz so'zini bo'lmang:</b> U muammosini to'liq ifoda etishiga imkon bering.
          </li>
          <li>
            <b>Muammoni aniqlashtiring:</b>{' '}
            <i>"Tushunarli, demak sizda EDO tizimiga kirish bo'yicha qiyinchilik tug'ildi, to'g'rimi?"</i>
          </li>
          <li>
            <b>Xushmuomalalik so'zlari:</b> <i>"Iltimos", "Rahmat", "Marhamat", "Hozir tekshirib beraman"</i>{' '}
            iboralaridan muntazam foydalaning.
          </li>
          <li>
            <b>Kutish rejimiga qo'yish:</b> Agar ma'lumot izlayotgan bo'lsangiz, mijozni sukutda qoldirmang:{' '}
            <i>"Iltimos, 1 daqiqa liniyada kuting, ma'lumotingizni tekshirib beraman."</i>
          </li>
        </ul>
      </div>

      <div className="manual-card manual-card--danger">
        <h4 className="manual-h4 is-danger">3. ⚠️ Qat'iyan man etiladigan holatlar</h4>
        <table className="manual-table manual-table--dont">
          <thead>
            <tr>
              <th className="w-[45%] text-danger-soft">❌ Noto'g'ri (Man etiladi)</th>
              <th className="text-[#86efac] light:text-positive">✅ To'g'ri (Tavsiya etiladi)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="manual-wrong">"Bu bizning ishimiz emas"</td>
              <td>"Ushbu masalaga tegishli bo'limimiz mutaxassisi aniqlik kiritadi, hozir sizni bog'lab beraman."</td>
            </tr>
            <tr>
              <td className="manual-wrong">"Bilmayman"</td>
              <td>"Hozir bu bo'yicha ma'lumotni aniqlashtirib, sizga aniq yo'nalish beraman."</td>
            </tr>
            <tr>
              <td className="manual-wrong">Mijoz gapirayotganda go'shakni qo'yib qo'yish</td>
              <td>Suhbatni to'liq yakunlab, rozilik olgandan so'ng xayrlashish.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="manual-card manual-card--accent">
        <h4 className="manual-h4 manual-h4--sm is-accent">4. Suhbatni yakunlash</h4>
        <div className="manual-soft-box">
          <span className="manual-say">
            "Yana biror savolingiz yoki yordamim kerak bo'lgan masala bormi? ... Murojaatingiz uchun tashakkur, kuningiz
            xayrli o'tsin!"
          </span>
        </div>
      </div>
    </>
  );
}

/** "Transfer & Ichki raqamlar" */
export function TransferTab() {
  return (
    <>
      <div className="manual-card manual-card--accent">
        <h4 className="manual-h4 is-accent">🔄 Qo'ng'iroqni boshqa mutaxassisga yo'naltirish (Transfer)</h4>
        <div className="manual-grid-2">
          <div className="manual-box manual-box--success">
            <strong className="manual-box-title text-positive">1. Attended Transfer (Asosiy / Tavsiya):</strong>
            <ol className="manual-box-list">
              <li>
                3CX dasturida <b>Transfer</b> tugmasini bosing.
              </li>
              <li>Ichki raqamni tering (masalan 114) va kutib turing.</li>
              <li>Hamkasbingiz go'shakni ko'targach, mijoz muammosini qisqa ayting.</li>
              <li>
                <b>Transfer</b> tugmasini yana bir marta bosib, qo'ng'iroqni topshiring.
              </li>
            </ol>
          </div>
          <div className="manual-box manual-box--accent">
            <strong className="manual-box-title text-info">2. Blind Transfer (Tezkor o'tkazish):</strong>
            <p className="manual-box-text">
              Agar qo'ng'iroqni to'g'ridan-to'g'ri navbatga yoki mas'ulga suhbatsiz o'tkazish zarur bo'lsa,{' '}
              <b>Blind Transfer</b> tugmasini bosib, ichki raqamni terishingiz kifoya.
            </p>
          </div>
        </div>
      </div>

      <div className="manual-card manual-card--success">
        <h4 className="manual-h4 manual-h4--mb12 is-success">📋 Asosiy ichki raqamlar ma'lumotnomasi:</h4>
        <table className="manual-table manual-table--numbers">
          <thead>
            <tr>
              <th>Ichki raqam</th>
              <th>Bo'lim / Yo'nalish</th>
              <th>Vazifasi</th>
            </tr>
          </thead>
          <tbody>
            {INTERNAL_NUMBERS.map((n) => (
              <tr key={n.ext}>
                <td className="manual-ext">{n.ext}</td>
                <td className="manual-dept">{n.department}</td>
                <td>{n.duty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "Telegram Form & Arizalar" */
export function TelegramTab() {
  return (
    <div className="manual-card manual-card--accent">
      <h4 className="manual-h4 is-accent">📝 Telegram Form Dashboard'dan foydalanish</h4>
      <p className="mb-3">
        Agar mijozning muammosi telefon suhbatida darhol hal bo'lmasa, uni <b>Telegram Form Dashboard</b> orqali
        rasmiylashtirish shart.
      </p>
      <div className="manual-box manual-box--telegram">
        <strong className="manual-box-title text-info">Bosqichma-bosqich tartib:</strong>
        <ol className="manual-box-list manual-box-list--13">
          <li>
            Asosiy sahifadagi <b>Telegram Form Dashboard</b> kartasidagi «🖥️ Shu yerda ochish» tugmasini bosing.
          </li>
          <li>
            Mijozning <b>Telefon raqami</b>, <b>Tashkilot nomi</b> va <b>F.I.Sh</b>ni to'liq kiriting.
          </li>
          <li>
            Muammoni qisqa, ammo tushunarli bayon eting (masalan:{' '}
            <i>"EDO tizimida 403 xatosi bermoqda, ERI kaliti tanilmayapti"</i>).
          </li>
          <li>Agar mijoz Telegram orqali skrinshot yuborgan bo'lsa, faylni yuklang.</li>
          <li>
            <b>Yuborish</b> tugmasini bosing. Xabar avtomatik ravishda mas'ul muhandislar guruhiga tushadi.
          </li>
        </ol>
      </div>
    </div>
  );
}

/** "Tanaffus & Intizom" */
export function ScheduleTab() {
  return (
    <>
      <div className="manual-card manual-card--warning">
        <h4 className="manual-h4 is-warning">⏸️ Ish tartibi va Tanaffus (Pause) qoidalari</h4>
        <ul className="manual-list manual-list--loose">
          <li>
            {/* legacy: "3CX Phone va 3CX Desktop Agent dasturini" — the agent is removed */}
            <b>Ishga kirishish:</b> Har bir operator smenaga kelgach birinchi navbatda kompyuterda <b>3CX Phone</b>{' '}
            dasturini ishga tushirishi shart. Status "On Hook" (yashil) bo'lishi kerak.
          </li>
          <li>
            <b>Tanaffus (Obed):</b> Tushlik yoki qisqa tanaffusga chiqishdan oldin 3CX dasturida o'z statusingizni{' '}
            <b>Away</b> yoki <b>Break</b> ga o'tkazing.
          </li>
          <li>
            <b>Ishga qaytish:</b> Tanaffusdan qaytgach statusni yana <b>Available (On Hook)</b> ga qaytarishni unutmang.
          </li>
        </ul>
      </div>

      <div className="manual-card manual-card--danger">
        <h4 className="manual-h4 manual-h4--sm is-danger">🚫 Qat'iyan man etiladi:</h4>
        <p className="manual-small">
          • Qo'ng'iroq kelganda uni qizil tugma (<b>Reject / Deny</b>) orqali rad etib o'chirib qo'yish.
          <br />• Telefonni beparvo qoldirib ketish yoki sababsiz "DND" (Do Not Disturb) rejimiga qo'yish.
          <br />
          <span className="font-semibold text-danger-soft">
            ℹ️ Barcha rad etishlar va tanaffus vaqtlari markaziy tizimda soniyasigacha avtomatik qayd etiladi.
          </span>
        </p>
      </div>
    </>
  );
}

/** "Texnik yordam" */
export function TroubleshootTab() {
  return (
    <div className="manual-card manual-card--accent">
      <h4 className="manual-h4 is-accent">🛠️ Texnik nosozliklarda nima qilish kerak?</h4>
      <div className="manual-step">
        <strong className="text-ink">1. Ovoz eshitilmasa yoki mikrofon ishlamasa:</strong>
        <p>
          3CX Softphone dasturida <b>Settings (⚙️)</b> ➔ <b>Audio Options</b> bo'limiga kiring. Microphone va Speaker
          bandlarida kompyuteringizga ulangan asosiy garnitura (Headset) tanlanganini tekshiring.
        </p>
      </div>
      <div className="manual-step">
        <strong className="text-ink">2. 3CX "Not Connected" yoki uzilib qolsa:</strong>
        <p>
          Tarmoq kabeli ulanganini tekshiring. PBX server IP: <code className="manual-code">{PBX_HOST}</code>, Port:{' '}
          <code className="manual-code">{SIP_PORT}</code>.
        </p>
      </div>
      <div className="manual-step">
        <strong className="text-ink">3. Masofaviy yordam (AnyDesk):</strong>
        <p>
          Agar AnyDesk qotib qolsa, panelimizdagi <b>AnyDesk Tozalash</b> vositasini yuklab olib ishga tushiring.
        </p>
      </div>
    </div>
  );
}
