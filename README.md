# Football Lineup — LineUp AR

Video yuklab, tarkibni kiritib, `ON AIR` tugmasini bosish uchun tayyor local web-demo.

## Ishga tushirish

```bash
cd "/Users/shahzod/Shahzod projects/football-lineup-ar"
npm start
```

Brauzerda `http://localhost:5174` ni oching. MP4 videoni yuklang, klub va tarkib ma'lumotini o'zgartiring, keyin `ON AIR` ni bosing.

Bu versiya uploaded video ustiga real-time grafik overlay chiqaradi. Haqiqiy jonli translyatsiyadagi pan/zoom kameraga yopishadigan AR uchun qo'shimcha camera tracking va broadcast output (masalan, Unreal + tracking + vMix/OBS NDI) kerak bo'ladi.

## Operator workflow

1. `SETUP` bo‘limida video, jamoa, rang va formation'ni tanlang.
2. `SQUAD` bo‘limida 11 futbolchining raqami, ismi, roli, statistikasi va suratini kiriting.
3. Fixed kamera uchun `JOYLASH`, harakatlanuvchi plan uchun `4 NUQTA` kalibrovkasidan foydalaning.
4. `TAKE ON AIR` orqali grafikni chiqaring; `PROGRAM` fullscreen oynasini OBS Window Capture bilan oling.

Keyboard: `Space` — take/replay, `Esc` — clear, `J` — joylash mode, `1–3` — operator panellari.

## Tekshirish

```bash
npm run check
```
