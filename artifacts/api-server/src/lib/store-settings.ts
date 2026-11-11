import { readSettingsRow, writeSettingsRow } from "@workspace/db";
import { SaveSettingsBody } from "@workspace/api-zod";

export const defaultSettings = {
  heroTitleEn: "A little dough.\nA whole lot of love.",
  heroTitleAr: "قليل من العجين.\nالكثير من الحب.",
  heroTextEn: "Your oven. Our cookie dough. Warm, freshly baked moments, made easy.",
  heroTextAr: "فرنك، وعجينتنا. لحظات دافئة وكوكيز طازج بكل سهولة.",
  aboutEn: "Amore Cookies brings frozen, ready-to-bake cookie dough to homes and cafés in Kuwait. Choose Classic Belgian Cocoa or Kinder Stuffed Cookie — 12 cookies in every bag, ready for your oven.",
  aboutAr: "أموري كوكيز تقدم عجينة الكوكيز المفرزنة والجاهزة للخبز للأفراد والمقاهي داخل الكويت. اختاري الكاكاو البلجيكي الكلاسيكي أو الكوكيز المحشي بالكندر — 12 حبة في كل كيس، جاهزة لفرنك.",
  storageEn: "Keep frozen. Follow the storage and expiry instructions on your product packaging.",
  storageAr: "يحفظ مجمداً. يرجى اتباع تعليمات الحفظ وتاريخ الصلاحية الموضحة على العبوة.",
  policiesEn: "", policiesAr: "", whatsapp: "", email: "", phone: "", hoursEn: "", hoursAr: "",
  bakingSteps: [
    { titleEn: "Preheat", titleAr: "سخني الفرن", textEn: "Preheat your oven to 175°C.", textAr: "سخني الفرن مسبقاً على درجة حرارة 175°C." },
    { titleEn: "Bake", titleAr: "اخبزي الكوكيز", textEn: "Bake at 150°C for 10–12 minutes.", textAr: "ضعي الكوكيز في الفرن لمدة 10–12 دقيقة على درجة حرارة 150°C." },
    { titleEn: "Cool & enjoy", titleAr: "بردي وقدمي", textEn: "Remove from the oven and let the cookies cool before serving.", textAr: "أخرجي الكوكيز واتركيه يبرد خارج الفرن قبل التقديم." },
  ],
  checkoutEnabled: false,
  deliveryFeeFils: 3000,
  logoImage: "/images/amore-logo.png",
  bakerImage: "/images/amore-baker.png",
  packageImage: "/images/amore-package.png",
  cookieImage: "/images/amore-cookie.jpg",
};

export async function readSettings() {
  const row = await readSettingsRow();
  return SaveSettingsBody.parse({ ...defaultSettings, ...row?.content });
}

export async function writeSettings(content: ReturnType<typeof SaveSettingsBody.parse>) {
  await writeSettingsRow(content);
  return content;
}
