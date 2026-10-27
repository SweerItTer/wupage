const STYLE_ID = "wupage-translation-style";

export function injectContentStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .wupage-translation {
      box-sizing: border-box;
      max-width: 100%;
      overflow-wrap: break-word;
      word-break: break-word;
      pointer-events: none;
    }

    .wupage-translation[data-wupage-mode="block"] {
      display: block;
      margin: 0.18em 0 0.38em;
      color: inherit;
      font-size: 0.95em;
      line-height: 1.55;
    }

    .wupage-translation[data-wupage-mode="block"][data-wupage-container="heading"] {
      display: inline;
      margin: 0 0 0 0.35em;
      color: inherit;
      font-size: 1rem;
      font-weight: 400;
      line-height: 1.45;
    }

    .wupage-translation[data-wupage-mode="inline"] {
      display: inline;
      margin-left: 0.35em;
      color: inherit;
      font-size: 0.92em;
      line-height: inherit;
    }

    .wupage-translation[data-wupage-mode="code-comment"] {
      display: block;
      margin: 0;
      color: inherit;
      font: inherit;
      line-height: inherit;
      white-space: pre-wrap;
    }

    .wupage-translation[data-wupage-preserve-whitespace="true"] {
      white-space: pre-wrap;
    }

    .wupage-translation[data-wupage-container="youtube-description"] {
      display: inline;
      margin: 0;
      white-space: pre-wrap;
    }

    .wupage-translation[data-wupage-container="youtube-description"]:not([data-wupage-display-mode="replace"])::before {
      content: "\\A";
      white-space: pre;
    }

    .wupage-translation[data-wupage-display-mode="replace"] {
      display: inline;
      margin: 0;
      color: inherit;
      font: inherit;
      line-height: inherit;
    }

    /* GitHub lays out code and line numbers in separate fixed-height rows.
       Keep comment translations on the source row, including pending states,
       so neither virtualized code nor the gutter needs to be resized. */
    :is(.react-code-text, .blob-code) .wupage-translation[data-wupage-mode="code-comment"] {
      display: inline;
      margin: 0 0 0 0.75em;
      white-space: nowrap;
    }

    :is(.react-code-text, .blob-code) .wupage-translation[data-wupage-mode="code-comment"][data-wupage-display-mode="replace"] {
      margin: 0;
    }

    .wupage-replaced-source {
      display: none !important;
    }

    /* Keep host-managed text measurable while its replacement determines the
       wrapper's height. The source must not stretch to the translation row. */
    .wupage-stable-replacement {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) !important;
      align-items: start !important;
    }

    .wupage-stable-replacement > .wupage-stable-source {
      grid-area: 1 / 1 !important;
      align-self: start !important;
      min-width: 0 !important;
      visibility: hidden !important;
    }

    .wupage-stable-replacement > .wupage-translation[data-wupage-container="stable-replacement"] {
      grid-area: 1 / 1;
      align-self: start;
      min-width: 0;
      display: block;
      margin: 0;
      visibility: visible;
    }

    .wupage-translation[data-wupage-container="authored-lines"] {
      position: static;
      display: block;
      float: none;
      width: auto;
      min-width: 0;
      height: auto;
      transform: none;
      letter-spacing: inherit;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .wupage-translation[data-wupage-container="image-text"] {
      display: block;
      margin: 0.6em 0;
      padding: 0;
      border-radius: 0;
      color: inherit;
      background: transparent;
      font-size: 0.95em;
      line-height: 1.55;
      text-align: start;
      white-space: pre-wrap;
    }

    .wupage-translation[data-wupage-image-layout="interleaved"] {
      container-type: inline-size;
      margin: 0;
      padding: 0;
      border-radius: 0;
      background: transparent;
      text-align: center;
      white-space: normal;
      pointer-events: auto;
    }

    .wupage-image-text-row {
      display: block;
      margin: 0 0 1.4em;
      font-size: var(--wupage-image-font-size);
    }

    .wupage-image-text-original {
      position: relative;
      display: block;
      width: 100%;
      overflow: hidden;
    }

    .wupage-image-text-original > img {
      position: absolute;
      top: 0;
      left: 0;
      display: block;
      width: 100%;
      max-width: none;
      height: auto;
      margin: 0;
      padding: 0;
      border: 0;
      transform-origin: top left;
    }

    .wupage-image-text-result {
      display: block;
      margin: 0.3em 0 0;
      font-size: 0.95em;
      font-weight: 600;
      line-height: 1.75;
      white-space: pre-wrap;
    }

    .wupage-translation-pending {
      min-width: 1.25em;
      min-height: 1.25em;
    }

    .wupage-translation-pending > span {
      display: inline-block;
      width: 0.9em;
      height: 0.9em;
      box-sizing: border-box;
      border: 2px solid rgba(15, 118, 110, 0.22);
      border-top-color: #0f766e;
      border-radius: 999px;
      vertical-align: -0.12em;
      animation: wupage-spin 780ms linear infinite;
    }

    .wupage-translation-pending[data-wupage-mode="block"] > span,
    .wupage-translation-pending[data-wupage-mode="code-comment"] > span {
      margin: 0.2em 0;
    }

    :is(.react-code-text, .blob-code) .wupage-translation-pending[data-wupage-mode="code-comment"] > span {
      margin: 0;
    }

    @keyframes wupage-spin {
      to {
        transform: rotate(360deg);
      }
    }

    #wupage-floating-hitbox {
      all: initial;
      position: fixed !important;
      left: auto !important;
      top: auto !important;
      right: 22px !important;
      bottom: 88px !important;
      z-index: 2147483647 !important;
      box-sizing: border-box !important;
      width: 74px !important;
      height: 74px !important;
      margin: 0 !important;
      padding: 0 !important;
      display: grid !important;
      place-items: center !important;
      transform: none !important;
      pointer-events: auto !important;
    }

    #wupage-floating-hitbox[hidden] {
      display: none !important;
    }

    #wupage-floating-hitbox:has(.is-menu-open) {
      pointer-events: none !important;
    }

    #wupage-floating-ball {
      all: initial;
      position: relative;
      box-sizing: border-box;
      width: 42px;
      height: 42px;
      min-width: 0;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 999px;
      display: grid;
      place-items: center;
      color: #ffffff;
      background: #116466;
      box-shadow: 0 8px 24px rgba(15, 35, 38, 0.22);
      appearance: none;
      cursor: pointer;
      pointer-events: auto;
      overflow: visible;
      text-align: center;
      text-decoration: none;
      text-indent: 0;
      text-transform: none;
      user-select: none;
      white-space: nowrap;
      touch-action: none;
      transition: transform 160ms ease, background 160ms ease, opacity 160ms ease;
    }

    #wupage-floating-ball > .wupage-floating-label {
      all: initial;
      display: block;
      color: #ffffff;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      font-size: 16px;
      font-style: normal !important;
      font-synthesis: none;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
      text-align: center;
      text-decoration: none;
      text-indent: 0;
      text-transform: none;
      transform: none !important;
      writing-mode: horizontal-tb;
    }

    #wupage-floating-ball:hover {
      background: #0f5557;
    }

    #wupage-floating-ball:focus-visible {
      outline: 3px solid #69b8ac;
      outline-offset: 3px;
    }

    #wupage-floating-ball.is-loading {
      box-shadow: 0 0 0 3px rgba(17, 100, 102, 0.2), 0 8px 24px rgba(15, 35, 38, 0.22);
    }

    #wupage-floating-ball.is-dragging {
      transition: none;
      cursor: grabbing;
      opacity: 0.92;
      transform: none;
    }

    #wupage-floating-ball[data-edge="left"]:not(.is-dragging) {
      transform: translateX(0);
    }

    #wupage-floating-ball[data-edge="right"]:not(.is-dragging) {
      transform: translateX(0);
    }

    #wupage-floating-hitbox:has(#wupage-floating-ball[data-edge="left"]):hover #wupage-floating-ball,
    #wupage-floating-ball[data-edge="left"].is-menu-open {
      transform: translateX(20px);
    }

    #wupage-floating-hitbox:has(#wupage-floating-ball[data-edge="right"]):hover #wupage-floating-ball,
    #wupage-floating-ball[data-edge="right"].is-menu-open {
      transform: translateX(-20px);
    }

    #wupage-floating-menu {
      all: initial;
      position: fixed !important;
      z-index: 2147483647;
      display: block;
      box-sizing: border-box;
      width: 296px;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 10px;
      border: 1px solid rgba(31, 42, 46, 0.12);
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 12px 30px rgba(15, 35, 38, 0.2);
      font: 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #172026;
      direction: ltr;
      text-align: left;
      font-synthesis: none;
      isolation: isolate;
    }

    #wupage-floating-menu *,
    #wupage-floating-menu *::before,
    #wupage-floating-menu *::after {
      box-sizing: border-box;
    }

    #wupage-floating-menu[hidden],
    #wupage-floating-menu [hidden] {
      display: none !important;
    }

    #wupage-floating-menu button {
      all: initial;
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 32px;
      border: 0;
      border-radius: 6px;
      padding: 0 10px;
      color: #172026;
      background: transparent;
      text-align: left;
      font: inherit;
      text-shadow: none;
      appearance: none;
      white-space: nowrap;
      cursor: pointer;
    }

    #wupage-floating-menu button:hover {
      background: #e8f1ef;
    }

    #wupage-floating-menu button:focus-visible {
      outline: 2px solid #69b8ac;
      outline-offset: 2px;
    }

    #wupage-floating-menu button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    #wupage-floating-menu button[aria-pressed="true"] {
      color: #0f5557;
      background: #d9efea;
      font-weight: 700;
    }

    #wupage-floating-menu button[data-action="page-toggle"] {
      display: flex;
      align-items: center;
      justify-content: center;
      width: calc(100% - 8px);
      min-height: 40px;
      margin: 4px;
      border: 1px solid #116466;
      color: #ffffff;
      background: #116466;
      text-align: center;
      font-weight: 700;
    }

    #wupage-floating-menu button[data-action="page-toggle"]:hover {
      border-color: #0f5557;
      background: #0f5557;
    }

    #wupage-floating-menu button[data-action="page-toggle"]:focus-visible {
      outline: 2px solid rgba(17, 100, 102, 0.34);
      outline-offset: 2px;
    }

    #wupage-floating-menu .wupage-menu-section {
      padding: 4px;
    }

    #wupage-floating-menu .wupage-menu-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 4px 8px;
    }

    #wupage-floating-menu .wupage-menu-header strong {
      font: 700 15px/1.4 system-ui, sans-serif;
      color: #116466;
    }

    #wupage-floating-menu .wupage-menu-header button,
    #wupage-floating-menu .wupage-menu-footer button,
    #wupage-floating-menu button[data-action="retranslate"] {
      width: auto;
      flex: 0 0 auto;
      min-height: 28px;
      padding: 0 6px;
      color: #116466;
      font-size: 12px;
    }

    #wupage-floating-menu .wupage-field-label {
      display: block;
      margin: 0 0 6px;
      color: #647379;
      font: 12px/1.4 system-ui, sans-serif;
      text-align: left;
    }

    #wupage-floating-menu .wupage-menu-field {
      all: initial;
      display: block;
      margin: 4px;
      padding: 4px 0;
      font: inherit;
    }

    #wupage-floating-menu .wupage-provider-select {
      all: initial;
      position: relative !important;
      inset: auto !important;
      display: block;
      width: 100%;
      height: 36px;
      margin: 0 !important;
      padding: 0 !important;
      font: inherit;
    }

    #wupage-floating-menu select[data-role="provider"] {
      all: initial;
      display: block;
      box-sizing: border-box;
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
      height: 36px !important;
      margin: 0 !important;
      padding: 0 28px !important;
      border: 1px solid #d5dfdc;
      border-radius: 8px;
      color: transparent !important;
      background: #f5f8f7;
      font: inherit;
      appearance: none !important;
      box-shadow: none !important;
      transform: none !important;
      cursor: pointer;
    }

    #wupage-floating-menu select[data-role="provider"] option {
      color: #26343a;
      background: #ffffff;
    }

    #wupage-floating-menu select[data-role="provider"]:focus-visible {
      outline: 2px solid #69b8ac;
      outline-offset: 2px;
    }

    #wupage-floating-menu .wupage-display-modes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 3px;
      padding: 3px;
      border-radius: 8px;
      background: #eef2f1;
    }

    #wupage-floating-menu .wupage-display-modes button {
      min-width: 0;
      padding: 0 3px;
      text-align: center;
      font-size: 12px;
    }

    #wupage-floating-menu .wupage-display-modes button[aria-pressed="true"] {
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(15, 35, 38, 0.1);
    }

    #wupage-floating-menu .wupage-translation-feedback {
      padding: 4px 8px 6px;
    }

    #wupage-floating-menu [data-role="translation-status"],
    #wupage-floating-menu .wupage-menu-hint {
      margin: 0;
      color: #647379;
      font: 12px/1.6 system-ui, sans-serif;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    #wupage-floating-menu [data-role="translation-status"][data-tone="error"] {
      color: #b13e36;
    }

    #wupage-floating-menu .wupage-menu-hint {
      padding: 2px 10px 4px;
    }

    #wupage-floating-menu .wupage-menu-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      padding: 0 4px;
      color: #647379;
      font-size: 11px;
    }

    #wupage-floating-menu .wupage-language-pair {
      all: initial;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);
      align-items: center;
      width: 100%;
      min-width: 0;
      margin: 0;
      padding: 0;
      gap: 0;
      box-sizing: border-box;
      direction: ltr;
      font: 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #wupage-floating-menu .wupage-language-select {
      all: initial;
      position: relative;
      display: block;
      box-sizing: border-box;
      float: none !important;
      width: auto !important;
      min-width: 0 !important;
      height: 40px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      transform: none !important;
    }

    #wupage-floating-menu .wupage-language-select select {
      all: initial;
      display: block;
      position: static !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: none !important;
      height: 40px !important;
      box-sizing: border-box;
      margin: 0 !important;
      appearance: none !important;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 0 24px 0 10px !important;
      color: transparent !important;
      background: #eef2f1;
      font: 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      letter-spacing: normal !important;
      text-align: left !important;
      text-indent: 0 !important;
      text-transform: none !important;
      transform: none !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      box-shadow: none !important;
      text-shadow: none !important;
      vertical-align: middle !important;
      cursor: pointer;
    }

    #wupage-floating-menu .wupage-language-select select option {
      color: #26343a !important;
      background: #ffffff !important;
      font: 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    }

    #wupage-floating-menu .wupage-language-value,
    #wupage-floating-menu .wupage-provider-value {
      all: initial;
      position: absolute !important;
      z-index: 1;
      inset: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 24px 0 8px !important;
      overflow: hidden !important;
      color: #26343a;
      font: 500 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      letter-spacing: normal !important;
      text-align: center !important;
      text-overflow: ellipsis !important;
      text-transform: none !important;
      text-shadow: none !important;
      white-space: nowrap !important;
      pointer-events: none;
      transform: none !important;
    }

    #wupage-floating-menu .wupage-provider-value {
      padding: 0 28px !important;
    }

    #wupage-floating-menu .wupage-language-select select:hover,
    #wupage-floating-menu .wupage-language-select select:focus-visible {
      border-color: #aebbb7;
      background: #ffffff;
    }

    #wupage-floating-menu .wupage-language-chevron {
      all: initial;
      position: absolute !important;
      z-index: 2;
      pointer-events: none;
      right: 10px !important;
      top: 50% !important;
      width: 5px !important;
      height: 5px !important;
      margin: 0 !important;
      padding: 0 !important;
      border-right: 2px solid #7d898e;
      border-bottom: 2px solid #7d898e;
      box-sizing: content-box;
      transform: translateY(-65%) rotate(45deg) !important;
    }

    #wupage-floating-menu .wupage-language-direction {
      all: initial;
      position: static !important;
      width: 24px !important;
      height: 40px !important;
      display: grid !important;
      place-items: center !important;
      align-self: center !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #116466;
      font: 17px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      text-align: center !important;
      transform: none !important;
    }

    #wupage-floating-menu .wupage-language-direction svg {
      all: initial;
      display: block !important;
      width: 24px !important;
      height: 24px !important;
      margin: 0 !important;
      padding: 0 !important;
      color: inherit;
      overflow: visible;
    }

    #wupage-floating-menu .wupage-visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      clip-path: inset(50%);
    }

    #wupage-floating-menu .wupage-menu-divider {
      height: 1px;
      margin: 6px 4px;
      background: rgba(31, 42, 46, 0.1);
    }

    #wupage-floating-menu .wupage-switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    #wupage-floating-menu .wupage-switch {
      position: relative;
      flex: 0 0 auto;
      width: 32px;
      height: 24px;
      border-radius: 8px;
      background: #d5dde0;
      transition: background 160ms ease;
    }

    #wupage-floating-menu .wupage-switch span {
      position: absolute;
      left: 3px;
      top: 3px;
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(15, 35, 38, 0.24);
      transition: transform 160ms ease;
    }

    #wupage-floating-menu .wupage-switch-row[aria-pressed="true"] .wupage-switch {
      background: #116466;
    }

    #wupage-floating-menu .wupage-switch-row[aria-pressed="true"] .wupage-switch span {
      transform: translateX(8px);
    }

    .wupage-paragraph-active {
      outline: 1px dashed rgba(17, 100, 102, 0.45);
      outline-offset: 3px;
    }

    #wupage-paragraph-highlight {
      position: fixed;
      z-index: 2147483646;
      box-sizing: border-box;
      border: 1px dashed rgba(17, 100, 102, 0.68);
      border-radius: 4px;
      pointer-events: none;
      background: rgba(17, 100, 102, 0.035);
    }

    #wupage-paragraph-highlight[hidden] {
      display: none;
    }

    #wupage-debug-panel {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 36px));
      height: min(420px, calc(100vh - 36px));
      min-width: min(280px, calc(100vw - 16px));
      min-height: min(200px, calc(100vh - 16px));
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
      box-sizing: border-box;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      border: 1px solid rgba(31, 42, 46, 0.14);
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 35, 38, 0.24);
      color: #172026;
      font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #wupage-debug-panel[hidden] {
      display: none;
    }

    #wupage-debug-panel header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(31, 42, 46, 0.1);
      background: #f7faf9;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    #wupage-debug-panel.is-dragging header {
      cursor: grabbing;
    }

    #wupage-debug-panel header strong {
      font-size: 13px;
    }

    #wupage-debug-panel header button {
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: 6px;
      color: #405057;
      background: transparent;
      font: 18px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }

    #wupage-debug-panel header button:hover {
      background: #e8f1ef;
    }

    #wupage-debug-panel .wupage-debug-summary {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(31, 42, 46, 0.08);
      color: #52636a;
    }

    #wupage-debug-panel .wupage-debug-list {
      min-height: 80px;
      overflow: auto;
      padding: 8px;
    }

    #wupage-debug-panel .wupage-debug-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 22px;
      height: 22px;
      cursor: nwse-resize;
      touch-action: none;
    }

    #wupage-debug-panel .wupage-debug-resize::before,
    #wupage-debug-panel .wupage-debug-resize::after {
      content: "";
      position: absolute;
      right: 4px;
      bottom: 4px;
      border-right: 2px solid #87959a;
      border-bottom: 2px solid #87959a;
    }

    #wupage-debug-panel .wupage-debug-resize::before {
      width: 10px;
      height: 10px;
    }

    #wupage-debug-panel .wupage-debug-resize::after {
      width: 5px;
      height: 5px;
    }

    #wupage-debug-panel.is-resizing {
      user-select: none;
    }

    #wupage-debug-panel .wupage-debug-empty {
      padding: 18px 8px;
      color: #7a8a91;
      text-align: center;
    }

    #wupage-debug-panel .wupage-debug-task {
      display: grid;
      gap: 4px;
      padding: 8px;
      border: 1px solid rgba(31, 42, 46, 0.1);
      border-left: 3px solid #9aa8ad;
      border-radius: 7px;
      background: #ffffff;
    }

    #wupage-debug-panel .wupage-debug-task + .wupage-debug-task {
      margin-top: 7px;
    }

    #wupage-debug-panel .wupage-debug-task[data-status="running"],
    #wupage-debug-panel .wupage-debug-task[data-status="waiting"] {
      border-left-color: #116466;
      background: #f4fbf9;
    }

    #wupage-debug-panel .wupage-debug-task[data-status="failed"] {
      border-left-color: #b42318;
      background: #fff8f7;
    }

    #wupage-debug-panel .wupage-debug-task-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      list-style: none;
    }

    #wupage-debug-panel .wupage-debug-task-title::-webkit-details-marker {
      display: none;
    }

    #wupage-debug-panel .wupage-debug-task-title strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }

    #wupage-debug-panel .wupage-debug-task-title span {
      flex: 0 0 auto;
      color: #0f5557;
      font-weight: 700;
    }

    #wupage-debug-panel .wupage-debug-task-meta {
      color: #5f6f75;
    }

    #wupage-debug-panel .wupage-debug-task-error {
      max-height: 58px;
      overflow: auto;
      color: #b42318;
      word-break: break-word;
    }

    #wupage-debug-panel .wupage-debug-task-detail {
      display: none;
      gap: 8px;
      margin-top: 6px;
      padding-top: 7px;
      border-top: 1px solid rgba(31, 42, 46, 0.08);
    }

    #wupage-debug-panel .wupage-debug-task[open] .wupage-debug-task-detail {
      display: grid;
    }

    #wupage-debug-panel .wupage-debug-text-block {
      display: grid;
      gap: 5px;
    }

    #wupage-debug-panel .wupage-debug-text-block h4 {
      margin: 0;
      color: #405057;
      font-size: 12px;
      line-height: 1.3;
    }

    #wupage-debug-panel .wupage-debug-text-block p,
    #wupage-debug-panel .wupage-debug-text-block pre {
      margin: 0;
      padding: 6px;
      border-radius: 6px;
      background: rgba(31, 42, 46, 0.05);
      color: #172026;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

  `;
  document.documentElement.append(style);
}
