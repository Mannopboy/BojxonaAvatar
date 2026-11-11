# v7 — yangi 3 ta video (Higgsfield, yangi akkaunt ulangach)

Hech narsa yuborilmagan, kredit sarflanmagan. Tayyor: `home_black_1080x1920.png` (qora fonli uy kadri), `audio/speaking_v7.mp3` (12.8 s, 4 ibora, orasida 0.5 s pauza), `audio/greeting_v7.mp3` (6.6 s).

## Eski xatolar → yechim

| Xato (foydalanuvchi ko'rgan) | Sabab | Yechim |
|---|---|---|
| Klipdan klipga o'tishda uzilish | xom klipda bosh 3–14 px siljiydi, uchlari mos emas, boshlanish kadrlari qorong'iroq | hamma klip BIR XIL uy kadridan boshlanadi va shu kadrda TUGAYDI (start_image = end_image); o'tish faqat shu uchlarda; boshlanish yorqinlik rampasi bo'lsa — kesiladi |
| Gap tugaganda og'iz ochiq turgan holda birdan kutishga o'tdi | chiqish nuqtasi faqat bosh o'rniga qarab tanlangan, og'iz hisobga olinmagan | chiqish faqat **og'iz yopiq VA bosh uy o'rnida** bo'lgan kadrlarda; audio iboralar orasida 0.5 s jim pauza (lablar yopiladi); xira-o'tish 400 ms |
| Ifoda ortiqcha (keng tabassum, lab cho'chchayishi, ko'z qisish) | promptda ifoda cheklanmagan | prompt: xotirjam, minimal ifoda, lablar yengil; tabassum/qisish/cho'chchayish yo'q; qabul qilinmasa — qayta |
| Kutishda ko'z 1.7 s yumuq | AI uzoq yumib qo'ydi | prompt: ko'z ochiq, bitta tez tabiiy pirpirash |
| Orqa fon kulrang, kesish bloklari | fon rangi studiya | start/end kadr sof qora fonda; AI fonni qora saqlaydi (aks holda eski geq kaliti qoladi) |
| Yorqinlik «puls» | AI klip boshida asl rasmdan o'z yorqinligiga o'tadi | uy kadri AI ko'rinishiga keltiriladi (1-klipdan 'settled' kadr), qolgan klip shundan boshlanadi |

## Model va sozlama
- **Seedance 2.5** yoki **2.0** (ikkalasida start_image, end_image, audio_references, «unlim» bor); Mini — zaxira. 9:16, 720p, `generate_audio=false` (audio faqat lab uchun reference).
- Hamma klip: `start_image = end_image = home_black_1080x1920.png`.

## 1) idle (4–5 s, loop)
Prompt: *Static locked-off camera. A woman in a dark green customs officer uniform and side cap stands calmly, eyes open, looking at the camera, relaxed closed lips with a very slight natural expression. Very subtle breathing, one quick natural blink, tiny relaxed head movement. Mouth stays closed. Pure solid black background, identical framing and lighting from first to last frame.*

## 2) speaking (13 s)
`audio_references = speaking_v7.mp3`. Prompt: *Static locked-off camera. The same woman speaks calmly and naturally to the camera, lip movements synchronized with the audio, closing her lips fully during every pause in the audio. Neutral professional expression, minimal facial expression, no exaggerated smile, no pursed lips, no winking, eyes open with natural blinks, head almost still, hands stay still. Pure solid black background, identical framing and lighting, ending in exactly the starting pose with lips closed.*

## 3) greeting (6–7 s)
`audio_references = greeting_v7.mp3`. Prompt: *Static locked-off camera. The same woman raises her right hand to the brim of her side cap in a formal respectful salute while saying hello with lips synchronized to the audio, holds briefly, then lowers her hand to the side and closes her lips, ending in exactly the starting pose. Calm neutral expression, no exaggerated smile. Pure solid black background, identical framing and lighting.*

## Qabul mezoni (har klip uchun, o'lchanadi)
1. Birinchi va oxirgi kadr farqi ≈ oddiy qo'shni kadr farqi (loop va o'tish uchun).
2. Boshlanishda yorqinlik rampasi yo'q (yoki kesiladi).
3. Fon qora (burchaklar ≈ 0).
4. Og'iz yopiq + bosh uy o'rnida (≤ 2 px) bo'lgan kadrlar chastotasi: gapirishda eng uzog'i bilan ~1 s kutish.
5. Ifoda: keng tabassum/cho'chchayish/qisish yo'q (kadrlarni ko'zdan kechirish).
6. Salom: qo'l ko'tarilishi/tushishi toza, oxirida uy pozasi.

## Keyin
Qirqish (ffmpeg), o'tish nuqtalari (`avatarClips.json`: og'iz yopiq + bosh o'rni), pleyer (400 ms xira-o'tish, chiqish nuqtasini kutadi), lokal demo, so'ng deploy uchun ruxsat.

## Salom v8 (qo'l avval boshga yetadi, keyin ovoz)
`audio_references` = 1.3 s jim + nutq (`Assalomu alaykum, hurmatli yo'lovchi! Men Davlat bojxona qo'mitasining virtual xodimiman.`, ~7.5 s), duration 8.
Prompt: *Static locked-off camera. The same woman first raises her right hand smoothly and calmly to the brim of her side cap in a formal respectful salute during the first 1.2 seconds, with her lips closed and silent. Only when her hand touches the cap does she begin to speak, lip movements synchronized with the audio, holding the salute while she says the first greeting. After the first sentence she smoothly lowers her hand to her side while continuing to speak, then closes her lips, ending in exactly the starting pose. Calm neutral professional expression, minimal facial expression, no exaggerated smile, no pursed lips, no winking, eyes open with natural blinks. Pure solid black background, identical framing and lighting.*
Natija: qo'l 0.75 s da boshga yetadi, og'iz ~1.54 s da ochiladi → `GREETING_SPEECH=1.54 python build_assets.py ...` (frontend audioni shu paytgacha kechiktiradi).

## Javob klipi (lab harakati o'z ovoziga mos)
`audio_references` = javob audiosi (0.25 s jim + nutq + oxirigacha jim; davomiylik = ceil(0.25 + nutq + 0.55) s), `start_image = end_image` = uy kadri, `generate_audio:false`.
Prompt: *Static locked-off camera. The same woman speaks calmly and naturally to the camera, her lip movements precisely synchronized with the audio from the first word to the last. Her lips stay closed before the speech starts; when the speech ends she closes her lips and stays still. Neutral professional expression, minimal facial expression, no exaggerated smile, no pursed lips, no winking, eyes open with natural blinks, head almost still, hands stay still. Pure solid black background, identical framing and lighting, ending in exactly the starting pose with lips closed.*
Qabul (`build_answers.py` hisoboti): `lipMatch` ≥ 0.7 (og'iz ochiqligi va ovoz borligi mosligi), `poseStart/poseEnd` ≤ 1.5 px, `mouthStart/mouthEnd` ≤ yopiq chegara. Birinchi klip (airport): lipMatch 0.92, og'iz ovozdan 2 kadr oldin ochiladi (tabiiy).
