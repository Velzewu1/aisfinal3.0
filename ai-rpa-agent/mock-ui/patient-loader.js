/**
 * Patient bootstrap for the mock-ui patient-scoped pages.
 *
 * Reads `?patient=ID` from the URL and hydrates every element marked with
 * `data-patient-display-*` plus any identity `data-field` inputs.
 *
 * Must be loaded BEFORE DOMContentLoaded runs write operations; a snapshot
 * is exposed as `window.__CURRENT_PATIENT__` for `controller/context.ts`
 * to read synchronously. This script does NOT perform navigation and does
 * NOT touch non-approved attributes.
 */
(function () {
  "use strict";

  var PATIENTS = {
    "MOCK-PED-INPT-001": {
      name: "Иванова Мария Алексеевна",
      shortName: "Иванова М.А.",
      dob: "2018-03-15",
      diagnosis: "(G93.2) Доброкачественная внутричерепная гипертензия",
      bed: "12",
      doctor: "Сейткали А.Б."
    },
    "MOCK-PED-INPT-DIARY-001": {
      name: "Петрова Елена Сергеевна",
      shortName: "Петрова Е.С.",
      dob: "2019-07-22",
      diagnosis: "(G93.2) Доброкачественная внутричерепная гипертензия",
      bed: "07",
      doctor: "Нурланова Г.К."
    },
    "MOCK-OUTPAT-SERVICE-001": {
      name: "Сидоров Игорь Павлович",
      shortName: "Сидоров И.П.",
      dob: "2017-11-03",
      diagnosis: "(A02.005.000) Консультация: Психолог",
      bed: "Амб.",
      doctor: "Ахметова Д.Р."
    },
    "MOCK-GER-INPT-002": {
      name: "Ким Валентин Дмитриевич",
      shortName: "Ким В.Д.",
      dob: "2015-05-18",
      diagnosis: "(Z86.6) В личном анамнезе болезни нервной системы",
      bed: "03",
      doctor: "Байжанов С.Т."
    },
    "MOCK-CARD-OUT-004": {
      name: "Алимов Рустем Кайратович",
      shortName: "Алимов Р.К.",
      dob: "2016-09-27",
      diagnosis: "(G93.2) Доброкачественная внутричерепная гипертензия",
      bed: "Амб.",
      doctor: "Сейткали А.Б."
    },
    "MOCK-NEURO-FU-005": {
      name: "Омарова Ляззат Нурлановна",
      shortName: "Омарова Л.Н.",
      dob: "2016-09-27",
      diagnosis: "(G93.2) Доброкачественная внутричерепная гипертензия",
      bed: "15",
      doctor: "Нурланова Г.К."
    }
  };

  var params = new URLSearchParams(window.location.search);
  var patientId = params.get("patient") || "MOCK-PED-INPT-001";
  var patient = PATIENTS[patientId] || PATIENTS["MOCK-PED-INPT-001"];

  window.__PATIENTS__ = PATIENTS;
  window.__CURRENT_PATIENT__ = Object.assign({ id: patientId }, patient);
  
  // Bridge for content script (MV3 isolated world cannot read window properties)
  document.documentElement.dataset.patientId = patientId;
  document.documentElement.dataset.patientName = patient.shortName || patient.name;

  function setText(selector, text) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = text;
    }
  }

  function setValue(selector, value) {
    var el = document.querySelector(selector);
    if (el && "value" in el) {
      el.value = value;
    }
  }

  function hydrate() {
    setText("[data-patient-display-name]", patient.shortName);
    setText("[data-patient-display-full-name]", patient.name);
    setText("[data-patient-display-diagnosis]", patient.diagnosis);
    setText("[data-patient-display-bed]", "Койка: " + patient.bed);
    setText("[data-patient-display-doctor]", "Врач: " + patient.doctor);

    var baseTitle = document.title || "";
    document.title = baseTitle.replace(/\s—.*$/, "") + " — " + patient.shortName;

    setValue('[data-field="patient_id"]', patientId);
    setValue('[data-field="patient_name"]', patient.name);
    setValue('[data-field="patient_dob"]', patient.dob);

    if (window && window.console) {
      console.log("[mock] loaded patient:", patientId, patient.shortName);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate);
  } else {
    hydrate();
  }
})();
