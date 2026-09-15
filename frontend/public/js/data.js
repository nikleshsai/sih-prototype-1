/**
 * data.js — Static reference data for FarmConnect frontend.
 * Crops and districts are hardcoded here so dropdowns always work
 * even when the backend API is unreachable or the DB is empty.
 *
 * Pages that need crops/districts should include this file and call:
 *   DATA.populateCrops(selectEl)
 *   DATA.populateDistricts(selectEl)
 */

const DATA = {

  /* ────────────────────────────────────────────
     CROPS  (matches seed.js crop_yield_reference)
  ──────────────────────────────────────────── */
  CROPS: [
    'Tomato',
    'Onion',
    'Potato',
    'Brinjal',
    'Okra',
    'Carrot',
    'Cabbage',
    'Cauliflower',
    'Beans',
    'Spinach',
    'Chilli',
    'Banana',
    'Mango',
    'Paddy',
    'Maize',
    'Groundnut',
    'Sugarcane',
  ],

  /* ────────────────────────────────────────────
     DISTRICTS  (Tamil Nadu — 38 districts)
  ──────────────────────────────────────────── */
  DISTRICTS: [
    'Ariyalur',
    'Chengalpattu',
    'Chennai',
    'Coimbatore',
    'Cuddalore',
    'Dharmapuri',
    'Dindigul',
    'Erode',
    'Kallakurichi',
    'Kancheepuram',
    'Karur',
    'Krishnagiri',
    'Madurai',
    'Nagapattinam',
    'Namakkal',
    'Perambalur',
    'Pudukkottai',
    'Ramanathapuram',
    'Ranipet',
    'Salem',
    'Sivaganga',
    'Tenkasi',
    'Thanjavur',
    'The Nilgiris',
    'Theni',
    'Thoothukudi',
    'Tiruchirappalli',
    'Tirunelveli',
    'Tirupathur',
    'Tiruppur',
    'Tiruvannamalai',
    'Tiruvarur',
    'Tiruvallur',
    'Vellore',
    'Viluppuram',
    'Virudhunagar',
  ],

  /* ────────────────────────────────────────────
     HELPERS
  ──────────────────────────────────────────── */

  /**
   * Populate a <select> element with crop options.
   * @param {HTMLSelectElement} el  - The select element to populate
   * @param {boolean} allOption     - If true, prepend "All Crops" option
   */
  populateCrops(el, allOption = false) {
    if (!el) return;
    // Keep existing first option (e.g. "Select crop..." placeholder)
    const placeholder = el.options[0] ? el.options[0].outerHTML : '';
    el.innerHTML = placeholder;
    if (allOption) el.innerHTML += '<option value="">All Crops</option>';
    this.CROPS.forEach(c => {
      el.innerHTML += `<option value="${c}">${c}</option>`;
    });
  },

  /**
   * Populate a <select> element with district options.
   * @param {HTMLSelectElement} el  - The select element to populate
   * @param {boolean} allOption     - If true, prepend "All Districts" option (selected)
   */
  populateDistricts(el, allOption = false) {
    if (!el) return;
    const placeholder = el.options[0] ? el.options[0].outerHTML : '';
    el.innerHTML = allOption
      ? '<option value="">All districts (state level)</option>'
      : placeholder;
    this.DISTRICTS.forEach(d => {
      el.innerHTML += `<option value="${d}">${d}</option>`;
    });
  },

  /**
   * Try to fetch crops from the API and fall back to static list.
   * Returns the final array of crop name strings.
   */
  async fetchCrops() {
    try {
      const res = await fetch('/api/public/crops');
      if (!res.ok) throw new Error('not ok');
      const json = await res.json();
      const apiCrops = (json.crops || []).map(c => c.crop_name || c);
      if (apiCrops.length) return [...new Set(apiCrops)];
    } catch (_) { /* fall through */ }
    return [...this.CROPS];
  },

  /**
   * Try to fetch districts from the API and fall back to static list.
   */
  async fetchDistricts() {
    try {
      const res = await fetch('/api/public/districts');
      if (!res.ok) throw new Error('not ok');
      const json = await res.json();
      const apiDistricts = json.districts || [];
      if (apiDistricts.length) return apiDistricts;
    } catch (_) { /* fall through */ }
    return [...this.DISTRICTS];
  },

  /**
   * Smart populate: tries API first, falls back to static list.
   * Use this for any page that wants live data when possible.
   */
  async smartPopulateCrops(el) {
    if (!el) return;
    const crops = await this.fetchCrops();
    const placeholder = el.options[0] ? el.options[0].outerHTML : '';
    el.innerHTML = placeholder;
    crops.forEach(c => {
      el.innerHTML += `<option value="${c}">${c}</option>`;
    });
  },

  async smartPopulateDistricts(el, allOption = false) {
    if (!el) return;
    const districts = await this.fetchDistricts();
    el.innerHTML = allOption ? '<option value="">All districts (state level)</option>' : '';
    districts.forEach(d => {
      el.innerHTML += `<option value="${d}">${d}</option>`;
    });
  },
};
