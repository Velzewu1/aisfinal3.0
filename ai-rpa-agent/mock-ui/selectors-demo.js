// Plain-JS helpers for the mock UI so nav tabs navigate, schedule grid renders,
// and status badges reflect data-status changes from the RPA executor.
//
// This file is part of the mock UI, NOT the extension. The extension's executor
// is still the only layer that mutates the DOM from AI output.

(function () {
  document.querySelectorAll("button[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-nav");
      if (!target) return;
      const map = {
        primary_exam: "primary_exam.html",
        epicrisis: "epicrisis.html",
        schedule: "schedule.html",
      };
      const href = map[target];
      if (href && !location.pathname.endsWith(href)) location.href = href;
    });
  });

  document.querySelectorAll("[data-status-entity]").forEach((el) => {
    const observer = new MutationObserver(() => {
      el.textContent = el.getAttribute("data-status") || "";
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-status"] });
  });

  document.querySelectorAll("[data-schedule-grid]").forEach((el) => {
    el.addEventListener("schedule-injected", (ev) => {
      const payload = ev && "detail" in ev ? ev.detail : null;
      el.setAttribute("data-status", "rendered");
      if (!payload) {
        el.innerHTML = "<em>schedule payload missing</em>";
        return;
      }
      const slots = payload.slots || [];
      const status =
        payload.metadata && typeof payload.metadata.status === "string"
          ? payload.metadata.status
          : "unknown";
      const rows = slots
        .map(
          (s) =>
            `<tr><td>${s.procedureId}</td><td>${s.doctorId}</td><td colspan="2">${s.time}</td></tr>`,
        )
        .join("");
      el.innerHTML = `
        <table>
          <thead><tr><th>procedure</th><th>doctor</th><th colspan="2">time (day:start-end)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p>status: <strong>${status}</strong></p>
      `;
    });
  });
})();
