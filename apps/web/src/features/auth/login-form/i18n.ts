import { registerTranslations } from '@/shared/i18n';

registerTranslations('authLogin', {
  uz: {
    username: 'Foydalanuvchi nomi',
    password: 'Maxfiy parol',
    showPassword: 'Parolni ko‘rsatish',
    hidePassword: 'Parolni yashirish',
    forgot: 'Parolni unutdingizmi?',
    submit: 'Kirish',
    required: 'Login va parolni kiriting',
    invalid: 'Login yoki parol noto‘g‘ri',
    attemptsLeft: 'Qolgan urinishlar: {{count}} ta.',
    locked: 'Juda ko‘p xato urinish. {{seconds}} soniyadan so‘ng qayta urinib ko‘ring',
    lockedNoTime: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring',
    failed: 'Server bilan bog‘lanib bo‘lmadi. Qayta urinib ko‘ring',
  },
  ru: {
    username: 'Имя пользователя',
    password: 'Пароль',
    showPassword: 'Показать пароль',
    hidePassword: 'Скрыть пароль',
    forgot: 'Забыли пароль?',
    submit: 'Войти',
    required: 'Введите логин и пароль',
    invalid: 'Неверный логин или пароль',
    attemptsLeft: 'Осталось попыток: {{count}}.',
    locked: 'Слишком много неудачных попыток. Повторите через {{seconds}} с',
    lockedNoTime: 'Слишком много попыток. Повторите позже',
    failed: 'Нет связи с сервером. Попробуйте ещё раз',
  },
});
