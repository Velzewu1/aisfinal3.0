import { registerAsset } from "./index.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("knowledge.seed");

// ------------------------------------------------------------------ //
// Seed reusable assets — clinic-wide templates, presets, and          //
// diagnosis-linked guidance for the Aqbobek rehab center.             //
//                                                                    //
// These are NOT patient facts. They are style/format guidance that    //
// enriches the LLM prompt with domain-specific writing conventions.   //
//                                                                    //
// Tags are the primary retrieval signal:                              //
//   - Document type: "primary_exam", "epicrisis", "diary"            //
//   - Specialty: "lkf", "psychologist", "speech", "massage"          //
//   - Diagnosis: "g93.2", "g80", "cerebral_palsy"                   //
//   - Role: "general", "template", "preset", "exemplar"              //
// ------------------------------------------------------------------ //

const SEED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

interface SeedAsset {
  id: string;
  label: string;
  tags: string[];
  contentType: "form_template" | "phrase_preset" | "field_default" | "protocol_snippet" | "custom";
  content: string;
}

const SEED_ASSETS: readonly SeedAsset[] = [
  // ── Primary Exam Templates ──────────────────────────────────────
  {
    id: "tpl_primary_exam_complaints",
    label: "Шаблон: жалобы при поступлении (первичный осмотр)",
    tags: ["primary_exam", "template", "complaints", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Жалобы при поступлении»:",
      "Структура: основная жалоба, сопутствующие жалобы, давность.",
      "Пример: «Жалобы на задержку речевого развития, нарушение координации, повышенный мышечный тонус в нижних конечностях. Наблюдается с рождения.»",
      "Стиль: формальный медицинский, без сокращений, 3-е лицо.",
    ].join("\n"),
  },
  {
    id: "tpl_primary_exam_objective",
    label: "Шаблон: объективный статус (первичный осмотр)",
    tags: ["primary_exam", "template", "objective_findings", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Объективно»:",
      "Структура: сознание → кожные покровы → неврологический статус → мышечный тонус → рефлексы → координация.",
      "Пример: «Сознание ясное. Кожные покровы обычной окраски, чистые. Мышечный тонус повышен в нижних конечностях по спастическому типу. Сухожильные рефлексы оживлены. Координаторные пробы выполняет с интенцией.»",
      "Стиль: последовательное описание систем, формальная лексика.",
    ].join("\n"),
  },
  {
    id: "tpl_primary_exam_disease_anamnesis",
    label: "Шаблон: анамнез заболевания",
    tags: ["primary_exam", "template", "disease_anamnesis", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Анамнез заболевания»:",
      "Структура: начало заболевания → течение → госпитализации → текущий статус.",
      "Пример: «Заболевание диагностировано в возрасте 6 месяцев. Регулярно проходит курсы реабилитации. Последняя госпитализация — 3 месяца назад. Поступает для планового курса.»",
    ].join("\n"),
  },

  // ── Epicrisis Templates ─────────────────────────────────────────
  {
    id: "tpl_epicrisis_discharge",
    label: "Шаблон: состояние при выписке (эпикриз)",
    tags: ["epicrisis", "template", "discharge", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Состояние при выписке»:",
      "Структура: динамика → достигнутые результаты → оставшиеся ограничения.",
      "Пример: «На фоне проведённого лечения отмечается положительная динамика: улучшение координации, снижение мышечного тонуса. Речевая функция с умеренным улучшением. Рекомендован повторный курс через 3 месяца.»",
    ].join("\n"),
  },
  {
    id: "tpl_epicrisis_treatment",
    label: "Шаблон: проведённое лечение (эпикриз)",
    tags: ["epicrisis", "template", "treatment", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Проведённое лечение»:",
      "Структура: перечень процедур с кратностью → медикаментозная терапия → результат.",
      "Пример: «Проведено: ЛФК ×10, массаж ×10, физиотерапия ×8, консультация логопеда ×5, консультация психолога ×3. Медикаментозно: витаминотерапия.»",
    ].join("\n"),
  },
  {
    id: "tpl_epicrisis_recommendations",
    label: "Шаблон: рекомендации при выписке",
    tags: ["epicrisis", "template", "recommendations", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Рекомендации»:",
      "Структура: режим → наблюдение → повторный курс → домашние упражнения.",
      "Пример: «Наблюдение невролога по месту жительства. Продолжить занятия ЛФК дома. Повторный курс реабилитации через 3 месяца. Контроль ЭЭГ через 6 месяцев.»",
    ].join("\n"),
  },

  // ── Diary Templates ─────────────────────────────────────────────
  {
    id: "tpl_diary_objective",
    label: "Шаблон: объективно (дневник)",
    tags: ["diary", "template", "diary_objective", "general"],
    contentType: "form_template",
    content: [
      "Шаблон заполнения поля «Объективно» в дневниковой записи:",
      "Структура: общее состояние → сознание → витальные → осмотр по системам.",
      "Пример: «Состояние удовлетворительное. Сознание ясное. Температура 36.6°C, ЧСС 82, АД 110/70. Кожные покровы чистые. Дыхание везикулярное. Живот мягкий.»",
      "Краткость: дневниковая запись компактнее первичного осмотра.",
    ].join("\n"),
  },

  // ── Diagnosis-Linked Presets ────────────────────────────────────
  {
    id: "preset_g80_cerebral_palsy",
    label: "Пресет: ДЦП (G80)",
    tags: ["g80", "cerebral_palsy", "dcp", "primary_exam", "epicrisis", "preset"],
    contentType: "phrase_preset",
    content: [
      "Диагноз-зависимые фразы для G80 (ДЦП):",
      "Жалобы: задержка моторного развития, нарушение походки, повышенный мышечный тонус, затруднение самообслуживания.",
      "Объективно: спастический тетрапарез / гемипарез, гиперрефлексия, патологические стопные знаки, контрактуры.",
      "Рекомендации: ЛФК, массаж, ботулинотерапия (по показаниям), ортопедические приспособления, повторный курс через 3-6 месяцев.",
    ].join("\n"),
  },
  {
    id: "preset_g93_2_intracranial_hypertension",
    label: "Пресет: доброкачественная внутричерепная гипертензия (G93.2)",
    tags: ["g93.2", "intracranial_hypertension", "primary_exam", "epicrisis", "preset"],
    contentType: "phrase_preset",
    content: [
      "Диагноз-зависимые фразы для G93.2 (доброкачественная внутричерепная гипертензия):",
      "Жалобы: головная боль, тошнота, нарушение зрения, беспокойство.",
      "Объективно: менингеальные симптомы отрицательные, глазное дно — ОДП расширены, отёк дисков.",
      "Лечение: дегидратационная терапия, ноотропы, наблюдение офтальмолога.",
    ].join("\n"),
  },

  // ── Specialty Presets ───────────────────────────────────────────
  {
    id: "preset_lkf_session",
    label: "Пресет: сеанс ЛФК",
    tags: ["lkf", "diary", "preset", "specialty"],
    contentType: "phrase_preset",
    content: [
      "Стандартные фразы для дневника ЛФК:",
      "Выполнено: индивидуальное занятие ЛФК, 40 мин. Упражнения на координацию, растяжку, укрепление мышц конечностей.",
      "Переносимость: хорошая / удовлетворительная / с ограничениями.",
      "Динамика: улучшение объёма движений / стабилизация / без существенной динамики.",
    ].join("\n"),
  },
  {
    id: "preset_massage_session",
    label: "Пресет: сеанс массажа",
    tags: ["massage", "diary", "preset", "specialty"],
    contentType: "phrase_preset",
    content: [
      "Стандартные фразы для дневника массажа:",
      "Выполнено: лечебный массаж воротниковой зоны / спины / конечностей, 30 мин.",
      "Переносимость: хорошая, без побочных реакций.",
      "Динамика: снижение мышечного тонуса / улучшение трофики тканей.",
    ].join("\n"),
  },
  {
    id: "preset_psychologist_session",
    label: "Пресет: консультация психолога",
    tags: ["psychologist", "psychology", "diary", "preset", "specialty"],
    contentType: "phrase_preset",
    content: [
      "Стандартные фразы для дневника психолога:",
      "Выполнено: индивидуальная консультация, 40 мин. Методы: игровая терапия / арт-терапия / когнитивная стимуляция.",
      "Поведение: контактен / ограниченно контактен, эмоциональный фон стабилен / лабилен.",
      "Динамика: улучшение концентрации / расширение коммуникативных навыков.",
    ].join("\n"),
  },
  {
    id: "preset_speech_therapy_session",
    label: "Пресет: занятие логопеда",
    tags: ["speech", "speech_therapy", "logoped", "diary", "preset", "specialty"],
    contentType: "phrase_preset",
    content: [
      "Стандартные фразы для дневника логопеда:",
      "Выполнено: индивидуальное логопедическое занятие, 40 мин. Работа над артикуляцией, фонематическим слухом, связной речью.",
      "Речевой статус: дизартрия / алалия / задержка речевого развития.",
      "Динамика: улучшение артикуляции / расширение словарного запаса / без существенной динамики.",
    ].join("\n"),
  },

  // ── Field Defaults ──────────────────────────────────────────────
  {
    id: "default_cmb_resuscitation_status",
    label: "По умолчанию: состояние (комбобокс)",
    tags: ["diary", "field_default", "cmb_resuscitation_status", "general"],
    contentType: "field_default",
    content: "Удовлетворительное",
  },
];

/**
 * Seed all built-in reusable assets into the knowledge registry.
 *
 * Safe to call multiple times — assets with existing IDs are overwritten.
 * Should be called once at startup (e.g. in background/index.ts).
 */
export function seedReusableAssets(): { registered: number; failed: number } {
  let registered = 0;
  let failed = 0;

  for (const seed of SEED_ASSETS) {
    const result = registerAsset({
      id: seed.id,
      scope: "reusable",
      label: seed.label,
      tags: seed.tags,
      createdAt: SEED_TIMESTAMP,
      contentType: seed.contentType,
      content: seed.content,
    });

    if (result.ok) {
      registered++;
    } else {
      log.warn("seed asset failed", { id: seed.id, error: result.error });
      failed++;
    }
  }

  log.info("reusable assets seeded", { registered, failed, total: SEED_ASSETS.length });
  return { registered, failed };
}
