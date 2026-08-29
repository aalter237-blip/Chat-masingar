# تفعيل إشعارات FCM (مجانًا — 5 دقائق)

بدون هذه الخطوة يعمل كل شيء داخل التطبيق وهو مفتوح، لكن **المكالمة الواردة لن توقظ الجوال وهو مغلق**.
Firebase Cloud Messaging مجاني تمامًا ولا يحتاج بطاقة ائتمان.

## 1) أنشئ مشروع Firebase
1. افتح https://console.firebase.google.com ← **Add project** ← سمِّه `masingar`.
2. عطّل Google Analytics (غير ضروري) ← **Create**.

## 2) سجّل تطبيق الأندرويد
1. داخل المشروع ← أيقونة أندرويد **Add app**:
   - **Package name:** `io.masingar.chat`
   - أضف أيضًا نسخة ثانية بالاسم `io.masingar.chat.debug` (نسخة التطوير).
2. حمّل ملف `google-services.json` وضعه في:
   ```
   android/app/google-services.json
   ```
   الملف مُستثنى من git تلقائيًا (مذكور في `.gitignore`). عند وجوده يتفعّل
   إشعار FCM في البناء تلقائيًا — البناء بدونه يستمر عاديًا.

## 3) فعّل الإشعارات في السيرفر
1. في Firebase ← ⚙️ **Project settings → Service accounts → Generate new private key**.
2. من الملف الناتج انسخ إلى `deploy/.env` على السيرفر:
   ```
   FCM_PROJECT_ID=<project_id>
   FCM_CLIENT_EMAIL=<client_email>
   FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```
3. أعد تشغيل السيرفر.

## 4) أعد بناء الـ APK
ادفع أي commit أو شغّل الـ workflow يدويًا — الـ APK الجديد يوقظ الجهاز عند ورود
مكالمة أو رسالة والتطبيق مغلق.

> ملاحظة: على أجهزة شاومي/هواوي فعّل للمستخدمين "التشغيل التلقائي" (Autostart)
> لتطبيق ماسنجر من إعدادات البطارية حتى تصل الإشعارات بثبات.
