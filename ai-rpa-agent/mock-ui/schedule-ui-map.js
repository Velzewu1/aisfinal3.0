/**
 * Deterministic UI styling for schedule slots. Keys are **identifiers + placement**, never labels
 * (labels are display-only and not unique).
 *
 * Lookup order (first match wins):
 *   1. SLOT_UI_MAP — composite key: doctorId + procedureId + dayIndex + timeRange
 *   2. DOC_PROC_UI_MAP — doctorId + procedureId
 *   3. PROCEDURE_UI_MAP — exact procedureId only (no substring / “name” matching)
 *
 * `color`: palette token (lfk | massage | ...) or `#rrggbb` for custom fill.
 */
(function (global) {
  "use strict";

  /**
   * @typedef {{ label: string, color: string, borderColor?: string }} ProcedureUiEntry
   */

  /**
   * Composite-key overrides: match doctor + procedure + day + minute range.
   * Key format: `buildCompositeUiKey(...)` → `${doctorId}\u0001${procedureId}\u0001${day}\u0001${start-end|"*"}`
   */
  var SLOT_UI_MAP = /** @type {Record<string, ProcedureUiEntry>} */ ({});

  /**
   * Doctor + procedure (no day/time) — use when slot-specific rows are absent.
   * Key: doctorId + "\u0001" + procedureId
   */
  var DOC_PROC_UI_MAP = /** @type {Record<string, ProcedureUiEntry>} */ ({
    "psychologist\u0001proc_psy": { label: "Консультация: Психолог", color: "psychologist" },
    "lkf_1\u0001proc_lfk": { label: "ЛФК", color: "lfk" },
    "lkf_1\u0001lfk": { label: "Лечебная физкультура", color: "lfk" },
    "massage_1\u0001proc_mass": { label: "Массаж воротниковой зоны", color: "massage" },
    "massage_1\u0001massage": { label: "Массаж лечебный", color: "massage" },
    "speech_therapist\u0001proc_l": { label: "Консультация: Логопед", color: "speech" },
    "speech_1\u0001speech": { label: "Логопедия", color: "speech" },
    "psych_1\u0001psychology": { label: "Консультация психолога", color: "psychologist" },
    "physio_1\u0001physio": { label: "Физиотерапия", color: "default" }
  });

  /**
   * Exact procedureId only (global default when no composite / doc+proc hit).
   */
  var PROCEDURE_UI_MAP = /** @type {Record<string, ProcedureUiEntry>} */ ({
    lfk: { label: "Лечебная физкультура", color: "lfk" },
    massage: { label: "Массаж лечебный", color: "massage" },
    psychology: { label: "Консультация психолога", color: "psychologist" },
    speech: { label: "Логопедия", color: "speech" },
    physio: { label: "Физиотерапия", color: "default" },
    proc_lfk: { label: "ЛФК", color: "lfk" },
    proc_kinezo: { label: "Кинезотерапия", color: "lfk" },
    proc_hydro: { label: "Гидрокинезотерапия", color: "lfk" },
    proc_mass: { label: "Массаж воротниковой зоны", color: "massage" },
    proc_psy: { label: "Консультация: Психолог", color: "psychologist" },
    proc_p: { label: "Психолог", color: "psychologist" },
    proc_l: { label: "Консультация: Логопед", color: "speech" },
    proc_physio: { label: "Физиотерапия", color: "default" },
    proc_rehab: { label: "Реабилитация", color: "default" },
    proc_a: { label: "Осмотр анестезиолога", color: "default" }
  });

  /** @type {Record<string, string>} */
  var DOCTOR_UI_MAP = {
    lkf_1: "Инструктор ЛФК",
    massage_1: "Массажист",
    psych_1: "Психолог",
    speech_1: "Логопед",
    physio_1: "Физиотерапевт",
    psychologist: "Психолог",
    speech_therapist: "Логопед",
    physiotherapist: "Физиотерапевт",
    rehabilitation_physician: "Реабилитолог",
    anesthesiologist: "Анестезиолог",
    attending_physician: "Лечащий врач",
    doc_psy: "Психолог",
    doc_phy: "Физиотерапевт",
    doc_l: "Логопед",
    doc_a: "Анестезиолог"
  };

  var KIND_FALLBACK_PATTERNS = [
    [/(лфк|exercise[_-]?therapy|lfk|kineso|kinezo)/i, "lfk"],
    [/(массаж|massage)/i, "massage"],
    [/(психолог|psycholog|psychologist)/i, "psychologist"],
    [/(логопед|speech|logoped)/i, "speech"]
  ];

  function humanizeId(id) {
    var stripped = String(id).replace(/^(proc|procedure|doc|doctor)[_-]/i, "");
    var spaced = stripped.replace(/[_-]+/g, " ").trim();
    if (spaced.length === 0) return String(id);
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function resolveKindFallback(doctorId, procedureId) {
    var probe = String(doctorId) + " " + String(procedureId);
    for (var i = 0; i < KIND_FALLBACK_PATTERNS.length; i += 1) {
      if (KIND_FALLBACK_PATTERNS[i][0].test(probe)) return KIND_FALLBACK_PATTERNS[i][1];
    }
    return "default";
  }

  function daySegment(dayIndex) {
    if (typeof dayIndex === "number" && isFinite(dayIndex)) return String(dayIndex);
    return "*";
  }

  function timeRangeSegment(startMinute, endMinute) {
    if (
      startMinute != null &&
      endMinute != null &&
      typeof startMinute === "number" &&
      typeof endMinute === "number" &&
      isFinite(startMinute) &&
      isFinite(endMinute)
    ) {
      return String(Math.round(startMinute)) + "-" + String(Math.round(endMinute));
    }
    return "*";
  }

  /**
   * @param {string} doctorId
   * @param {string} procedureId
   * @param {number|undefined|null} dayIndex
   * @param {number|null|undefined} startMinute
   * @param {number|null|undefined} endMinute
   */
  function buildCompositeUiKey(doctorId, procedureId, dayIndex, startMinute, endMinute) {
    return [String(doctorId), String(procedureId), daySegment(dayIndex), timeRangeSegment(startMinute, endMinute)].join(
      "\u0001",
    );
  }

  function canonicalProcedureId(procedureId) {
    return String(procedureId).replace(/_day\d+$/, "");
  }

  function exactProcedureRow(procedureId) {
    var p = String(procedureId);
    var pCanon = canonicalProcedureId(p);
    if (PROCEDURE_UI_MAP[p]) return PROCEDURE_UI_MAP[p];
    if (pCanon !== p && PROCEDURE_UI_MAP[pCanon]) return PROCEDURE_UI_MAP[pCanon];
    var pl = p.toLowerCase();
    for (var pk in PROCEDURE_UI_MAP) {
      if (Object.prototype.hasOwnProperty.call(PROCEDURE_UI_MAP, pk) && pk.toLowerCase() === pl) {
        return PROCEDURE_UI_MAP[pk];
      }
    }
    return null;
  }

  /**
   * @param {string} doctorId
   * @param {string} procedureId
   * @param {number|undefined|null} dayIndex
   * @param {number|null|undefined} startMinute
   * @param {number|null|undefined} endMinute
   */
  function lookupProcedureUiEntry(doctorId, procedureId, dayIndex, startMinute, endMinute) {
    var d = String(doctorId);
    var p = String(procedureId);
    var dayS = daySegment(dayIndex);
    var timeS = timeRangeSegment(startMinute, endMinute);

    var slotKeys = [
      [d, p, dayS, timeS].join("\u0001"),
      [d, p, dayS, "*"].join("\u0001"),
      [d, p, "*", "*"].join("\u0001")
    ];

    for (var i = 0; i < slotKeys.length; i += 1) {
      if (SLOT_UI_MAP[slotKeys[i]]) return SLOT_UI_MAP[slotKeys[i]];
    }

    var dp = d + "\u0001" + p;
    if (DOC_PROC_UI_MAP[dp]) return DOC_PROC_UI_MAP[dp];
    var pCanon = canonicalProcedureId(p);
    var dpCanon = d + "\u0001" + pCanon;
    if (pCanon !== p && DOC_PROC_UI_MAP[dpCanon]) return DOC_PROC_UI_MAP[dpCanon];

    return exactProcedureRow(p);
  }

  var PALETTE = /^(lfk|massage|psychologist|speech|default)$/;

  /**
   * @param {string} procedureId
   * @param {string} doctorId
   * @param {{ dayIndex?: number|null, startMinute?: number|null, endMinute?: number|null }} [ctx]
   */
  function resolveProcedureUi(procedureId, doctorId, ctx) {
    ctx = ctx || {};
    var row = lookupProcedureUiEntry(doctorId, procedureId, ctx.dayIndex, ctx.startMinute, ctx.endMinute);
    var label = row && row.label ? row.label : humanizeId(procedureId);
    var colorSpec = row && row.color ? row.color : null;

    if (colorSpec && colorSpec.charAt(0) === "#") {
      return {
        label: label,
        dataSlotKind: "custom",
        inline: {
          background: colorSpec,
          border: row && row.borderColor ? row.borderColor : "rgba(107, 115, 148, 0.85)"
        }
      };
    }
    if (colorSpec && PALETTE.test(colorSpec)) {
      return { label: label, dataSlotKind: colorSpec, inline: null };
    }
    return {
      label: label,
      dataSlotKind: resolveKindFallback(doctorId, procedureId),
      inline: null
    };
  }

  function resolveDoctorLabel(doctorId) {
    var id = String(doctorId);
    if (DOCTOR_UI_MAP[id]) return DOCTOR_UI_MAP[id];
    var lower = id.toLowerCase();
    for (var k in DOCTOR_UI_MAP) {
      if (Object.prototype.hasOwnProperty.call(DOCTOR_UI_MAP, k) && k.toLowerCase() === lower) {
        return DOCTOR_UI_MAP[k];
      }
    }
    return humanizeId(doctorId);
  }

  global.__SCHEDULE_UI_MAPS__ = {
    slotMap: SLOT_UI_MAP,
    docProcMap: DOC_PROC_UI_MAP,
    procedureMap: PROCEDURE_UI_MAP,
    doctorMap: DOCTOR_UI_MAP,
    resolveProcedureUi: resolveProcedureUi,
    resolveDoctorLabel: resolveDoctorLabel,
    buildCompositeUiKey: buildCompositeUiKey
  };
})(typeof window !== "undefined" ? window : globalThis);
