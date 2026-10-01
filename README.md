# Football Lineup — LineUp AR

Jonli kamera, OBS Virtual Camera, efir oynasi yoki video fayl ustiga tarkib grafikasini chiqaradigan local web-demo.

Production: **https://camera.identify.uz/**. Server: `169.58.110.18`, loyiha: `/opt/football-lineup`, konteyner: `football-lineup`, port: `5174`.

HTTPS'ni `mcp-clarvio-caddy` boshqaradi; sertifikat avtomatik yangilanadi. Host konfiguratsiyasi `/opt/mcp.clarvio.tech/Caddyfile`, LineUp upstream'i `172.18.0.1:5174`. 2026-09-06 kuni konteynerning `/etc/caddy/Caddyfile` read-only bind mount'i eski inode'ga bog'langanligi sababli amaldagi barcha route'lar saqlanib, yangilangan konfiguratsiya `/config/lineup-Caddyfile` orqali validate/reload qilindi; host fayli ham shu konfiguratsiyaga tenglashtirildi. Keyingi proxy o'zgarishida konteynerdagi va hostdagi fayllarni solishtiring; eski `/etc/caddy/Caddyfile` bilan ko'r-ko'rona reload qilmang.

## Ishga tushirish

```bash
cd "/Users/shahzod/work/Projects/football-lineup-ar"
npm start
```

Brauzerda `http://localhost:5174` ni oching. Jonli manbani ulang yoki MP4 videoni yuklang, klub va tarkib ma'lumotini o'zgartiring, keyin `TAKE ON AIR` ni bosing.

## Jonli manba

1. `SETUP` ichida kamerani tanlab `KAMERA` tugmasini bosing va brauzer ruxsatini bering. Kamera nomlari ruxsat berilgach ko'rinadi. Boshqa kameraga o'tish uchun uni tanlab yana `KAMERA` bosing.
2. OBS'dan olish uchun OBS Virtual Camera'ni yoqing va kameralar ro'yxatidan tanlang. Yoki `EFIR OYNASI` orqali efir ochilgan boshqa tab/oynani tanlang; LineUp oynasining o'zini tanlamang.
3. Kamerani kerakli keng planga olib, `JOYLASH` bilan kartalarni joylashtiring va `SAQLASH` bosing.
   Boshlang'ich yo'nalish **90°**: darvozabon chapda, himoyachilar, yarim himoyachilar va hujumchilar o'ngga qarab joylashadi. Kartalar tik turadi. `Tarkib yo'nalishi` orqali 0°/90°/180°/270° ni tanlash, `Boshlang'ich joylashuv` orqali formation presetini tiklash mumkin. Yo'nalish har bir jamoa uchun alohida saqlanadi; yo'nalish o'zgargach tracking uchun qayta kalibrovka qiling.
4. `4 NUQTA` ni bosing: ko'rib turgan kadr muzlaydi, kamera esa ishlashda davom etadi. Maydonning turli qismlaridagi 4 ta oq chiziq kesishmasini tanlang. Nuqtalar bir chiziqda yoki juda yaqin bo'lmasin; to'rtburchak hosil qilsin. Belgilash paytida kamerani imkon qadar qimirlatmang.
5. `LIVE TRACK` va ishonch foizi chiqqach `TAKE ON AIR` ni bosing. Kartalar kalibrovka qilingan maydonning siljishi va zoom'iga ergashadi. `CLEAR`/`Esc` grafikani yashiradi, jonli tracking davom etadi. `UZISH` manbani va tracking ulanishini uzadi.
6. `TRACK LOST` bo'lsa yoki ulanish uzilsa, kartalar yashiriladi. Yangi planda `4 NUQTA` orqali qayta belgilang. `JOYLASH`, jamoa yoki formation almashtirilsa, tracking to'xtaydi; keyin qayta kalibrovka qiling.
7. `OUTPUT → PROGRAM` fullscreen natijasini OBS Window Capture orqali oling. OBS Virtual Camera kirishi va LineUp natijasi qayta bir-biriga ulanib qolmasin.

Jonli kirish video-only; ovozni OBS'da alohida boshqaring. Bu ilova o'zi RTMP/SRT efir yubormaydi, oddiy efir sahifasi havolasini to'g'ridan-to'g'ri ochmaydi.

Kamera va ekran ulash uchun `localhost` yoki HTTPS kerak; oddiy HTTP LAN manzili orqali ishlamasligi mumkin. Telefon kamerasi uchun ilovani telefonning HTTPS brauzerida ochish kerak; telefonni ushbu kompyuterga masofadan ulash bu versiyada yo'q. [Brauzer capture talablari](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

Jonli `4 NUQTA` rejimi kadrlarni WebSocket orqali serverga yuboradi; serverda ular faylga saqlanmaydi. Brauzer hisoblangan kadr va unga tegishli grafikani bir vaqtda ko'rsatadi. Tezlik 12 kadr/soniyagacha; haqiqiy FPS va kechikish `LIVE TRACK` yonida ko'rinadi va internet/server tezligiga bog'liq. Bu rejim 25/50 FPS broadcast tracking o'rnini to'liq bosmaydi.

Tracking boshlang'ich maydon detallariga bog'liq: yaqin plan, xiralik, katta burilish, juda kuchli zoom yoki to'silishda qayta kalibrovka talab qilinadi. Yo'qolgan tracking o'z-o'zidan boshqa planga biriktirilmaydi. Qimirlamaydigan kamera uchun `4 NUQTA` siz, `JOYLASH` bilan ishlash ham mumkin.

## Operator workflow

1. `SETUP` bo‘limida jonli manba yoki video fayl, jamoa, rang va formation'ni tanlang.
2. `SQUAD` bo‘limida 11 futbolchining raqami, ismi, roli, statistikasi va suratini kiriting.
3. Quyidagi `AUTO JOYLASH` bilan maydonga mos tarkib tuzing. Qo'lda boshqarish uchun `JOYLASH` va `4 NUQTA` ham mavjud.
4. `TAKE ON AIR` orqali grafikni chiqaring; `PROGRAM` fullscreen oynasini OBS Window Capture bilan oling.

Keyboard: `Space` — take/replay, `Esc` — clear, `J` — joylash mode, `1–3` — operator panellari.

## AUTO JOYLASH — maydonga mos aqlli joylashuv

1. Jonli kamera yoki video faylni ulang. `Formation` tanlang, `SQUAD` ichida rollarni tekshiring: aynan bitta `GK` bo'lishi kerak.
2. `SETUP → AUTO JOYLASH` bo'limida `O'z yarim maydoni` yoki `Butun maydon` tanlang. Shu hududning to'rtta burchagi ko'rinadigan keng planni oching.
3. `AUTO JOYLASH` tugmasini bosing. Kadr muzlaydi, jonli kamera ishlashda davom etadi. Sxemadagi nuqtalarni videoda **1 → 2 → 3 → 4** tartibida belgilang. Chap/o'ng — o'z darvozangizdan hujum tomonga qaraganda:
   - **1:** o'z darvoza chizig'i va chap yon chiziq kesishmasi.
   - **2:** markaz chizig'i va chap yon chiziq kesishmasi; butun maydonda raqib darvoza chizig'i.
   - **3:** markaz chizig'i va o'ng yon chiziq kesishmasi; butun maydonda raqib darvoza chizig'i.
   - **4:** o'z darvoza chizig'i va o'ng yon chiziq kesishmasi.
4. `LIVE TRACK` yoki faylda `Maydonga biriktirildi` holatini kuting. Kartalar avtomatik preview'da chiqadi. Rol mos kelmasa, sariq xabarda qaysi futbolchi qaysi pozitsiyaga o'tgani ko'rsatiladi; tarkib yoki formation'ni tuzatib qayta belgilang.
5. `TAKE ON AIR` bilan chiqaring. `CLEAR` yashiradi, `PREVIEW` animatsiyasiz qayta ko'rsatadi. `OUTPUT → PROGRAM` katta ekranga chiqaradi.

Formation maydon rakursiga mos hisoblanadi; darvozabon va qanotlar ro'yxat tartibiga emas, futbolchi rollariga qarab taqsimlanadi. Kartaning pastki markazi uning maydondagi nuqtasiga biriktiriladi, surat tik qoladi. Kartalar sig'ishiga qarab hajm kamayadi, keyin statistika yashiriladi, zarur bo'lsa raqam va ismli ixcham kartalar chiqadi. O'qiladigan eng kichik hajm ham sig'masa, grafika yashiriladi va kengroq plan so'raladi; taktik nuqtalar surilmaydi.

Yangi manba, tracking yo'qolishi, rol yoki jamoa almashishi maydonni qayta belgilashni talab qiladi. Saqlangan loyihada tarkib va joylashuv bor, eski kamera kalibrovkasi qayta ishlatilmaydi. `JOYLASH` qo'lda tahrirga o'tkazadi; `Boshlang'ich joylashuv` 90° yoki tanlangan yo'nalishdagi oddiy formation'ni tiklaydi.

Bu versiyada maydon chiziqlarini operator belgilaydi; maydonni sun'iy intellekt bilan o'z-o'zidan aniqlash yo'q. Jonli tracking tezligi va keng plan talablari yuqoridagi bilan bir xil.

## Tekshirish

```bash
npm run check
.venv/bin/python -m pip install -r requirements-dev.txt
npm test
```

JavaScript testlari maydon perspektivasi, teskari kamera ko'rinishi, rollar taqsimoti, kartalar sig'ishi va taktik nuqtalarning saqlanishini tekshiradi. Backend testlari siljish/zoom/perspektiva aniqligi, kadr almashishida tracking yo'qolishi, qayta kalibrovka, noto'g'ri kadr va nuqtalar, WebSocket sessiyalari ajratilishini tekshiradi.


## 2026-09-15 tuzatishlari

- Fayl tracking'i jonli tracking kabi dastlabki kalibrovka kadriga solishtiriladi. Tracking yo'qolgach yangi planga avtomatik yopishmaydi; 4 NUQTA/AUTO JOYLASH bilan qayta belgilanadi.
- Fayllar cheklangan fon ishchisida hisoblanadi; shu vaqtda jonli WebSocket ishlashi davom etadi. Bir vaqtning o'zida bitta fayl hisoblanadi. Limit: 256 MB, 10 daqiqa, 4K, 120 FPS.
- 4:3 va boshqa video nisbatlarida preview kesilishi hisobga olinadi. PROGRAM fullscreen har qanday monitorda 16:9 nisbatni saqlaydi; qolgan joy qora bo'ladi.
- Formation, jamoa va kalibrovkani o'zgartirish kartalarni efirdan tushiradi. Hisoblash tugamaguncha TAKE ON AIR bloklanadi.
- Project JSON avval to'liq tekshiriladi; noto'g'ri fayl faol va saqlangan loyihaga tegmaydi. PNG/JPEG/WebP/GIF data-URL suratlari qo'llab-quvvatlanadi; yangi suratlar 512 pikselgacha siqiladi.
- Saqlash ishlamasa pastda SAQLANMADI xabari chiqadi. OUTPUT → EXPORT bilan ochiq loyihadan JSON nusxa olish mumkin.
- Tactical links yoqish/o'chirish ishlaydi; chiziqlar futbolchi slotlariga bog'lanadi va tracking bilan harakatlanadi.
- Faqat belgilangan frontend fayllari ochiladi. Backend, repository va vaqtinchalik upload fayllari URL orqali tarqatilmaydi.

Regressiya testlari: `npm test`. Project importi, video koordinatalari, kamera kesilishi, parallel so'rovlar, API validatsiyasi va yopiq fayl yo'llarini tekshiradi. Brauzer tekshiruvlari sun'iy kamera va video orqali bajarilgan; haqiqiy stadion/OBS efiri uchun alohida rehearsal kerak.
