const { test, expect } = require('@playwright/test');

test.describe('Call Center E2E Tests — Autentifikatsiya, Profil va Sozlamalar', () => {

    test('1. Noto\'g\'ri parol kiritilganda xato xabari ko\'rsatilishi kerak', async ({ page }) => {
        await page.goto('/login');
        await expect(page).toHaveTitle(/Call Center - Tizimga Kirish/i);

        // Login va noto'g'ri parol kiritish
        await page.fill('#usernameInput', 'superuser');
        await page.fill('#passwordInput', 'noto_gri_parol_123');
        await page.click('#loginButton');

        // Xatolik xabari chiqishi kerak
        const errorAlert = page.locator('#loginErrorMessage');
        await expect(errorAlert).toBeVisible();
        await expect(errorAlert).toContainText(/Login yoki parol noto'g'ri/i);
    });

    test('2. To\'g\'ri login/parol bilan kirish, Profil Dropdown va Sozlamalar modali ishlashi', async ({ page }) => {
        await page.goto('/login');

        // To'g'ri ma'lumotlar bilan kirish
        await page.fill('#usernameInput', 'superuser');
        await page.fill('#passwordInput', '@Abaddon2004');
        await page.click('#loginButton');

        // Dashboard sahifasiga o'tishi kerak
        await page.waitForURL('**/', { timeout: 10000 });
        await expect(page.locator('#userProfileBtn')).toBeVisible();

        // 1. Profil tugmasini bosish -> Pastga Dropdown ochilishi kerak
        await page.click('#userProfileBtn');
        const dropdown = page.locator('#userProfileDropdown');
        await expect(dropdown).toBeVisible();
        await expect(page.locator('#headerUsername')).toHaveText('superuser');

        // Dropdownda Sozlamalar va Chiqish tugmalari ko'rinishi kerak
        await expect(page.locator('#btnSettings')).toBeVisible();
        await expect(page.locator('#btnLogout')).toBeVisible();

        // 2. "Sozlamalar" tugmasini bosish -> Sozlamalar modali ochilishi kerak
        await page.click('#btnSettings');
        const settingsModal = page.locator('#settingsModal');
        await expect(settingsModal).toBeVisible();
        await expect(settingsModal).toHaveClass(/open/);

        // 3. Tab 1: Xavfsizlik & Rate Limit sozlamalari mavjudligi
        await expect(page.locator('#tabPaneSecurity')).toBeVisible();
        const thresholdInput = page.locator('#lockoutThresholdInput');
        await expect(thresholdInput).toBeVisible();
        const durationSelect = page.locator('#lockoutDurationInput');
        await expect(durationSelect).toBeVisible();

        // 4. Tab 2: Statistika & Exclude List tabiga o'tish
        await page.click('button[data-tab="exclude"]');
        await expect(page.locator('#tabPaneExclude')).toBeVisible();
        await expect(page.locator('#excludeSearchInput')).toBeVisible();
        // Operatorlar ro'yxati yuklanishini kutish
        await expect(page.locator('.exclude-op-item').first()).toBeVisible({ timeout: 10000 });

        // 5. Tab 3: Foydalanuvchilar (RBAC) tabiga o'tish
        await page.click('button[data-tab="users"]');
        await expect(page.locator('#tabPaneUsers')).toBeVisible();
        await expect(page.locator('#newUsername')).toBeVisible();
        await expect(page.locator('#newUserRole')).toBeVisible();
        // Foydalanuvchilar jadvalida superuser borligini tekshirish
        await expect(page.locator('#settingsUsersTableBody')).toContainText('superuser');

        // 6. Modalni yopish (Esc yoki Close btn)
        await page.click('.settings-close-btn');
        await expect(settingsModal).not.toHaveClass(/open/);
    });

});
