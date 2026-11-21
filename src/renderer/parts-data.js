'use strict';

// Reference data for the Parts & Quotes tab (re-engineered from the standalone
// "Screen & Battery Finder"). Static trade knowledge; live values (prices, URLs)
// are overridden per shop and saved in the portable tools.json.
window.TM_PARTS = {
  // iPhone models, newest first. `panel` = native display. Gotchas are bench
  // warnings for screen and battery jobs.
  iphones: [
    { id: '16pm', name: 'iPhone 16 Pro Max', a: 'A3296', panel: 'Soft OLED (ProMotion 120Hz)', screenGotchas: 'Friction-fit screen gasket; disconnect battery before display flexes; Face ID dot projector module is exceptionally delicate.', batteryGotchas: 'Electrically-induced 9-12V adhesive release tabs; verify BMS serial transfer if the "important battery message" is to be avoided.' },
    { id: '16pro', name: 'iPhone 16 Pro', a: 'A3293', panel: 'Soft OLED (ProMotion 120Hz)', screenGotchas: 'Bottom-opening chassis; lift carefully at 90 degrees to avoid ripping the ambient-light-sensor flex.', batteryGotchas: 'Needs precise thermal-plate softening and pull-tab tension control.' },
    { id: '16plus', name: 'iPhone 16 Plus', a: 'A3289', panel: 'Flexible OLED', screenGotchas: 'Standard dual-flex layout; watch the earpiece speaker clip retention.', batteryGotchas: 'Standard pull-tab mechanism; check bottom loudspeaker module clearance.' },
    { id: '16', name: 'iPhone 16', a: 'A3287', panel: 'Flexible OLED', screenGotchas: 'Crisp OLED panel; check TrueTone programmer compatibility before sealing.', batteryGotchas: 'Direct battery access after removing the lower Taptic Engine bracket.' },
    { id: '15pm', name: 'iPhone 15 Pro Max', a: 'A3108', panel: 'Soft OLED (Titanium Frame)', screenGotchas: 'Titanium bezel scratches easily; use a nylon spudger; watch the delicate Face ID flex near the top bezel.', batteryGotchas: 'Dual pouch pull tabs; watch the metal chassis grounding clips.' },
    { id: '15pro', name: 'iPhone 15 Pro', a: 'A3102', panel: 'Soft OLED (Titanium Frame)', screenGotchas: 'Exact screw placement around the earpiece bracket is crucial to avoid screen pressure spots.', batteryGotchas: 'Standard pull tabs; disconnect the wireless charging coil assembly first.' },
    { id: '15plus', name: 'iPhone 15 Plus', a: 'A3094', panel: 'Flexible OLED', screenGotchas: 'Book-style right-side opening; disconnect the battery immediately.', batteryGotchas: 'Standard adhesive strips; verify BMS health reading.' },
    { id: '15', name: 'iPhone 15', a: 'A3090', panel: 'Flexible OLED', screenGotchas: 'Dynamic Island sensor array is integrated on the screen flex; handle with extreme care.', batteryGotchas: 'Standard replacement; check charging-port flex alignment.' },
    { id: '14pm', name: 'iPhone 14 Pro Max', a: 'A2896', panel: 'Soft OLED (Dynamic Island)', screenGotchas: 'Always program the ambient-light sensor / TrueTone (JCID or i2C) to prevent an auto-brightness lock.', batteryGotchas: 'Battery data serial tagging required for a 100% health display without the warning banner.' },
    { id: '14pro', name: 'iPhone 14 Pro', a: 'A2890', panel: 'Soft OLED (Dynamic Island)', screenGotchas: 'Dynamic Island camera bracket screws are asymmetric; mixing them punctures the LCD.', batteryGotchas: 'BMS transfer recommended for 14-series health reporting.' },
    { id: '14plus', name: 'iPhone 14 Plus', a: 'A2886', panel: 'Flexible OLED', screenGotchas: 'Large screen; press the waterproof adhesive gasket evenly with a roller.', batteryGotchas: 'Easy access after lower shield removal.' },
    { id: '14', name: 'iPhone 14', a: 'A2882', panel: 'Flexible OLED', screenGotchas: 'Standard dual flex; check proximity sensor alignment.', batteryGotchas: 'Standard adhesive pull tabs.' },
    { id: '13pm', name: 'iPhone 13 Pro Max', a: 'A2643', panel: 'Soft OLED (120Hz ProMotion)', screenGotchas: 'Transfer the original earpiece flex to keep Face ID (solder or tag-on flex for no message).', batteryGotchas: 'Spot-weld the original BMS board onto the new cell to eliminate the "important battery message".' },
    { id: '13pro', name: 'iPhone 13 Pro', a: 'A2483', panel: 'Soft OLED (120Hz ProMotion)', screenGotchas: 'Match IC serial numbers when swapping screens; high sensitivity to static discharge.', batteryGotchas: 'BMS transfer required.' },
    { id: '13', name: 'iPhone 13', a: 'A2482', panel: 'Flexible OLED', screenGotchas: 'Smaller notch width; earpiece module is modular.', batteryGotchas: 'Standard pull tabs.' },
    { id: '13mini', name: 'iPhone 13 mini', a: 'A2481', panel: 'Flexible OLED', screenGotchas: 'Tight internal tolerances; route the battery flex under the wireless charging coil correctly.', batteryGotchas: 'Compact cell layout; careful with the lower microphone ribbon.' },
    { id: '12pm', name: 'iPhone 12 Pro Max', a: 'A2342', panel: 'Soft OLED', screenGotchas: 'Ceramic Shield edges are brittle; use a heated opening bag.', batteryGotchas: 'Standard adhesive.' },
    { id: '11', name: 'iPhone 11', a: 'A2111', panel: 'Incell LCD', screenGotchas: 'LCD panel is thicker than OLED; ensure the display sits flush in the housing frame.', batteryGotchas: 'Easy LCD-era entry; no specialised BMS welding needed on the 11.' }
  ],

  // Screen supplier tiers. `off` is added to a per-model base trade estimate.
  screenSuppliers: [
    { supplier: 'MobileSentrix UK', product: 'XO7 Soft OLED', type: 'Soft OLED', closeness: 96, warranty: 'Lifetime', off: 12, preferred: true },
    { supplier: 'ReplaceBase', product: 'Repair Pro Soft OLED', type: 'Soft OLED', closeness: 95, warranty: 'Lifetime', off: 10, preferred: true },
    { supplier: 'iParts4U', product: 'Pro Soft OLED', type: 'Soft OLED', closeness: 94, warranty: '12 Months', off: 8, preferred: false },
    { supplier: 'RepairBuyer', product: 'Premium Soft OLED', type: 'Soft OLED', closeness: 93, warranty: '12 Months', off: 6, preferred: false },
    { supplier: 'Square Repair Trade', product: 'Grade-A Trade OLED', type: 'Soft OLED', closeness: 94, warranty: '12 Months', off: 9, preferred: false },
    { supplier: 'Maxbhi UK', product: 'OEM-Spec Aftermarket OLED', type: 'Soft OLED', closeness: 92, warranty: '6 Months', off: 4, preferred: false },
    { supplier: 'Direct Mobiles Trade', product: 'Standard OLED', type: 'Soft OLED', closeness: 90, warranty: '12 Months', off: 0, preferred: false },
    { supplier: 'Fonefunshop', product: 'Hard OLED High Grade', type: 'Hard OLED', closeness: 88, warranty: '12 Months', off: 2, preferred: false },
    { supplier: 'TVC-Mall Trade', product: 'Incell LCD Budget', type: 'Incell LCD', closeness: 80, warranty: '6 Months', off: -12, preferred: false },
    { supplier: 'Laptop Screen UK', product: 'Refurbished Original OEM', type: 'Original OEM', closeness: 100, warranty: 'Lifetime', off: 35, preferred: false }
  ],

  batterySuppliers: [
    { supplier: 'MobileSentrix UK', product: 'AmpSentrix Pro (100% Health)', capacity: 'High Cap', health: 'No pop-up', warranty: 'Lifetime', off: 6 },
    { supplier: 'ReplaceBase', product: 'Pro Diagnostic Cell', capacity: 'OEM Spec', health: 'Direct readout', warranty: '12 Months', off: 5 },
    { supplier: 'iParts4U', product: 'High Capacity Premium Cell', capacity: '+15% mAh', health: 'BMS transfer', warranty: '12 Months', off: 4 },
    { supplier: 'RepairBuyer', product: 'Standard Trade Cell', capacity: 'OEM', health: 'Standard', warranty: '12 Months', off: 0 },
    { supplier: 'Fonefunshop', product: 'Workshop Grade Cell', capacity: 'OEM', health: 'Standard', warranty: '12 Months', off: -2 }
  ],

  suppliersDir: [
    { name: 'MobileSentrix UK', specialty: 'AmpSentrix & XO7 Screens', warranty: 'Lifetime (excl. physical damage)', cutoff: '19:00 UK dispatch', url: 'https://www.mobilesentrix.co.uk' },
    { name: 'ReplaceBase', specialty: 'Repair Pro & OEM Parts', warranty: 'Lifetime on screens', cutoff: '17:30 UK dispatch', url: 'https://www.replacebase.co.uk' },
    { name: 'iParts4U', specialty: 'Pro Soft OLED & Tooling', warranty: '12 months trade', cutoff: '16:30 UK dispatch', url: 'https://www.iparts4u.co.uk' },
    { name: 'RepairBuyer', specialty: 'Trade Screens & Batteries', warranty: '12 months replacement', cutoff: '16:00 UK dispatch', url: 'https://www.repairbuyer.co.uk' },
    { name: 'Fonefunshop', specialty: 'Diagnostic Tools & Parts', warranty: '12 months trade', cutoff: '15:30 UK dispatch', url: 'https://www.fonefunshop.co.uk' },
    { name: 'TVC-Mall Trade', specialty: 'Bulk Aftermarket Screens', warranty: '6 months supplier', cutoff: '14:00 international', url: 'https://www.tvc-mall.com' },
    { name: 'Maxbhi UK', specialty: 'Extensive LCD & OLED catalogue', warranty: '6 months', cutoff: '15:00 dispatch', url: 'https://www.maxbhi.co.uk' },
    { name: 'Laptop Screen UK', specialty: 'Display panels & touch units', warranty: '12 months panel', cutoff: '16:30 dispatch', url: 'https://www.laptopscreen.co.uk' },
    { name: 'Direct Mobiles Trade', specialty: 'Refurbished & new parts', warranty: '12 months', cutoff: '16:00 dispatch', url: 'https://www.directmobiles.co.uk' },
    { name: 'Square Repair Trade', specialty: 'London trade hub & parts', warranty: '12 months', cutoff: '17:00 dispatch', url: 'https://www.squarerepair.co.uk' }
  ],

  // Local competitor retail prices (screen replacement) by model id.
  competitors: [
    { name: 'Apple (Watford Atria)', loc: 'Watford', prices: { '16pm': 389, '16pro': 349, '16plus': 329, '16': 299, '15pm': 379, '15pro': 339, '15plus': 319, '15': 289, '14pm': 369, '14pro': 329, '14plus': 309, '14': 279, '13pm': 329, '13pro': 299, '13': 279, '13mini': 259, '12pm': 319, '11': 229 } },
    { name: 'RL Supplies', loc: 'Rickmansworth', prices: { '16pm': 220, '16pro': 195, '16plus': 185, '16': 160, '15pm': 210, '15pro': 185, '15plus': 175, '15': 150, '14pm': 195, '14pro': 170, '14plus': 160, '14': 140, '13pm': 160, '13pro': 145, '13': 125, '13mini': 115, '12pm': 135, '11': 75 } },
    { name: 'Golden Mobiles', loc: 'Vicarage Rd, Watford', prices: { '16pm': 210, '16pro': 185, '16plus': 175, '16': 150, '15pm': 200, '15pro': 175, '15plus': 165, '15': 140, '14pm': 185, '14pro': 160, '14plus': 150, '14': 130, '13pm': 150, '13pro': 135, '13': 115, '13mini': 105, '12pm': 125, '11': 70 } },
    { name: 'Ricky High St Repair', loc: 'Rickmansworth WD3', prices: { '16pm': 230, '16pro': 205, '16plus': 195, '16': 170, '15pm': 220, '15pro': 195, '15plus': 185, '15': 160, '14pm': 205, '14pro': 180, '14plus': 170, '14': 150, '13pm': 170, '13pro': 155, '13': 135, '13mini': 125, '12pm': 145, '11': 80 } },
    { name: 'Watford High St Centre', loc: 'Watford WD17', prices: { '16pm': 215, '16pro': 190, '16plus': 180, '16': 155, '15pm': 205, '15pro': 180, '15plus': 170, '15': 145, '14pm': 190, '14pro': 165, '14plus': 155, '14': 135, '13pm': 155, '13pro': 140, '13': 120, '13mini': 110, '12pm': 130, '11': 72 } }
  ],

  laptops: [
    { brand: 'Lenovo', model: 'ThinkPad T14 Gen 2 / Gen 3', part: 'NV156FHM-N48', size: '15.6" 1920x1080', panel: 'IPS Matte 30-pin', touch: false, cost: 48, supplier: 'Laptop Screen UK', url: 'https://www.laptopscreen.co.uk', gotchas: 'Check bracket mount positions (top/bottom screw tabs vs adhesive bezel).' },
    { brand: 'ASUS', model: 'ROG Strix G15 / G17', part: 'B156HAN08.0', size: '15.6" 1920x1080 144Hz', panel: 'IPS 40-pin eDP', touch: false, cost: 65, supplier: 'ReplaceBase', url: 'https://www.replacebase.co.uk', gotchas: 'Match the exact refresh rate (144Hz vs 300Hz) or the backlight driver can fail.' },
    { brand: 'Dell', model: 'Latitude 5520 / 5530', part: 'N156HCA-EA1', size: '15.6" 1920x1080', panel: 'IPS Slim 30-pin', touch: false, cost: 45, supplier: 'MobileSentrix UK', url: 'https://www.mobilesentrix.co.uk', gotchas: 'Slim bezel uses double-sided tape; a heat gun is needed for bezel removal.' },
    { brand: 'Apple', model: 'MacBook Pro 13" A2338 (M1/M2)', part: 'RETINA-A2338-ASSEM', size: '13.3" 2560x1600 Retina', panel: 'Complete lid assembly', touch: false, cost: 185, supplier: 'iParts4U', url: 'https://www.iparts4u.co.uk', gotchas: 'Always disconnect the battery before unplugging the display cable (backlight fuse).' },
    { brand: 'HP', model: 'ProBook 450 G8 / G9', part: 'LM156LFCL03', size: '15.6" 1920x1080', panel: 'IPS Slim 30-pin', touch: false, cost: 42, supplier: 'RepairBuyer', url: 'https://www.repairbuyer.co.uk', gotchas: 'Verify the bracket offset; generic replacements can misalign with the keyboard deck.' },
    { brand: 'Acer', model: 'Nitro 5 AN515-57 / AN515-58', part: 'LP156WFG-SPB2', size: '15.6" 1920x1080 144Hz', panel: 'IPS Narrow Bezel 40-pin', touch: false, cost: 62, supplier: 'Laptop Screen UK', url: 'https://www.laptopscreen.co.uk', gotchas: 'Use 3M stretch-release tabs behind the panel; do not over-pry the lower hinge cover.' }
  ],

  // Catalogue search URL builders per supplier (used for Buy links when no exact
  // product URL has been saved).
  searchUrl: {
    'MobileSentrix UK': (q) => 'https://www.mobilesentrix.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q),
    'ReplaceBase': (q) => 'https://www.replacebase.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q),
    'iParts4U': (q) => 'https://www.iparts4u.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q),
    'RepairBuyer': (q) => 'https://www.repairbuyer.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q),
    'Fonefunshop': (q) => 'https://www.fonefunshop.co.uk/index.php?route=product/search&search=' + encodeURIComponent(q),
    'Maxbhi UK': (q) => 'https://www.maxbhi.co.uk/search?q=' + encodeURIComponent(q),
    'Square Repair Trade': (q) => 'https://www.squarerepair.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q),
    'Direct Mobiles Trade': (q) => 'https://www.directmobiles.co.uk/search?q=' + encodeURIComponent(q),
    'TVC-Mall Trade': (q) => 'https://www.tvc-mall.com/search.html?SearchText=' + encodeURIComponent(q),
    'Laptop Screen UK': (q) => 'https://www.laptopscreen.co.uk/?s=' + encodeURIComponent(q)
  }
};
