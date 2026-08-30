# النشر المجاني الدائم ٢٤/٧ — خطوة بخطوة (بدون بطاقة بنكية)

المعادلة: **Render** (تشغيل السيرفر مجاناً) + **UptimeRobot** (يمنع نوم الخطة المجانية
فيبقى صاحياً ٢٤/٧) + **Supabase اختياري** (حفظ الرسائل من مسح قرص الخطة المجانية).

> كل الخدمات الثلاث مجانية تماماً وبلا بطاقة — التسجيل ببريد إلكتروني أو حساب GitHub فقط.

---

## الخطوة ١ — ادمج التحديثات (دقيقة واحدة)

افتح [Pull Request #13](https://github.com/aalter237-blip/Chat-masingar/pull/13)
واضغط **Merge pull request** حتى يصبح كود «ماسنجر لايت» هو الفرع الرئيسي.

## الخطوة ٢ — شغّل السيرفر بضغطة واحدة (٣ دقائق)

1. في صفحة المستودع على GitHub اضغط زر **Deploy to Render** الموجود في `README`
   (أو افتح مباشرة: `https://render.com/deploy?repo=https://github.com/aalter237-blip/Chat-masingar`).
2. سجّل الدخول بحساب **GitHub** (زر أخضر — بدون بطاقة).
3. سيقرأ Render ملف `render.yaml` تلقائياً. كل ما يُطلب منك:
   - **JOIN_CODE**: اختر رقماً سرياً من ٤ خانات (مثل `4521`) — سيُطلب من كل عضو جديد.
   - SUPABASE_URL و SUPABASE_SERVICE_KEY: اتركهما فارغين الآن (انظر الخطوة ٤).
4. اضغط **Apply** وانتظر ٢-٣ دقائق حتى يتحول إلى **Live**.
5. انسخ رابط خدمتك أعلى الصفحة، مثل: `https://masingar-lite.onrender.com`

## الخطوة ٣ — منع النوم ليعمل ٢٤/٧ فعلياً (دقيقتان — مهمة!)

الخطة المجانية في Render تنام بعد ١٥ دقيقة بلا زوار، وأول زائر بعدها ينتظر ~٥٠ ثانية.
الحل المجاني المعروف: موقع يزور سيرفرك تلقائياً كل ٥ دقائق فيبقى صاحياً دائماً:

1. ادخل [uptimerobot.com](https://uptimerobot.com) → **Register** (مجاني، بريد فقط).
2. بعد الدخول: **Add New Monitor** واملأ:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: ماسنجر لايت
   - **URL**: `https://رابطك.onrender.com/api/circle`
   - **Monitoring Interval**: 5 minutes
3. **Create Monitor** — انتهى. سيرفرك الآن لا ينام أبداً. ✅

(بديل: [cron-job.org](https://cron-job.org) — أنشئ مهمة كل ٥ دقائق لنفس الرابط.)

## الخطوة ٤ (اختيارية لكن موصى بها) — حماية الرسائل من المسح

قرص الخطة المجانية يُمسح عند إعادة النشر. لتبقى الأعضاء والرسائل دائماً:

1. [supabase.com](https://supabase.com) → مشروع جديد (مجاني، بلا بطاقة).
2. **SQL Editor** → ألصق ونفّذ:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
```

3. **Project Settings → API**: انسخ **Project URL** و**service_role key**.
4. في Render → خدمتك → **Environment** → أضف `SUPABASE_URL` و`SUPABASE_SERVICE_KEY** → Save.

## الخطوة ٥ — افتح التطبيق ووزّعه على دائرتك

- **من المتصفح فوراً**: افتح رابطك من Chrome على الجوال → ⋮ → **إضافة إلى الشاشة الرئيسية**.
- **من الـ APK**: ثبّت آخر `Masingar.apk` من تبويب **Actions** في المستودع،
  وعند أول تشغيل اكتب رابطك في نافذة «عنوان سيرفر ماسنجر لايت» (يُحفظ مرة واحدة).
- أرسل لأفراد دائرتك (٥ كحد أقصى): الرابط + رمز الانضمام.

---

## التحقق أن كل شيء سليم

| أين | ماذا تبحث عنه |
|---|---|
| Render → خدمتك → Events | **Live** بدون أخطاء |
| المتصفح | فتح الرابط يعرض شاشة الدخول الزرقاء «ماسنجر لايت» |
| Render → Logs (بعد Supabase) | `حفظ : Supabase خارجي مفعّل` |
| Supabase → Table Editor | سطر `main` في جدول `app_state` بعد أول رسالة |
| UptimeRobot | Monitor يعني كل ٥ دقائق بلا انقطاع |

## الخطوة ٦ — ربط نطاقك الخاص (shargawe237.com) بالتطبيق

بعد أن تصبح خدمتك **Live** على Render برابط مثل `masingar-lite.onrender.com`:

1. في Render → خدمتك → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. اكتب: `shargawe237.com` (وأضف `www.shargawe237.com` بنفس الطريقة إن أردت).
3. سيعرض لك Render **سجلات DNS المطلوبة** — انسخها كما هي إلى لوحة التحكم
   في **الجهة التي اشتريت منها النطاق** (Namecheap / GoDaddy / Hostinger ...):
   - للنطاق الرئيسي عادة سجلا **A** بعنوانَي Render: `216.24.57.1` و `216.24.57.2`
   - لـ www عادة سجل **CNAME** يشير إلى `masingar-lite.onrender.com`
   > انسخ القيم من شاشة Render فهي الأدق لخدمتك، ولا تعتمد على هذه الأرقام وحدها.
4. انتشر DNS خلال دقائق إلى ساعات (حسب الجهة). Render سيُصدر شهادة
   **HTTPS تلقائياً ومجاناً** للنطاق عند نجاح الاتصال — لا تفعل شيئاً.
5. افتح `https://shargawe237.com` — ستجد شاشة دخول ماسنجر لايت. ✅
6. في تطبيق الأندرويد: إن كان مبنياً بعد هذا التحديث فسيعمل مباشرة على نطاقك
   (العنوان الافتراضي أصبح نطاقك)، وإن كان أقدم فغيّر العنوان من داخل التطبيق.

> بديل محترف (اختياري): نقل DNS إلى Cloudflare المجاني ثم ربطه بـ Render —
> يمنحك حماية إضافية وتحكم DNS أسهل، مع دعم كامل لـ WebSocket.

## أسئلة متكررة

**التطبيق بطيء أول مرة في الصباح؟**
لم تُطبّق الخطوة ٣ (منع النوم) — أو غيّر الفاصل إلى 5 minutes فعلاً لا 30.

**أعاد Render النشر واختفت الرسائل؟**
لم تُطبّق الخطوة ٤ (Supabase). طبّقها ثم أرسل أي رسالة جديدة ليعود الحفظ.

**نسيت رمز الانضمام / أريد تصفير الدائرة؟**
Render → Environment → عدّل `JOIN_CODE`. للتصفير الكامل: Supabase → `app_state` → احذف سطر `main`.

**أريد أكثر من ٥ أعضاء؟**
Render → Environment → `MAX_MEMBERS=8` مثلاً → Save.
