# التشغيل الإنتاجي — وصفة فريق صغير (≈5 مستخدمين، مجانًا بالكامل)

هذه الوصفة تجعل النظام يعمل "بكل قوة" لعدد صغير من المستخدمين دون أي اشتراك مدفوع.
عندما يكبر الفريق لاحقًا: بدّل إلى `SMS_PROVIDER=twilio` وانشر coturn الخاص بك.

| المكوّن | الحل المجاني المضبوط | ملاحظات |
|---|---|---|
| المصادقة (OTP) | **بوت تلجرام (موصى به)** — `TELEGRAM_BOT_TOKEN` من @BotFather، وكل مستخدم يرسل رقمه للبوت مرة واحدة | الكود يصل كرسالة تلجرام رسمية؛ الربط محفوظ في قاعدة البيانات |
| (بديل مجاني) SMS حقيقي | TextBee من شريحة هاتفك الخاص — يبقى احتياطيًا تلقائيًا | أنشئ مفتاحًا جديدًا — القديم كان مكشوفًا |
| خوادم الاتصال | STUN من Google + ترحيل TURN مجاني تلقائي (Open Relay) | لا إعداد مطلوب؛ يعمل خلف NAT الجوال |
| الإشعارات في الخلفية | Firebase Cloud Messaging (مجاني) — خطوات `docs/FIREBASE_SETUP.md` | اختياري؛ بدونه يجب فتح التطبيق لاستقبال المكالمات |
| سر الجلسات | يُحفظ تلقائيًا في `server/data/.jwt-secret` أو ثبّته بـ `JWT_SECRET` | الجلسات لا تموت مع إعادة التشغيل ✓ |
| التوقيع | ملف keystore حقيقي (30 سنة) — أسرار CI بالأسفل | التحديثات المستقبلية لن تكسر التثبيت |
| قاعدة البيانات | SQLite مدمج | كافٍ جدًا لعشرات المستخدمين المتزامنين |

## 1) تشغيل/تحديث السيرفر
```bash
cd server
cp ../deploy/.env.example .env   # راجع القيم (الافتراضيات جاهزة كما هي)
npm install
NODE_ENV=production node src/index.js     # أو: systemctl restart masingar
```

### تفعيل إرسال الكود عبر بوت تلجرام (مرة واحدة)
1. أنشئ البوت: افتح **@BotFather** في تلجرام ← `/newbot` ← انسخ التوكن.
2. اضبط في `.env`:
   ```
   SMS_PROVIDER=telegram
   TELEGRAM_BOT_TOKEN=1234567890:AAH...   # من @BotFather
   TELEGRAM_BOT_USERNAME=masingar_otp_bot # بدون @ — يظهر في التطبيقات
   ```
3. أعد تشغيل السيرفر — ستجد في السجل: `telegram: bot @… ready`.
4. أرسل اسم البوت للمستخدمين: يفتحونه مرة واحدة، يضغطون **Start**، ويرسلون
   أرقامهم → تظهر في صفحة **`https://your-domain/telegram`** وتبدأ رموز
   التحقق بالوصول كرسائل تلجرام — بدون SMS ولا رسوم.

> إذا فشل تلجرام لأي سبب (رقم غير مربوط / البوت متوقف)، يتحول الإرسال تلقائيًا
> إلى مزوّد SMS المضبوط (إن وُجد) ثم إلى سجل السيرفر — لن يعلق طلب دخول أبدًا.
> والكود في وضع الطوارئ يُقرأ من:
```bash
journalctl -u masingar -f   # سطر يبدأ بـ otp:
```

## 2) تفعيل توقيع الإصدار في GitHub (مرة واحدة)
الـ workflow يوقّع تلقائيًا عند وجود 4 أسرار. أضِفها من
**Settings → Secrets and variables → Actions → New repository secret**:

| السر | القيمة |
|---|---|
| `KEYSTORE_BASE64` | `base64 -w0 masingar-release.keystore` |
| `KEYSTORE_PASSWORD` | كلمة مرور المفتاح |
| `KEY_PASSWORD` | نفس الكلمة |
| `KEY_ALIAS` | `masingar` |

أو من الطرفية على جهازك:
```bash
base64 -w0 masingar-release.keystore | gh secret set KEYSTORE_BASE64 -R aalter237-blip/Chat-masingar
gh secret set KEYSTORE_PASSWORD -b"الكلمة" -R aalter237-blip/Chat-masingar
gh secret set KEY_PASSWORD -b"الكلمة"   -R aalter237-blip/Chat-masingar
gh secret set KEY_ALIAS -b"masingar"     -R aalter237-blip/Chat-masingar
```
> احتفظ بملف `masingar-release.keystore` وكلمته في مكان آمن — فقدانه يعني أن
> كل تحديث مستقبلي يتطلب من المستخدمين حذف التطبيق وإعادة تثبيته.

ثم أضِف هذه الخطوة إلى `.github/workflows/main.yml` **قبل** خطوة `Build Release APK`
(لا يستطيع البوت تعديل ملفات workflows بصلاحياته):

```yaml
      - name: Prepare release signing (when KEYSTORE_* secrets exist)
        run: |
          if [ -n "$KEYSTORE_BASE64" ]; then
            echo "$KEYSTORE_BASE64" | base64 -d > release.keystore
            printf '%s\n' \
              "KEYSTORE_FILE=release.keystore" \
              "KEYSTORE_PASSWORD=$KEYSTORE_PASSWORD" \
              "KEY_ALIAS=$KEY_ALIAS" \
              "KEY_PASSWORD=$KEY_PASSWORD" > local.properties
          fi
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.KEY_PASSWORD }}
```

## 3) بناء الـ APK وتوزيعه
أي دمج في `main` يبني APK موقّعًا في Actions ← Artifacts ← `Masingar.apk`.
أرسل الملف للمستخدمين الخمسة (واتساب/تيليجرام) — يكفي تفعيل "تثبيت من مصادر غير معروفة".

بيانات السيرفر تُخزّن في `server/data/` — انسخها احتياطيًا دوريًا (`masingar.db`).
