import { site } from '../data/site';
import { SHORTLIST_DOC_TYPES, UPLOAD } from '../data/application-schema';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<T>(s));

const form = $('#docsForm') as HTMLFormElement | null;
const invalid = $('[data-invalid]') as HTMLElement | null;
const successEl = $('[data-success]') as HTMLElement | null;
const token = new URLSearchParams(location.search).get('token') || '';

if (form) init(form);

async function init(form: HTMLFormElement) {
  const statusEl = $('[data-status]', form) as HTMLElement;
  const submitBtn = $('[data-submit]', form) as HTMLButtonElement;
  const files = new Map<string, File[]>();
  SHORTLIST_DOC_TYPES.forEach((d) => files.set(d.key, []));

  const showInvalid = () => {
    form.hidden = true;
    if (invalid) invalid.hidden = false;
  };

  if (!token) {
    showInvalid();
    return;
  }

  // Validate the link (greeting + expiry UX) before showing the form.
  try {
    const res = await fetch(`${site.apiBase}/api/doc-check?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!data.valid) return showInvalid();
    if (data.name) {
      const g = $('[data-greeting]');
      if (g) g.textContent = `Hi ${data.name} — upload your documents`;
    }
    form.hidden = false;
  } catch {
    // If the check fails (e.g. offline), still allow attempting the upload.
    form.hidden = false;
  }

  /* ---- dropzones ---- */
  const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  const validFile = (f: File): string | null => {
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (!UPLOAD.acceptExt.includes(ext as any) && !UPLOAD.acceptMime.includes(f.type as any))
      return 'Only PDF, JPG, PNG or WebP files are allowed.';
    if (f.size > UPLOAD.maxBytesPerFile) return `“${f.name}” is too large (max 10 MB).`;
    return null;
  };
  const renderList = (key: string) => {
    const list = $(`[data-doc-list="${key}"]`, form) as HTMLElement;
    list.innerHTML = '';
    files.get(key)!.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = 'fileitem';
      const isImg = f.type.startsWith('image/');
      const thumb = document.createElement(isImg ? 'img' : 'div');
      thumb.className = 'fileitem__thumb';
      if (isImg) (thumb as HTMLImageElement).src = URL.createObjectURL(f);
      else thumb.textContent = 'PDF';
      const meta = document.createElement('div');
      meta.className = 'fileitem__meta';
      meta.innerHTML = `<div class="fileitem__name">${f.name}</div><div class="fileitem__size">${fmtSize(f.size)}</div>`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'fileitem__remove';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => { files.get(key)!.splice(i, 1); renderList(key); });
      li.append(thumb, meta, rm);
      list.appendChild(li);
    });
  };
  const addFiles = (key: string, max: number, incoming: FileList | File[], errEl: HTMLElement) => {
    errEl.textContent = '';
    const arr = files.get(key)!;
    for (const f of Array.from(incoming)) {
      if (arr.length >= max) { errEl.textContent = `You can upload up to ${max} file${max > 1 ? 's' : ''} here.`; break; }
      const err = validFile(f);
      if (err) { errEl.textContent = err; continue; }
      arr.push(f);
    }
    renderList(key);
  };
  $$('.dropzone', form).forEach((dz) => {
    const key = dz.getAttribute('data-doc')!;
    const max = Number(dz.getAttribute('data-max')) || 1;
    const input = $('input[type=file]', dz) as HTMLInputElement;
    const drop = $('[data-droptarget]', dz) as HTMLElement;
    const errEl = $(`[data-error-for="doc-${key}"]`, form) as HTMLElement;
    input.addEventListener('change', () => { if (input.files) addFiles(key, max, input.files, errEl); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
    drop.addEventListener('drop', (e) => { const dt = (e as DragEvent).dataTransfer; if (dt?.files) addFiles(key, max, dt.files, errEl); });
  });

  const setStatus = (msg: string, state: 'ok' | 'error' | '') => {
    statusEl.textContent = msg;
    if (state) statusEl.dataset.state = state; else statusEl.removeAttribute('data-state');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ((form.elements.namedItem('website') as HTMLInputElement)?.value) {
      finish();
      return;
    }
    // required docs present?
    for (const d of SHORTLIST_DOC_TYPES) {
      if (d.required && files.get(d.key)!.length === 0) {
        ($(`[data-error-for="doc-${d.key}"]`, form) as HTMLElement).textContent = `Please upload your ${d.label.toLowerCase()}.`;
        return;
      }
    }
    if (!(form.elements.namedItem('docsConsent') as HTMLInputElement).checked) {
      setStatus('Please confirm the authorization checkbox.', 'error');
      return;
    }
    const turnstileToken = (form.elements.namedItem('cf-turnstile-response') as HTMLInputElement)?.value;
    if (!turnstileToken) { setStatus('Please complete the verification challenge.', 'error'); return; }

    submitBtn.disabled = true;
    try {
      setStatus('Securing your upload…', '');
      const beginRes = await fetch(`${site.apiBase}/api/doc-begin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, turnstileToken }),
      });
      if (!beginRes.ok) throw new Error('begin ' + beginRes.status);
      const { uploadJwt } = await beginRes.json();

      const documents: Record<string, string[]> = {};
      let done = 0;
      const total = SHORTLIST_DOC_TYPES.reduce((n, d) => n + files.get(d.key)!.length, 0);
      for (const d of SHORTLIST_DOC_TYPES) {
        documents[d.key] = [];
        for (const f of files.get(d.key)!) {
          setStatus(`Uploading… (${++done}/${total})`, '');
          const res = await fetch(`${site.apiBase}/api/upload`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${uploadJwt}`,
              'Content-Type': f.type || 'application/octet-stream',
              'x-doc-type': d.key,
              'x-file-name': encodeURIComponent(f.name),
            },
            body: f,
          });
          if (!res.ok) throw new Error('upload ' + res.status);
          documents[d.key].push((await res.json()).key);
        }
      }

      setStatus('Finishing…', '');
      const submitRes = await fetch(`${site.apiBase}/api/doc-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uploadJwt}` },
        body: JSON.stringify({ creditReport: documents.creditReport || [], photoId: documents.photoId || [] }),
      });
      if (!submitRes.ok) throw new Error('submit ' + submitRes.status);
      finish();
    } catch (err) {
      console.error(err);
      setStatus(`Sorry, something went wrong. Please try again or email ${site.contact.email}.`, 'error');
      // @ts-ignore
      window.turnstile?.reset?.();
    } finally {
      submitBtn.disabled = false;
    }
  });

  function finish() {
    form.hidden = true;
    if (successEl) {
      successEl.hidden = false;
      successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
