/* The program flow chart's access table, as data. navtest reads it; so will the Quality review suites.

   Each page: the address it lives at, what proves it is on screen, and who may reach it. `ph`, `tp`, `tl`, `lp`
   are phone, iPad portrait, iPad landscape and laptop; `mgmt` and `staff` the roles. A value of 1 is "reachable",
   0 is "refused or not there", 'message' is "reachable, but it says to use a phone or tablet", 'view' is "opens,
   but nothing in it can be changed". `built:false` is a page the flow chart has and a later phase builds. */
const F = '#/f/f1/s/s1', G3 = '#/f/f2/s/s3';
module.exports = {
  DEVICES: { ph: 390, tp: 820, tl: 1024, lp: 1280 },
  PAGES: [
    { id: 'Facilities', url: '/index.html#/', probe: '#pageFacilities', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Sheets', url: '/index.html#/f/f1', probe: '#pageSheets', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Sheet settings', url: '/index.html' + F + '/settings', probe: '#pageSettings', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 'view' },
    { id: 'Ice: Rink view', url: '/ice.html' + F + '/rink', probe: '#rink', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Ice: Trends', url: '/ice.html' + F + '/trends', probe: '#home', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Ice: Measurement builder', url: '/ice.html' + F + '/build', probe: '#chips', msg: '#laptopMsg', ph: 1, tp: 1, tl: 1, lp: 'message', mgmt: 1, staff: 1 },
    { id: 'Ice Preferences', url: '/ice.html' + F + '/rink', open: '#gear', probe: '#scrim.on', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 'view' },
    { id: 'Glass: Rink view', url: '/glass.html' + F, probe: '#plan', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Glass: Builder', url: '/glass.html' + G3 + '/build', probe: '#builder', msg: '#bldLaptop', ph: 1, tp: 1, tl: 1, lp: 'message', mgmt: 1, staff: 1 },
    { id: 'Glass: Inventory', url: '/glass.html' + F + '/inventory', probe: '#spares', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Staff', url: '/index.html#/staff', probe: '#sharedCodes', ph: 1, tp: 1, tl: 1, lp: 1, mgmt: 1, staff: 0 },
    /* Quality review is the laptop's, and is built in D6. */
    { id: 'Quality review: Changes', built: false, ph: 0, tp: 0, tl: 0, lp: 1, mgmt: 1, staff: 0 },
    { id: 'Quality review: Current state', built: false, ph: 0, tp: 0, tl: 0, lp: 1, mgmt: 1, staff: 0 },
    { id: 'Quality review: Flags', built: false, ph: 0, tp: 0, tl: 0, lp: 1, mgmt: 1, staff: 1 },
    { id: 'Quality review: Reports', built: false, ph: 0, tp: 0, tl: 0, lp: 1, mgmt: 1, staff: 0 }
  ]
};
