"use strict";

(function markRequiredFields() {
  function findFieldLabel(field) {
    if (field.labels?.length) return field.labels[0];
    return (
      field.closest("label") ||
      field.closest(".field, .field-group")?.querySelector("label") ||
      null
    );
  }

  function applyRequiredMarkers(root = document) {
    const fields = [];
    if (root.matches?.("input[required], select[required], textarea[required]")) {
      fields.push(root);
    }
    fields.push(
      ...root.querySelectorAll?.(
        "input[required], select[required], textarea[required]",
      ) || [],
    );

    fields.forEach((field) => {
      field.setAttribute("aria-required", "true");
      findFieldLabel(field)?.classList.add("required-field-label");
    });
  }

  function initialize() {
    applyRequiredMarkers();
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          applyRequiredMarkers(mutation.target);
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) applyRequiredMarkers(node);
        });
      });
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ["required"],
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
