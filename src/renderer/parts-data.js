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

  // iPads, newest first. `screenBase` / `batteryBase` are per-model trade
  // estimates (iPads vary far too much for a formula). Suppliers adjust around them.
  ipads: [
    { id: 'ipp129-6', name: 'iPad Pro 12.9" (6th gen, M2)', a: 'A2436', panel: 'Fully laminated LCD + glass (assembly)', screenBase: 175, batteryBase: 48, screenGotchas: 'Face ID dot-projector flex runs along the top edge — nick it and Face ID is dead with no aftermarket fix. One fully-laminated assembly (no glass-only repair); huge adhesive footprint and high crack risk on the 12.9. Disconnect the battery before the display flex.', batteryGotchas: 'Big multi-cell pack bonded hard to the chassis. Use adhesive remover and patience — a punctured iPad cell can catch fire. Budget serious bench time.' },
    { id: 'ipp11-4', name: 'iPad Pro 11" (4th gen, M2)', a: 'A2759', panel: 'Fully laminated LCD + glass (assembly)', screenBase: 105, batteryBase: 38, screenGotchas: 'Face ID flex sits along the top edge — protect it or Face ID is lost. Laminated assembly only; replace the whole unit. Heat evenly, lift at a shallow angle.', batteryGotchas: 'Cells glued to the frame; lever gently with plastic only, never metal. Disconnect the battery first.' },
    { id: 'ipair5', name: 'iPad Air (5th gen, M1)', a: 'A2588', panel: 'Laminated LCD + glass (assembly)', screenBase: 68, batteryBase: 30, screenGotchas: 'Fully bonded LCD + glass — no cheap glass-only fix, swap the whole assembly. Touch ID lives in the top button (not the screen), so a screen swap keeps it. Mind the top-edge flex.', batteryGotchas: 'Battery is bonded to the rear case; warm it and pry slowly. Never fold or puncture the cell.' },
    { id: 'ipair4', name: 'iPad Air (4th gen)', a: 'A2316', panel: 'Laminated LCD + glass (assembly)', screenBase: 62, batteryBase: 28, screenGotchas: 'Same bonded assembly as the Air 5; Touch ID in the top button is unaffected by a screen swap. Don’t disturb the top-button flex.', batteryGotchas: 'Heavily glued cell; adhesive remover and patience. A bent cell is a fire risk — bin it.' },
    { id: 'ipad10', name: 'iPad (10th gen)', a: 'A2696', panel: 'Non-laminated LCD + digitizer', screenBase: 48, batteryBase: 28, screenGotchas: 'Digitizer and LCD are separate layers — a glass-only fix is possible but fiddly. The front-camera/ambient flex runs along the LONG edge now (landscape camera) — very easy to tear. Touch ID is in the top button, so a screen swap keeps it.', batteryGotchas: 'Standard glued pack; lift with plastic tools only.' },
    { id: 'ipad9', name: 'iPad (9th gen)', a: 'A2602', panel: 'Separate glass digitizer + LCD', screenBase: 20, batteryBase: 20, screenGotchas: 'Classic separate glass digitizer over the LCD — a cracked-glass-only repair is cheap. You MUST transfer the original Touch ID home button or Touch ID is lost forever. Heavy frame adhesive; watch the long digitizer flex top-left.', batteryGotchas: 'Glued cell under the logic board shielding; straightforward but slow.' },
    { id: 'ipadmini6', name: 'iPad mini (6th gen)', a: 'A2567', panel: 'Laminated LCD + glass (assembly)', screenBase: 58, batteryBase: 26, screenGotchas: 'The faint “jelly scroll” on this panel is normal, not damage you caused — tell the customer up front. Laminated assembly; Touch ID in the top button is unaffected by a screen swap.', batteryGotchas: 'Compact, heavily-taped cell; gentle heat and plastic tools only.' },
    { id: 'ipad78', name: 'iPad (7th / 8th gen)', a: 'A2197 / A2270', panel: 'Separate glass digitizer + LCD', screenBase: 18, batteryBase: 18, screenGotchas: 'Separate glass digitizer — cheap glass-only fix. Transfer the original Touch ID home button or lose Touch ID. Lots of frame adhesive; heat and take your time at the flex corner.', batteryGotchas: 'Glued cell beneath board shielding; easy but slow, never force it.' }
  ],

  ipadScreenSuppliers: [
    { supplier: 'MobileSentrix UK', product: 'OEM-grade assembly / digitizer', closeness: 95, warranty: '6 Months', off: 14, preferred: true },
    { supplier: 'ReplaceBase', product: 'Aftermarket assembly', closeness: 92, warranty: '12 Months', off: 9, preferred: true },
    { supplier: 'iParts4U', product: 'Digitizer / assembly', closeness: 90, warranty: '6 Months', off: 5, preferred: false },
    { supplier: 'Maxbhi UK', product: 'Budget digitizer', closeness: 84, warranty: '3 Months', off: -6, preferred: false },
    { supplier: 'TVC-Mall Trade', product: 'Bulk aftermarket', closeness: 82, warranty: '3 Months', off: -9, preferred: false }
  ],

  ipadBatterySuppliers: [
    { supplier: 'MobileSentrix UK', product: 'OEM-spec cell', capacity: 'OEM', health: 'Standard', warranty: '6 Months', off: 7 },
    { supplier: 'ReplaceBase', product: 'Trade cell', capacity: 'OEM', health: 'Standard', warranty: '12 Months', off: 4 },
    { supplier: 'iParts4U', product: 'Workshop cell', capacity: 'OEM', health: 'Standard', warranty: '6 Months', off: 0 }
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

  // Laptop finder. The search box works for ANY model or part number via the
  // supplier links below; these curated entries add known panels/batteries,
  // revision gotchas and your prices. Part numbers are the COMMON ones — always
  // confirm against the sticker on the panel/battery itself.
  laptops: [
    { id: 'dell-lat-5520', brand: 'Dell', model: 'Latitude 5520 / 5530 / 5540', aliases: '5520 5530 5540 e5520',
      screen: { size: '15.6"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['N156HCA-EBA', 'NV156FHM-N4C', 'B156HAN02.1'], note: 'Non-touch slim IPS. Touch variants use a bonded glass assembly + different bezel — don’t mix them up. Brackets screw to the sides.', cost: 45 },
      battery: { spec: '53Wh (3-cell) / 63Wh (4-cell)', parts: ['Dell WY9MP', 'Dell 7FMXV'], note: '53Wh and 63Wh are physically different thicknesses — match the Wh and the connector. 4-cell is thicker; check it clears the trackpad.', cost: 42 } },
    { id: 'dell-xps-15-95xx', brand: 'Dell', model: 'XPS 15 9500 / 9510 / 9520', aliases: 'xps 15 9500 9510 9520 precision 5550',
      screen: { size: '15.6"', res: 'FHD+ 1920×1200 / UHD+ 3840×2400', hz: 60, conn: '40-pin eDP', touch: 'varies', panels: ['B156HAN08.2 (FHD+ non-touch)', 'UHD+ touch = full lid assembly'], note: 'BIG one: FHD+ non-touch is a bare panel; UHD+ is a touch assembly — totally different part and job. InfinityEdge bonding; most techs fit the whole lid. Confirm which you have before ordering.', cost: 95 },
      battery: { spec: '56Wh / 86Wh', parts: ['Dell M59JH (86Wh)', 'Dell 69KF2 (56Wh)'], note: 'Swollen XPS batteries are common — if it’s puffy, bin it safely. 56Wh vs 86Wh differ in thickness.', cost: 70 } },
    { id: 'dell-insp-15-3000', brand: 'Dell', model: 'Inspiron 15 3511 / 3520 / 3525', aliases: 'inspiron 15 3511 3520 3525 3501',
      screen: { size: '15.6"', res: 'FHD 1920×1080 / HD 1366×768', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NT156FHM-N61', 'B156HTN06.1', 'HD = NT156WHM-N4P'], note: 'Watch HD vs FHD — the HD panel is cheaper but the customer may expect FHD. Plastic lid, bezel clips off.', cost: 38 },
      battery: { spec: '41Wh / 54Wh', parts: ['Dell 266J9', 'Dell JK6Y6'], note: 'Internal; remove the base. Check 3-cell vs 4-cell connector.', cost: 36 } },
    { id: 'hp-probook-450', brand: 'HP', model: 'ProBook 450 G8 / G9 / 455', aliases: 'probook 450 g8 g9 455 440',
      screen: { size: '15.6"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['LP156WFC-SPD1', 'NV156FHM-N48', 'N156HCA-E5A'], note: 'Slim-bezel IPS. Verify the bracket offset — generic panels can sit proud of the keyboard deck.', cost: 42 },
      battery: { spec: '45Wh', parts: ['HP RH03XL', 'HP RF09XL'], note: 'RH03XL is the usual 3-cell. Internal — undo the base screws (some under the feet).', cost: 40 } },
    { id: 'hp-elitebook-840', brand: 'HP', model: 'EliteBook 840 G7 / G8 / 845', aliases: 'elitebook 840 g7 g8 845 g8',
      screen: { size: '14"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['N140HCA-E5C', 'LP140WFA-SPD1'], note: 'Low-power eDP — a non-LP panel can cause flicker/no-post. Match the LP variant.', cost: 46 },
      battery: { spec: '53Wh', parts: ['HP CC03XL'], note: 'CC03XL across several G-series. Internal.', cost: 44 } },
    { id: 'hp-pavilion-15', brand: 'HP', model: 'Pavilion 15-eg / 15-eh', aliases: 'pavilion 15 eg eh 15-eg0xxx',
      screen: { size: '15.6"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NT156FHM-N3K', 'B156HAN02.5'], note: 'Narrow-bezel; some use adhesive tabs, not just clips — warm the bezel.', cost: 40 },
      battery: { spec: '41Wh / 43Wh', parts: ['HP RF03XL', 'HP PC03XL'], note: 'RF03XL (Intel) vs different cells on AMD builds — check the sticker.', cost: 40 } },
    { id: 'hp-250-g8', brand: 'HP', model: 'HP 250 G8 / 255 G8 / 240', aliases: '250 g8 255 g8 240 g8 notebook',
      screen: { size: '15.6"', res: 'FHD 1920×1080 / HD 1366×768', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NT156FHM-N61', 'HD = N156BGA-EA3'], note: 'Budget line ships HD or FHD — confirm before quoting.', cost: 36 },
      battery: { spec: '41Wh', parts: ['HP HT03XL'], note: 'HT03XL is the common one. Internal.', cost: 38 } },
    { id: 'lenovo-thinkpad-t14', brand: 'Lenovo', model: 'ThinkPad T14 / T14s Gen 1–3', aliases: 'thinkpad t14 t14s gen 1 2 3',
      screen: { size: '14"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NV140FHM-N4T', 'B140HAN04.0', 'LP140WFH-SPD1'], note: 'Low-power eDP; touch models are a bonded assembly. Bracket tabs differ between Gen 1–2 and Gen 3.', cost: 48 },
      battery: { spec: '50Wh', parts: ['Lenovo L19M3PD5', 'Lenovo L19L3PD6'], note: 'Internal; several part numbers across gens — match the connector keying.', cost: 46 } },
    { id: 'lenovo-ideapad-3', brand: 'Lenovo', model: 'IdeaPad 3 15 / Slim 3', aliases: 'ideapad 3 15 slim 3 15iil 15are 82',
      screen: { size: '15.6"', res: 'FHD 1920×1080 / HD', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NT156FHM-N3A', 'B156HTN06.1'], note: 'Common HD vs FHD trap on this family. Plastic lid, clips.', cost: 38 },
      battery: { spec: '38Wh / 45Wh', parts: ['Lenovo L19M3PF7', 'Lenovo L19D3PF4'], note: 'L19M (long) vs L19D (short) differ in length — measure the bay.', cost: 36 } },
    { id: 'lenovo-legion-5', brand: 'Lenovo', model: 'Legion 5 / 5 Pro 15', aliases: 'legion 5 15 15ach 15arh pro',
      screen: { size: '15.6"', res: 'FHD 1920×1080 144/165Hz', hz: 165, conn: '40-pin eDP', touch: false, panels: ['LP156WFG-SPB2', 'NE156FHM-NZ1 (165Hz)', 'B156HAN08.4 (144Hz)'], note: 'MUST match the refresh rate (144 vs 165Hz) and it’s a 40-pin high-refresh panel — a 60Hz/30-pin won’t work. Pro models are QHD, different panel again.', cost: 70 },
      battery: { spec: '60Wh / 80Wh', parts: ['Lenovo L19C4PC2', 'Lenovo L20C4PC2'], note: '4-cell; match Wh and the thicker 80Wh clearance.', cost: 55 } },
    { id: 'lenovo-x1-carbon', brand: 'Lenovo', model: 'ThinkPad X1 Carbon Gen 8–11', aliases: 'x1 carbon gen 8 9 10 11',
      screen: { size: '14"', res: 'FHD 1920×1200 / WUXGA / UHD', hz: 60, conn: '40-pin eDP (low-power)', touch: 'varies', panels: ['Often supplied as full lid/bezel assembly', 'NV140WUM-N41 (WUXGA)'], note: 'Gen-specific and often sold as a whole top-cover assembly. Confirm aspect ratio (16:9 Gen8 vs 16:10 Gen9+). Touch = bonded.', cost: 110 },
      battery: { spec: '57Wh', parts: ['Lenovo L18M4P71', 'Lenovo L20M4P71'], note: 'Internal; gen-specific. Disconnect before display work.', cost: 60 } },
    { id: 'asus-vivobook-15', brand: 'Asus', model: 'VivoBook 15 X512 / X515 / X513', aliases: 'vivobook 15 x512 x515 x513 f515',
      screen: { size: '15.6"', res: 'FHD 1920×1080 / HD', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NT156FHM-N3A', 'B156HAN02.1', 'HD = NT156WHM-N44'], note: 'Many were HD — don’t assume FHD. Thin panel, easy to crack on removal.', cost: 40 },
      battery: { spec: '37Wh', parts: ['Asus B31N1912', 'Asus C31N1912'], note: 'B31 (3-cell). Internal.', cost: 40 } },
    { id: 'asus-rog-strix-g15', brand: 'Asus', model: 'ROG Strix G15 / G17', aliases: 'rog strix g15 g17 g513 g713',
      screen: { size: '15.6"', res: 'FHD 1920×1080 144/300Hz', hz: 144, conn: '40-pin eDP', touch: false, panels: ['B156HAN08.0 (144Hz)', 'B156HAN08.4', 'LQ156M1JW03 (300Hz)'], note: 'Match the exact refresh (144 vs 300Hz) and panel maker or the backlight/driver can misbehave. 40-pin high-refresh only.', cost: 68 },
      battery: { spec: '66Wh / 90Wh', parts: ['Asus C41N1906', 'Asus C41N2013'], note: 'Match Wh; 90Wh is thicker. Internal, under the board tray.', cost: 58 } },
    { id: 'asus-tuf-f15', brand: 'Asus', model: 'TUF Gaming F15 / A15', aliases: 'tuf gaming f15 a15 fx506 fa506',
      screen: { size: '15.6"', res: 'FHD 1920×1080 144Hz', hz: 144, conn: '40-pin eDP', touch: false, panels: ['B156HAN08.2', 'NV156FHM-NX1'], note: 'High-refresh 40-pin. Earlier TUF had 60Hz panels — check before ordering 144Hz.', cost: 60 },
      battery: { spec: '48Wh / 90Wh', parts: ['Asus B31N1911', 'Asus C41N1906'], note: '3-cell (48Wh) vs 4-cell (90Wh) are different parts — check cell count.', cost: 52 } },
    { id: 'acer-aspire-5', brand: 'Acer', model: 'Aspire 5 A515 / A514', aliases: 'aspire 5 a515 a514 56 57',
      screen: { size: '15.6"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NV156FHM-N4K', 'B156HAN02.1'], note: 'Slim IPS; some SKUs are TN/HD — verify. Bezel is clip + tape.', cost: 40 },
      battery: { spec: '48Wh', parts: ['Acer AP18C8K', 'Acer AP19B8K'], note: 'AP18C8K is one of the most common Acer cells across the range. Internal.', cost: 40 } },
    { id: 'acer-nitro-5', brand: 'Acer', model: 'Nitro 5 AN515-55/57/58', aliases: 'nitro 5 an515 55 57 58 an517',
      screen: { size: '15.6"', res: 'FHD 1920×1080 144Hz', hz: 144, conn: '40-pin eDP', touch: false, panels: ['LP156WFG-SPB2', 'LP156WFG-SPB3', 'NV156FHM-NX1'], note: 'High-refresh narrow-bezel; 40-pin. Use 3M stretch-release tabs behind the panel; don’t over-pry the hinge cover.', cost: 62 },
      battery: { spec: '57Wh', parts: ['Acer AP18E7M', 'Acer AP18E8M'], note: '4-cell; AP18E7M vs E8M differ in capacity/length — match it.', cost: 50 } },
    { id: 'acer-swift-3', brand: 'Acer', model: 'Swift 3 SF314 / SF315', aliases: 'swift 3 sf314 sf315',
      screen: { size: '14"', res: 'FHD 1920×1080 IPS', hz: 60, conn: '30-pin eDP', touch: false, panels: ['NV140FHM-N4H', 'B140HAN04.0'], note: 'Thin metal lid; panel is slim — easy to flex-crack. Low-power eDP.', cost: 44 },
      battery: { spec: '48Wh', parts: ['Acer AP18C8K', 'Acer AP19B8K'], note: 'Shared AP18C8K/AP19B8K family. Internal.', cost: 42 } },
    { id: 'apple-mba-m1-m2', brand: 'Apple', model: 'MacBook Air A2337 (M1) / A2681 (M2)', aliases: 'macbook air m1 m2 a2337 a2681',
      screen: { size: '13.3" / 13.6"', res: 'Retina', hz: 60, conn: 'Full display assembly', touch: false, panels: ['Complete lid assembly only (no bare panel)'], note: 'Glass is bonded — it’s a whole-assembly job. ALWAYS disconnect the battery before unplugging the display cable or you’ll blow the backlight fuse.', cost: 180 },
      battery: { spec: 'A2389 (M1) cell', parts: ['Apple A2389'], note: 'Glued to the top case; adhesive-remover and patience. Never puncture.', cost: 70 } },
    { id: 'apple-mbp-13-a2338', brand: 'Apple', model: 'MacBook Pro 13" A2338 (M1/M2)', aliases: 'macbook pro 13 a2338 m1 m2',
      screen: { size: '13.3"', res: 'Retina 2560×1600', hz: 60, conn: 'Full display assembly', touch: false, panels: ['Complete lid assembly only'], note: 'Disconnect the battery first (backlight fuse). Assembly swap, not a bare panel.', cost: 185 },
      battery: { spec: 'A2389', parts: ['Apple A2389'], note: 'Heavily glued; watch the trackpad flex underneath.', cost: 72 } },
    { id: 'apple-mbp-14-16', brand: 'Apple', model: 'MacBook Pro 14"/16" A2442 / A2485 / A2779', aliases: 'macbook pro 14 16 a2442 a2485 a2779 a2780',
      screen: { size: '14.2" / 16.2"', res: 'Liquid Retina XDR mini-LED', hz: 120, conn: 'Full display assembly', touch: false, panels: ['Complete lid assembly only — mini-LED, very costly'], note: 'ProMotion mini-LED assembly; eye-watering part cost and fragile. Quote the assembly price carefully. Battery-first rule applies.', cost: 420 },
      battery: { spec: 'A2519 (14") / A2520 (16")', parts: ['Apple A2519', 'Apple A2520'], note: 'Large glued pack; genuine-only for health reporting.', cost: 120 } },
    { id: 'ms-surface-laptop', brand: 'Microsoft', model: 'Surface Laptop 3 / 4 / 5 (13.5")', aliases: 'surface laptop 3 4 5 13.5',
      screen: { size: '13.5"', res: 'PixelSense 2256×1504 touch', hz: 60, conn: 'Bonded touch assembly', touch: true, panels: ['Bonded glass + LCD assembly (often sold with frame)'], note: 'One of the hardest repairs going — the display is heavily bonded and the chassis is glued/clipped under the Alcantara. High breakage risk; many shops send these out. Quote accordingly.', cost: 150 },
      battery: { spec: 'G3HTA061H etc.', parts: ['Surface Laptop battery (model-specific)'], note: 'Deeply glued; destructive entry. Confirm exact model/part.', cost: 90 } },
    { id: 'ms-surface-pro', brand: 'Microsoft', model: 'Surface Pro 7 / 8 / 9', aliases: 'surface pro 7 8 9 tablet',
      screen: { size: '12.3" / 13"', res: 'PixelSense touch', hz: 60, conn: 'Bonded digitizer + LCD', touch: true, panels: ['Bonded assembly — digitizer fused to LCD'], note: 'Tablet-style bonded glass; extreme heat and patience, high crack risk. Pro 8/9 are even tighter than 7. Often an assembly swap.', cost: 130 },
      battery: { spec: 'Model-specific', parts: ['Surface Pro battery (per model)'], note: 'Glued under the board; one of the trickier battery jobs.', cost: 85 } },
    { id: 'msi-gf63', brand: 'MSI', model: 'MSI GF63 / Katana / Sword 15', aliases: 'msi gf63 katana sword 15 thin',
      screen: { size: '15.6"', res: 'FHD 1920×1080 144Hz', hz: 144, conn: '30/40-pin eDP', touch: false, panels: ['N156HGA-EA3 (60Hz)', 'NV156FHM-NX3 (144Hz)'], note: 'Older GF63 was 60Hz 30-pin; newer is 144Hz — the pin count AND refresh differ. Confirm both.', cost: 55 },
      battery: { spec: '51Wh', parts: ['MSI BTY-M6M'], note: 'BTY-M6M across the thin GF/Katana line. Internal.', cost: 50 } }
  ],

  // Laptop suppliers for the search links. ALL ON by default; the tech can
  // untick any. `kinds` = which searches it appears in. Unverified sites are
  // routed via a site-scoped Google search so the link always lands.
  laptopSuppliers: [
    { id: 'ajparts', name: 'AJ Parts', kinds: 'both', note: 'UK · Dell partner 10+ yrs · 6-mo warranty', live: 'shopify', base: 'https://www.ajparts.co.uk', url: (q) => 'https://www.ajparts.co.uk/search?q=' + encodeURIComponent(q) },
    { id: 'ebay', name: 'eBay UK', kinds: 'both', note: 'Huge new/used pool — match the exact part number', live: 'ebay', url: (q) => 'https://www.ebay.co.uk/sch/i.html?_nkw=' + encodeURIComponent(q) },
    { id: 'oem', name: 'Manufacturer (direct)', kinds: 'both', note: 'The laptop brand’s own parts / support site', oem: true },
    { id: 'laptopscreen', name: 'LaptopScreen UK', kinds: 'screen', note: 'Panel compatibility database', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:laptopscreen.co.uk OR site:laptopscreen.com ' + q) },
    { id: 'screensuk', name: 'Screens.uk', kinds: 'screen', note: 'UK screen specialist', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:screens.uk ' + q) },
    { id: 'newmodeus', name: 'NewModeUS', kinds: 'screen', note: 'Panel part-number database', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:newmodeus.com ' + q) },
    { id: 'mobilesentrix', name: 'MobileSentrix UK', kinds: 'both', note: 'Trade screens & batteries', url: (q) => 'https://www.mobilesentrix.co.uk/catalogsearch/result/?q=' + encodeURIComponent(q) },
    { id: 'maxbhi', name: 'Maxbhi UK', kinds: 'both', note: 'Large catalogue incl. batteries', url: (q) => 'https://www.maxbhi.co.uk/search?q=' + encodeURIComponent(q) },
    { id: 'google', name: 'Google', kinds: 'both', note: 'Catch-all web search', url: (q) => 'https://www.google.co.uk/search?q=' + encodeURIComponent(q) }
  ],

  // Manufacturer-direct links, chosen by brand. Dell deep-links to a specific
  // machine's own parts page by its service tag (serial) when we have it.
  oem: [
    { re: /dell/i, name: 'Dell', url: (q, serial) => serial ? ('https://www.dell.com/support/home/en-uk/product-support/servicetag/' + encodeURIComponent(serial) + '/parts') : 'https://www.dell.com/support/home/en-uk?app=parts' },
    { re: /\bhp\b|hewlett|probook|elitebook|pavilion|spectre|envy|omen|victus/i, name: 'HP PartSurfer', url: (q) => 'https://partsurfer.hp.com/Search.aspx?SearchText=' + encodeURIComponent(q) },
    { re: /lenovo|thinkpad|ideapad|legion|yoga|thinkbook/i, name: 'Lenovo', url: (q) => 'https://pcsupport.lenovo.com/gb/en/search?query=' + encodeURIComponent(q) },
    { re: /acer|aspire|nitro|swift|predator|spin|travelmate/i, name: 'Acer', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:acer.com OR site:spareparts.acer.com ' + q + ' screen') },
    { re: /asus|vivobook|zenbook|\brog\b|\btuf\b|zephyrus/i, name: 'Asus', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:asus.com ' + q + ' LCD panel') },
    { re: /\bmsi\b|katana|stealth|modern|prestige|sword|cyborg|bravo/i, name: 'MSI', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:msi.com ' + q + ' panel') },
    { re: /apple|macbook/i, name: 'Apple Self Service Repair', url: () => 'https://selfservicerepair.co.uk/en-GB/home' },
    { re: /microsoft|surface/i, name: 'Microsoft Surface', url: () => 'https://support.microsoft.com/en-gb/surface' },
    { re: /samsung|galaxy book/i, name: 'Samsung', url: () => 'https://www.samsung.com/uk/support/' },
    { re: /toshiba|dynabook/i, name: 'Dynabook', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:dynabook.com ' + q + ' screen') },
    { re: /huawei|matebook/i, name: 'Huawei', url: () => 'https://consumer.huawei.com/uk/support/' },
    { re: /razer/i, name: 'Razer', url: (q) => 'https://www.google.com/search?q=' + encodeURIComponent('site:razer.com ' + q + ' panel') }
  ],
  oemFor: function (text) { const s = String(text || ''); for (const o of this.oem) { if (o.re.test(s)) return o; } return null; },

  // Which part do you need? Screen & battery are database-backed (exact part
  // numbers); the rest search your suppliers by model + keyword and carry the
  // bench gotchas that matter for that part.
  partTypes: [
    { id: 'screen', label: '🖥 Screen / panel', short: 'Screen', search: 'screen', gotchas: '' },
    { id: 'battery', label: '🔋 Battery', short: 'Battery', search: 'battery', gotchas: '' },
    { id: 'chargeport', label: '🔌 Charge port / DC jack', short: 'Charge port', search: 'charging port dc jack', gotchas: 'First decide how it mounts: SOLDERED to the motherboard (a micro-soldering job — see the Board Repair tab), a MODULAR daughterboard / DC-jack-on-a-cable (quick swap), or a USB-C board. Match the pin count and the cable length/connector. A USB-C port handles charging negotiation, so a failed port often shows as “won’t charge” — and the charging IC may need checking or programming.' },
    { id: 'keyboard', label: '⌨ Keyboard', short: 'Keyboard', search: 'keyboard UK', gotchas: 'Match UK (ISO) layout, backlit vs non-backlit, and the ribbon/connector. Many are now only sold as part of the top case/palmrest — check before quoting a bare keyboard. Some need the old metal frame transferred.' },
    { id: 'palmrest', label: '🖐 Palmrest / top case', short: 'Palmrest', search: 'palmrest top cover keyboard', gotchas: 'Usually includes the keyboard and trackpad. Colour/finish must match. The fingerprint reader and power button often have to be moved over from the old one.' },
    { id: 'hinges', label: '🔩 Hinges', short: 'Hinge set', search: 'hinge set hinges', gotchas: 'A stiff hinge has usually already cracked the lid or bottom case — check BOTH covers before quoting, or it comes straight back. Sold as left+right sets. If the hinge mount in the plastic is stripped, a new hinge alone won’t hold.' },
    { id: 'lcdback', label: '🔲 Lid / LCD back cover (A)', short: 'LCD back cover', search: 'LCD back cover rear lid', gotchas: 'Match colour/finish and touch vs non-touch. The Wi-Fi antenna cables usually run inside the lid — transfer them.' },
    { id: 'bezel', label: '🖼 Screen bezel (B)', short: 'Bezel', search: 'screen bezel surround', gotchas: 'Clip + adhesive; the camera cut-out position varies by SKU. Narrow-bezel models are fragile — warm the adhesive before prying.' },
    { id: 'bottom', label: '📦 Bottom case (D)', short: 'Bottom case', search: 'bottom base cover', gotchas: 'Transfer the rubber feet; screw lengths vary around the case. Some have an integrated SSD/Wi-Fi access door.' },
    { id: 'cooling', label: '🌀 Fan / heatsink', short: 'Cooling fan', search: 'cooling fan heatsink', gotchas: 'Fan-only vs a combined fan+heatsink assembly differ — check which you need. Re-paste the CPU/GPU and replace the thermal pads. Dual-fan models have separate CPU and GPU fans.' },
    { id: 'trackpad', label: '🖲 Trackpad', short: 'Trackpad', search: 'trackpad touchpad', gotchas: 'Often part of the palmrest and not sold separately. Match the connector and mounting bracket.' },
    { id: 'speakers', label: '🔊 Speakers', short: 'Speaker set', search: 'speaker set left right', gotchas: 'Usually a left+right pair; check the connector and cable routing.' },
    { id: 'webcam', label: '📷 Webcam / camera', short: 'Webcam', search: 'webcam camera module', gotchas: 'Often built into the screen assembly and not separately replaceable. Match IR (Windows Hello) vs standard.' },
    { id: 'wifi', label: '📶 Wi-Fi card', short: 'Wi-Fi card', search: 'wifi card m.2 ngff', gotchas: 'M.2 2230 (NGFF) vs older half-mini PCIe. Some older HP/Lenovo have a BIOS WHITELIST that blocks non-approved cards — check before fitting. Transfer the MAIN/AUX antenna leads.' },
    { id: 'charger', label: '⚡ Charger / PSU', short: 'Charger', search: 'charger ac adapter', gotchas: 'Match the WATTAGE (or higher) and the tip — barrel size or USB-C PD. Under-wattage causes slow/no charge and brown-outs under load. USB-C chargers must support the right PD profile.' },
    { id: 'ssd', label: '💽 SSD / storage', short: 'SSD', search: 'ssd m.2 nvme', gotchas: 'M.2 NVMe vs M.2 SATA vs soldered eMMC — not every slot takes NVMe. Size 2280 vs 2242. Some ultrabooks have soldered storage (no upgrade).' },
    { id: 'ram', label: '🧠 RAM / memory', short: 'RAM', search: 'ram memory so-dimm', gotchas: 'Lots of modern laptops have SOLDERED RAM — confirm it’s actually upgradable before quoting. Match DDR4 vs DDR5 and the speed; SO-DIMM only if it’s socketed.' },
    { id: 'other', label: '🔧 Other part…', short: 'Part', search: '', gotchas: 'Type exactly what you need in the search box (e.g. “flex cable”, “CMOS battery”, “power button board”) and it’ll search your suppliers for it.' }
  ],

  // Model-specific part gotchas, keyed by laptop id then part-type id. Shown at
  // the top of the finder when a known model is matched. Trade-typical — hedged
  // where builds vary; always confirm against the machine in front of you.
  partNotesByModel: {
    'dell-lat-5520': { chargeport: 'Charges over USB-C — the port is soldered to the motherboard, so a dead port is a board-level job, not a modular swap.', ram: '2× SO-DIMM DDR4 slots — socketed and upgradable.', ssd: 'Single M.2 2280 NVMe slot.' },
    'dell-xps-15-95xx': { chargeport: 'USB-C charging — port soldered to the board.', ram: '2× SO-DIMM slots — socketed.', ssd: 'M.2 2280 NVMe (two slots on some builds).' },
    'dell-insp-15-3000': { chargeport: 'Round barrel DC jack on a short cable — MODULAR, a quick swap, no soldering.', ram: 'SO-DIMM (one or two slots by build) — socketed.', ssd: 'M.2 2280 NVMe; some builds also have a 2.5" SATA bay.' },
    'hp-probook-450': { chargeport: 'Blue-tip barrel DC jack on a cable — MODULAR. G9 also charges over USB-C.', ram: '2× SO-DIMM slots — socketed.', ssd: 'M.2 2280 NVMe.' },
    'hp-elitebook-840': { chargeport: 'USB-C charging — port soldered to the board.', ram: 'Usually one SO-DIMM slot; some configs have soldered memory — check before quoting an upgrade.', ssd: 'M.2 2280 NVMe.' },
    'hp-pavilion-15': { chargeport: 'Blue-tip barrel DC jack on a cable — MODULAR.', ram: 'Often 1 soldered + 1 SO-DIMM slot — check the config.', ssd: 'M.2 2280 NVMe.' },
    'hp-250-g8': { chargeport: 'Barrel DC jack on a cable on most builds (modular) — verify it isn’t board-mounted on yours.', ram: '1–2 SO-DIMM slots — socketed.', ssd: 'M.2 2280 NVMe (+ 2.5" SATA on some).' },
    'lenovo-thinkpad-t14': { chargeport: 'Charges over USB-C — the port is soldered to the board, so a dead port is a board-repair job.', ram: 'The T14s has SOLDERED RAM (not upgradable). The standard T14 has soldered memory PLUS one SO-DIMM slot — confirm which you’ve got before quoting an upgrade.', ssd: 'M.2 NVMe — 2280 on the T14; the T14s Gen 1 uses the shorter 2242.', keyboard: 'ThinkPad keyboard is its own replaceable part (not fused to the palmrest) — match the exact FRU and backlit vs non-backlit.' },
    'lenovo-ideapad-3': { chargeport: 'Round barrel DC jack on a short cable — MODULAR. Some newer builds use USB-C.', ram: 'Usually 4–8GB soldered plus one SO-DIMM slot — check the config.', ssd: 'M.2 2280 NVMe.' },
    'lenovo-legion-5': { chargeport: 'Slim rectangular-tip barrel on a cable (MODULAR) plus USB-C PD — note it needs the big (≥230W) brick under gaming load.', ram: '2× SO-DIMM slots — socketed.', ssd: 'Two M.2 2280 NVMe slots.' },
    'lenovo-x1-carbon': { chargeport: 'USB-C charging — port soldered to the board.', ram: 'SOLDERED — not upgradable.', ssd: 'M.2 2280 NVMe (2242 on some gens).', keyboard: 'Separate replaceable keyboard — match the FRU and backlight.' },
    'asus-vivobook-15': { chargeport: 'Barrel DC jack on a cable — MODULAR.', ram: 'Often 4–8GB soldered plus one SO-DIMM slot — check before quoting.', ssd: 'M.2 2280 NVMe (some have a 2.5" SATA bay).' },
    'asus-rog-strix-g15': { chargeport: 'Proprietary barrel on a cable (MODULAR) + USB-C PD — gaming load needs the big brick.', ram: '2× SO-DIMM slots.', ssd: 'Two M.2 2280 NVMe slots.' },
    'asus-tuf-f15': { chargeport: 'Barrel DC jack on a cable — MODULAR.', ram: 'Typically 8GB soldered + one SO-DIMM slot.', ssd: 'M.2 2280 NVMe (+ 2.5" on older builds).' },
    'acer-aspire-5': { chargeport: 'Barrel DC jack on a cable — MODULAR.', ram: 'Often one soldered + one SO-DIMM slot — check.', ssd: 'M.2 2280 NVMe (+ 2.5" SATA on some).' },
    'acer-nitro-5': { chargeport: 'Barrel on a cable (MODULAR) + a large PSU — match the wattage.', ram: '2× SO-DIMM slots.', ssd: 'Two M.2 slots (+ 2.5" bay on some).' },
    'acer-swift-3': { chargeport: 'USB-C charging on recent models (soldered port); older ones use a barrel jack.', ram: 'SOLDERED — not upgradable.', ssd: 'M.2 2280 NVMe.' },
    'apple-mba-m1-m2': { chargeport: 'M1: USB-C; M2: MagSafe 3 + USB-C. Charge circuitry is on the logic board.', ram: 'Unified memory inside the chip — SOLDERED, not upgradable.', ssd: 'Soldered to the logic board — not user-replaceable.' },
    'apple-mbp-13-a2338': { chargeport: 'USB-C charging via the logic board.', ram: 'Unified, SOLDERED — not upgradable.', ssd: 'Soldered — not replaceable.' },
    'apple-mbp-14-16': { chargeport: 'MagSafe 3 + USB-C (Thunderbolt).', ram: 'Unified, SOLDERED.', ssd: 'Soldered — not replaceable.' },
    'ms-surface-laptop': { chargeport: 'Charges via the Surface Connect port (and USB-C on 4/5).', ram: 'SOLDERED — not upgradable.', ssd: 'Removable M.2 2230 SSD under the keyboard (SL3/4/5) — one of the few Surface parts you can actually swap.' },
    'ms-surface-pro': { chargeport: 'Surface Connect port (USB-C charging on 8/9).', ram: 'SOLDERED.', ssd: 'Removable M.2 2230 SSD under the kickstand.' },
    'msi-gf63': { chargeport: 'Barrel DC jack on a cable — MODULAR.', ram: '2× SO-DIMM slots.', ssd: 'M.2 2280 NVMe (+ 2.5" SATA on some).' }
  },

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
