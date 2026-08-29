# ماسنجر — Masingar

تطبيق دردشة ومكالمات **صوتية وفيديو** يعمل على كل دول العالم، مبني ليقدّم أفضل جودة ممكنة على الشبكات الضعيفة (2G / 3G / 4G / 5G / Wi‑Fi).

المشروع يحتوي على ثلاثة أجزاء تعمل معاً:

| الجزء | الوصف |
|---|---|
| `server/` | سيرفر Node.js: مصادقة برقم الهاتف (OTP)، مزامنة جهات الاتصال، الدردشة، إشارات المكالمات (WebRTC)، رفع الملفات، إشعارات FCM |
| `web/` | عميل ويب (عربي/إنجليزي، يعمل على الجوال والمتصفح) لتجربة الدردشة والمكالمات فوراً |
| `android/` | تطبيق أندرويد كامل (Kotlin + Jetpack Compose + WebRTC) جاهز لبناء ملف APK |

---

## 1) تجربة سريعة (الآن)

**نسخة منشورة وجاهزة للتجربة: https://chatmassage.bonto.run** — افتحها من الجوال أو المتصفح وسجّل الدخول برقمك (أو بأحد الأرقام التجريبية بالأسفل).

السيرفر يعمل أيضاً في هذه المساحة على المنفذ `3000` — افتح الرابط من المعاينة المباشرة، وستظهر شاشة الدخول.

للاختبار بسرعة:

1. اضغط على أحد الأرقام التجريبية (مثل `+967771000001`) ثم **إرسال كود التحقق**.
2. في الوضع التجريبي لا يُرسل SMS (لا يوجد مزوّد رسائل مضبوط)، لذلك يظهر الكود داخل التطبيق مباشرة.
3. لاختبار مكالمة بين طرفين: افتح الرابط في **تبويبين** (أو في جوالك)، وسجّل الدخول بأرقام مختلفة
   (`967771000001` / `967771000002` / `967771000003` / `12025550123`) ثم ابدأ مكالمة صوتية أو فيديو.

> الحسابات التجريبية تُنشأ تلقائياً عند أول تشغيل (`DEMO_SEED=false` لتعطيلها في الإنتاج).

**تجربة APK أندرويد على نفس السيرفر:** اضبط في `android/local.properties`:
```properties
SERVER_URL=https://chatmassage.bonto.run   # السيرفر الدائم (الافتراضي الآن في التطبيق)
```
ثم ابنِ الـ APK وثبّته على جوالك — ستستطيع الدردشة والاتصال بالحسابات التجريبية من الجوال مباشرة.
للاستضافة الدائمة انشر السيرفر على خادمك (القسم 3) وبدّل الرابط.

**تثبيت فوري بدون بناء:** افتح رابط المعاينة من متصفح Chrome على الجوال ثم
**⋮ > إضافة إلى الشاشة الرئيسية** — سيعمل التطبيق كتطبيق مثبّت (PWA) بنفس مميزات الدردشة والمكالمات.

تشغيل السيرفر يدوياً:

```bash
cd server
npm install
PORT=3000 SMS_PROVIDER=none node src/index.js
# ثم افتح http://localhost:3000
```

---

## 2) بناء ملف APK (أندرويد)

### الطريقة الأولى — Android Studio (الأسهل)
1. افتح Android Studio ← **File > Open** ← اختر مجلد `android`.
2. انسخ `android/local.properties.example` إلى `android/local.properties` واضبط:
   ```properties
   SERVER_URL=https://your-server.example.com
   DEFAULT_COUNTRY_CODE=967
   ```
3. **Build > Build Bundle(s)/APK(s) > Build APK(s)** — الناتج في
   `android/app/build/outputs/apk/debug/app-debug.apk`.

### الطريقة الثانية — سطر الأوامر
```bash
cd android
gradle wrapper --gradle-version 8.9      # مرة واحدة فقط (أو استخدم Gradle المثبت لديك)
./gradlew assembleDebug                  # APK للتجربة
./gradlew assembleRelease                # APK النهائي (universal + لكل معمارية)
```
الناتج: `android/app/build/outputs/apk/{debug,release}/*.apk`

### الطريقة الثالثة — بناء سحابي تلقائي (GitHub Actions)
انسخ الملف `docs/github-actions-ci.yml` إلى `.github/workflows/ci.yml` ثم ادفع:
كل push سيبني ملفات APK ويضعها في تبويب **Artifacts**، ويشغّل اختبارات السيرفر أيضاً.

### التوقيع للإنتاج
أنشئ keystore ثم أضف بياناته في `android/local.properties`:
```properties
KEYSTORE_FILE=../masingar.jks
KEYSTORE_PASSWORD=***
KEY_ALIAS=masingar
KEY_PASSWORD=***
```

### إن فشل البناء (استكشاف الأخطاء)

| العَرَض | السبب | الحل |
|---|---|---|
| `Could not resolve org.webrtc:google-webrtc` | النسخة القديمة كانت على Bintray/JCenter فقط وهو مغلق | المشروع يستخدم الآن `io.getstream:stream-webrtc-android:1.3.10` من Maven Central بنفس واجهة `org.webrtc.*` |
| خطأ في `compileDebugKotlin` | — | نزّل artifact باسم `kotlin-build-log` من صفحة العمل؛ السطر الأول فيه اسم الملف ورقم السطر |
| `SDK location not found` | — | أنشئ `android/local.properties` فيه `sdk.dir=...` أو ثبّت Android SDK |
| التطبيق لا يتصل بالسيرفر | `BuildConfig.SERVER_URL` الافتراضي `https://chat.example.com` | اكتب عنوان سيرفرك في `android/local.properties` باسم `SERVER_URL`، أو من شاشة الإعدادات داخل التطبيق |

### صلاحيات التطبيق
ميكروفون، كاميرا، جهات الاتصال، الإشعارات، البلوتوث (لسماعات المكالمات)،
العمل في الخلفية أثناء المكالمة. كلها تُطلب عند الحاجة فقط.

---

## 3) تشغيل السيرفر على استضافة (VPS)

```bash
# على سيرفر Ubuntu/Debian مع Docker
git clone <repo> && cd Chat-masingar/deploy
cp .env.example .env && nano .env        # املأ القيم (الأسرار، النطاق، TURN)
docker compose up -d
```

أو بدون Docker:

```bash
cd server && npm install --omit=dev
sudo cp ../deploy/systemd/masingar.service /etc/systemd/system/
sudo systemctl enable --now masingar
```

### لماذا تحتاج TURN؟
الاتصال المباشر بين الهواتف يفشل خلف **NAT متماثل** أو شبكات الجوال (وهي الحالة الشائعة في 2G/3G).
خادم TURN يمرّر الوسائط كحل أخير، وبدونه تفشل نسبة كبيرة من المكالمات.
`deploy/coturn/turnserver.conf` مضبوط على `3478/UDP` و`5349/TLS` و`443/TCP`
(منفذ 443 هو الأنسب للشبكات المقيدة جداً).

بعد تشغيل coturn ضع في إعدادات السيرفر:
```bash
TURN_SECRET=   # نفس static-auth-secret في turnserver.conf
TURN_HOST=turn.example.com
```
السيرفر يولّد بيانات دخول مؤقتة (HMAC) لكل مستخدم عبر `/api/ice`، فلا تُكشف أسرار TURN أبداً.

### إرسال رسائل SMS (كود التحقق)
- `SMS_PROVIDER=textbee` → **رسالة SMS حقيقية عبر [textbee.dev](https://textbee.dev)**: جوالك الأندرويد يعمل كبوابة إرسال، والرسالة تخرج من شريحتك (بدون اشتراك شهري).
- `SMS_PROVIDER=twilio` → يحتاج `TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM`.
- `SMS_PROVIDER=http` → يستدعي ويب‌هوك: `POST {to, code, app}`.
- `SMS_PROVIDER=console` → يُطبع في سجل السيرفر (لا يصل للمستخدم).
- `SMS_PROVIDER=none` → الكود يُعاد في الاستجابة — **للتطوير فقط**: أي شخص يستطيع فتح أي حساب بمعرفة رقمه.

**إعداد TextBee** (المزوّد الافتراضي — يعمل مباشرة بدون إعداد):
المفتاح ومعرّف الجوال مضمّنان كقيم افتراضية في `server/src/config.js`، فأي نسخة من السيرفر
تُرسل رموز التحقق برسالة SMS حقيقية فور تشغيلها. **يمكن (ويُفضّل) تجاوزهما** بمتغيّرات البيئة:
```bash
# في /opt/masingar/server/.env  (أو في بيئة docker compose)
SMS_PROVIDER=textbee
TEXTBEE_API_KEY=txb_...          # من لوحة تحكم textbee > API Keys
TEXTBEE_DEVICE_ID=6a92...        # معرّف الجوال المسجّل كبوابة
#TEXTBEE_BASE_URL=https://api.textbee.dev     # للبوابة المستضافة ذاتياً
#SMS_TEXT=ماسنجر: كود التحقق هو ${code}      # نص الرسالة
```
السيرفر ينادي `POST /api/v1/gateway/devices/{DEVICE_ID}/send-sms` مع ترويسة `x-api-key`،
ويرسل الرقم بصيغة E.164 (`+967771234567`). إن فشل الإرسال (رصيد/شبكة/جهاز غير متصل)
يسجّل السيرفر الخطأ ولا يمنع تسجيل الدخول.

> **تنبيه:** القيم الافتراضية داخل `server/src/config.js` تُقرأ من الكود، فاجعل المستودع **خاصاً**
> (أو استبدلها بمتغيّرات البيئة قبل المشاركة، وولّد مفتاحاً جديداً من لوحة TextBee).
> ملف `.env` مُتجاهَل في `.gitignore` وخدمة systemd تقرأه عبر `EnvironmentFile`.

### تفعيل حقيقي للأرقام الشخصية (بدون حسابات تجريبية)

الوضع الافتراضي الآن **للاستخدام الحقيقي**:
- `DEMO_SEED=false` افتراضياً → **لا تُنشأ أي حسابات تجريبية** عند أول تشغيل.
- صفحة الدخول **لا تُظهر الأرقام التجريبية** إلا إذا كان السيرفر في وضع تجريبي
  (`SMS_PROVIDER=none`) — تُعلمها نقطة `/api/health` بحقل `demo`.
- أي رقم شخصي جديد يسجّل نفسه تلقائياً: طلب كود → `POST /api/auth/otp/request` →
  استلام رسالة SMS → `POST /api/auth/otp/verify` بالكود والاسم → يُنشأ الحساب.
- الكود **لا يُعاد في الاستجابة** أبداً إلا في وضع التطوير (`SMS_PROVIDER=none`).

لتنظيف سيرفرك الحالي من الحسابات التجريبية (إن لم يكن لديك مستخدمون حقيقيون بعد):
```bash
sudo systemctl stop masingar
sudo rm -f /opt/masingar/server/data/masingar.db*
sudo systemctl start masingar
```
أو احذفها فقط مع الحفاظ على الباقي:
```bash
sqlite3 /opt/masingar/server/data/masingar.db \
  "DELETE FROM users WHERE phone IN ('967771000001','967771000002','967771000003','12025550123');"
```
ثم تحقّق:
```bash
curl -s https://chatmassage.bonto.run/api/health
# يجب أن يظهر: "demo":false   و users بعدد مستخدميك الحقيقيين فقط
```

### إشعارات المكالمات والتطبيق مغلق (FCM)
1. أنشئ مشروع Firebase وأضف تطبيق أندرويد.
2. انسخ القيم إلى `android/local.properties`:
   `FCM_API_KEY / FCM_APP_ID / FCM_PROJECT_ID / FCM_SENDER_ID`
3. في السيرفر: `FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY` (مفتاح حساب الخدمة JSON).
بدون FCM تعمل المكالمات أثناء فتح التطبيق (أو في الخلفية ما دامت العملية حيّة).

---

## 4) كيف نحافظ على الجودة على الشبكات الضعيفة؟

في `web/js/rtc.js` و`android/.../calls/WebrtcEngine.kt` نفس المنطق:

1. **الصوت أولاً:** ترميز Opus أحادي القناة مع `DTX` و`FEC` داخل النطاق، ومعدل بث يبدأ من 16 كيلوبت على 2G ويرتفع حتى 96 حسب الشبكة.
2. **سلم جودة للفيديو:** 180p ← 270p ← 360p ← 480p ← 720p، ويبدأ دائماً من الأسفل على بيانات الجوال.
3. **قياس مستمر:** كل ثانية نقرأ RTT ونسبة فقد الحزم والبت المتاح من `getStats`:
   - 3 عيّنات سيئة → ننزل درجة،
   - 8 عيّنات جيدة مع سعة كافية → نصعد درجة.
4. **تحجيم زمني (L1T3):** يمكن حذف إطارات دون تجميد الصورة عند الضغط.
5. **التبديل للصوت فقط** عند بلوغ الشبكة حالة ميؤوس منها، ثم **العودة التلقائية للفيديو** متى تحسّنت.
6. **إعادة الاتصال:** عند انقطاع ICE تتم إعادة التفاوض تلقائياً (`restartIce`) مع تراجع زمني.
7. **IPv4 أولاً** (كثير من شبكات 2G/3G تكسر IPv6)، وترشيح IPv6 مضبوط في محرك أندرويد.
8. **الطابور غير المتصل:** الرسائل تُحفظ محلياً وتُرسل تلقائياً عند عودة الإنترنت (Outbox + WorkManager).

---

## 5) التشفير من طرف لطرف والخصوصية

### أ) الرسائل والملفات: لا يقرأها إلا الطرفان
- لكل حساب هوية **X25519**؛ المفتاح العام يُنشر للسيرفر، والخاص لا يخرج من الجهاز (مشفّر داخل `Android Keystore` على الجوال).
- كل رسالة ثنائية تُغلَّف بمفتاح مؤقّت جديد: `X25519` ← `HKDF-SHA-256` ← `AES-256-GCM`، وبيانات المصادقة تربط النص بالمحادثة والمرسل والمستقبل، فلا يمكن نقل نص إلى محادثة أخرى.
- المجموعات: مفتاح مجموعة عشوائي يُغلَّف لكل عضو بمفتاحه العام، والرسائل تُشفَّر به.
- **الملفات والصور والتسجيلات الصوتية تُشفَّر قبل الرفع**؛ السيرفر يستقبل `.enc` ولا يملك المفتاح (يصل داخل الرسالة المشفّرة).
- السيرفر يخزّن: `{ "v":1, "epk":…, "n":…, "ct":… }` ولا شيء غيره. جرّب بنفسك:
  ```bash
  node test/e2ee-live.mjs     # يثبت أن السيرفر لا يستطيع قراءة النص
  ```
- إن لم يسجّل الطرف مفتاحه العام بعد، تُرسل الرسالة غير مشفّرة لتبقى المحادثة تعمل، وتعود مشفّرة تلقائياً بمجرد توفر المفتاح.
- ملاحظة صادقة: لا يمكن للمتصفح ولا لأندرويد منع تطبيق خارجي من تصوير الشاشة؛ ما نفعله هو **الإفصاح** (انظر ج).

### ب) خلفية المحادثة المشتركة
- اضغط 🎨 أعلى المحادثة واختر خلفية: تُحفظ في `conversation_settings` على السيرفر وتُبثّ فوراً لكل الأعضاء
  عبر إطار `conversation:settings`، فتظهر لهم مباشرة بلا إعادة تحميل.
- القوالب موحّدة بين الويب وأندرويد: `none · teal · night · sunset · sand · ocean · dots`
  (أندرويد يقرأ الألوان من نفس تدرّج CSS الذي يستخدمه الويب).

### ج) تنبيه لقطات الشاشة وتسجيل الشاشة
- **أندرويد 14+**: يستخدم `ScreenCaptureCallback` من النظام — بلا أي صلاحية.
- **أندرويد 13 وأقل**: مراقب على `MediaStore` يبحث عن ملف جديد في مجلدات `Screenshots / Screen recordings`
  (يحتاج صلاحية الوسائط، ويُطلب تلقائياً عند فتح محادثة).
- **الويب**: اختصارات `PrintScreen` و `⌘/Win + Shift + 3/4/5/S`، وأي `getDisplayMedia` داخل التطبيق.
- النتيجة: رسالة `system` داخل المحادثة + إشعار فوري للطرف الآخر (و FCM إن كان مغلقاً)، مع حدّ تنبيه واحد
  لكل نوع كل 4 ثوانٍ حتى لا يتحول الأمر إلى إزعاج.

---

## 6) بنية المشروع

```
server/
  src/config.js       إعدادات البيئة
  src/db.js           SQLite (node:sqlite أو better-sqlite3)
  src/store.js        طبقة البيانات (مستخدمون، محادثات، رسائل، مكالمات)
  src/api.js          REST: /api/auth, /api/conversations, /api/messages, /api/uploads, /api/ice …
  src/ws.js           WebSocket: الحضور، الكتابة، الإيصالات، إشارات المكالمات
  src/push.js         FCM HTTP v1
  src/ice.js          بيانات دخول TURN المؤقتة
  test/e2e.mjs        43 فحصاً شاملاً (تسجيل دخول، دردشة، إشارات مكالمة، خلفية، خصوصية)
web/                  عميل الويب (HTML/CSS/JS بدون خطوة بناء)
  js/crypto.js        بروتوكول التشفير من طرف لطرف (X25519 + HKDF + AES-GCM)
android/              تطبيق أندرويد (Kotlin, Compose, WebRTC, Room-less SQLite cache, WorkManager)
  crypto/X25519.kt    اتفاق المفاتيح (RFC 7748) بلا أي مكتبة خارجية
  crypto/Hkdf.kt      اشتقاق المفاتيح (RFC 5869)
  crypto/Aead.kt      AES-256-GCM مع بيانات مصادقة إضافية
  crypto/IdentityStore.kt   هوية الجهاز مشفّرة داخل Android Keystore
  crypto/E2eeEngine.kt     المحرّك: رسائل 1:1، مجموعات، ملفات
  util/ScreenCaptureWatcher.kt  اكتشاف لقطات الشاشة وتسجيلها
deploy/               docker-compose + coturn + nginx + systemd
docs/                 ملف CI جاهز + ملاحظات إضافية
```

### واجهات REST الأساسية
```
POST /api/auth/otp/request      {phone}
POST /api/auth/otp/verify       {phone, code}
POST /api/contacts/sync         {contacts:[{hash,name}]}   (بصمات SHA-256 فقط)
GET  /api/conversations
POST /api/conversations         {userId|phone}  أو {type:'group', title, memberIds}
GET  /api/conversations/:id/messages
POST /api/conversations/:id/messages
POST /api/conversations/:id/read
POST /api/uploads               (multipart)
GET  /api/ice                   STUN/TURN ببيانات مؤقتة
GET  /api/sync?since=           مزامنة بعد الانقطاع
GET  /api/conversations/:id/settings      الخلفية المشتركة للمحادثة
POST /api/conversations/:id/settings      {settings:{wallpaper|theme|bubbleColor|accentColor}}
GET  /api/conversations/:id/keys          مفاتيح المجموعة (مغلّفة لكل عضو)
POST /api/conversations/:id/keys          {keys:[{userId,enc,nonce}]}
PATCH /api/me                             {name|about|avatar|public_key}
```

### إطارات WebSocket
`ready · message · message:update · typing · receipt · presence · presence:state · conversation · conversation:settings · conversation:keys · user:key · event · call.invite · call.ringing · call.answer · call.ice · call.media · call.end · call.decline · call.busy`

إطار التنبيهات من العميل إلى السيرفر:
```json
{ "t": "event", "type": "screenshot|recording|recording_stop", "conversationId": "c_…", "meta": {} }
```
يحفظه السيرفر رسالة `system` داخل المحادثة ويبثّه فوراً للطرف الآخر (مع إشعار FCM إن كان خارج التطبيق).

وإطار `user:key` يُبثّ لأعضاء محادثات المستخدم عند تغيّر مفتاحه العام (تثبيت جديد/جهاز جديد) حتى لا تُشفَّر
الرسائل بمفتاح قديم لا يملكه صاحبه.

---

## 7) الاختبارات

تشغيل كل شيء بأمر واحد (يشغّل سيرفر اختبار مؤقت بقاعدة بيانات مؤقتة):
```bash
node test/run-all.mjs
```

أو كل مجموعة على حدة:
```bash
node test/verify-crypto.py        # 47 فحصاً: X25519/HKDF مقابل RFC 7748 و RFC 5869 و Node/OpenSSL
node test/e2ee-web.mjs            # 13 فحصاً لمحرّك التشفير في المتصفح
node test/e2ee-cross.mjs          # 13 فحصاً: الويب ↔ أندرويد يفتحان رسائل بعضهما
cd server && node test/e2e.mjs    # 43 فحصاً: REST + WebSocket + الخلفية + التنبيهات
node test/e2ee-live.mjs           # 12 فحصاً ضد سيرفر حقيقي: تشفير، ملفات، مجموعات، خلفية، تنبيهات
node test/web-two-clients.mjs     # 20 فحصاً: **عميلان ويب حقيقيان** يتبادلان رسائل مشفّرة وخلفية وتنبيهات
node test/web-smoke.mjs           # 12 فحصاً لواجهة الويب داخل DOM حقيقي (يحتاج: cd test && npm i jsdom esbuild)
```

---

## 8) ملاحظات أمنية وتشغيلية

- النقل محمي بـ TLS في الإنتاج (nginx + شهادات مجانية).
- أرقام جهات الاتصال تُرفع **كبصمات SHA‑256** فقط؛ السيرفر لا يخزّن أرقام غير المستخدمين.
- المصادقة JWT مع توكن تحديث، وجلسات قابلة للإبطاء.
- الاتصال من التطبيق عبر HTTPS فقط (`network_security_config.xml`) باستثناء عناوين التطوير المحلية.
- رفع الملفات محدود بـ 32MB وروابطها عشوائية (capability URLs).
- **التشفير من طرف لطرف مُفعّل**: السيرفر لا يرى نص أي رسالة ولا أي ملف، بل مغلّفاً مشفّراً فقط.
  - هوية X25519 لكل حساب؛ المفتاح الخاص مشفّر داخل Android Keystore على الجوال، ومحفوظ في المتصفح محلياً.
  - المحادثات الثنائية: `X25519(مفتاح مؤقت، هوية الطرف)` ← `HKDF-SHA-256` ← `AES-256-GCM` مع ربط السياق `masingar|v1|<المحادثة>|<المرسل>|<المستقبل>`.
  - المجموعات: مفتاح مجموعة عشوائي (32 بايت) يُغلَّف لكل عضو بمفتاحه العام؛ الرسائل `masingar|g1|<المحادثة>|<المرسل>`.
  - الملفات والصور والصوت تُشفَّر قبل الرفع (`AES-256-GCM`) ويُرفع الناتج باسم `.enc`، والمفتاح يصل داخل الرسالة المشفّرة فقط.
  - إن لم يكن الطرف قد سجّل مفتاحه العام بعد، تُرسل الرسالة بدون تشفير لتبقى المحادثة تعمل، وتُشفَّر تلقائياً ما إن يصبح المفتاح متاحاً.
- **خصوصية إضافية**: لا تُعرض أسماء الملفات ولا محتوياتها في الإشعارات عند تشفيرها.

---

## 9) خريطة الطريق القريبة

- تشفير من طرف لطرف للمجموعات بمفاتيح دوّارة (re-keying) عند تغيّر الأعضاء.
- مجموعات مع صلاحيات وروابط دعوة.
- التحقق من بصمة الأمان (Safety Numbers) بين الطرفين.
- نسخ احتياطي سحابي اختياري.
- مشاركة الشاشة أثناء المكالمة.
- نسخة iOS.

---

رخصة المشروع: MIT.
