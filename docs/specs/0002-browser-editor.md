---
status: implemented
---

> 編輯器的預設範例已隨語言切片更新。最新文法定義在 [0003-control-flow-and-semantic-analysis.md](0003-control-flow-and-semantic-analysis.md)。

# Spec: browser editor

## Objective

Turn `main.html` into a browser-based JumpJet editor. A user can edit JavaScript, compile and run it through JumpJet, inspect diagnostics and bytecode, keep a local draft, import a `.js` file, and download the current document as `.js`.

The browser must use the compiler in `src/`. It must not execute editor text with `eval`, `Function`, or a script element.

## Approved scope

- One open document with a filename and source text
- A native textarea editor with Tab insertion and Ctrl or Command plus Enter to run
- Explicit save plus automatic draft saving in `localStorage`
- Import from a local `.js` file up to 1 MB
- Download the current document as a `.js` file
- Result, diagnostics, and bytecode output panels
- Responsive layout for desktop and narrow screens
- No backend, accounts, third-party editor, or deployment

## Architecture

### Usage

```text
open page
-> restore local draft or show example
-> edit source
-> compile and run
-> inspect result, diagnostics, and bytecode
-> save locally or download as .js
```

### Ownership

- `src/` remains the compiler and VM. It has no browser dependencies.
- `web/document.js` owns draft validation, filename normalization, file limits, and the storage adapter.
- `web/app.js` owns DOM events and translates editor actions into compiler calls.
- `main.html` owns accessible page structure.
- `web/styles.css` owns presentation and responsive layout.

The web layer depends on `src/index.js`. Compiler modules never import from `web/`.

### Document model

```js
{
    name: "main.js",
    source: "let answer = 1 + 2 * 3; answer;"
}
```

The storage adapter accepts a browser-compatible `Storage` object. It returns `null` for missing or malformed saved data. Imported content stays plain text.

### Failure paths

- Storage failures keep the editor usable and show a short status message.
- Files without a `.js` suffix are rejected.
- Files larger than 1 MB are rejected before reading.
- Compiler diagnostics appear as text with stage and source span.
- Runtime and bytecode validation errors appear as text without HTML injection.

## Alternatives considered

### Monaco or CodeMirror

These editors add syntax highlighting and richer editing, but they add dependencies and bundling before the workflow is proven. The first version uses a textarea. A later spec can replace only the editor adapter.

### File System Access API

This API can overwrite a selected local file, but browser support is uneven and every file handle needs user permission. The first version combines local draft storage, import, and download.

### Server persistence

A server would support accounts and cross-device documents. It also adds authentication, storage, and deployment concerns. Those are outside this version.

## Tech stack

- Browser ECMAScript modules
- Existing JumpJet compiler modules
- HTML and CSS without a UI framework
- Node built-in tests for document logic
- Playwright CLI for browser verification

## Commands

```sh
npm test
npm run check
npm run dev
```

`npm run dev` serves the repository at `http://127.0.0.1:8000/main.html`.

## Project structure

```text
main.html
web/
  app.js
  document.js
  styles.css
src/
  compiler and VM modules
tests/
  web-document.test.js
```

## Code style

Browser code uses named functions for user actions and reads or writes DOM text through `textContent` or form element values.

```js
function showResult(value) {
    resultOutput.textContent = String(value);
}
```

## Testing strategy

- Unit tests cover draft round trips, malformed storage, filenames, and import limits.
- Existing compiler and VM tests remain unchanged.
- Browser verification covers initial load, compile and run, diagnostics, draft restore, and import.
- A screenshot confirms the desktop layout.

## Boundaries

Always:

- Treat imported files and editor text as untrusted plain text.
- Use the existing `compile` and `run` API.
- Keep the editor usable when storage is unavailable.
- Preserve source text exactly through save and import.

Ask first:

- Add dependencies, a backend, accounts, or direct file-system writes.
- Replace the textarea with a third-party editor.
- Publish the site.

Never:

- Execute editor text with `eval`, `Function`, inline scripts, or script injection.
- Render imported text or diagnostics through `innerHTML`.
- Send source text over the network.

## Tasks

- [x] Implement and test the document and storage rules.
  - Acceptance: valid documents round-trip; malformed data and unsafe files are rejected.
  - Verify: `node --test tests/web-document.test.js`.
  - Files: `web/document.js`, `tests/web-document.test.js`.

- [x] Build the editor page and controller.
  - Acceptance: edit, run, save, import, and download controls are wired to their owners.
  - Verify: `npm run check` and browser snapshot.
  - Files: `main.html`, `web/app.js`, `web/styles.css`, `package.json`.

- [x] Verify the real browser flows.
  - Acceptance: results and diagnostics are visible, drafts survive reload, and imported source replaces the editor text.
  - Verify: Playwright CLI session and screenshot.
  - Files: browser artifacts under `output/playwright/` only.

- [x] Update user documentation.
  - Acceptance: README explains how to start and use the editor.
  - Verify: run every documented command.
  - Files: `README.md`, this spec.

## Success criteria

1. Opening `main.html` through the local server shows the editor with a valid example.
2. Running the example displays `7` and its bytecode without native JavaScript evaluation.
3. Invalid source displays compiler diagnostics with source positions.
4. Save and automatic save survive a page reload.
5. Import accepts a `.js` file up to 1 MB and rejects other files.
6. Download produces a sanitized `.js` filename and the exact editor source.
7. The page has no dependency on jQuery or an external CDN.
8. Existing compiler tests still pass.

## Open questions

None for this version. The user approved browser-local drafts, `.js` import, and `.js` download.

## Verification record

- Unit and integration tests pass with `npm test`.
- Syntax checks pass with `npm run check`.
- A real browser compiled `let price = 20; let quantity = 3; price * quantity;` to a result of `60`.
- A real browser reported a positioned parser diagnostic for `let = 1;`.
- Draft content survived reload.
- Importing `jumpjet-import.js` produced `40`, and downloading produced the same filename.
- The browser console contained no errors or warnings after load.
- Desktop and 390-pixel-wide layouts were inspected from screenshots in `output/playwright/`.
