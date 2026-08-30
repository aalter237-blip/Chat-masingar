# دليل GO-LIVE — تشغيل ماسنجر للاستخدام الفعلي

هذا الدليل يأخذك خطوة بخطوة من «نسخة جارية على حاسوبك» إلى «خدمة مستقرة
لفريقك». اقرأ **تحذير الأمان** أولاً — فهو ليس اختيارياً.

---

## ⚠️ تحذير الأمان (اقرأ قبل أي شيء)

> **لا تنتقل إلى الإنتاج وأنت ما زلت تعتمد على الوضع التطويري.**
> قبل فتح الخدمة للآخرين أو ربطها بموقع عام، تأكّد من الآتي — أي واحد مفقود
> يعني أن بيانات فريقك في خطر:

| # | الشرط | لماذا هو مهم | كيف تتأكد |
|---|---|---|---|
| 1 | `SMS_PROVIDER` ليس `none` | في وضع `none` يَرُد السيرفر بكود التحقق على أي طلب — أي شخص يعرف رقم هاتف يمكنه الدخول إلى الحساب. | شغّل `curl /api/health` وتأكد أن `sms` لا يساوي `none` |
| 2 | `DEMO_SEED=false` | لا يُنشأ أي حساب تجريبي بكلمة مرور معروفة. | تحقق أن `users` في `/api/health` تبدأ بـ 0 في تثبيت جديد |
| 3 | HTTPS مفعّل والوصول عبر `https://` فقط | التطبيقات ترفض الاتصال بغير HTTPS، وحتى لو مرّرتها فكلمات المرور والرسائل لا تُحمى. | تأكد أن `PUBLIC_URL` تبدأ بـ `https://` |
| 4 | `JWT_SECRET` قوي وثابت | يوقّع كل الجلسات؛ سره ضعيف أو متغيّر يعني إمكانية تزوير أو فقدان الجلسات. | `openssl rand -hex 48` وضعه في `.env` |
| 5 | مفاتيح بوابات الرسائل ليست في الكود | أي مفتاح مُلتزم في المستودع (TextBee / Telegram / Twilio) يُعتبر مكشوفًا. | امسحه من git وأعد توليده، ثم ضعه في أسرار CI / `.env` |
| 6 | كلمة مرور keystore الأندرويد قوية ومحفوظة في أسرار CI | بها يوقَّع كل APK؛ ضياعها يمنع تحديث التطبيق مستقبلًا. | أضف `KEYSTORE_*` الأربعة في أسرار GitHub Actions |
| 7 | `NODE_ENV=production` | يطفئ الميزات التطويرية (كإرجاع الكود) ويضبط إعدادات السجل. | تحقق من سجل الإقلاع أنه يطبع `(production)` |
| 8 | السجلّ لا يطبع رموز التحقق في الوضع الفعلي | رموز OTP في السجل متاحة لأي شخص يقرأ السجلّ. | تأكد أن `sms` هو `telegram` أو `textbee` وليس `console` |

> إذا وجدت أي مفتاح قديم مكشوف (مثل مفتاح TextBee سابق) — **أعد توليده فورًا**
> حتى لو كنت تعتقد أنه لم يُستخدم.

---

## 1) التحضير (مرة واحدة)

1. **نسخة من السيرفر**
   ```bash
   cd server
   cp ../deploy/.env.example .env
   ```
2. **غيّر القيم الحرجة في `.env`** (الجدول أعلاه):
   - `SMS_PROVIDER=telegram` (موصى به، مجاني) أو `textbee` — **ليس** `none`.
   - `TELEGRAM_BOT_TOKEN` و `TELEGRAM_BOT_USERNAME` إذا استخدمت تلجرام.
   - `JWT_SECRET=$(openssl rand -hex 48)`.
   - `PUBLIC_URL=https://your-domain`.
   - `NODE_ENV=production`.
3. **ثبّت التبعيات**
   ```bash
   npm install
   ```

## 2) المصادقة عبر بوت تلجرام (موصى به)

1. أنشئ البوت: افتح **@BotFather** ← `/newbot` ← انسخ التوكن.
2. ضعه في `.env`: `SMS_PROVIDER=telegram` + `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_BOT_USERNAME` (بدون `@`).
3. أعد تشغيل السيرفر — سترى في السجل: `telegram: bot @… ready`.
4. أرسل اسم البوت للمستخدمين: يفتحونه مرة واحدة، يضغطون **Start**، ويرسلون
   أرقامهم → تظهر في `https://your-domain/telegram` وتبدأ الرموز بالوصول
   كرسائل تلجرام — بلا SMS وبلا رسوم.
   > تعرّف على الخطوات الكاملة في `docs/PRODUCTION.md`.

## 3) تشغيل الخدمة

```bash
cd server
NODE_ENV=production node src/index.js      # أو: systemctl restart masingar
```

تحقّق سريع:
```bash
curl -s https://your-domain/api/health
# يجب أن ترى: sms:"telegram" (أو textbee) و demo:false
```

## 4) بناء وتوقيع APK الأندرويد

1. أضف أسرار التوقيع في **Settings → Secrets and variables → Actions**:
   `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS`.
   ```bash
   base64 -w0 masingar-release.keystore | gh secret set KEYSTORE_BASE64 -R <org>/Chat-masingar
   gh secret set KEYSTORE_PASSWORD -b"..." -R <org>/Chat-masingar
   gh secret set KEY_PASSWORD      -b"..." -R <org>/Chat-masingar
   gh secret set KEY_ALIAS         -b"masingar" -R <org>/Chat-masingar
   ```
2. الدمج في `main` (أو تشغيل يدوي من تبويب **Actions**) يشغّل
   `.github/workflows/main.yml` الذي يبني **ملف APK واحد** (Android 8+)
   ويرفعه كـ artifact باسم `Masingar.apk`.
3. نزّل الـ APK من تبويب **Actions** ووزّعه على الفريق.

## 5) الإشعارات في الخلفية (اختياري لكن مُجدٍ)

الإشعارات تجعل المكالمات تصل حتى والتطبيق مغلق. اتبع `docs/FIREBASE_SETUP.md`
(5 دقائق، مجاني) واملأ `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.

## 6) قائمة فحص ما قبل الإطلاق

- [ ] `/api/health` يعيد `sms` غير `none` و`demo:false`
- [ ] الاتصال عبر `https://` فقط
- [ ] `JWT_SECRET` قوي وثابت عبر إعادة التشغيل
- [ ] لا مفاتيح بوابات في المستودع
- [ ] `NODE_ENV=production`
- [ ] `KEYSTORE_*` الأربعة موجودة في أسرار CI
- [ ] جلسة المستخدم تبقى صالحة بعد إعادة تشغيل السيرفر
- [ ] `test/data-continuity.mjs` يمر (اختبار بقاء البيانات والجلسات)

---

> تذكّر: هذا الدليل يفترض فريقًا صغيرًا (حوالي 5 مستخدمين) ويعمل بمكوّنات
> مجانية تمامًا. عندما يكبر الفريق: بدّل إلى `SMS_PROVIDER=twilio` وانشر
> coturn الخاص بك (انظر `deploy/coturn`).
