// Desktop bridge — injected into the page by the Tauri shell before any app script runs.
//
// Design rule: app/template.html contains NO Tauri code. The web app is the product and
// must keep working in a plain browser, so everything desktop-only lives here and is
// layered on top once the app has booted. If anything below is missing or throws, the
// browser behaviour it replaced is left exactly as it was.
(() => {
  'use strict';

  const T = window.__TAURI__;
  if (!T || !T.core || typeof T.core.invoke !== 'function') return;   // plain browser: do nothing

  const invoke = T.core.invoke;
  const listen = T.event && T.event.listen;

  const log = (...a) => console.log('[desktop]', ...a);
  const say = msg => { try { window.toast ? window.toast(msg) : log(msg); } catch { log(msg); } };

  /** Read a binding the app declared with const/let: those are not on window. */
  const G = name => { try { return window.eval(name); } catch { return undefined; } };

  /** Wait until the app has finished booting (its globals exist). */
  function whenReady(fn) {
    let tries = 0;
    const poll = () => {
      const ready = typeof window.openMcu === 'function' && G('MCU_FILES') && G('M');
      if (ready) { try { fn(); } catch (e) { console.error('[desktop] setup failed', e); } return; }
      if (++tries > 200) { console.error('[desktop] the app never finished booting; staying in browser mode'); return; }
      setTimeout(poll, 25);
    };
    if (document.readyState === 'complete') poll();
    else window.addEventListener('load', poll, { once: true });
  }

  /** Put a YAML file into the app's registry and its MCU dropdown. */
  function register(name, yamlText) {
    const files = G('MCU_FILES');
    if (!files) return false;
    files[name] = yamlText;                     // const binding, mutable object
    const sel = document.getElementById('mcusel');
    if (sel && ![...sel.options].some(o => o.value === name)) {
      const o = document.createElement('option');
      o.value = o.textContent = name;
      sel.appendChild(o);
    }
    return true;
  }

  const currentMcuName = () => { const m = G('M'); return m && m.mcu ? m.mcu.name : null; };

  whenReady(async () => {
    // ---- 1. MCU files from disk (bundled resources + ~/.wch_cubemx/mcus) ----------
    try {
      const onDisk = await invoke('list_mcus');
      let added = 0;
      for (const f of onDisk || []) if (register(f.name, f.yaml)) added++;
      if (added) log(`${added} MCU file(s) from disk`);
    } catch (e) {
      console.error('[desktop] list_mcus failed', e);
    }

    // ---- 2. native dialogs replace the browser file input / download --------------
    const openBtn = document.getElementById('m-open');
    if (openBtn) openBtn.onclick = async () => {
      try {
        const f = await invoke('open_mcu');
        if (!f) return;
        register(f.name, f.yaml);
        window.openMcu(f.yaml);
        const sel = document.getElementById('mcusel');
        if (sel) sel.value = f.name;
        say(`Loaded ${f.name}`);
      } catch (e) { alert('Could not load: ' + e); }
    };

    // saveProject is a function declaration, so the toolbar button AND Ctrl+S both
    // resolve through window.saveProject — replacing it captures both.
    if (typeof window.projectSerialize === 'function') {
      window.saveProject = async () => {
        try {
          const project = G('PROJECT') || { name: 'Untitled' };
          const written = await invoke('save_project', { name: project.name || 'Untitled', yaml: window.projectSerialize() });
          if (!written) return;                       // cancelled
          project.dirty = false;
          if (typeof window.updateCrumb === 'function') window.updateCrumb();
          say('Saved ' + written.replace(/^.*[\\/]/, ''));
        } catch (e) { alert('Could not save: ' + e); }
      };
      const saveBtn = document.getElementById('m-save');
      if (saveBtn) saveBtn.onclick = () => window.saveProject();
    }

    // ---- 2b. Generate PlatformIO project: a folder, not a download ---------------
    //
    // The page owns the LAYOUT (which files, what they are called, what is in them)
    // and hands over a flat list of { path, text } with paths relative to the
    // project root. The shell owns only WHERE the root goes. That split is why
    // browser mode can ship the identical list as a .zip without either side
    // knowing about the other.
    //
    // Browser mode defines window.generateProjectFiles(); if the page has not
    // built it yet this whole block is inert, which is how the bridge has always
    // behaved for a feature that is not there.
    // `subfolder: false` writes loose files straight into the picked folder (the
    // Project Manager's GENERATE CODE); the default nests a whole project under
    // `<picked>/<name>/`.
    window.desktopWriteProject = async (name, files, { overwrite = false, subfolder = true } = {}) => {
      const res = await invoke('write_project', { name, files, overwrite, subfolder });
      return res;                                     // null when the user cancelled
    };

    if (typeof window.generateProjectFiles === 'function') {
      window.generateProject = async () => {
        try {
          const project = G('PROJECT') || { name: 'Untitled' };
          const files = await window.generateProjectFiles();
          if (!files || !files.length) { alert('Nothing to generate.'); return; }
          const res = await window.desktopWriteProject(project.name || 'WCHCubeProject', files);
          if (!res) return;                           // cancelled
          say(`Wrote ${res.written.length} file(s) to ${res.root}`);
        } catch (e) {
          // The Rust side refuses a non-empty folder and a path that could escape
          // the root, and it names which. Show that rather than a generic failure:
          // "it did not write, and here is the file" is the useful half.
          alert('Could not generate the project:\n\n' + e);
        }
      };
    }

    const openProjBtn = document.getElementById('m-openproj');
    if (openProjBtn && typeof window.projectApply === 'function') openProjBtn.onclick = async () => {
      try {
        const text = await invoke('open_project');
        if (!text) return;
        window.projectApply(window.jsyaml.load(text));
        say('Project opened');
      } catch (e) { alert('Could not open project: ' + e); }
    };

    // ---- 3. hot reload: edit a YAML in any editor, see it here --------------------
    if (listen) {
      try {
        await listen('mcu-changed', event => {
          const f = event.payload;
          if (!f || !f.yaml) return;
          register(f.name, f.yaml);
          if (f.name === currentMcuName()) {
            const state = G('S');
            const pkg = state ? state.pkg : null;
            try {
              window.openMcu(f.yaml);                   // re-parse and re-render
              const s = G('S');
              if (pkg && s && f.yaml.includes(pkg) && typeof window.setPackage === 'function') {
                try { window.setPackage(pkg); window.renderAll(true); } catch { /* package is gone: keep the default */ }
              }
              say(`${f.name} reloaded from disk`);
            } catch (e) {
              say(`${f.name} has an error: ${e.message}`);
            }
          } else {
            say(`${f.name} updated on disk`);
          }
        });
        log('watching data/mcus for changes');
      } catch (e) {
        console.error('[desktop] could not subscribe to mcu-changed', e);
      }
    }

    document.documentElement.dataset.shell = 'tauri';
  });
})();
