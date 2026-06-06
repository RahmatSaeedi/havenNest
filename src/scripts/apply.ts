import IMask from 'imask';
import { site } from '../data/site';
import { RELATIONSHIPS, INITIAL_DOC_TYPES, UPLOAD } from '../data/application-schema';

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) =>
  r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) =>
  Array.from(r.querySelectorAll<T>(s));

const form = $('#applyForm') as HTMLFormElement | null;
if (form) initApply(form);

function initApply(form: HTMLFormElement) {
  const steps = $$('.step', form);
  const stepBtns = $$('[data-step-jump]'); // in the wizard nav, outside the form
  const progressBar = $('[data-progress]') as HTMLElement;
  const stepNumEl = $('[data-stepnum]') as HTMLElement;
  const currentTitleEl = $('[data-current-title]') as HTMLElement;
  const stepsToggle = $('[data-steps-toggle]') as HTMLButtonElement;
  const stepsList = $('[data-stepper]') as HTMLElement;
  const completed = new Set<number>();
  const prevBtn = $('[data-prev]', form) as HTMLButtonElement;
  const nextBtn = $('[data-next]', form) as HTMLButtonElement;
  const submitBtn = $('[data-submit]', form) as HTMLButtonElement;
  const statusEl = $('[data-status]', form) as HTMLElement;
  const successEl = $('[data-success]') as HTMLElement;
  const STORE_KEY = 'havennest:apply:v1';

  let current = 0;
  /** File store: docType -> File[] */
  const files = new Map<string, File[]>();
  INITIAL_DOC_TYPES.forEach((d) => files.set(d.key, []));

  /* ---------------- masks ---------------- */
  function applyMask(el: HTMLInputElement) {
    if (el.dataset.maskApplied) return;
    const kind = el.dataset.mask;
    if (kind === 'phone') IMask(el, { mask: '(000) 000-0000' });
    else if (kind === 'postal')
      IMask(el, {
        mask: 'A0A 0A0',
        // @ts-ignore IMask definitions
        definitions: { A: { mask: /[A-Za-z]/, prepare: (s: string) => s.toUpperCase() } },
      });
    else if (kind === 'money')
      IMask(el, {
        mask: '$num',
        // @ts-ignore
        blocks: { num: { mask: Number, thousandsSeparator: ',', scale: 0, signed: false } },
      });
    el.dataset.maskApplied = '1';
  }
  function applyMasksIn(root: ParentNode) {
    $$('[data-mask]', root).forEach((el) => applyMask(el as HTMLInputElement));
    $$('[data-uppercase]', root).forEach((el) =>
      el.addEventListener('input', () => {
        const i = el as HTMLInputElement;
        i.value = i.value.toUpperCase();
      })
    );
    enhanceDatesIn(root);
  }

  /* ---------------- friendly date selects (Year / Month / Day) ---------------- */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

  function enhanceDatesIn(root: ParentNode) {
    $$('[data-picker]', root).forEach((el) => enhanceDate(el as HTMLInputElement));
  }

  function enhanceDate(input: HTMLInputElement) {
    if (input.dataset.enhanced || !input.parentNode) return;
    input.dataset.enhanced = '1';
    const kind = input.dataset.picker; // 'dob' | 'past'
    const thisYear = new Date().getFullYear();
    const maxYear = thisYear;
    const minYear = kind === 'dob' ? thisYear - 100 : thisYear - 70;
    const required = input.required;

    const mkSel = (cls: string, label: string, placeholder: string) => {
      const s = document.createElement('select');
      s.className = cls;
      s.setAttribute('aria-label', label);
      const o = document.createElement('option');
      o.value = '';
      o.textContent = placeholder;
      s.appendChild(o);
      return s;
    };
    const addOpt = (sel: HTMLSelectElement, value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    };

    const wrap = document.createElement('div');
    wrap.className = 'datesel';
    const ySel = mkSel('datesel--year', 'Year', 'Year');
    const mSel = mkSel('datesel--month', 'Month', 'Month');
    const dSel = mkSel('datesel--day', 'Day', 'Day');
    for (let y = maxYear; y >= minYear; y--) addOpt(ySel, String(y), String(y));
    MONTHS.forEach((m, i) => addOpt(mSel, String(i + 1).padStart(2, '0'), m));

    const fillDays = () => {
      const y = Number(ySel.value) || 2000;
      const m = Number(mSel.value) || 1;
      const max = daysInMonth(y, m);
      const prev = dSel.value;
      dSel.length = 1; // keep placeholder
      for (let d = 1; d <= max; d++) addOpt(dSel, String(d).padStart(2, '0'), String(d));
      if (prev && Number(prev) <= max) dSel.value = prev;
    };
    fillDays();

    if (required) {
      ySel.required = mSel.required = dSel.required = true;
      input.required = false; // selects now carry the requirement
    }

    input.parentNode.insertBefore(wrap, input);
    wrap.append(ySel, mSel, dSel);
    input.style.display = 'none';

    if (input.value) {
      const [Y, M, D] = input.value.split('-');
      ySel.value = Y || '';
      mSel.value = M || '';
      fillDays();
      dSel.value = D || '';
    }

    const sync = () => {
      input.value = ySel.value && mSel.value && dSel.value ? `${ySel.value}-${mSel.value}-${dSel.value}` : '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    ySel.addEventListener('change', () => { fillDays(); sync(); });
    mSel.addEventListener('change', () => { fillDays(); sync(); });
    dSel.addEventListener('change', sync);
  }

  /* ---------------- age helpers ---------------- */
  function ageFromDob(value: string): number | null {
    if (!value) return null;
    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  /* ---------------- conditional reveals ---------------- */
  function currentValueOf(name: string): string {
    if (name === 'unit-type') {
      const sel = form.elements.namedItem('unit') as HTMLSelectElement | null;
      const opt = sel?.selectedOptions?.[0];
      return opt?.dataset.type ?? '';
    }
    const el = form.elements.namedItem(name);
    if (!el) return '';
    if (el instanceof RadioNodeList) return (el as RadioNodeList).value;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el.value;
    return '';
  }
  function updateConditionals() {
    $$('[data-show-when]', form).forEach((box) => {
      const [name, valuesRaw] = (box.getAttribute('data-show-when') || '').split('=');
      const allowed = (valuesRaw || '').split('|');
      const show = allowed.includes(currentValueOf(name));
      box.hidden = !show;
      // strip/restore required on inner controls so hidden fields don't block
      $$('input, select, textarea', box).forEach((c) => {
        const ctl = c as HTMLInputElement;
        if (!show) {
          if (ctl.required) {
            ctl.dataset.reqHeld = '1';
            ctl.required = false;
          }
        } else if (ctl.dataset.reqHeld) {
          ctl.required = true;
          delete ctl.dataset.reqHeld;
        }
      });
    });
    // pets: ensure a row exists when shown
    if (currentValueOf('hasPets') === 'yes' && $$('[data-pet-card]', petsWrap).length === 0) addPet();
  }

  /* ---------------- rent hint ---------------- */
  const unitSel = form.elements.namedItem('unit') as HTMLSelectElement;
  const rentHint = $('[data-rent-hint]', form) as HTMLElement;
  function updateRentHint() {
    const opt = unitSel.selectedOptions[0];
    const rent = opt?.dataset.rent;
    if (rent) {
      rentHint.textContent = `Monthly rent for this unit: $${Number(rent).toLocaleString('en-CA')} (utilities not included).`;
      rentHint.hidden = false;
    } else rentHint.hidden = true;
  }

  /* ---------------- repeatable groups ---------------- */
  const occWrap = $('[data-occupants]', form) as HTMLElement;
  const petsWrap = $('[data-pets]', form) as HTMLElement;
  const vehWrap = $('[data-vehicles]', form) as HTMLElement;
  const resWrap = $('[data-residences]', form) as HTMLElement;
  const emergWrap = $('[data-emergency]', form) as HTMLElement;

  function tpl(name: string): HTMLElement {
    const t = document.querySelector<HTMLTemplateElement>(`template[data-tpl="${name}"]`)!;
    return t.content.firstElementChild!.cloneNode(true) as HTMLElement;
  }

  function renumberOccupants() {
    $$('[data-occupant-card]', occWrap).forEach((card, i) => {
      const idx = $('[data-occ-index]', card);
      if (idx) idx.textContent = String(i + 1);
    });
  }

  function populateRelationships(card: HTMLElement) {
    const rel = $('[data-occ="relationship"]', card) as HTMLSelectElement;
    RELATIONSHIPS.forEach((r) => {
      const o = document.createElement('option');
      o.value = r;
      o.textContent = r;
      rel.appendChild(o);
    });
  }

  function wireOccupant(card: HTMLElement) {
    const rel = $('[data-occ="relationship"]', card) as HTMLSelectElement;
    const otherWrap = $('[data-occ-otherrel]', card) as HTMLElement;
    const otherInput = $('[data-occ="relationshipOther"]', card) as HTMLInputElement;
    const syncRel = () => {
      const isOther = rel.value === 'Other';
      if (otherWrap) otherWrap.hidden = !isOther;
      if (otherInput) {
        otherInput.required = isOther;
        if (!isOther) otherInput.value = '';
      }
    };
    rel.addEventListener('change', syncRel);

    const dob = $('[data-occ="dob"]', card) as HTMLInputElement;
    const ageBox = $('[data-occ-age]', card) as HTMLElement;
    const cosign = $('[data-occ-cosign]', card) as HTMLElement;
    const cosignFields = $('[data-occ-cosign-fields]', card) as HTMLElement;
    const updateAge = () => {
      const age = ageFromDob(dob.value);
      if (age == null) {
        ageBox.hidden = true;
        cosign.hidden = true;
        return;
      }
      const adult = age >= 18;
      ageBox.hidden = false;
      ageBox.dataset.adult = String(adult);
      ageBox.textContent = adult ? `Adult (${age}) — please indicate co-signing below.` : `Minor (${age})`;
      cosign.hidden = !adult;
      // toggle required on cosign yes/no
      $$('[data-occ="willCosign"]', card).forEach((r) => ((r as HTMLInputElement).required = adult));
      if (!adult) {
        $$('[data-occ="willCosign"]', card).forEach((r) => ((r as HTMLInputElement).checked = false));
        cosignFields.hidden = true;
      }
    };
    dob.addEventListener('change', updateAge);
    $$('[data-occ="willCosign"]', card).forEach((r) =>
      r.addEventListener('change', () => {
        const val = (card.querySelector('[data-occ="willCosign"]:checked') as HTMLInputElement)?.value;
        cosignFields.hidden = val !== 'yes';
        const req = val === 'yes';
        (card.querySelector('[data-occ="cosignEmail"]') as HTMLInputElement).required = req;
        (card.querySelector('[data-occ="cosignPhone"]') as HTMLInputElement).required = req;
      })
    );
    $('[data-remove]', card)?.addEventListener('click', () => {
      card.remove();
      renumberOccupants();
      save();
    });
    applyMasksIn(card); // also enhances DOB into Year/Month/Day selects (reads any set value)
    card.addEventListener('input', save);
    card.addEventListener('change', save);
    syncRel();
    updateAge();
    const checkedCosign = card.querySelector('[data-occ="willCosign"]:checked') as HTMLInputElement | null;
    if (checkedCosign) checkedCosign.dispatchEvent(new Event('change'));
  }

  function addOccupant(data?: Record<string, any>) {
    const card = tpl('occupant');
    occWrap.appendChild(card);
    populateRelationships(card);
    // Set values BEFORE wiring so the date-select enhancement picks up the DOB.
    if (data) {
      (['fullName', 'dob', 'relationship', 'relationshipOther', 'cosignEmail', 'cosignPhone', 'cosignIncome'] as const).forEach((k) => {
        const el = card.querySelector<HTMLInputElement>(`[data-occ="${k}"]`);
        if (el && data[k] != null) el.value = data[k];
      });
      if (data.willCosign) {
        const r = card.querySelector<HTMLInputElement>(`[data-occ="willCosign"][value="${data.willCosign}"]`);
        if (r) r.checked = true;
      }
    }
    wireOccupant(card);
    renumberOccupants();
  }

  function addPet(data?: Record<string, any>) {
    const card = tpl('pet');
    petsWrap.appendChild(card);
    $('[data-remove]', card)?.addEventListener('click', () => {
      card.remove();
      save();
    });
    applyMasksIn(card);
    card.addEventListener('input', save);
    card.addEventListener('change', save);
    if (data) {
      (['type', 'breed', 'weight', 'age'] as const).forEach((k) => {
        const el = card.querySelector<HTMLInputElement>(`[data-pet="${k}"]`);
        if (el && data[k] != null) el.value = data[k];
      });
      const fx = card.querySelector<HTMLInputElement>('[data-pet="fixed"]');
      if (fx) fx.checked = !!data.fixed;
    }
  }

  function addVehicle(data?: Record<string, any>) {
    const card = tpl('vehicle');
    vehWrap.appendChild(card);
    $('[data-remove]', card)?.addEventListener('click', () => {
      card.remove();
      save();
    });
    applyMasksIn(card);
    card.addEventListener('input', save);
    card.addEventListener('change', save);
    if (data) {
      const mm = card.querySelector<HTMLInputElement>('[data-veh="makeModel"]');
      const pl = card.querySelector<HTMLInputElement>('[data-veh="plate"]');
      const pk = card.querySelector<HTMLInputElement>('[data-veh="parkingNeeded"]');
      if (mm) mm.value = data.makeModel ?? '';
      if (pl) pl.value = data.plate ?? '';
      if (pk) pk.checked = !!data.parkingNeeded;
    }
  }

  function addResidence(data?: Record<string, any>) {
    const card = tpl('residence');
    resWrap.appendChild(card);
    if (data) {
      (['street', 'city', 'province', 'postal', 'from', 'to'] as const).forEach((k) => {
        const el = card.querySelector<HTMLInputElement>(`[data-res="${k}"]`);
        if (el && data[k] != null) el.value = data[k];
      });
    }
    $('[data-remove]', card)?.addEventListener('click', () => { card.remove(); save(); });
    applyMasksIn(card); // postal mask + past-date selects
    card.addEventListener('input', save);
    card.addEventListener('change', save);
  }

  function addEmergency(data?: Record<string, any>) {
    const card = tpl('emergency');
    emergWrap.appendChild(card);
    if (data) {
      (['name', 'relationship', 'phone'] as const).forEach((k) => {
        const el = card.querySelector<HTMLInputElement>(`[data-emerg="${k}"]`);
        if (el && data[k] != null) el.value = data[k];
      });
    }
    $('[data-remove]', card)?.addEventListener('click', () => { card.remove(); save(); });
    applyMasksIn(card);
    card.addEventListener('input', save);
    card.addEventListener('change', save);
  }

  $('[data-add-occupant]', form)?.addEventListener('click', () => { addOccupant(); save(); });
  $('[data-add-pet]', form)?.addEventListener('click', () => { addPet(); save(); });
  $('[data-add-vehicle]', form)?.addEventListener('click', () => { addVehicle(); save(); });
  $('[data-add-residence]', form)?.addEventListener('click', () => { addResidence(); save(); });
  $('[data-add-emergency]', form)?.addEventListener('click', () => { addEmergency(); save(); });

  /* ---------------- file dropzones ---------------- */
  function fmtSize(b: number) {
    return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
  }
  function totalFileCount() {
    let n = 0;
    files.forEach((arr) => (n += arr.length));
    return n;
  }
  function validFile(f: File): string | null {
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (!UPLOAD.acceptExt.includes(ext as any) && !UPLOAD.acceptMime.includes(f.type as any))
      return 'Only PDF, JPG, PNG or WebP files are allowed.';
    if (f.size > UPLOAD.maxBytesPerFile) return `“${f.name}” is too large (max 10 MB).`;
    return null;
  }
  function renderFileList(docKey: string) {
    const list = $(`[data-doc-list="${docKey}"]`, form) as HTMLElement;
    list.innerHTML = '';
    files.get(docKey)!.forEach((f, i) => {
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
      rm.addEventListener('click', () => {
        files.get(docKey)!.splice(i, 1);
        renderFileList(docKey);
      });
      li.append(thumb, meta, rm);
      list.appendChild(li);
    });
  }
  function addFiles(docKey: string, max: number, incoming: FileList | File[], errEl: HTMLElement) {
    errEl.textContent = '';
    const arr = files.get(docKey)!;
    for (const f of Array.from(incoming)) {
      if (arr.length >= max) { errEl.textContent = `You can upload up to ${max} file${max > 1 ? 's' : ''} here.`; break; }
      if (totalFileCount() >= UPLOAD.maxFilesTotal) { errEl.textContent = `Maximum ${UPLOAD.maxFilesTotal} files in total.`; break; }
      const err = validFile(f);
      if (err) { errEl.textContent = err; continue; }
      arr.push(f);
    }
    renderFileList(docKey);
  }
  $$('.dropzone', form).forEach((dz) => {
    const docKey = dz.getAttribute('data-doc')!;
    const max = Number(dz.getAttribute('data-max')) || 1;
    const input = $('input[type=file]', dz) as HTMLInputElement;
    const drop = $('[data-droptarget]', dz) as HTMLElement;
    const errEl = $(`[data-error-for="doc-${docKey}"]`, form) as HTMLElement;
    input.addEventListener('change', () => { if (input.files) addFiles(docKey, max, input.files, errEl); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); })
    );
    drop.addEventListener('drop', (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (dt?.files) addFiles(docKey, max, dt.files, errEl);
    });
  });

  /* ---------------- step navigation ---------------- */
  function showStep(n: number, focus = true) {
    current = Math.max(0, Math.min(steps.length - 1, n));
    steps.forEach((s, i) => (s.hidden = i !== current));
    stepBtns.forEach((btn, i) => {
      const state = i === current ? 'current' : completed.has(i) ? 'done' : 'upcoming';
      btn.dataset.state = state;
      if (i === current) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
    if (progressBar) progressBar.style.width = `${((current + 1) / steps.length) * 100}%`;
    if (stepNumEl) stepNumEl.textContent = String(current + 1);
    if (currentTitleEl)
      currentTitleEl.textContent = stepBtns[current]?.querySelector('.wiz__step-label')?.textContent ?? '';
    // collapse the mobile step list
    stepsList?.removeAttribute('data-open');
    stepsToggle?.setAttribute('aria-expanded', 'false');

    prevBtn.hidden = current === 0;
    const last = current === steps.length - 1;
    nextBtn.hidden = last;
    submitBtn.hidden = !last;
    if (last) buildReview();
    if (focus) {
      const h = $('.step__title', steps[current]) as HTMLElement;
      h?.setAttribute('tabindex', '-1');
      h?.focus();
      const top = $('[data-wiz]')?.getBoundingClientRect().top ?? 0;
      window.scrollTo({ top: window.scrollY + top - 90, behavior: 'smooth' });
    }
    save();
  }

  function setError(name: string, msg: string) {
    const el = $(`[data-error-for="${name}"]`, form);
    if (el) el.textContent = msg;
  }
  function clearErrors(scope: ParentNode) {
    $$('[data-error-for]', scope).forEach((e) => (e.textContent = ''));
    $$('[aria-invalid="true"]', scope).forEach((e) => e.removeAttribute('aria-invalid'));
  }

  type StepResult = { ok: true } | { ok: false; el?: HTMLElement };

  function validateStep(index: number): StepResult {
    const step = steps[index];
    clearErrors(step);
    // Validate required controls, skipping any inside a hidden conditional block
    // (those have `required` stripped by updateConditionals anyway).
    const controls = $$('input, select, textarea', step).filter(
      (c) => !(c as HTMLElement).closest('[data-show-when][hidden]')
    );
    for (const c of controls) {
      const el = c as HTMLInputElement;
      if (!el.checkValidity()) {
        el.setAttribute('aria-invalid', 'true');
        return { ok: false, el };
      }
    }
    // custom checks per step
    if (index === 1) {
      const emailEl = form.elements.namedItem('email') as HTMLInputElement;
      const email2El = form.elements.namedItem('emailConfirm') as HTMLInputElement;
      if (emailEl.value && email2El.value && emailEl.value.toLowerCase() !== email2El.value.toLowerCase()) {
        setError('emailConfirm', 'Emails do not match.');
        email2El.setAttribute('aria-invalid', 'true');
        return { ok: false, el: email2El };
      }
      const dob = form.elements.namedItem('dob') as HTMLInputElement;
      const age = ageFromDob(dob.value);
      if (age != null && age < 18) {
        setError('dob', 'You must be at least 18 to apply.');
        dob.setAttribute('aria-invalid', 'true');
        return { ok: false, el: dob };
      }
    }
    if (index === 4) {
      const cards = $$('[data-occupant-card]', occWrap);
      if (cards.length === 0) {
        setError('occupants', 'Please add at least one occupant.');
        return { ok: false };
      }
      for (const card of cards) {
        const name = (card.querySelector('[data-occ="fullName"]') as HTMLInputElement).value.trim();
        const dobV = (card.querySelector('[data-occ="dob"]') as HTMLInputElement).value;
        const rel = (card.querySelector('[data-occ="relationship"]') as HTMLSelectElement).value;
        if (!name || !dobV || !rel) {
          setError('occupants', 'Please complete name, date of birth and relationship for every occupant.');
          return { ok: false, el: card.querySelector('[data-occ="fullName"]') as HTMLElement };
        }
        if (rel === 'Other' && !(card.querySelector('[data-occ="relationshipOther"]') as HTMLInputElement).value.trim()) {
          setError('occupants', 'Please specify the relationship for occupants marked “Other”.');
          return { ok: false, el: card.querySelector('[data-occ="relationshipOther"]') as HTMLElement };
        }
        const age = ageFromDob(dobV);
        if (age != null && age >= 18) {
          const cosign = card.querySelector('[data-occ="willCosign"]:checked') as HTMLInputElement | null;
          if (!cosign) {
            setError('occupants', 'For each adult (18+), choose whether they will co-sign the lease.');
            return { ok: false, el: card };
          }
          if (cosign.value === 'yes') {
            const ce = (card.querySelector('[data-occ="cosignEmail"]') as HTMLInputElement).value.trim();
            const cp = (card.querySelector('[data-occ="cosignPhone"]') as HTMLInputElement).value.trim();
            if (!ce || !cp) {
              setError('occupants', 'Please provide email and phone for each co-signing adult.');
              return { ok: false, el: card };
            }
          }
        }
      }
    }
    if (index === 5) {
      if ($$('[data-emergency-card]', emergWrap).length === 0) {
        setError('emergency', 'Please add at least one emergency contact.');
        return { ok: false };
      }
    }
    if (index === 6) {
      for (const d of INITIAL_DOC_TYPES) {
        if (d.required && files.get(d.key)!.length === 0) {
          setError(`doc-${d.key}`, `Please upload your ${d.label.toLowerCase()}.`);
          return { ok: false, el: ($(`#doc-${d.key}`, form) as HTMLElement)?.closest('.docblock') as HTMLElement };
        }
      }
    }
    return { ok: true };
  }

  function reportInvalid(r: StepResult) {
    if (r.ok) return;
    const el = r.el;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el as HTMLInputElement).focus?.();
      (el as HTMLInputElement).reportValidity?.();
    });
  }

  nextBtn.addEventListener('click', () => {
    const r = validateStep(current);
    if (r.ok) {
      completed.add(current);
      showStep(current + 1);
    } else reportInvalid(r);
  });
  prevBtn.addEventListener('click', () => showStep(current - 1));
  // Jump to ANY section from the wizard nav.
  stepBtns.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      if (i === current) return;
      // remember the current step as completed if it's valid (no error noise)
      showStep(i);
    })
  );
  // Mobile: expand/collapse the step list.
  stepsToggle?.addEventListener('click', () => {
    const open = stepsList?.hasAttribute('data-open');
    if (open) {
      stepsList?.removeAttribute('data-open');
      stepsToggle.setAttribute('aria-expanded', 'false');
    } else {
      stepsList?.setAttribute('data-open', '');
      stepsToggle.setAttribute('aria-expanded', 'true');
    }
  });

  /* ---------------- review ---------------- */
  function buildReview() {
    const review = $('[data-review]', form) as HTMLElement;
    const g = (title: string, step: number, rows: [string, string][]) => {
      const filled = rows.filter(([, v]) => v && v.trim());
      if (!filled.length) return '';
      return `<div class="review__group"><div class="review__grouphead">${title}<button type="button" class="review__edit" data-goto="${step}">Edit</button></div><dl class="review__rows">${filled
        .map(([k, v]) => `<div class="review__row"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
        .join('')}</dl></div>`;
    };
    const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | RadioNodeList)?.value ?? '';
    const unitLabel = unitSel.selectedOptions[0]?.textContent ?? '';
    const occ = collectOccupants()
      .map((o) => `${o.fullName} (${o.relationshipLabel}${o.willCosign === 'yes' ? ', co-signer' : ''})`)
      .join('; ');

    review.innerHTML =
      g('Unit & move-in', 0, [
        ['Unit', unitLabel],
        ['Move-in', v('moveInDate')],
        ['Lease term', v('leaseTerm')],
        ['Garage', v('wantGarage')],
      ]) +
      g('About you', 1, [
        ['Name', v('fullName')],
        ['Email', v('email')],
        ['Phone', v('phone')],
        ['Date of birth', v('dob')],
      ]) +
      g('Residence', 2, [
        ['Address', `${v('currentStreet')}, ${v('currentCity')} ${v('currentProvince')} ${v('currentPostal')}`],
        ['Rent/own', v('ownRent')],
        ['Previous residences', `${collectResidences().length} listed`],
      ]) +
      g('Employment & income', 3, [
        ['Status', v('employmentStatus')],
        ['Gross monthly income', v('grossMonthlyIncome')],
      ]) +
      g('Occupants', 4, [['Everyone living here', occ]]) +
      g('Background', 5, [
        ['Pets', v('hasPets')],
        ['Smoking', v('smoking')],
        ['Guarantor', v('hasGuarantor')],
        ['Emergency contacts', `${collectEmergencies().length} listed`],
      ]) +
      g('Documents', 6, [
        ['Proof of income', `${files.get('proofOfIncome')!.length} file(s)`],
        ['ID & credit report', 'Requested only if shortlisted'],
      ]);

    $$('[data-goto]', review).forEach((b) =>
      b.addEventListener('click', () => showStep(Number(b.getAttribute('data-goto'))))
    );
  }
  function escapeHtml(s: string) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
  }

  /* ---------------- collect payload ---------------- */
  const moneyToNum = (s: string) => Number((s || '').replace(/[^\d]/g, '')) || 0;
  const vstr = (name: string) => {
    const el = form.elements.namedItem(name);
    if (!el) return '';
    if (el instanceof RadioNodeList) return el.value;
    return (el as HTMLInputElement).value.trim();
  };

  function collectOccupants() {
    return $$('[data-occupant-card]', occWrap).map((card) => {
      const get = (k: string) => (card.querySelector(`[data-occ="${k}"]`) as HTMLInputElement)?.value?.trim() ?? '';
      const cosign = (card.querySelector('[data-occ="willCosign"]:checked') as HTMLInputElement)?.value ?? '';
      const dobV = get('dob');
      const age = ageFromDob(dobV);
      const relSel = get('relationship');
      const relOther = get('relationshipOther');
      return {
        fullName: get('fullName'),
        dob: dobV,
        age: age ?? null,
        relationship: relSel, // raw select value (for restore)
        relationshipOther: relOther,
        relationshipLabel: relSel === 'Other' && relOther ? relOther : relSel,
        isAdult: age != null && age >= 18,
        willCosign: cosign,
        cosignEmail: get('cosignEmail'),
        cosignPhone: get('cosignPhone'),
        cosignIncome: moneyToNum(get('cosignIncome')),
      };
    });
  }
  function collectResidences() {
    return $$('[data-residence-card]', resWrap)
      .map((card) => {
        const get = (k: string) => (card.querySelector(`[data-res="${k}"]`) as HTMLInputElement)?.value?.trim() ?? '';
        return { street: get('street'), city: get('city'), province: get('province'), postal: get('postal'), from: get('from'), to: get('to') };
      })
      .filter((r) => r.street || r.city);
  }
  function collectEmergencies() {
    return $$('[data-emergency-card]', emergWrap)
      .map((card) => {
        const get = (k: string) => (card.querySelector(`[data-emerg="${k}"]`) as HTMLInputElement)?.value?.trim() ?? '';
        return { name: get('name'), relationship: get('relationship'), phone: get('phone') };
      })
      .filter((e) => e.name || e.phone);
  }
  function collectPets() {
    if (vstr('hasPets') !== 'yes') return [];
    return $$('[data-pet-card]', petsWrap).map((card) => ({
      type: (card.querySelector('[data-pet="type"]') as HTMLInputElement).value.trim(),
      breed: (card.querySelector('[data-pet="breed"]') as HTMLInputElement).value.trim(),
      weight: (card.querySelector('[data-pet="weight"]') as HTMLInputElement).value.trim(),
      age: (card.querySelector('[data-pet="age"]') as HTMLInputElement).value.trim(),
      fixed: (card.querySelector('[data-pet="fixed"]') as HTMLInputElement).checked,
    })).filter((p) => p.type);
  }
  function collectVehicles() {
    return $$('[data-vehicle-card]', vehWrap).map((card) => ({
      makeModel: (card.querySelector('[data-veh="makeModel"]') as HTMLInputElement).value.trim(),
      plate: (card.querySelector('[data-veh="plate"]') as HTMLInputElement).value.trim(),
      parkingNeeded: (card.querySelector('[data-veh="parkingNeeded"]') as HTMLInputElement).checked,
    })).filter((vv) => vv.makeModel || vv.plate);
  }

  function buildPayload(documents: Record<string, string[]>) {
    return {
      unit: vstr('unit'),
      unitLabel: unitSel.selectedOptions[0]?.textContent ?? '',
      moveInDate: vstr('moveInDate'),
      leaseTerm: vstr('leaseTerm'),
      wantGarage: vstr('wantGarage'),
      hearAbout: vstr('hearAbout'),
      applicant: {
        fullName: vstr('fullName'),
        preferredName: vstr('preferredName'),
        dob: vstr('dob'),
        email: vstr('email'),
        phone: vstr('phone'),
        altPhone: vstr('altPhone'),
      },
      residence: {
        street: vstr('currentStreet'),
        city: vstr('currentCity'),
        province: vstr('currentProvince'),
        postal: vstr('currentPostal'),
        ownRent: vstr('ownRent'),
        currentMoveIn: vstr('currentMoveIn'),
        reasonLeaving: vstr('reasonLeaving'),
        currentRent: moneyToNum(vstr('currentRent')),
        landlordName: vstr('landlordName'),
        landlordPhone: vstr('landlordPhone'),
        landlordEmail: vstr('landlordEmail'),
        canContactLandlord: vstr('canContactLandlord'),
        evicted: vstr('evicted'),
        evictedExplain: vstr('evictedExplain'),
        brokeLease: vstr('brokeLease'),
        brokeLeaseExplain: vstr('brokeLeaseExplain'),
        previousResidences: collectResidences(),
      },
      employment: {
        status: vstr('employmentStatus'),
        employer: vstr('employer'),
        jobTitle: vstr('jobTitle'),
        lengthWithEmployer: vstr('lengthWithEmployer'),
        employerPhone: vstr('employerPhone'),
        grossMonthlyIncome: moneyToNum(vstr('grossMonthlyIncome')),
        additionalIncome: moneyToNum(vstr('additionalIncome')),
      },
      occupants: collectOccupants().map((o) => ({
        fullName: o.fullName,
        dob: o.dob,
        age: o.age,
        relationship: o.relationshipLabel,
        isAdult: o.isAdult,
        willCosign: o.willCosign,
        cosignEmail: o.cosignEmail,
        cosignPhone: o.cosignPhone,
        cosignIncome: o.cosignIncome,
      })),
      background: {
        hasPets: vstr('hasPets'),
        pets: collectPets(),
        serviceAnimal: vstr('serviceAnimal'),
        smoking: vstr('smoking'),
        vehicles: collectVehicles(),
        bankruptcy: vstr('bankruptcy'),
        hasGuarantor: vstr('hasGuarantor'),
        guarantor: {
          name: vstr('guarantorName'),
          phone: vstr('guarantorPhone'),
          email: vstr('guarantorEmail'),
        },
        emergencyContacts: collectEmergencies(),
      },
      documents,
      consent: {
        infoTrue: (form.elements.namedItem('infoTrue') as HTMLInputElement).checked,
        noFeeAck: (form.elements.namedItem('noFeeAck') as HTMLInputElement).checked,
        creditConsent: (form.elements.namedItem('creditConsent') as HTMLInputElement).checked,
        privacyConsent: (form.elements.namedItem('privacyConsent') as HTMLInputElement).checked,
        signature: vstr('signature'),
        signedAt: new Date().toISOString(),
      },
    };
  }

  /* ---------------- autosave ---------------- */
  let saveTimer: number | undefined;
  function save() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const fields: Record<string, any> = {};
      $$('input, select, textarea', form).forEach((c) => {
        const el = c as HTMLInputElement;
        if (!el.name || el.name === 'website' || el.name === 'cf-turnstile-response' || el.type === 'file') return;
        if (el.type === 'radio' || el.type === 'checkbox') {
          if (el.checked) fields[el.name] = el.value === 'on' ? true : el.value;
        } else if (el.value) fields[el.name] = el.value;
      });
      const data = {
        step: current,
        fields,
        occupants: collectOccupants(),
        residences: collectResidences(),
        pets: collectPets(),
        vehicles: collectVehicles(),
        emergencies: collectEmergencies(),
      };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    }, 350);
  }

  function restore(): number {
    let data: any;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { data = null; }
    if (!data) {
      addOccupant(); // start with one occupant
      addEmergency(); // and one emergency contact
      return 0;
    }
    // static fields
    Object.entries(data.fields || {}).forEach(([name, val]) => {
      const el = form.elements.namedItem(name);
      if (!el) return;
      if (el instanceof RadioNodeList) {
        $$(`[name="${name}"]`, form).forEach((r) => {
          const i = r as HTMLInputElement;
          if (i.type === 'radio') i.checked = i.value === val;
        });
      } else {
        const i = el as HTMLInputElement;
        if (i.type === 'checkbox') i.checked = !!val;
        else i.value = String(val);
      }
    });
    // dynamic groups
    (data.occupants?.length ? data.occupants : [undefined]).forEach((o: any) => addOccupant(o));
    (data.residences || []).forEach((r: any) => addResidence(r));
    (data.pets || []).forEach((p: any) => addPet(p));
    (data.vehicles || []).forEach((vv: any) => addVehicle(vv));
    (data.emergencies?.length ? data.emergencies : [undefined]).forEach((e: any) => addEmergency(e));
    return typeof data.step === 'number' ? data.step : 0;
  }

  $('[data-reset]', form)?.addEventListener('click', () => {
    if (confirm('Clear all saved answers and start over?')) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });

  /* ---------------- submit ---------------- */
  function setStatus(msg: string, state: 'ok' | 'error' | '') {
    statusEl.textContent = msg;
    if (state) statusEl.dataset.state = state;
    else statusEl.removeAttribute('data-state');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // honeypot
    if ((form.elements.namedItem('website') as HTMLInputElement)?.value) {
      finishSuccess('HN-' + Date.now().toString(36).toUpperCase());
      return;
    }
    // validate every step
    for (let i = 0; i < steps.length; i++) {
      const r = validateStep(i);
      if (!r.ok) { showStep(i); reportInvalid(r); return; }
    }
    const token = (form.elements.namedItem('cf-turnstile-response') as HTMLInputElement)?.value;
    if (!token) { setStatus('Please complete the verification challenge below.', 'error'); return; }

    submitBtn.disabled = true;
    try {
      setStatus('Securing your submission…', '');
      const begin = await api('/api/apply-begin', { token });
      const { submissionId, uploadJwt } = begin;

      // upload files
      const documents: Record<string, string[]> = {};
      const total = totalFileCount();
      let done = 0;
      for (const d of INITIAL_DOC_TYPES) {
        documents[d.key] = [];
        for (const f of files.get(d.key)!) {
          setStatus(`Uploading documents… (${++done}/${total})`, '');
          const key = await uploadFile(uploadJwt, d.key, f);
          documents[d.key].push(key);
        }
      }

      setStatus('Submitting your application…', '');
      const payload = buildPayload(documents);
      await api('/api/apply', payload, uploadJwt);

      localStorage.removeItem(STORE_KEY);
      finishSuccess(submissionId);
    } catch (err) {
      console.error(err);
      setStatus(`Sorry, something went wrong submitting your application. Please try again, or email ${site.contact.email}.`, 'error');
      // refresh Turnstile so the user can retry
      // @ts-ignore
      window.turnstile?.reset?.();
    } finally {
      submitBtn.disabled = false;
    }
  });

  async function api(path: string, body: any, jwt?: string) {
    const res = await fetch(`${site.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }
  async function uploadFile(jwt: string, docType: string, file: File): Promise<string> {
    const res = await fetch(`${site.apiBase}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-doc-type': docType,
        'x-file-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) throw new Error(`upload ${file.name} -> ${res.status}`);
    const json = await res.json();
    return json.key;
  }

  function finishSuccess(ref: string) {
    form.hidden = true;
    $('.stepper')?.setAttribute('hidden', '');
    $('.apply__head')?.setAttribute('hidden', '');
    successEl.hidden = false;
    const refEl = $('[data-success-ref]') as HTMLElement;
    if (refEl) refEl.textContent = `Reference: ${ref}`;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- init ---------------- */
  const savedStep = restore();
  applyMasksIn(form); // masks + date-selects for static fields (values already restored)

  // preselect unit from ?unit= (overrides any saved draft selection)
  const params = new URLSearchParams(location.search);
  const preUnit = params.get('unit');
  if (preUnit && unitSel.querySelector(`option[value="${CSS.escape(preUnit)}"]`)) unitSel.value = preUnit;

  // attach listeners after restore so value-setting doesn't fire side effects mid-restore
  unitSel.addEventListener('change', () => { updateRentHint(); updateConditionals(); });
  form.addEventListener('change', updateConditionals);
  form.addEventListener('input', save);
  form.addEventListener('change', save);

  updateRentHint();
  updateConditionals();
  showStep(savedStep, false);
}
